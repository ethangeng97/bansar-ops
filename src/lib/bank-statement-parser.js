// ============================================================================
// bank-statement-parser.js — 银行对账单(浦发 etabBill CSV)解析 → payments 映射
//
// 纯逻辑，无 DOM/fs 依赖；浏览器(导入 Modal)和 node(脚本)共用。
//
// 对账单列(GBK编码)：
//   0 交易日期 1 交易时间 2 申请日期 3 凭证号 4 借方金额 5 贷方金额 6 余额
//   7 对方账号 8 对方户名 9 对方行名 10 交易流水号 11 传票序号 12 记录状态
//   13 摘要 14 交易附言 15 客户账户类型
//
// 映射：贷方进账→AR(收款) / 借方出账→AP(付款)
//       bank_flow_no = `${交易流水号}#${传票序号}`(全表唯一的去重键)
// ============================================================================

// GBK → 字符串（浏览器 File.arrayBuffer() 或 node Buffer 都可传入）
export function decodeGbk(buf) {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return new TextDecoder("gbk").decode(bytes);
}

// 极简 RFC4180 CSV 解析（支持引号转义、\r\n）
export function parseCsv(text) {
  const rows = [];
  let row = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else if (c === "\r") { /* skip */ }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const num = (s) => {
  const v = parseFloat(String(s ?? "").replace(/,/g, "").trim());
  return Number.isFinite(v) ? v : 0;
};
const ymd = (s) => {
  const t = String(s ?? "").trim();
  return /^\d{8}$/.test(t) ? `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}` : null;
};

// 业务分类：用于"排除手续费/工资"可选过滤
export function categorize(r) {
  const txt = `${r[13] || ""}${r[14] || ""}${r[8] || ""}`;
  if (/手续费|服务月费|汇划手续费/.test(txt)) return "bank_fee";
  if (/工资/.test(txt)) return "salary";
  if (/利息/.test(txt)) return "interest";
  return "business";
}

// 把一行明细映射成 payment（不含 payment_no / partner_id）
function mapRow(r, bankAccount) {
  const debit = num(r[4]);   // 借方 = 付款 AP
  const credit = num(r[5]);  // 贷方 = 收款 AR
  const direction = credit > 0 ? "AR" : "AP";
  const amount = credit > 0 ? credit : debit;
  const flow = (r[10] || "").trim();
  const seq = (r[11] || "").trim();
  const notes = [r[13], r[14]].map((x) => (x || "").trim()).filter(Boolean).join(" | ") || null;
  return {
    _date: (r[0] || "").trim(),
    _time: (r[1] || "").trim().padStart(6, "0"),
    _category: categorize(r),
    direction,
    payment_date: ymd(r[0]),
    amount: Number(amount.toFixed(2)),
    currency: "CNY",
    exchange_rate: 1,
    partner_name: (r[8] || "").trim() || null,
    bank_account: bankAccount,
    bank_flow_no: `${flow}#${seq}`,
    payment_method: "transfer",
    notes,
    status: "active",
  };
}

// 解析整份对账单文本 → { account, stmtDebit, stmtCredit, rows }
export function parseBankStatement(text) {
  const all = parseCsv(text);
  const account = (all.find((r) => r[0] === "账号") || [])[1] || null;
  const totals = all.find((r) => r[0] === "借记总额");
  const stmtDebit = totals ? num(totals[1]) : null;
  const stmtCredit = totals ? num(totals[3]) : null;
  const dataRows = all.filter((r) => /^\d{8}$/.test((r[0] || "").trim()));

  let rows = dataRows
    .map((r) => mapRow(r, account))
    .filter((m) => m.payment_date && m.amount > 0)
    .sort((a, b) => (a._date + a._time).localeCompare(b._date + b._time));

  // 文件内按 bank_flow_no 去重（正常不触发）
  const seen = new Set();
  rows = rows.filter((m) => (seen.has(m.bank_flow_no) ? false : (seen.add(m.bank_flow_no), true)));

  return { account, stmtDebit, stmtCredit, rows };
}

// 解析单号 → 该 prefix-year 的最大序号
export function seqStartFromPaymentNos(paymentNos) {
  const start = {};
  for (const pn of paymentNos || []) {
    const m = /^(RCV|PAY)-(\d{4})-(\d+)$/.exec(pn || "");
    if (!m) continue;
    const key = `${m[1]}-${m[2]}`;
    start[key] = Math.max(start[key] || 0, parseInt(m[3], 10));
  }
  return start;
}

// 生成最终待插入记录：去重 + 落单号 + partner_id
//   mapped          : parseBankStatement().rows（可先按 _category 过滤）
//   existingFlowSet  : Set<bank_flow_no>，已存在的跳过
//   customersByName  : Map<name, id>（仅唯一户名）
//   seqStart         : { 'RCV-2026': n, 'PAY-2026': n }
// → { toInsert, skipped }
export function buildPaymentRecords(mapped, { existingFlowSet = new Set(), customersByName = new Map(), seqStart = {} } = {}) {
  const counter = { ...seqStart };
  const nextNo = (direction, date) => {
    const pre = direction === "AR" ? "RCV" : "PAY";
    const yr = date.slice(0, 4);
    const key = `${pre}-${yr}`;
    const n = (counter[key] || 0) + 1;
    counter[key] = n;
    return `${pre}-${yr}-${String(n).padStart(4, "0")}`;
  };

  const toInsert = [];
  let skipped = 0;
  for (const m of mapped) {
    if (existingFlowSet.has(m.bank_flow_no)) { skipped++; continue; }
    toInsert.push({
      payment_no: nextNo(m.direction, m.payment_date),
      direction: m.direction,
      payment_date: m.payment_date,
      amount: m.amount,
      currency: m.currency,
      exchange_rate: m.exchange_rate,
      partner_id: customersByName.get(m.partner_name) || null,
      partner_name: m.partner_name,
      bank_account: m.bank_account,
      bank_flow_no: m.bank_flow_no,
      payment_method: m.payment_method,
      notes: m.notes,
      status: m.status,
    });
  }
  return { toInsert, skipped };
}
