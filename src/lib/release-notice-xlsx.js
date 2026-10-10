// ============================================================================
// release-notice-xlsx.js — 放舱信息 Excel（与网页 / PDF / Word 同版式）
// 数据由 ReleaseNotice.jsx 的 buildReleaseDoc() 提供，三种导出共用。
// ============================================================================
import {
  FONT, a4Sheet, block, box, fill, fitRowHeight, getExcelJS, placeImage, pt, saveWorkbook, styleRange, thin,
} from "./xlsx-layout.js";

const BRAND = "FF1F3864";
// 8 列，合计约 105 字符宽；标签占 A:C（≈32%，同网页），值占 D:H
const WIDTHS = [12, 11, 11, 14, 14, 14, 14, 15];

export async function exportReleaseNoticeToXlsx({ filename, doc }) {
  const ExcelJS = await getExcelJS();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Bansar OPS";
  workbook.created = new Date();
  const ws = a4Sheet(workbook, "放舱信息", { marginMm: 14, widths: WIDTHS });
  const font = (px, extra = {}) => ({ name: FONT, size: pt(px), ...extra });

  // 抬头：logo | 英文公司名 | Reference No.
  for (let r = 1; r <= 3; r++) ws.getRow(r).height = 17;
  block(ws, 1, 2, 3, 6, doc.companyEn, {
    font: font(13.5, { bold: true, color: { argb: BRAND } }),
    alignment: { vertical: "middle" },
  });
  block(ws, 1, 7, 3, 8, {
    richText: [
      { text: "Reference No.\n", font: font(8, { color: { argb: "FF444444" } }) },
      { text: doc.referenceNo, font: font(9.5, { bold: true }) },
    ],
  }, { alignment: { horizontal: "right", vertical: "middle", wrapText: true } });
  styleRange(ws, 3, 1, 3, 8, { border: { bottom: { style: "medium", color: { argb: BRAND } } } });
  await placeImage(workbook, ws, doc.logoUrl, { col: 0.05, row: 0.15, maxWidth: 75, maxHeight: 60 });

  // 标题
  block(ws, 5, 1, 5, 8, doc.title, {
    font: font(22, { bold: true, color: { argb: BRAND } }), alignment: { horizontal: "center", vertical: "middle" },
  });
  ws.getRow(5).height = 30;
  block(ws, 6, 1, 6, 8, doc.subtitle, {
    font: font(13, { color: { argb: "FF444444" } }), alignment: { horizontal: "center", vertical: "middle" },
  });
  ws.getRow(6).height = 18;

  // 致 / 日期 信息框
  let row = 8;
  block(ws, row, 1, row, 8, {
    richText: doc.infoLines.flatMap((line, i) => [
      ...(i > 0 ? [{ text: "\n", font: font(10.5) }] : []),
      ...line.flatMap(([label, value], j) => [
        ...(j > 0 ? [{ text: "    ", font: font(10.5) }] : []),
        { text: `${label} `, font: font(10.5, { bold: true }) },
        { text: value, font: font(10.5) },
      ]),
    ]),
  }, {
    fill: fill("FFF5F8FC"), border: box("FFCDD9EC"),
    alignment: { vertical: "middle", wrapText: true, indent: 1 },
  });
  ws.getRow(row).height = 38;
  row += 2;

  // 各信息分组：彩色标题行 + 标签 / 值
  for (const section of doc.sections) {
    block(ws, row, 1, row, 8, section.title, {
      font: font(11, { bold: true, color: { argb: "FFFFFFFF" } }),
      fill: fill(section.headArgb), alignment: { vertical: "middle", indent: 1 },
    });
    ws.getRow(row).height = 20;
    row += 1;
    for (const item of section.rows) {
      block(ws, row, 1, row, 3, item.label, {
        font: font(10.5, { bold: true, color: { argb: section.labelArgb } }),
        fill: fill(section.cellArgb), border: box(), alignment: { vertical: "middle", wrapText: true, indent: 1 },
      });
      block(ws, row, 4, row, 8, String(item.value ?? ""), {
        font: font(10.5, { bold: !!item.bold }), border: box(),
        alignment: { vertical: "middle", wrapText: true, indent: 1 },
      });
      ws.getRow(row).height = fitRowHeight(item.value, 60, 14, 21);
      row += 1;
    }
    row += 1;
  }

  // 提醒框
  const notice = [doc.notice.title, ...doc.notice.lines].join("\n");
  block(ws, row, 1, row, 8, {
    richText: [
      { text: `${doc.notice.title}\n`, font: font(10, { bold: true, color: { argb: "FF555555" } }) },
      { text: doc.notice.lines.join("\n"), font: font(10, { color: { argb: "FF555555" } }) },
    ],
  }, {
    fill: fill("FFFFFBE6"),
    border: { left: { style: "thick", color: { argb: "FFFAAD14" } } },
    alignment: { vertical: "top", wrapText: true, indent: 1 },
  });
  ws.getRow(row).height = fitRowHeight(notice, 90, 15, 30);
  row += 2;

  // 操作方 + 页脚
  block(ws, row, 1, row, 8, {
    richText: [
      { text: "Operator / 操作: ", font: font(10, { color: { argb: "FF444444" } }) },
      { text: doc.companyEn, font: font(10, { bold: true }) },
    ],
  }, { alignment: { horizontal: "right", vertical: "middle" }, border: { top: thin("FFDDDDDD") } });
  ws.getRow(row).height = 20;
  row += 2;
  block(ws, row, 1, row, 5, doc.footerLeft, { font: font(8, { color: { argb: "FF888888" } }), border: { top: thin("FFDDDDDD") } });
  block(ws, row, 6, row, 8, doc.formCode, {
    font: font(8, { color: { argb: "FF888888" } }), alignment: { horizontal: "right" }, border: { top: thin("FFDDDDDD") },
  });
  ws.pageSetup.printArea = `A1:H${row}`;

  await saveWorkbook(workbook, filename);
}
