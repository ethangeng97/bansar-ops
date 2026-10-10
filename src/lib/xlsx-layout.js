// ============================================================================
// xlsx-layout.js — 按“打印版式”生成 Excel 的公共小工具
// 放舱信息、提单的 Excel 都用它：A4 纵向、宽度缩放到一页、合并单元格整块加边框，
// 字号 / 图片按网页尺寸换算，保证打印出来和网页 / PDF / Word 版一致。
// ============================================================================
import { downloadBlob, sanitizeFileStem } from "./document-download.js";

let excelJsPromise;
export async function getExcelJS() {
  if (!excelJsPromise) excelJsPromise = import("exceljs");
  const mod = await excelJsPromise;
  return mod.default || mod;
}

// 表格总宽约 105 个字符 ≈ 792px，打印时缩放到 A4 内容区（182~186mm ≈ 688~703px）。
// 字号和图片按同样比例放大，打印出来才和网页一样大：网页 px → Excel pt。
export const PRINT_SCALE = 792 / 690;
export const pt = px => +(px * 0.75 * PRINT_SCALE).toFixed(1);

export const FONT = "Microsoft YaHei";
export const thin = (argb = "FF888888") => ({ style: "thin", color: { argb } });
export const box = (argb = "FF888888") => ({ top: thin(argb), right: thin(argb), bottom: thin(argb), left: thin(argb) });
export const fill = argb => ({ type: "pattern", pattern: "solid", fgColor: { argb } });

// 合并单元格的边框 / 底色要写到区域里的每一格，否则打印时只有左上角那格有框线
export function styleRange(ws, row1, col1, row2, col2, style) {
  for (let r = row1; r <= row2; r++) {
    for (let c = col1; c <= col2; c++) {
      const cell = ws.getCell(r, c);
      cell.style = { ...cell.style, ...style };
    }
  }
}

// 合并区域并写值；border 只画区域外框（内部合并线不需要）
export function block(ws, row1, col1, row2, col2, value, { border, ...style } = {}) {
  if (row2 > row1 || col2 > col1) ws.mergeCells(row1, col1, row2, col2);
  styleRange(ws, row1, col1, row2, col2, style);
  if (border) {
    for (let r = row1; r <= row2; r++) {
      for (let c = col1; c <= col2; c++) {
        const edges = {};
        if (r === row1 && border.top) edges.top = border.top;
        if (r === row2 && border.bottom) edges.bottom = border.bottom;
        if (c === col1 && border.left) edges.left = border.left;
        if (c === col2 && border.right) edges.right = border.right;
        const cell = ws.getCell(r, c);
        cell.border = { ...cell.border, ...edges };
      }
    }
  }
  const cell = ws.getCell(row1, col1);
  cell.value = value ?? "";
  return cell;
}

// 一个格子里“小字标签 + 正文”两段（提单格子的样式）
export function labelled(label, value, { labelPx = 9, valuePx = 10.5, bold = true, color = "FF000000" } = {}) {
  return {
    richText: [
      { text: `${label}\n`, font: { name: FONT, size: pt(labelPx), color: { argb: "FF444444" } } },
      { text: String(value ?? ""), font: { name: FONT, size: pt(valuePx), bold, color: { argb: color } } },
    ],
  };
}

export async function imageAsDataUrl(url) {
  if (!url) return null;
  try {
    const response = await fetch(url);
    if (!response.ok) return null;
    const blob = await response.blob();
    const mime = blob.type.toLowerCase();
    const extension = mime.includes("png") ? "png" : mime.includes("gif") ? "gif" : mime.includes("jpeg") || mime.includes("jpg") ? "jpeg" : null;
    if (!extension) return null;
    return await new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve({ base64: reader.result, extension });
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

// 按网页上的最大显示尺寸等比缩放（再乘打印缩放比例），避免图片变形或打印偏小
function fitImageSize(dataUrl, maxWidth, maxHeight) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(maxWidth / img.naturalWidth, maxHeight / img.naturalHeight, 1) * PRINT_SCALE;
      resolve({ width: Math.round(img.naturalWidth * scale), height: Math.round(img.naturalHeight * scale) });
    };
    img.onerror = () => resolve({ width: Math.round(maxWidth * PRINT_SCALE), height: Math.round(maxHeight * PRINT_SCALE) });
    img.src = dataUrl;
  });
}

export async function placeImage(workbook, ws, url, { col, row, maxWidth, maxHeight }) {
  const image = await imageAsDataUrl(url);
  if (!image) return;
  try {
    const imageId = workbook.addImage(image);
    ws.addImage(imageId, { tl: { col, row }, ext: await fitImageSize(image.base64, maxWidth, maxHeight) });
  } catch { /* 图片格式 ExcelJS 不支持时跳过，不影响其他内容 */ }
}

export function a4Sheet(workbook, name, { marginMm = 14, widths }) {
  const margin = marginMm / 25.4;
  const ws = workbook.addWorksheet(name, {
    pageSetup: {
      paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      horizontalCentered: true,
      margins: { left: margin, right: margin, top: margin, bottom: margin, header: 0.2, footer: 0.2 },
    },
    properties: { defaultRowHeight: 18 },
  });
  ws.columns = widths.map(width => ({ width }));
  ws.views = [{ showGridLines: false }];
  return ws;
}

export async function saveWorkbook(workbook, filename) {
  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(
    new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `${sanitizeFileStem(filename)}.xlsx`,
  );
}

// 估算合并区域里文字需要的行高（Excel 不会自动撑高合并单元格）
export function fitRowHeight(text, charsPerLine, linePt, minPt = 15) {
  const lines = String(text ?? "").split("\n")
    .reduce((n, line) => n + Math.max(1, Math.ceil(line.length / Math.max(1, charsPerLine))), 0);
  return Math.max(minPt, lines * linePt + 4);
}
