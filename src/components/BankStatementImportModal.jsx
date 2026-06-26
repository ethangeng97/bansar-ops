// ============================================================================
// BankStatementImportModal — 银行对账单批量导入收付款记录
// 由 PaymentsList 打开。流程：
//   1. 上传网银导出的对账单 CSV（GBK 编码，浦发 etabBill 格式）
//   2. 解析 + 联库去重(按 bank_flow_no) + 按对方户名匹配 customers 填 partner_id
//   3. 预览(收款AR/付款AP/重复跳过；可选排除手续费·工资)
//   4. 确认 → 分批 insert payments（单号在现有最大序号上续号）
// ============================================================================
import { useState, useRef, useMemo } from "react";
import { supabase } from "../supabase.js";
import {
  decodeGbk, parseBankStatement, buildPaymentRecords, seqStartFromPaymentNos,
} from "../lib/bank-statement-parser.js";

const fmt = (n) => Number(n || 0).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function BankStatementImportModal({ open, user, onClose, onImported }) {
  const [stmt, setStmt] = useState(null);        // { account, stmtDebit, stmtCredit, rows }
  const [ctx, setCtx] = useState(null);          // { existingFlowSet, customersByName, seqStart }
  const [excludeNonBiz, setExcludeNonBiz] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);

  const reset = () => { setStmt(null); setCtx(null); setErr(null); setExcludeNonBiz(false); };

  const handleFile = async (file) => {
    if (!file) return;
    reset();
    setBusy(true);
    try {
      const buf = await file.arrayBuffer();
      const text = decodeGbk(buf);
      const parsed = parseBankStatement(text);
      if (!parsed.rows.length) { setErr("没解析出任何明细行。确认是网银导出的对账单 CSV？"); return; }

      // 联库：现有 payments 的 bank_flow_no + 单号 + customers 字典
      const existingFlowSet = new Set();
      const paymentNos = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await supabase.from("payments")
          .select("payment_no, bank_flow_no").range(from, from + 999);
        if (error) throw error;
        const batch = data || [];
        batch.forEach((p) => { if (p.bank_flow_no) existingFlowSet.add(p.bank_flow_no); paymentNos.push(p.payment_no); });
        if (batch.length < 1000) break;
      }
      const { data: custs, error: cErr } = await supabase.from("customers").select("id, name").limit(5000);
      if (cErr) throw cErr;
      const nameCount = new Map(), customersByName = new Map();
      (custs || []).forEach((c) => {
        const k = (c.name || "").trim(); if (!k) return;
        nameCount.set(k, (nameCount.get(k) || 0) + 1); customersByName.set(k, c.id);
      });
      [...nameCount].forEach(([k, v]) => { if (v > 1) customersByName.delete(k); });

      setStmt(parsed);
      setCtx({ existingFlowSet, customersByName, seqStart: seqStartFromPaymentNos(paymentNos) });
    } catch (e) {
      setErr("解析失败：" + (e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  // 根据"排除非业务"开关重算待导入
  const built = useMemo(() => {
    if (!stmt || !ctx) return null;
    const mapped = excludeNonBiz ? stmt.rows.filter((r) => r._category === "business") : stmt.rows;
    const { toInsert, skipped } = buildPaymentRecords(mapped, ctx);
    const ar = toInsert.filter((r) => r.direction === "AR");
    const ap = toInsert.filter((r) => r.direction === "AP");
    const sum = (xs) => xs.reduce((s, r) => s + r.amount, 0);
    const excluded = excludeNonBiz ? stmt.rows.filter((r) => r._category !== "business").length : 0;
    const matched = toInsert.filter((r) => r.partner_id).length;
    return { toInsert, skipped, ar, ap, sumAr: sum(ar), sumAp: sum(ap), excluded, matched };
  }, [stmt, ctx, excludeNonBiz]);

  const onDrop = (e) => { e.preventDefault(); setDragOver(false); handleFile(e.dataTransfer?.files?.[0]); };

  const doImport = async () => {
    if (!built || built.toInsert.length === 0) return;
    if (!window.confirm(`确认导入 ${built.toInsert.length} 笔到收付款记录？\n收款 ${built.ar.length} · 付款 ${built.ap.length}`)) return;
    setBusy(true);
    try {
      const rows = built.toInsert.map((r) => ({ ...r, created_by: user?.id || null }));
      let ok = 0; const errors = [];
      for (let i = 0; i < rows.length; i += 100) {
        const chunk = rows.slice(i, i + 100);
        const { error } = await supabase.from("payments").insert(chunk);
        if (error) errors.push(error.message); else ok += chunk.length;
      }
      if (errors.length) alert(`导入完成（部分失败）\n成功 ${ok} 笔；失败批次：\n${[...new Set(errors)].join("\n")}`);
      else alert(`导入成功！共 ${ok} 笔`);
      onImported?.();
      reset();
      onClose();
    } catch (e) {
      alert("导入失败：" + (e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  // 金额合计是否与对账单一致（仅全量、未排除时校验）
  const totalsMatch = stmt && built && !excludeNonBiz && built.skipped === 0 &&
    Math.abs(built.sumAr - (stmt.stmtCredit || 0)) < 0.01 &&
    Math.abs(built.sumAp - (stmt.stmtDebit || 0)) < 0.01;

  if (!open) return null;

  return (
    <div style={overlay} onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        <div style={head}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>📥 导入银行对账单 → 收付款记录</div>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={btn}>关闭</button>
        </div>

        <div style={{ padding: 16, overflow: "auto", flex: 1 }}>
          {!stmt ? (
            <>
              <div style={{ fontSize: 12, color: "#666", marginBottom: 8, lineHeight: 1.6 }}>
                上传网银导出的对账单 <b>CSV</b>（GBK 编码）。系统按
                <b> 贷方进账=收款 / 借方出账=付款</b> 拆分，按
                <b> 交易流水号#传票序号 </b>去重（已导入过的自动跳过），并按对方户名匹配客商填关联。
              </div>
              <div
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                onClick={() => inputRef.current?.click()}
                style={{
                  border: `2px dashed ${dragOver ? "#1990ff" : "#bbb"}`,
                  background: dragOver ? "#e6f4ff" : "#fafafa",
                  borderRadius: 6, padding: "44px 20px", textAlign: "center",
                  cursor: "pointer", color: "#555", fontSize: 13,
                }}
              >
                {busy ? "解析中…" : "📥 拖入或点击选择对账单 .csv 文件"}
              </div>
              <input ref={inputRef} type="file" accept=".csv" style={{ display: "none" }}
                onChange={(e) => handleFile(e.target.files?.[0])} />
              {err && <div style={{ marginTop: 8, color: "#c00", fontSize: 12 }}>⚠ {err}</div>}
            </>
          ) : built && (
            <>
              <div style={{ fontSize: 12, color: "#666", marginBottom: 10 }}>
                账号 <b>{stmt.account}</b> · 明细 <b>{stmt.rows.length}</b> 笔
              </div>

              <div style={{ display: "flex", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
                <Stat label="待导入" value={built.toInsert.length} color="#1f3864" big />
                <Stat label={`收款 AR`} value={`${built.ar.length} 笔 / ¥${fmt(built.sumAr)}`} color="#52c41a" />
                <Stat label={`付款 AP`} value={`${built.ap.length} 笔 / ¥${fmt(built.sumAp)}`} color="#fa8c16" />
                <Stat label="重复跳过" value={built.skipped} color="#999" />
                <Stat label="匹配到客商" value={built.matched} color="#1990ff" />
                {excludeNonBiz && <Stat label="已排除非业务" value={built.excluded} color="#999" />}
              </div>

              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#444", marginBottom: 10, cursor: "pointer" }}>
                <input type="checkbox" checked={excludeNonBiz} onChange={(e) => setExcludeNonBiz(e.target.checked)} />
                排除银行手续费 / 工资等非业务流水
              </label>

              {totalsMatch && (
                <div style={{ marginBottom: 10, padding: "6px 10px", background: "#f6ffed", border: "1px solid #b7eb8f", borderRadius: 3, fontSize: 12, color: "#389e0d" }}>
                  ✓ 金额合计与对账单借贷总额完全一致（收 ¥{fmt(stmt.stmtCredit)} / 付 ¥{fmt(stmt.stmtDebit)}）
                </div>
              )}

              <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>预览（前 12 笔）</div>
              <table style={tbl}>
                <thead><tr>
                  <th style={th}>方向</th><th style={th}>日期</th><th style={th}>对方</th>
                  <th style={{ ...th, textAlign: "right" }}>金额</th><th style={th}>流水号</th><th style={th}>摘要</th>
                </tr></thead>
                <tbody>
                  {built.toInsert.slice(0, 12).map((r, i) => (
                    <tr key={i}>
                      <td style={{ ...td, color: r.direction === "AR" ? "#52c41a" : "#fa8c16", fontWeight: 600 }}>
                        {r.direction === "AR" ? "收" : "付"}
                      </td>
                      <td style={td}>{r.payment_date}</td>
                      <td style={{ ...td, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {r.partner_name || "—"}{r.partner_id ? "" : <span style={{ color: "#ccc" }}> ·未关联</span>}
                      </td>
                      <td style={{ ...td, textAlign: "right", fontFamily: "Consolas,monospace" }}>{fmt(r.amount)}</td>
                      <td style={{ ...td, fontFamily: "Consolas,monospace", color: "#888" }}>{r.bank_flow_no}</td>
                      <td style={{ ...td, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#666" }}>{r.notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
                <button disabled={busy || built.toInsert.length === 0} onClick={doImport} style={btnPrimary}>
                  {busy ? "导入中…" : `✓ 确认导入 ${built.toInsert.length} 笔`}
                </button>
                <button onClick={reset} style={btn} disabled={busy}>重新选择文件</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, color, big }) {
  return (
    <div style={{ padding: "6px 12px", background: "#fafafa", border: "1px solid #f0f0f0", borderRadius: 4, minWidth: 90 }}>
      <div style={{ fontSize: 11, color: "#888" }}>{label}</div>
      <div style={{ fontSize: big ? 18 : 13, fontWeight: 700, color }}>{value}</div>
    </div>
  );
}

const overlay = { position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 };
const modal = { width: "min(900px, 95vw)", maxHeight: "90vh", background: "#fff", borderRadius: 6, boxShadow: "0 6px 30px rgba(0,0,0,.2)", display: "flex", flexDirection: "column" };
const head = { display: "flex", alignItems: "center", padding: "10px 16px", borderBottom: "1px solid #eee" };
const btn = { padding: "5px 14px", cursor: "pointer", border: "1px solid #d9d9d9", background: "#fff", borderRadius: 3 };
const btnPrimary = { ...btn, background: "#1f3864", color: "#fff", border: "1px solid #1f3864", fontWeight: 600 };
const tbl = { width: "100%", borderCollapse: "collapse", fontSize: 11, border: "1px solid #eee" };
const th = { padding: 5, background: "#f5f5f5", border: "1px solid #eee", textAlign: "left", fontWeight: 600, whiteSpace: "nowrap" };
const td = { padding: 5, border: "1px solid #f0f0f0" };
