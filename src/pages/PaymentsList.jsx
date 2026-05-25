// ============================================================================
// PaymentsList.jsx — 收付款记录(财务模块)
// 路由:#/payments
// 数据源:payments 表 + payment_bills 关联表(挂多张账单)
// 一行 = 一笔收/付款,展开看挂的账单列表
// 操作:新建、编辑、作废、CSV 导出
// 联动:payment_bills 行变动会触发 DB trigger 重算 bills.settled_amount
// ============================================================================

import { useEffect, useState, Fragment } from "react";
import { supabase } from "../supabase.js";
import PaymentEditor from "./PaymentEditor.jsx";

const BRAND = "#1f3864";
const PAGE_SIZE = 50;

const STATUS_LABELS = {
  active: { label: "有效", color: "#52c41a", bg: "#f6ffed" },
  voided: { label: "已作废", color: "#888",  bg: "#fafafa" },
};

const METHOD_LABELS = {
  transfer: "银行转账",
  cash:     "现金",
  check:    "支票",
  other:    "其他",
};

const formatDate = (d) => {
  if (!d) return "—";
  const date = new Date(d);
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

// 把一行数据数组拼成 CSV 行,字段含逗号/引号时按 RFC 4180 用双引号转义
const csvCell = (v) => {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csvRow = (cells) => cells.map(csvCell).join(",");

export default function PaymentsList({ onBack }) {
  const [direction, setDirection] = useState("AR");      // AR=收款 / AP=付款
  const [payments, setPayments] = useState([]);          // 当前页的 payment 数组(最多 PAGE_SIZE 行)
  const [billsByPayment, setBillsByPayment] = useState({}); // { [payment_id]: [{bill, applied_amount}] }
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    keyword: "", date_from: "", date_to: "",
    currency: "", status: "active",
  });
  const [expanded, setExpanded] = useState(new Set());
  const [editing, setEditing] = useState(null);          // null | {} (新建) | payment 对象(编辑)
  const [page, setPage] = useState(0);                   // 0-indexed
  // 头部统计:走单独 RPC,绕过 PostgREST 1000 行上限,反映"全量符合筛选条件"的真实数字
  const [headerSummary, setHeaderSummary] = useState({ cnt: 0, total_cny: 0, by_currency: [] });
  // 提交版筛选:keyword/date/currency 改了不立即查,等用户按"查询"或回车;改后 bump 触发 load
  const [reloadKey, setReloadKey] = useState(0);

  // 把 keyword 包进 PostgREST .or(ilike) 表达式;.or() 不自动 url-encode,且有自己的语法字符
  // (`,()*%`),需要先剥掉再 encodeURIComponent 余下部分(中文字符也要编码)
  const buildKeywordOr = (kw) => {
    const cleaned = kw.replace(/[,()*%]/g, "").trim();
    if (!cleaned) return null;
    const pat = encodeURIComponent(`*${cleaned}*`);
    return [
      `payment_no.ilike.${pat}`,
      `partner_name.ilike.${pat}`,
      `bank_account.ilike.${pat}`,
      `bank_flow_no.ilike.${pat}`,
      `notes.ilike.${pat}`,
    ].join(",");
  };

  // 给查询 builder 应用筛选条件(列表 + CSV 导出共用)
  const applyFilters = (q) => {
    if (filters.status)    q = q.eq("status", filters.status);
    if (filters.currency)  q = q.eq("currency", filters.currency);
    if (filters.date_from) q = q.gte("payment_date", filters.date_from);
    if (filters.date_to)   q = q.lte("payment_date", filters.date_to);
    const orExpr = buildKeywordOr(filters.keyword || "");
    if (orExpr) q = q.or(orExpr);
    return q;
  };

  const load = async () => {
    setLoading(true);
    try {
      // ── 主查询(只拉当前页 PAGE_SIZE 行)──
      let q = supabase.from("payments").select("*")
        .eq("direction", direction)
        .order("payment_date", { ascending: false })
        .order("created_at", { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      q = applyFilters(q);

      const { data, error } = await q;
      if (error) { alert("加载失败: " + error.message); setLoading(false); return; }
      const rows = data || [];

      // ── 拉当前页 payment 关联的 bills(展开时显示)──
      const pids = rows.map(p => p.id);
      let bMap = {};
      if (pids.length > 0) {
        const { data: pbs } = await supabase.from("payment_bills")
          .select("payment_id, bill_id, applied_amount").in("payment_id", pids);
        const billIds = [...new Set((pbs || []).map(x => x.bill_id))];
        let billLookup = {};
        if (billIds.length > 0) {
          const { data: bs } = await supabase.from("bills")
            .select("id, bill_no, currency, amount_total, settled_amount, status, shipment_id, statement_id")
            .in("id", billIds);
          (bs || []).forEach(b => { billLookup[b.id] = b; });
        }
        (pbs || []).forEach(pb => {
          (bMap[pb.payment_id] ||= []).push({
            applied_amount: Number(pb.applied_amount || 0),
            bill: billLookup[pb.bill_id] || { id: pb.bill_id, bill_no: "(已删除)" },
          });
        });
      }

      setPayments(rows);
      setBillsByPayment(bMap);

      // ── 头部 summary RPC(全量,无分页限制)──
      const { data: sumData, error: sumErr } = await supabase.rpc("payments_summary", {
        p_direction:  direction,
        p_status:     filters.status || null,
        p_currency:   filters.currency || null,
        p_keyword:    (filters.keyword || "").replace(/[*%]/g, "").trim() || null,
        p_date_from:  filters.date_from || null,
        p_date_to:    filters.date_to || null,
      });
      if (sumErr) {
        // 头部统计失败不阻塞列表;降级显示当前页的近似值
        console.warn("payments_summary failed:", sumErr.message);
        setHeaderSummary({ cnt: rows.length, total_cny: 0, by_currency: [] });
      } else {
        const row = Array.isArray(sumData) ? sumData[0] : sumData;
        setHeaderSummary({
          cnt: Number(row?.cnt || 0),
          total_cny: Number(row?.total_cny || 0),
          by_currency: Array.isArray(row?.by_currency) ? row.by_currency : [],
        });
      }
    } catch (err) {
      alert("加载失败: " + (err.message || err));
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [direction, filters.status, page, reloadKey]);

  // "查询"按钮 / 回车 / 重置:回到第一页并强制 reload(即使 page 已经是 0)
  const commitFilters = () => {
    if (page === 0) setReloadKey(k => k + 1);
    else setPage(0);
  };

  const toggleExpand = (id) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id); else next.add(id);
    setExpanded(next);
  };

  const onVoid = async (p) => {
    if (!confirm(`确认作废 ${p.payment_no}?\n该笔款项将不再计入账单核销;关联账单的核销金额会自动回退。`)) return;
    const { error } = await supabase.from("payments")
      .update({ status: "voided", voided_at: new Date().toISOString() })
      .eq("id", p.id);
    if (error) { alert("作废失败: " + error.message); return; }
    await load();
  };

  const onUnvoid = async (p) => {
    if (!confirm(`确认恢复 ${p.payment_no} 为有效?\n关联账单会重新计入该笔核销。`)) return;
    const { error } = await supabase.from("payments")
      .update({ status: "active", voided_at: null })
      .eq("id", p.id);
    if (error) { alert("恢复失败: " + error.message); return; }
    await load();
  };

  // CSV 导出:导"当前筛选条件下的全部记录"(不仅是当前页)。
  // PostgREST 单次最多 1000 行,所以按 1000 一批循环拉直到拿不满为止;关联 bill 也分批查。
  const [exporting, setExporting] = useState(false);
  const onExportCsv = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      const CHUNK = 1000;
      const allRows = [];
      for (let from = 0; ; from += CHUNK) {
        let q = supabase.from("payments").select("*")
          .eq("direction", direction)
          .order("payment_date", { ascending: false })
          .order("created_at", { ascending: false })
          .range(from, from + CHUNK - 1);
        q = applyFilters(q);
        const { data, error } = await q;
        if (error) throw error;
        const batch = data || [];
        allRows.push(...batch);
        if (batch.length < CHUNK) break;
      }

      // 关联 bills:payment_ids 也可能 > 1000,IN 列表分批避免 URL 过长
      const allPids = allRows.map(p => p.id);
      const bMap = {};
      const IN_CHUNK = 200;
      for (let i = 0; i < allPids.length; i += IN_CHUNK) {
        const slice = allPids.slice(i, i + IN_CHUNK);
        const { data: pbs } = await supabase.from("payment_bills")
          .select("payment_id, bill_id, applied_amount").in("payment_id", slice);
        const billIds = [...new Set((pbs || []).map(x => x.bill_id))];
        let billLookup = {};
        if (billIds.length > 0) {
          const { data: bs } = await supabase.from("bills")
            .select("id, bill_no").in("id", billIds);
          (bs || []).forEach(b => { billLookup[b.id] = b; });
        }
        (pbs || []).forEach(pb => {
          (bMap[pb.payment_id] ||= []).push({
            applied_amount: Number(pb.applied_amount || 0),
            bill: billLookup[pb.bill_id] || { id: pb.bill_id, bill_no: "(已删除)" },
          });
        });
      }

      const header = [
        "单号", "方向", "日期", "对方", "币种", "金额",
        "汇率", "折CNY", "付款方式", "银行账号", "银行流水号", "备注",
        "状态", "挂账单号", "挂账单金额合计",
      ];
      const lines = [csvRow(header)];
      for (const p of allRows) {
        const linked = bMap[p.id] || [];
        const billNos = linked.map(x => x.bill?.bill_no).filter(Boolean).join(" ");
        const linkedSum = linked.reduce((s, x) => s + x.applied_amount, 0).toFixed(2);
        lines.push(csvRow([
          p.payment_no,
          p.direction === "AR" ? "收款" : "付款",
          formatDate(p.payment_date),
          p.partner_name || "",
          p.currency,
          Number(p.amount).toFixed(2),
          Number(p.exchange_rate || 1).toFixed(4),
          Number(p.amount_cny || 0).toFixed(2),
          METHOD_LABELS[p.payment_method] || "",
          p.bank_account || "",
          p.bank_flow_no || "",
          (p.notes || "").replace(/\n/g, " "),
          STATUS_LABELS[p.status]?.label || p.status,
          billNos,
          linkedSum,
        ]));
      }
      // BOM 确保 Excel 正确识别 UTF-8 中文
      const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `payments_${direction}_${new Date().toISOString().slice(0,10)}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert("导出失败: " + (err.message || err));
    } finally {
      setExporting(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(headerSummary.cnt / PAGE_SIZE));

  return (
    <>
      <h1 className="page-title">收付款记录</h1>

      <div style={{ display: "flex", borderBottom: "1px solid var(--shell-border)", marginBottom: 12 }}>
        {[["AR", "收款记录(应收)"], ["AP", "付款记录(应付)"]].map(([key, label]) => {
          const active = direction === key;
          return (
            <button key={key} onClick={() => { setDirection(key); setPage(0); }} style={{
              padding: "8px 18px", border: "none", background: "transparent", cursor: "pointer", fontSize: 13,
              color: active ? "var(--shell-primary)" : "var(--shell-text-2)",
              fontWeight: active ? 600 : 400,
              borderBottom: active ? "2px solid var(--shell-primary)" : "2px solid transparent",
              marginBottom: -1,
            }}>{label}</button>
          );
        })}
      </div>

      <div className="page-section-bar">
        <input className="field-input" placeholder={`单号 / ${direction === "AR" ? "客户" : "供应商"} / 银行 / 备注`}
               value={filters.keyword}
               onChange={e => setFilters({...filters, keyword: e.target.value})}
               onKeyDown={e => e.key === "Enter" && commitFilters()}
               style={{ width: 260 }} />
        <input className="field-input" type="date" value={filters.date_from}
               onChange={e => setFilters({...filters, date_from: e.target.value})} style={{ width: 130 }} />
        <span style={{ color: "var(--shell-text-3)" }}>~</span>
        <input className="field-input" type="date" value={filters.date_to}
               onChange={e => setFilters({...filters, date_to: e.target.value})} style={{ width: 130 }} />
        <select className="field-select" value={filters.currency} onChange={e => setFilters({...filters, currency: e.target.value})} style={{ width: 110 }}>
          <option value="">全部币种</option>
          <option value="CNY">CNY</option><option value="USD">USD</option>
          <option value="EUR">EUR</option><option value="GBP">GBP</option>
        </select>
        <select className="field-select" value={filters.status} onChange={e => { setFilters({...filters, status: e.target.value}); setPage(0); }} style={{ width: 110 }}>
          <option value="active">仅有效</option>
          <option value="voided">仅作废</option>
          <option value="">全部</option>
        </select>
        <button className="btn" onClick={commitFilters}>查询</button>
        <button className="btn" onClick={() => { setFilters({ keyword: "", date_from: "", date_to: "", currency: "", status: "active" }); commitFilters(); }}>重置</button>
      </div>

      <div className="page-section-bar" style={{ background: "#fff" }}>
        <span style={{ flex: 1, color: "var(--shell-text-2)", fontSize: 12 }}>
          共 <b>{headerSummary.cnt}</b> 笔 · 折 CNY <b>¥ {headerSummary.total_cny.toFixed(2)}</b>
          {headerSummary.by_currency.length > 1 && (
            <span className="muted" style={{ marginLeft: 8 }}>
              ({headerSummary.by_currency.map(c => `${c.currency} ${Number(c.total).toFixed(2)}`).join(" / ")})
            </span>
          )}
        </span>
        <button className="btn" onClick={onExportCsv} disabled={exporting || headerSummary.cnt === 0}>
          {exporting ? "导出中..." : "↓ 导出 CSV"}
        </button>
        <button className="btn primary" onClick={() => setEditing({})}>+ 新建{direction === "AR" ? "收款" : "付款"}</button>
      </div>

      <div className="page-card" style={{ padding: 0, overflow: "auto" }}>
        {loading ? (
          <div className="empty-state empty-text">加载中...</div>
        ) : payments.length === 0 ? (
          <div className="empty-state empty-text">暂无{direction === "AR" ? "收款" : "付款"}记录</div>
        ) : (
          <table className="tms-table">
            <thead>
              <tr>
                <th style={{ ...th, width: 28 }}></th>
                <th style={th}>单号</th>
                <th style={th}>日期</th>
                <th style={th}>{direction === "AR" ? "客户" : "供应商"}</th>
                <th style={{ ...th, textAlign: "right" }}>币 / 金额</th>
                <th style={{ ...th, textAlign: "right" }}>折 CNY</th>
                <th style={{ ...th, textAlign: "center" }}>挂账单</th>
                <th style={{ ...th, textAlign: "center" }}>方式</th>
                <th style={th}>银行流水号</th>
                <th style={{ ...th, textAlign: "center", width: 70 }}>状态</th>
                <th style={{ ...th, textAlign: "center", minWidth: 110 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {payments.map(p => {
                const isExp = expanded.has(p.id);
                const linked = billsByPayment[p.id] || [];
                const sLabel = STATUS_LABELS[p.status] || { label: p.status, color: "#888", bg: "#fafafa" };
                const isVoided = p.status === "voided";
                return (
                  <Fragment key={p.id}>
                    <tr style={{ borderBottom: "1px solid #f5f5f5", cursor: "pointer", opacity: isVoided ? 0.6 : 1 }}
                        onClick={() => toggleExpand(p.id)}>
                      <td style={{ ...td, textAlign: "center", color: "#999", userSelect: "none" }}>
                        {linked.length > 0 ? (isExp ? "▼" : "▶") : ""}
                      </td>
                      <td style={{ ...td, fontFamily: "Consolas,monospace", color: BRAND, fontWeight: 600 }}>
                        {p.payment_no}
                      </td>
                      <td style={{ ...td, fontFamily: "Consolas,monospace", color: "#444" }}>
                        {formatDate(p.payment_date)}
                      </td>
                      <td style={td}>{p.partner_name || "—"}</td>
                      <td style={{ ...td, textAlign: "right", fontFamily: "Consolas,monospace", fontWeight: 700 }}>
                        {p.currency} {Number(p.amount).toFixed(2)}
                      </td>
                      <td style={{ ...td, textAlign: "right", fontFamily: "Consolas,monospace", color: "#1990ff", fontWeight: 600 }}>
                        {Number(p.amount_cny || 0).toFixed(2)}
                      </td>
                      <td style={{ ...td, textAlign: "center" }}>
                        {linked.length > 0 ? (
                          <span style={{ display: "inline-block", padding: "1px 8px",
                                          background: "#e6f4ff", color: "#1990ff", borderRadius: 3,
                                          fontSize: 11, fontWeight: 600 }}>
                            {linked.length}
                          </span>
                        ) : <span style={{ color: "#bbb" }}>—</span>}
                      </td>
                      <td style={{ ...td, textAlign: "center", color: "#666" }}>
                        {METHOD_LABELS[p.payment_method] || "—"}
                      </td>
                      <td style={{ ...td, fontFamily: "Consolas,monospace", color: "#888", fontSize: 11 }}>
                        {p.bank_flow_no || "—"}
                      </td>
                      <td style={{ ...td, textAlign: "center" }}>
                        <span style={{ display: "inline-block", padding: "1px 8px", borderRadius: 3,
                                       background: sLabel.bg, color: sLabel.color, fontSize: 11, fontWeight: 600 }}>
                          {sLabel.label}
                        </span>
                      </td>
                      <td style={{ ...td, textAlign: "center" }} onClick={e => e.stopPropagation()}>
                        {!isVoided && (
                          <>
                            <a onClick={() => setEditing(p)} style={linkStyle}>编辑</a>
                            <span style={{ color: "#ddd", margin: "0 4px" }}>|</span>
                            <a onClick={() => onVoid(p)} style={{ ...linkStyle, color: "#ff4d4f" }}>作废</a>
                          </>
                        )}
                        {isVoided && (
                          <a onClick={() => onUnvoid(p)} style={linkStyle}>恢复</a>
                        )}
                      </td>
                    </tr>
                    {isExp && linked.length > 0 && (
                      <tr style={{ background: "#fafbfc" }}>
                        <td></td>
                        <td colSpan={10} style={{ padding: "8px 12px 12px 0" }}>
                          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
                            <thead>
                              <tr style={{ color: "#666" }}>
                                <th style={subTh}>账单号</th>
                                <th style={{ ...subTh, textAlign: "right" }}>账单金额</th>
                                <th style={{ ...subTh, textAlign: "right" }}>已核销</th>
                                <th style={{ ...subTh, textAlign: "right" }}>本笔分摊</th>
                                <th style={{ ...subTh, textAlign: "center" }}>账单状态</th>
                              </tr>
                            </thead>
                            <tbody>
                              {linked.map(({ bill, applied_amount }) => (
                                <tr key={bill.id} style={{ borderTop: "1px solid #f0f0f0" }}>
                                  <td style={{ ...subTd, fontFamily: "Consolas,monospace" }}>
                                    {bill.bill_no ? (
                                      <a href={`#/bills/${bill.id}`} target="_blank" rel="noreferrer"
                                         style={{ color: BRAND, textDecoration: "none", fontWeight: 600 }}>
                                        {bill.bill_no}
                                      </a>
                                    ) : "(已删除)"}
                                  </td>
                                  <td style={{ ...subTd, textAlign: "right", fontFamily: "Consolas,monospace" }}>
                                    {bill.currency} {Number(bill.amount_total || 0).toFixed(2)}
                                  </td>
                                  <td style={{ ...subTd, textAlign: "right", fontFamily: "Consolas,monospace", color: "#52c41a" }}>
                                    {Number(bill.settled_amount || 0).toFixed(2)}
                                  </td>
                                  <td style={{ ...subTd, textAlign: "right", fontFamily: "Consolas,monospace", fontWeight: 600 }}>
                                    {applied_amount.toFixed(2)}
                                  </td>
                                  <td style={{ ...subTd, textAlign: "center", color: "#888" }}>
                                    {bill.status || "—"}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {p.notes && (
                            <div style={{ marginTop: 8, padding: "6px 10px", background: "#fff", border: "1px solid #f0f0f0", borderRadius: 3, fontSize: 11.5, color: "#666" }}>
                              备注:{p.notes}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}

        {/* 分页 */}
        {!loading && headerSummary.cnt > 0 && (
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 6, marginTop: 14, paddingTop: 12, borderTop: "1px solid #f0f0f0", fontSize: 12, color: "#666" }}>
            <button onClick={() => setPage(0)} disabled={page === 0} style={pgBtn(page === 0)}>« 首页</button>
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} style={pgBtn(page === 0)}>← 上一页</button>
            <span style={{ margin: "0 6px" }}>
              第
              <input type="number" min={1} max={totalPages} value={page + 1}
                     onChange={e => {
                       const v = parseInt(e.target.value, 10);
                       if (!Number.isFinite(v)) return;
                       setPage(Math.max(0, Math.min(totalPages - 1, v - 1)));
                     }}
                     style={{ width: 48, textAlign: "center", padding: "3px 4px", border: "1px solid #d9d9d9", borderRadius: 3, fontSize: 12, margin: "0 4px" }} />
              / {totalPages} 页
              <span style={{ color: "#aaa", marginLeft: 10 }}>
                {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, headerSummary.cnt)} / 共 {headerSummary.cnt} 条
              </span>
            </span>
            <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page + 1 >= totalPages} style={pgBtn(page + 1 >= totalPages)}>下一页 →</button>
            <button onClick={() => setPage(totalPages - 1)} disabled={page + 1 >= totalPages} style={pgBtn(page + 1 >= totalPages)}>末页 »</button>
          </div>
        )}
      </div>

      {editing && (
        <PaymentEditor
          payment={editing}
          direction={direction}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await load(); }}
        />
      )}
    </>
  );
}

const th = { padding: "7px 6px", textAlign: "left", borderBottom: "1px solid #e8e8e8", fontWeight: 600 };
const td = { padding: 6 };
const subTh = { padding: "5px 6px", textAlign: "left", borderBottom: "1px solid #e8e8e8", fontWeight: 600, fontSize: 11, color: "#888" };
const subTd = { padding: "5px 6px" };
const btn = { padding: "5px 14px", background: "#fff", border: "1px solid #d9d9d9", borderRadius: 3, fontSize: 12, cursor: "pointer" };
const selStyle = { padding: "5px 8px", border: "1px solid #d9d9d9", borderRadius: 3, fontSize: 12 };
const linkStyle = { color: "#1990ff", cursor: "pointer", fontSize: 11 };
const pgBtn = (disabled) => ({
  padding: "4px 10px", background: "#fff",
  border: "1px solid #d9d9d9", borderRadius: 3, fontSize: 12,
  cursor: disabled ? "not-allowed" : "pointer",
  color: disabled ? "#bbb" : "#444",
});
