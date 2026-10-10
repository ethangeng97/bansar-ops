// ============================================================================
// bl-xlsx.js — 提单（确认件 / COPY / 正本 / 电放件）Excel，与网页 / PDF / Word 同版式
// 数据由 BLLayout.jsx 组装（buildBlDoc），版面按网页的两栏格子排：
// 左半 A:E、右半 F:J，货物表 Marks | 件数 | 品名(C:H) | 毛重 | 体积，第二页为背面条款。
// （网页上斜着的 COPY / ORIGINAL 大水印在 Excel 里做不到，用标题下的红色标记代替）
// ============================================================================
import {
  FONT, a4Sheet, block, box, fill, fitRowHeight, getExcelJS, placeImage, pt, saveWorkbook, styleRange, thin,
} from "./xlsx-layout.js";

const BRAND = "FF1F3864";
const BRAND_BG = "FFF5F8FC";
const RED = "FFCC0000";
const LINE = "FF555555";
// 10 列 ≈ 105 字符宽；左右两半各约 50%，货物表列宽比例同网页（12/13/49/13/13）
// A4 减上下 12mm 页边距，再按“宽度缩放到一页”的比例折回表格里的高度（约 0.91）
const FRONT_PAGE_PT = 830;
const WIDTHS = [12.5, 13.5, 8.5, 8.5, 8.5, 8.5, 8.5, 8.5, 13.5, 13.5];
const px2pt = px => +(px * 0.75 * (792 / 690)).toFixed(1);  // 行高：网页像素 → 打印后等高的 pt

