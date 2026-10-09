import { downloadBlob, sanitizeFileStem } from "./document-download.js";

let excelJsPromise;
async function getExcelJS() {
  if (!excelJsPromise) excelJsPromise = import("exceljs");
  const mod = await excelJsPromise;
  return mod.default || mod;
}

const BLUE = "FF1F3864";
const PALE_BLUE = "FFF5F8FC";
const BORDER = { style: "thin", color: { argb: "FF888888" } };
const ALL_BORDERS = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };

// 合并单元格的边框 / 底色要写到区域里的每一格，只写左上角那格时，
// 打印出来只有第一列有框线（之前 Excel 版和网页版对不上的主要原因）
function styleRange(ws, row1, col1, row2, col2, style) {
  for (let r = row1; r <= row2; r++) {
    for (let c = col1; c <= col2; c++) {
      const cell = ws.getCell(r, c);
      cell.style = { ...cell.style, ...style };
    }
  }
}

function setMerged(ws, row, from, to, value, style = {}) {
  if (to > from) ws.mergeCells(row, from, row, to);
  styleRange(ws, row, from, row, to, style);
  const cell = ws.getCell(row, from);
  cell.value = value ?? "";
  return cell;
}

function setCell(cell, value, style = {}) {
  cell.value = value ?? "";
  cell.style = { ...cell.style, ...style };
}

