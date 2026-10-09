// ============================================================================
// bill-xlsx.js — 账单 Excel 导出（与“打印账单 / PDF”同版式）
// 数据由 BillDetail.jsx 的 buildBillDoc() 提供，打印 / Word / Excel 三者共用，
// 改字段时只改 buildBillDoc 一处。
// ============================================================================

import { downloadBlob, sanitizeFileStem } from "./document-download.js";

let excelJsPromise;
async function getExcelJS() {
  if (!excelJsPromise) excelJsPromise = import("exceljs");
  const mod = await excelJsPromise;
  return mod.default || mod;
}

const FONT = { name: "Microsoft YaHei", size: 9, color: { argb: "FF222222" } };
const LINE = { style: "thin", color: { argb: "FFBBBBBB" } };
const ALL_BORDERS = { top: LINE, bottom: LINE, left: LINE, right: LINE };
const NUM_FMT = "0.00";
// 费用明细 8 列：费用项目 / 单位 / 数量 / 币种 / 单价 / 金额 / 折 CNY / 备注
const COL_WIDTHS = [24, 8, 8, 8, 12, 13, 13, 18];

function setMerged(ws, row, from, to, value, style = {}) {
  if (to > from) ws.mergeCells(row, from, row, to);
  const cell = ws.getCell(row, from);
  cell.value = value ?? "";
  cell.style = { ...cell.style, ...style };
  return cell;
}

export async function exportBillToXlsx({ filename, doc }) {
  const ExcelJS = await getExcelJS();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Bansar OPS";
  workbook.created = new Date();
  // 与打印版一致：A4 纵向，页边距 16mm（0.63 英寸），宽度缩放到一页
  const margin = 16 / 25.4;
  const ws = workbook.addWorksheet("账单", {
    pageSetup: {
      paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      horizontalCentered: true,
      margins: { left: margin, right: margin, top: margin, bottom: margin, header: 0.2, footer: 0.2 },
    },
    properties: { defaultRowHeight: 18 },
  });
  ws.columns = COL_WIDTHS.map(width => ({ width }));
  ws.views = [{ showGridLines: false }];

  let r = 1;
  setMerged(ws, r, 1, 8, doc.title, {
    font: { ...FONT, size: 16, bold: true },
    alignment: { horizontal: "center", vertical: "middle" },
  });
  ws.getRow(r).height = 30;
  r += 2;

  // 账单信息：两列，每列 “标签 + 值”（A 标签 / B:D 值，E 标签 / F:H 值）
  const metaLabel = { font: { ...FONT, bold: true, color: { argb: "FF666666" } }, alignment: { vertical: "middle" }, border: { bottom: { style: "dotted", color: { argb: "FFDDDDDD" } } } };
  const metaValue = { font: FONT, alignment: { vertical: "middle", wrapText: true }, border: { bottom: { style: "dotted", color: { argb: "FFDDDDDD" } } } };
  for (let i = 0; i < doc.meta.length; i += 2) {
    const [l1, v1] = doc.meta[i];
    setMerged(ws, r, 1, 1, l1, metaLabel);
    setMerged(ws, r, 2, 4, v1, metaValue);
    if (doc.meta[i + 1]) {
      const [l2, v2] = doc.meta[i + 1];
      setMerged(ws, r, 5, 5, l2, metaLabel);
      setMerged(ws, r, 6, 8, v2, metaValue);
    }
    ws.getRow(r).height = 20;
    r += 1;
  }
  r += 1;

  setMerged(ws, r, 1, 8, "费用明细", {
    font: { ...FONT, size: 10.5, bold: true },
    border: { bottom: { style: "thin", color: { argb: "FFBBBBBB" } } },
  });
  r += 1;

  const headerRow = r;
  const numCols = new Set([3, 5, 6, 7]);
  doc.columns.forEach((label, idx) => {
    const cell = ws.getCell(r, idx + 1);
    cell.value = label;
    cell.style = {
      font: { ...FONT, bold: true },
      fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FFF2F4F7" } },
      border: ALL_BORDERS,
      alignment: { horizontal: numCols.has(idx + 1) ? "right" : "left", vertical: "middle" },
    };
  });
  ws.getRow(r).height = 20;
  r += 1;

  if (doc.rows.length === 0) {
    setMerged(ws, r, 1, 8, "无费用明细", { font: FONT, border: ALL_BORDERS, alignment: { horizontal: "center", vertical: "middle" } });
    r += 1;
  }
  doc.rows.forEach(row => {
    const values = [row.charge, row.unit, row.quantity, row.currency, row.unitPrice, row.amount, row.amountCny, row.remark];
    values.forEach((value, idx) => {
      const col = idx + 1;
      const cell = ws.getCell(r, col);
      cell.value = value ?? "";
      cell.style = {
        font: FONT,
        border: ALL_BORDERS,
        alignment: { horizontal: numCols.has(col) ? "right" : "left", vertical: "middle", wrapText: true },
        ...(col >= 5 && col <= 7 ? { numFmt: NUM_FMT } : {}),
      };
    });
    r += 1;
  });
  r += 1;

  setMerged(ws, r, 1, 8, doc.totalText, {
    font: { ...FONT, bold: true },
    alignment: { horizontal: "right", vertical: "middle" },
  });
  r += 4;

  setMerged(ws, r, 1, 4, "制单：________________", { font: FONT, alignment: { vertical: "middle" } });
  setMerged(ws, r, 5, 8, "确认/盖章：________________", { font: FONT, alignment: { horizontal: "right", vertical: "middle" } });

  // 明细跨页时每页重复表头
  ws.pageSetup.printTitlesRow = `${headerRow}:${headerRow}`;

  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(
    new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `${sanitizeFileStem(filename)}.xlsx`,
  );
}