export async function exportBlToXlsx({ filename, doc }) {
  const ExcelJS = await getExcelJS();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Bansar OPS";
  workbook.created = new Date();
  const ws = a4Sheet(workbook, "提单", { marginMm: 12, widths: WIDTHS });
  const font = (px, extra = {}) => ({ name: FONT, size: pt(px), ...extra });
  const grid = { border: box(LINE), alignment: { vertical: "top", wrapText: true, indent: 1 } };
  const field = (label, value, opts) => ({
    richText: [
      { text: `${label}\n`, font: font(9, { color: { argb: "FF444444" } }) },
      { text: String(value ?? ""), font: font(opts?.valuePx || 10.5, { bold: opts?.bold !== false }) },
    ],
  });

  let row = await header(workbook, ws, doc, font, [
    { text: `${doc.blNoLabel}\n`, font: font(8, { color: { argb: "FF444444" } }) },
    { text: doc.blNo, font: font(9.5, { bold: true }) },
    ...(doc.bookingNo ? [
      { text: "\nBooking No.\n", font: font(8, { color: { argb: "FF444444" } }) },
      { text: doc.bookingNo, font: font(9.5, { bold: true }) },
    ] : []),
  ], false);

  // ── 上半部分：两栏格子 ──
  const elastic = [];  // 收发通格子：网页上是固定高度，正面超出一页时先压这几格
  const pair = (left, right, heightPx) => {
    block(ws, row, 1, row, 5, left, grid);
    if (Array.isArray(right)) {
      right.forEach(([from, to, value]) => block(ws, row, from, row, to, value, grid));
    } else {
      block(ws, row, 6, row, 10, right, grid);
    }
    ws.getRow(row).height = px2pt(heightPx);
    row += 1;
  };

  const titleRich = [
    ...(doc.designation ? [{ text: `${doc.designation}\n`, font: font(11, { bold: true, color: { argb: RED } }) }] : []),
    { text: "BILL OF LADING\n", font: font(22, { bold: true, color: { argb: BRAND } }) },
    { text: "(COMBINED TRANSPORT / PORT TO PORT)", font: font(10, { color: { argb: "FF444444" } }) },
    ...(doc.badge ? [{ text: `\n\n${doc.badge}`, font: font(12, { bold: true, color: { argb: RED } }) }] : []),
  ];
  block(ws, row, 1, row, 5, field("Shipper", doc.shipper), grid);
  block(ws, row, 6, row, 10, { richText: titleRich }, { border: box(LINE), alignment: { horizontal: "center", vertical: "middle", wrapText: true } });
  ws.getRow(row).height = Math.max(px2pt(110), fitRowHeight(doc.shipper, 50, 12, 0) + 14);
  elastic.push({ row, min: Math.max(px2pt(80), fitRowHeight(doc.shipper, 50, 12, 0) + 14) });
  row += 1;
  pair(field('Consignee (if "To Order" so indicate)', doc.consignee),
    field("For delivery of goods please apply to:", doc.deliveryAgent, { valuePx: 10 }),
    Math.max(110, 16 * (String(doc.consignee).split("\n").length + 2)));
  elastic.push({ row: row - 1, min: px2pt(16 * (String(doc.consignee).split("\n").length + 2)) });
  pair(field("Notify Party (No claim shall attach for failure to notify)", doc.notify),
    doc.telexStamp ? { richText: [{ text: "TELEX RELEASE", font: font(18, { bold: true, color: { argb: RED } }) }] } : "",
    Math.max(90, 16 * (String(doc.notify).split("\n").length + 2)));
  elastic.push({ row: row - 1, min: px2pt(Math.max(doc.telexStamp ? 60 : 0, 16 * (String(doc.notify).split("\n").length + 2))) });
  if (doc.telexStamp) ws.getCell(row - 1, 6).alignment = { horizontal: "center", vertical: "middle" };
  pair(field("Pre-Carriage by", "—"), field("Place of Receipt", doc.placeOfReceipt), 36);
  pair(field("Vessel and Voyage No.", doc.vesselVoyage), field("Port of Loading", doc.pol), 36);
  pair(field("Port of Discharge", doc.pod), [
    [6, 8, field("Place of Delivery", doc.placeOfDelivery)],
    [9, 10, field("Final destination", doc.finalDestination)],
  ], 36);

  block(ws, row, 1, row, 10, "PARTICULARS DECLARED BY SHIPPER", {
    font: font(10.5, { bold: true, color: { argb: "FFFFFFFF" } }), fill: fill(BRAND), border: box(LINE),
    alignment: { horizontal: "center", vertical: "middle" },
  });
  ws.getRow(row).height = px2pt(22);
  row += 1;

  // ── 货物表 ──
  const cargoCols = [[1, 1], [2, 2], [3, 8], [9, 9], [10, 10]];
  const cargoRow = (values, { bg, bold, heightPt, aligns = [] } = {}) => {
    values.forEach((value, i) => {
      const [from, to] = cargoCols[i];
      block(ws, row, from, row, to, value ?? "", {
        font: font(i === 0 ? 9.5 : 10, { bold: !!bold || i === 1 }),
        border: box(LINE),
        ...(bg ? { fill: fill(bg) } : {}),
        alignment: { horizontal: aligns[i] || "left", vertical: "top", wrapText: true, indent: aligns[i] === "right" ? 0 : 1 },
      });
    });
    ws.getRow(row).height = heightPt;
    row += 1;
  };
  cargoRow(["Marks and Nos.", "No. of Containers\nor Packages", "Description of Packages and Goods", "Gross Weight (KGS)", "Measurement (CBM)"],
    { bg: BRAND_BG, bold: true, heightPt: px2pt(46), aligns: ["left", "left", "left", "right", "right"] });
  const numAligns = ["left", "left", "left", "right", "right"];
  const fmt3 = n => (n ? Number(n).toFixed(3) : "—");
  const totalsLine = `${doc.totalPkg} ${doc.unit}    ${doc.totalWt ? `${doc.totalWt.toFixed(3)}KGS` : ""}    ${doc.totalCbm ? `${doc.totalCbm.toFixed(3)}CBM` : ""}`
    + (doc.distinctProducts.length ? `\n${doc.distinctProducts.join(" / ")}` : "");
  if (doc.showSummary) {
    cargoRow(["SUMMARY", `${doc.totalPkg} ${doc.unit}`, totalsLine, fmt3(doc.totalWt), fmt3(doc.totalCbm)],
      { bg: "FFFFF8E1", bold: true, heightPt: fitRowHeight(totalsLine, 60, 13, 22), aligns: numAligns });
  }
  if (doc.rows.length === 0) {
    block(ws, row, 1, row, 10, "No cargo data", { font: font(10, { color: { argb: "FF999999" } }), border: box(LINE), alignment: { horizontal: "center", vertical: "middle" } });
    ws.getRow(row).height = px2pt(60);
    row += 1;
  }
  doc.rows.forEach((r, i) => {
    const desc = `${i === 0 ? "SHIPPER'S LOAD COUNT & SEAL S.T.C.\n" : ""}${r.pkgs} ${r.unit}    ${r.gw ? `${r.gw.toFixed(3)}KGS` : ""}    ${r.cbm ? `${r.cbm.toFixed(3)}CBM` : ""}\n\n═══════\n${r.desc}`;
    cargoRow([r.marks, r.pkgs ? `${r.pkgs} ${r.unit}` : "—", desc, fmt3(r.gw), fmt3(r.cbm)],
      { heightPt: Math.max(fitRowHeight(desc, 60, 13, 30), fitRowHeight(r.marks, 12, 12, 30)), aligns: numAligns });
  });
  if (doc.containerInfo) {
    block(ws, row, 1, row, 10, doc.containerInfo, { font: font(9.5), border: box(LINE), alignment: { vertical: "top", wrapText: true, indent: 1 } });
    ws.getRow(row).height = fitRowHeight(doc.containerInfo, 110, 12, 18);
    row += 1;
  }
  if (doc.showTotal) {
    cargoRow(["TOTAL", `${doc.totalPkg} ${doc.unit}`, `═══════\n${totalsLine}`, fmt3(doc.totalWt), fmt3(doc.totalCbm)],
      { bg: BRAND_BG, bold: true, heightPt: fitRowHeight(`═\n${totalsLine}`, 60, 13, 22), aligns: numAligns });
  }
  block(ws, row, 1, row, 5, doc.freightTerms, {
    font: font(10, { bold: true }), border: { left: thin(LINE), bottom: thin(LINE) },
    alignment: { vertical: "bottom", indent: 1 },
  });
  block(ws, row, 6, row, 10, `SHIPPED ON BOARD: ${doc.onBoardDate}`, {
    font: font(10, { bold: true }), border: { right: thin(LINE), bottom: thin(LINE) },
    alignment: { horizontal: "right", vertical: "bottom" },
  });
  ws.getRow(row).height = px2pt(136);
  const fillerRow = row;
  row += 1;

  // ── 底部：件数大写 / 运费 / 签发 ──
  pair(field("Total No. of Containers or Packages (in words)", doc.totalInWords), "", 36);
  const check = on => (on ? "☑" : "☐");
  [[1, 4, field("Freight and Charges", "FREIGHT AS ARRANGED")], [5, 6, field("Rate", "")],
   [7, 8, field("Prepaid", check(doc.isPrepaid), { valuePx: 13 })], [9, 10, field("Collect", check(doc.isCollect), { valuePx: 13 })]]
    .forEach(([from, to, value]) => block(ws, row, from, row, to, value, grid));
  ws.getRow(row).height = px2pt(38);
  row += 1;
  [[1, 3, field("Ex. Rate", "")], [4, 7, field("Prepaid at", "")], [8, 10, field("Payable at", doc.payableAt)]]
    .forEach(([from, to, value]) => block(ws, row, from, row, to, value, grid));
  ws.getRow(row).height = px2pt(36);
  row += 1;
  pair(field("Place and date of issue", doc.placeAndDate), field("No. of Original B(s) / L", doc.numOriginals), 36);

  const signRow = row;
  block(ws, row, 1, row, 5, doc.legalText.join("\n"), {
    font: font(7.5, { color: { argb: "FF555555" } }), border: box(LINE),
    alignment: { vertical: "top", wrapText: true, indent: 1 },
  });
  block(ws, row, 6, row, 10, {
    richText: [
      { text: "For and on behalf of\n", font: font(9) },
      { text: `${doc.companyEn}\n\n\n\n\n\n`, font: font(11, { bold: true }) },
      { text: "Authorized Signature(s)\n", font: font(9.5, { bold: true, italic: true, color: { argb: "FF444444" } }) },
      { text: "As Agent for the Carrier  ", font: font(9, { color: { argb: "FF444444" } }) },
      { text: doc.carrierName, font: font(9, { bold: true }) },
    ],
  }, { border: box(LINE), alignment: { vertical: "top", wrapText: true, indent: 1 } });
  ws.getRow(row).height = Math.max(px2pt(150), fitRowHeight(doc.legalText.join("\n"), 75, 9.5, 0));
  await placeImage(workbook, ws, doc.stampUrl, { col: 7.6, row: signRow - 1 + 0.15, maxWidth: 160, maxHeight: 120 });
  await placeImage(workbook, ws, doc.signatureUrl, { col: 5.2, row: signRow - 1 + 0.45, maxWidth: 160, maxHeight: 50 });
  row += 1;

  footer(ws, row, "TERMS AND CONDITIONS OVERLEAF", `Form ${doc.formCode} · Page 1 of ${doc.totalPages}`, font);
  // 网页上货物表下面的空白是把正面撑满一页用的；Excel 里按剩余高度算，正面刚好一页
  let used = 0;
  for (let r = 1; r <= row; r++) if (r !== fillerRow) used += ws.getRow(r).height || 15;
  const filler = Math.max(px2pt(30), Math.min(px2pt(136), FRONT_PAGE_PT - used));
  ws.getRow(fillerRow).height = filler;
  let excess = used + filler - FRONT_PAGE_PT;
  for (const { row: r, min } of elastic) {
    if (excess <= 0) break;
    const cut = Math.min(excess, Math.max(0, ws.getRow(r).height - min));
    ws.getRow(r).height -= cut;
    excess -= cut;
  }
  ws.getRow(row).addPageBreak();
  row += 1;

  // ── 背面条款页 ──
  row = await header(workbook, ws, doc, font, [
    { text: `${doc.blNoLabel}\n`, font: font(8, { color: { argb: "FF444444" } }) },
    { text: `${doc.blNo}\n`, font: font(9.5, { bold: true }) },
    { text: "TERMS AND CONDITIONS", font: font(8.5, { color: { argb: "FF888888" } }) },
  ], true, row);
  block(ws, row, 1, row, 10, doc.termsIntro, {
    font: font(9, { color: { argb: "FF444444" } }), fill: fill(BRAND_BG), border: box("FFCDD9EC"),
    alignment: { vertical: "middle", wrapText: true, indent: 1 },
  });
  ws.getRow(row).height = fitRowHeight(doc.termsIntro, 140, 12, 22);
  row += 2;
  const half = Math.ceil(doc.terms.length / 2);
  const term = (t, n) => (t ? {
    richText: [
      { text: `${n}. ${t.title}\n`, font: font(9, { bold: true, color: { argb: BRAND } }) },
      { text: t.body, font: font(8.5) },
    ],
  } : "");
  for (let i = 0; i < half; i++) {
    const left = doc.terms[i];
    const right = doc.terms[half + i];
    block(ws, row, 1, row, 5, term(left, i + 1), { alignment: { vertical: "top", wrapText: true, horizontal: "justify" } });
    block(ws, row, 6, row, 10, term(right, half + i + 1), {
      border: { left: thin("FFCCCCCC") }, alignment: { vertical: "top", wrapText: true, horizontal: "justify", indent: 1 },
    });
    const longest = Math.max(left.body.length, right ? right.body.length : 0);
    ws.getRow(row).height = fitRowHeight("x".repeat(longest), 72, 10.5, 0) + 14;
    row += 1;
  }
  footer(ws, row, doc.termsFooter, `Page ${doc.totalPages} of ${doc.totalPages} · Form ${doc.formCode}`, font, BRAND);

  await saveWorkbook(workbook, filename);
}

