// ============================================================================
// import-bank-statement.mjs — 把银行对账单(浦发 etabBill CSV)导入 payments 表
//
// 解析/映射逻辑全部复用 src/lib/bank-statement-parser.js（与 App 内"导入对账单"
// Modal 同一套），本脚本只负责：读文件、联库去重、生成单号、写库。
//
// 用法：
//   预览(不写库)：               node scripts/import-bank-statement.mjs <对账单.csv>
//   预览+联库去重统计(只读)：     SUPABASE_SERVICE_KEY=eyJ... node scripts/import-bank-statement.mjs <对账单.csv>
//   写入：                        SUPABASE_SERVICE_KEY=eyJ... node scripts/import-bank-statement.mjs <对账单.csv> --apply
//   排除手续费/工资等非业务：     ... <对账单.csv> --exclude-non-business [--apply]
// ============================================================================
import fs from "fs";
import path from "path";
import {
  decodeGbk, parseBankStatement, buildPaymentRecords, seqStartFromPaymentNos,
} from "../src/lib/bank-statement-parser.js";

const SUPABASE_URL = "https://pewdvheoaqofmzwhwwvu.supabase.co";
const KEY = process.env.SUPABASE_SERVICE_KEY || "";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const excludeNonBiz = args.includes("--exclude-non-business");
const csvPath = args.find((a) => !a.startsWith("--"));

if (!csvPath) {
  console.error("用法: node scripts/import-bank-statement.mjs <对账单.csv> [--exclude-non-business] [--apply]");
  process.exit(1);
}
if (apply && !KEY) {
  console.error("✗ --apply 需要环境变量 SUPABASE_SERVICE_KEY（service_role 密钥）");
  process.exit(1);
}

async function sb(p, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${p}`, {
    ...opts,
    headers: {
      apikey: KEY, Authorization: `Bearer ${KEY}`,
      "Content-Type": "application/json", Prefer: "return=representation",
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let body; try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
  return body;
}
async function sbAll(table, select) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const batch = await sb(`/${table}?select=${select}`, {
      headers: { Range: `${from}-${from + 999}`, "Range-Unit": "items" },
    });
    out.push(...(batch || []));
    if (!batch || batch.length < 1000) break;
  }
  return out;
}

const main = async () => {
  const text = decodeGbk(fs.readFileSync(csvPath));
  const stmt = parseBankStatement(text);
  console.log(`账号: ${stmt.account}`);
  console.log(`明细行: ${stmt.rows.length}（对账单借记总额 ${stmt.stmtDebit} / 贷记总额 ${stmt.stmtCredit}）`);

  let existingFlowSet = new Set();
  let customersByName = new Map();
  let seqStart = {};

  if (KEY) {
    const pays = await sbAll("payments", "payment_no,bank_flow_no");
    pays.forEach((p) => { if (p.bank_flow_no) existingFlowSet.add(p.bank_flow_no); });
    seqStart = seqStartFromPaymentNos(pays.map((p) => p.payment_no));
    const custs = await sbAll("customers", "id,name");
    const nameCount = new Map();
    custs.forEach((c) => {
      const k = (c.name || "").trim(); if (!k) return;
      nameCount.set(k, (nameCount.get(k) || 0) + 1); customersByName.set(k, c.id);
    });
    [...nameCount].forEach(([k, v]) => { if (v > 1) customersByName.delete(k); });
  }

  const mapped = excludeNonBiz ? stmt.rows.filter((r) => r._category === "business") : stmt.rows;
  const { toInsert, skipped } = buildPaymentRecords(mapped, { existingFlowSet, customersByName, seqStart });

  const ar = toInsert.filter((r) => r.direction === "AR");
  const ap = toInsert.filter((r) => r.direction === "AP");
  const sum = (xs) => xs.reduce((s, r) => s + r.amount, 0).toFixed(2);
  console.log(`\n待导入: ${toInsert.length} 笔（去重跳过 ${skipped}${excludeNonBiz ? `；已排除非业务 ${stmt.rows.length - mapped.length}` : ""}）`);
  console.log(`  收款 AR: ${ar.length} 笔, 合计 ${sum(ar)}`);
  console.log(`  付款 AP: ${ap.length} 笔, 合计 ${sum(ap)}`);
  console.log(`  partner_id 匹配到: ${toInsert.filter((r) => r.partner_id).length} 笔`);
  if (!KEY) console.log("  ⚠ 未提供 SUPABASE_SERVICE_KEY：未联库去重、未匹配 partner_id（预览基于文件全量）");

  // 预览 CSV（写到 csv 同目录）
  const previewPath = path.join(path.dirname(csvPath), "payments_import_preview.csv");
  const head = ["payment_no", "direction", "payment_date", "partner_name", "currency", "amount", "bank_flow_no", "payment_method", "notes"];
  const esc = (v) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const lines = [head.join(",")];
  for (const r of toInsert) lines.push(head.map((h) => esc(r[h])).join(","));
  try { fs.writeFileSync(previewPath, "﻿" + lines.join("\n"), "utf-8"); console.log(`\n预览已写出: ${previewPath}`); }
  catch (e) { console.log(`\n（预览未写出: ${e.message}）`); }

  if (!apply) { console.log("\n（预览模式，未写库。确认后加 --apply 并提供 SUPABASE_SERVICE_KEY 执行写入）"); return; }

  console.log(`\n开始写入 payments ...`);
  let inserted = 0; const errors = [];
  for (let i = 0; i < toInsert.length; i += 200) {
    const chunk = toInsert.slice(i, i + 200);
    try { await sb(`/payments`, { method: "POST", body: JSON.stringify(chunk) }); inserted += chunk.length; process.stdout.write(`\r  已写入 ${inserted}/${toInsert.length}`); }
    catch (e) { errors.push(`批次 ${i}: ${e.message}`); }
  }
  console.log(`\n完成。成功 ${inserted} 笔${errors.length ? `；失败 ${errors.length} 批：\n${errors.join("\n")}` : ""}`);
};

main().catch((e) => { console.error("✗ 出错:", e.message); process.exit(1); });
