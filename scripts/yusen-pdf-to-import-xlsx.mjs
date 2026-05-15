// 把日邮（Yusen NBO）费用确认单 PDF 转成 ChargeImportModal 期望的 xlsx
//
// 用法:
//   node scripts/yusen-pdf-to-import-xlsx.mjs <input.pdf> [output.xlsx]
//   默认输出到同目录下同名 .xlsx
//
// 依赖系统 pdftotext（poppler）— macOS: brew install poppler
//
// 解析逻辑：
//   1. pdftotext -layout 提取文本（中文完整）
//   2. 解析头部：账单号 / SO# / 费用参考号 / MBL / 箱型 / 船名等
//   3. 找"分单费用明细"段，逐行解析: 费用名称 金额 币种 税率
//   4. 全部当作"应付（班萨 → 日邮）"

import { execFileSync } from "child_process";
import { writeFileSync, statSync } from "fs";
import path from "path";
import * as XLSX from "xlsx";

const SUPPLIER = "日邮物流（中国）有限公司宁波分公司";

function extractText(pdfPath) {
  // -layout 保留列对齐，正则更稳；-enc UTF-8 强制 UTF-8 输出
  return execFileSync("pdftotext", ["-layout", "-enc", "UTF-8", pdfPath, "-"], {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
}

// 从 PDF 文本里抽一个字段：grabField(text, /账单号\s+(\S+)/) → 字段值或 ""
function grabField(text, re) {
  const m = text.match(re);
  return m ? m[1].trim() : "";
}

function parseMeta(text) {
  return {
    bill_no:    grabField(text, /账单号\s+(\S+)/),
    bill_date:  grabField(text, /账单日期\s+(\S+)/),
    so_no:      grabField(text, /SO#\s+(\S+)/),
    po_no:      grabField(text, /PO#\s+(\S+)/),
    mbl_no:     grabField(text, /TMAST#\s+(\S+)/),
    bl_no:      grabField(text, /提单号\s+(\S+)/),
    vessel_voy: grabField(text, /船名\/航次\s+(.+?)\s{2,}/),
    etd:        grabField(text, /ETD\s+(\S+)/),
    container:  grabField(text, /箱型箱量\s+(.+?)(?:\s{2,}|$)/m),
    pol:        grabField(text, /起运港\s+(\S+)/),
    pod:        grabField(text, /卸货港\s+(\S+)/),
    ref_no:     grabField(text, /费用参考号:\s+(\S+)/),
  };
}

// 解析"分单费用明细" 段
// 每行格式（pdftotext -layout 后）：
//   代理舱单传输费                  200.00         RMB    0
//   代理船公司订舱费                 605.00         RMB    0
//   …
//   代理整柜操作费                  300.00         RMB    0
//                                        分单小计：     RMB:3544;
function parseChargeLines(text) {
  const startIdx = text.indexOf("分单费用明细");
  if (startIdx < 0) throw new Error('未找到"分单费用明细"段');
  const endIdx = text.indexOf("分单小计", startIdx);
  const block = text.slice(startIdx, endIdx > 0 ? endIdx : undefined);

  // 每行: 费用名称（中文，可含括号）+ 多空格 + 金额 + 多空格 + 币种 + 多空格 + 税率
  // 用 [ \t]* 而不是 \s*，避免跨行吞掉表头
  const lineRe = /^[ \t]*([^\s\d][^\d\n]*?)[ \t]{2,}([\d,]+\.\d{2})[ \t]+(RMB|USD|CNY|EUR|HKD|JPY)[ \t]+(\d+(?:\.\d+)?)/gm;
  const rows = [];
  let m;
  while ((m = lineRe.exec(block)) !== null) {
    const [, name, amountStr, currency, taxStr] = m;
    if (name.includes("费用名称")) continue;  // 跳过表头
    rows.push({
      name: name.trim(),
      amount: parseFloat(amountStr.replace(/,/g, "")),
      currency: currency === "RMB" ? "CNY" : currency,
      tax_rate: parseFloat(taxStr),
    });
  }
  if (rows.length === 0) throw new Error("没解析到任何费用行，请检查 PDF 文本格式");
  return rows;
}

function buildXlsx(meta, charges, outPath) {
  const header = ["费用名称", "结算单位", "计费单位", "数量", "单价", "币种", "汇率", "税率%", "备注"];
  const remark = [meta.ref_no, meta.so_no, meta.container].filter(Boolean).join(" · ");
  const apRows = charges.map(c => [
    c.name, SUPPLIER, "票", 1, c.amount, c.currency, 1, c.tax_rate, remark
  ]);
  const widths = [{wch: 30}, {wch: 32}, {wch: 8}, {wch: 6}, {wch: 10}, {wch: 8}, {wch: 8}, {wch: 8}, {wch: 36}];

  const wb = XLSX.utils.book_new();
  const wsAr = XLSX.utils.aoa_to_sheet([header]);                // 应收：仅表头
  const wsAp = XLSX.utils.aoa_to_sheet([header, ...apRows]);
  wsAr["!cols"] = wsAp["!cols"] = widths;
  XLSX.utils.book_append_sheet(wb, wsAr, "应收");
  XLSX.utils.book_append_sheet(wb, wsAp, "应付");

  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  writeFileSync(outPath, buf);
}

// ── main ──
const pdfPath = process.argv[2];
if (!pdfPath) {
  console.error("用法: node scripts/yusen-pdf-to-import-xlsx.mjs <input.pdf> [output.xlsx]");
  process.exit(1);
}
try { statSync(pdfPath); } catch { console.error(`找不到 PDF: ${pdfPath}`); process.exit(1); }

const outPath = process.argv[3] || pdfPath.replace(/\.pdf$/i, ".xlsx").replace(/\s*\(NBO\)/, "");

const text = extractText(pdfPath);
const meta = parseMeta(text);
const charges = parseChargeLines(text);

buildXlsx(meta, charges, outPath);

const total = charges.reduce((s, c) => s + c.amount, 0);
console.log(`✓ 已生成 ${outPath}`);
console.log(`  账单号 ${meta.bill_no} / SO# ${meta.so_no} / 费用参号 ${meta.ref_no}`);
console.log(`  应付 ${charges.length} 行，合计 ${total.toFixed(2)} CNY`);
console.log(`  船名航次: ${meta.vessel_voy}`);
console.log(`  箱型: ${meta.container} / ${meta.pol} → ${meta.pod}`);