async function header(workbook, ws, doc, font, rightRich, underline, startRow = 1) {
  for (let r = startRow; r < startRow + 3; r++) ws.getRow(r).height = 17;
  block(ws, startRow, 2, startRow + 2, 7, doc.companyEn, {
    font: font(13.5, { bold: true, color: { argb: BRAND } }), alignment: { vertical: "middle" },
  });
  block(ws, startRow, 8, startRow + 2, 10, { richText: rightRich }, {
    alignment: { horizontal: "right", vertical: "middle", wrapText: true },
  });
  if (underline) {
    styleRange(ws, startRow + 2, 1, startRow + 2, 10, { border: { bottom: { style: "medium", color: { argb: BRAND } } } });
  }
  await placeImage(workbook, ws, doc.logoUrl, { col: 0.05, row: startRow - 1 + 0.15, maxWidth: 75, maxHeight: 60 });
  ws.getRow(startRow + 3).height = 8;
  return startRow + 4;
}

function footer(ws, row, left, right, font, lineArgb) {
  const border = lineArgb ? { top: thin(lineArgb) } : undefined;
  block(ws, row, 1, row, 6, left, { font: font(8, { color: { argb: "FF888888" } }), alignment: { vertical: "middle" }, border });
  block(ws, row, 7, row, 10, right, { font: font(8, { color: { argb: "FF888888" } }), alignment: { horizontal: "right", vertical: "middle" }, border });
  ws.getRow(row).height = 16;
}