async function imageAsDataUrl(url) {
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

// 按网页上的最大显示尺寸等比缩放图片（网页：logo 80×64，公章 130×100），避免被拉伸变形
// 打印时整张表（约 792px 宽）会缩放到 A4 可打印宽度（网页内容区 182mm ≈ 688px），
// 图片要按同样比例放大，打印出来才和网页 / Word 一样大
const PRINT_SCALE = 792 / 688;

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

export async function exportStatementToXlsx({
  filename, company = {}, statement, isBatch, shipments, chargesByShip,
  containersByShip, chargeItemMap, toPartnerName, issueDate, totalsByCcy, totalCny,
}) {
  const ExcelJS = await getExcelJS();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Bansar OPS";
  workbook.created = new Date();
  const ws = workbook.addWorksheet("对账单", {
    pageSetup: { paperSize: 9, orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.55, right: 0.55, top: 0.55, bottom: 0.55, header: 0.2, footer: 0.2 } },
    properties: { defaultRowHeight: 18 },
  });
  // 列宽与网页版费用表的比例一致（Statement.jsx 的 CHARGE_COL_WIDTHS）；
  // 账单信息用 A | B:E | F:G | H:J，对应网页的 16% / 34% / 16% / 34%
  ws.columns = [16, 9, 9, 8, 8, 8, 11, 8, 12, 17].map(width => ({ width }));
  ws.views = [{ showGridLines: false }];

  // Company masthead and document title.
  ws.mergeCells("A1:B3");
  ws.mergeCells("C1:J3");
  const companyName = company.name_zh || "班萨（宁波）国际货运代理有限公司";
  setCell(ws.getCell("C1"), companyName, {
    font: { name: "Microsoft YaHei", size: 15, bold: true, color: { argb: BLUE } },
    alignment: { horizontal: "center", vertical: "middle" },
    border: { bottom: { style: "medium", color: { argb: BLUE } } },
  });
  styleRange(ws, 3, 1, 3, 10, { border: { bottom: { style: "medium", color: { argb: BLUE } } } });
  for (let r = 1; r <= 3; r++) ws.getRow(r).height = 19;
  const logo = await imageAsDataUrl(company.logo_url);
  if (logo) {
    try {
      const imageId = workbook.addImage(logo);
      const ext = await fitImageSize(logo.base64, 80, 64);
      ws.addImage(imageId, { tl: { col: 0.05, row: 0.2 }, ext });
    } catch { /* Logo is optional if the source format is not supported by ExcelJS. */ }
  }

  ws.mergeCells("A5:J6");
  setCell(ws.getCell("A5"), "对 账 单", {
    font: { name: "Microsoft YaHei", size: 22, bold: true, color: { argb: "FF000000" } },
    alignment: { horizontal: "center", vertical: "middle" },
  });
  ws.getRow(5).height = 22;
  ws.getRow(6).height = 18;
  setMerged(ws, 8, 1, 5, `TO: ${toPartnerName || "—"}`, {
    font: { name: "Microsoft YaHei", size: 10, bold: true }, alignment: { vertical: "middle" },
  });
  const dateText = `日期: ${issueDate || ""}${isBatch && statement?.statement_no ? `    对账单号: ${statement.statement_no}` : ""}`;
  setMerged(ws, 8, 6, 10, dateText, {
    font: { name: "Microsoft YaHei", size: 10, bold: true, color: { argb: BLUE } },
    alignment: { horizontal: "right", vertical: "middle" },
  });

  let row = 10;
  const bodyFont = { name: "Microsoft YaHei", size: 9 };
  const labelStyle = { font: { ...bodyFont, bold: true, color: { argb: BLUE } }, fill: { type: "pattern", pattern: "solid", fgColor: { argb: PALE_BLUE } }, border: ALL_BORDERS, alignment: { vertical: "middle", wrapText: true } };
  const valueStyle = { font: bodyFont, border: ALL_BORDERS, alignment: { vertical: "middle", wrapText: true } };
  const chargeHeaderStyle = { font: { ...bodyFont, bold: true, color: { argb: "FFFFFFFF" } }, fill: { type: "pattern", pattern: "solid", fgColor: { argb: BLUE } }, border: ALL_BORDERS, alignment: { horizontal: "center", vertical: "middle", wrapText: true } };
  const chargeCellStyle = { font: bodyFont, border: ALL_BORDERS, alignment: { vertical: "middle", wrapText: true } };
  const chargeHeaders = ["费用名称", "单价", "数量", "单位", "币种", "税率", "金额", "汇率", "折本币总计", "备注"];

  for (const ship of shipments || []) {
    const containers = containersByShip?.[ship.id] || [];
    const containerNos = containers.map(c => c.container_no).filter(Boolean).join(", ");
    const sealNos = containers.map(c => c.seal_no).filter(Boolean).join(", ");
    const metadata = [
      [["客户编号", ship.customer_po || ship.po || ""], ["订单编号", ship.order_no || ""]],
      [["主单号", ship.mbl_no || ship.booking_no || ""], ["分单号", ship.hbl_no || ""]],
      [["SO号", ship.booking_no || ""], ["起运港", ship.pol || ""]],
      [["件数", ship.qty_packages || "0"], ["目的港", ship.pod || ""]],
      [["毛重", `${ship.weight || "0"} KGS`], ["船名航次", `${ship.vessel || ""}${ship.voyage ? `/${ship.voyage}` : ""}`]],
      [["体积", `${ship.volume || "0"} CBM`], ["ETD", ship.etd ? formatDate(ship.etd) : ""]],
      [["箱型箱量", ship.qty_container || ""], ["箱号", containerNos || ship.container_no || ""]],
      [["封号", sealNos || ship.seal_no || ""], ["客户名", ship.customer || ""]],
    ];
    for (const pairs of metadata) {
      const [left, right] = pairs;
      // 值统一按文本写入：件数等数字否则会靠右，和网页不一致
      setMerged(ws, row, 1, 1, `${left[0]}:`, labelStyle);
      setMerged(ws, row, 2, 5, String(left[1] ?? ""), valueStyle);
      setMerged(ws, row, 6, 7, `${right[0]}:`, labelStyle);
      setMerged(ws, row, 8, 10, String(right[1] ?? ""), valueStyle);
      ws.getRow(row).height = 20;
      row++;
    }

    chargeHeaders.forEach((header, idx) => setCell(ws.getCell(row, idx + 1), header, chargeHeaderStyle));
    ws.getRow(row).height = 24;
    row++;
    const charges = chargesByShip?.[ship.id] || [];
    if (charges.length === 0) {
      setMerged(ws, row, 1, 10, "无费用明细", { ...chargeCellStyle, alignment: { horizontal: "center", vertical: "middle" } });
      ws.getRow(row).height = 22;
      row++;
    } else {
      for (const charge of charges) {
        const amount = Number(charge.quantity || 0) * Number(charge.unit_price || 0) * (1 + Number(charge.tax_rate || 0) / 100);
        const values = [
          chargeItemMap?.[charge.charge_item_id] || charge.notes_charge || "—",
          Number(charge.unit_price || 0), Number(charge.quantity || 0), charge.unit || "票",
          charge.currency || "CNY", `${Number(charge.tax_rate || 0)}%`, amount,
          Number(charge.exchange_rate || 1), amount * Number(charge.exchange_rate || 1), charge.remark || "",
        ];
        values.forEach((value, idx) => {
          const style = { ...chargeCellStyle };
          if ([1, 6, 8].includes(idx)) {
            style.alignment = { horizontal: "right", vertical: "middle" };
            style.numFmt = "0.00";  // 与网页一样保留两位小数
          }
          if (idx === 2 || [3, 4, 5, 7].includes(idx)) style.alignment = { horizontal: "center", vertical: "middle" };
          setCell(ws.getCell(row, idx + 1), value, style);
        });
        ws.getRow(row).height = 19;
        row++;
      }
    }
    row++;
  }

  const totalStyle = { font: { name: "Microsoft YaHei", size: 10, bold: true }, border: ALL_BORDERS, alignment: { vertical: "middle", wrapText: true } };
  const totalLabelStyle = { ...totalStyle, fill: { type: "pattern", pattern: "solid", fgColor: { argb: PALE_BLUE } }, alignment: { horizontal: "right", vertical: "middle" } };
  setMerged(ws, row, 1, 3, "合计:", totalLabelStyle);
  setMerged(ws, row, 4, 10, Object.entries(totalsByCcy || {}).map(([ccy, amount]) => `${ccy} ${amount.toFixed(2)}`).join(" ; "), totalStyle);
  ws.getRow(row++).height = 24;
  setMerged(ws, row, 1, 3, "折本币合计:", totalLabelStyle);
  setMerged(ws, row, 4, 10, `CNY ${Number(totalCny || 0).toFixed(2)}`, { ...totalStyle, font: { ...totalStyle.font, color: { argb: "FFCC0000" }, size: 11 } });
  ws.getRow(row++).height = 24;
  row++;

  setMerged(ws, row, 1, 7, "付款信息:", { ...labelStyle, font: { ...bodyFont, bold: true }, alignment: { vertical: "middle" } });
  setMerged(ws, row, 8, 10, "注释", { ...labelStyle, font: { ...bodyFont, bold: true }, alignment: { vertical: "middle" } });
  ws.getRow(row++).height = 22;
  const paymentStart = row;
  const paymentEnd = row + 4;
  ws.mergeCells(paymentStart, 1, paymentEnd, 7);
  styleRange(ws, paymentStart, 1, paymentEnd, 7, { border: ALL_BORDERS });
  setCell(ws.getCell(paymentStart, 1), `开户公司：${companyName}\nCNY 开户行：上海浦东发展银行股份有限公司宁波东部新城支行\nCNY 账号：94160078801900001487\nUSD 开户行：上海浦东发展银行股份有限公司宁波东部新城支行\nUSD 账号：94160078814500001489`, {
    font: { name: "Microsoft YaHei", size: 9 }, border: ALL_BORDERS,
    alignment: { vertical: "top", wrapText: true },
  });
  ws.mergeCells(paymentStart, 8, paymentEnd, 10);
  styleRange(ws, paymentStart, 8, paymentEnd, 10, { border: ALL_BORDERS });
  setCell(ws.getCell(paymentStart, 8), (isBatch && statement?.notes) || "", {
    font: { name: "Microsoft YaHei", size: 9 }, border: ALL_BORDERS,
    alignment: { vertical: "top", wrapText: true },
  });
  for (let r = paymentStart; r <= paymentEnd; r++) ws.getRow(r).height = 22;
  const seal = await imageAsDataUrl(company.seal_url);
  if (seal) {
    try {
      const imageId = workbook.addImage(seal);
      const ext = await fitImageSize(seal.base64, 130, 100);
      ws.addImage(imageId, { tl: { col: 8.5, row: paymentStart - 1 + 0.15 }, ext });
    } catch { /* Seal is optional if the source format is not supported by ExcelJS. */ }
  }
  row = paymentEnd + 1;
  setMerged(ws, row, 1, 10, `ISSUED BY: ${(isBatch && statement?.issued_by) || "—"}`, {
    font: { name: "Microsoft YaHei", size: 9, bold: true }, border: ALL_BORDERS,
    alignment: { horizontal: "right", vertical: "middle" },
  });
  ws.getRow(row++).height = 22;
  setMerged(ws, row, 1, 7, companyName, { font: { name: "Microsoft YaHei", size: 8, color: { argb: "FF888888" } }, border: { top: BORDER } });
  setMerged(ws, row, 8, 10, "Form BNSR-STM", { font: { name: "Microsoft YaHei", size: 8, color: { argb: "FF888888" } }, alignment: { horizontal: "right" }, border: { top: BORDER } });
  ws.getRow(row).height = 18;
  ws.pageSetup.printArea = `A1:J${row}`;

  const buffer = await workbook.xlsx.writeBuffer();
  downloadBlob(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${sanitizeFileStem(filename)}.xlsx`);
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
