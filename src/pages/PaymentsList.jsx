// ============================================================================
// PaymentsList.jsx — 收付款记录(财务模块)
// 路由:#/payments
// 数据源:payments 表 + payment_bills 关联表(挂多张账单)
// 一行 = 一笔收/付款,展开看挂的账单列表
// 操作:新建、编辑、作废、CSV 导出
// 联动:payment_bills 行变动会触发 DB trigger 重算 bills.settled_amount
// ============================================================================

import { useEffect, useState, Fragment, useMemo } from "react";
import { supabase } from "../supabase.js";
import PaymentEditor from "./PaymentEditor.jsx";

const BRAND = "#1f3864";

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
  const [payments, setPayments] = useState([]);          // 当前 direction 的 payment 数组
  const [billsByPayment, setBillsByPayment] = useState({}); // { [payment_id]: [{bill, applied_amount}] }
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    keyword: "", date_from: "", date_to: "",
    currency: "", status: "active",
  });
  const [expanded, setExpanded] = useState(new Set());
  const [editing, setEditing] = useState(null);          // null | {} (新建) | payment 对象(编辑)

  const load = async () => {
    setLoading(true);
    try {
      let q = supabase.from("payments").select("*")
        .eq("direction", direction)
        .order("payment_date", { ascending: false })
        .order("created_at", { ascending: false });

      if (filters.status)    q = q.eq("status", filters.status);
      if (filters.currency)  q = q.eq("currency", filters.currency);
      if (filters.date_from) q = q.gte("payment_date", filters.date_from);
      if (filters.date_to)   q = q.lte("payment_date", filters.date_to);

      const { data, error } = await q;
      if (error) { alert("加载失败: " + error.message); setLoading(false); return; }
      let rows = data || [];

      // 客户端关键字过滤(单号 / 对方 / 银行 / 备注)
      if (filters.keyword) {
        const k = filters.keyword.toLowerCase().trim();
        rows = rows.filter(p =>
          (p.payment_no || "").toLowerCase().includes(k) ||
          (p.partner_name || "").toLowerCase().includes(k) ||
          (p.bank_account || "").toLowerCase().includes(k) ||
          (p.bank_flow_no || "").toLowerCase().includes(k) ||
          (p.notes || "").toLowerCase().includes(k)
        );
      }

      // 拉关联的 bills(展开时用)
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
    } catch (err) {
      alert("加载失败: " + (err.message || err));
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [direction, filters.status]);

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

  const onExportCsv = () => {
    const header = [
      "单号", "方向", "日期", "对方", "币种", "金额",
      "汇率", "折CNY", "付款方式", "银行账号", "银行流水号", "备注",
      "状态", "挂账单号", "挂账单金额合计",
    ];
    const lines = [csvRow(header)];
    for (const p of payments) {
      const linked = billsByPayment[p.id] || [];
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
  };

  // 顶部汇总
  const summary = useMemo(() => {
    const byCcy = {};
    let cny = 0;
    for (const p of payments) {
      byCcy[p.currency] = (byCcy[p.currency] || 0) + Number(p.amount || 0);
      cny += Number(p.amount_cny || 0);
    }
    return { count: payments.length, byCcy, cny };
  }, [payments]);

  return (
    <div style={{ padding: 16, background: "#f0f2f5", minHeight: "100vh" }}>
      <div style={{ background: "#fff", borderRadius: 4, padding: 16, boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>

        {/* 顶部 */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, paddingBottom: 12, borderBottom: "1px solid #f0f0f0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            {onBack && <button onClick={onBack} style={btn}>← 返回</button>}
            <span style={{ fontSize: 16, fontWeight: 700 }}>收付款记录</span>
            <span style={{ marginLeft: 4, color: "#888", fontSize: 12 }}>
              共 {summary.count} 笔 · 折 CNY ¥ {summary.cny.toFixed(2)}
              {Object.keys(summary.byCcy).length > 1 && (
                <span style={{ color: "#aaa", marginLeft: 8 }}>
                  ({Object.entries(summary.byCcy).map(([c, v]) => `${c} ${v.toFixed(2)}`).join(" / ")})
                </span>
              )}
            </span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onExportCsv} style={btn} disabled={payments.length === 0}>导出 CSV</button>
            <button onClick={() => setEditing({})}
                    style={{ ...btn, background: BRAND, color: "#fff", borderColor: BRAND }}>
              + 新建{direction === "AR" ? "收款" : "付款"}
            </button>
          </div>
        </div>

        {/* AR/AP Tab */}
        <div style={{ display: "flex", gap: 0, marginBottom: 14, borderBottom: "1px solid #e8e8e8" }}>
          {[["AR", "收款记录(应收)"], ["AP", "付款记录(应付)"]].map(([key, label]) => (
            <div key={key}
                 onClick={() => setDirection(key)}
                 style={{
                   padding: "10px 24px", cursor: "pointer",
                   color: direction === key ? BRAND : "#666",
                   fontWeight: direction === key ? 700 : 500,
                   borderBottom: direction === key ? `2px solid ${BRAND}` : "2px solid transparent",
                   marginBottom: -1,
                   fontSize: 13,
                 }}>
              {label}
            </div>
          ))}
        </div>

        {/* 筛选 */}
        <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center", fontSize: 12, flexWrap: "wrap" }}>
          <input placeholder={`单号 / ${direction === "AR" ? "客户" : "供应商"} / 银行 / 备注`}
                 value={filters.keyword}
                 onChange={e => setFilters({...filters, keyword: e.target.value})}
                 onKeyDown={e => e.key === "Enter" && load()}
                 style={{ flex: "0 0 280px", padding: "5px 8px", border: "1px solid #d9d9d9", borderRadius: 3, fontSize: 12 }} />
          <span style={{ color: "#888" }}>日期</span>
          <input type="date" value={filters.date_from}
                 onChange={e => setFilters({...filters, date_from: e.target.value})}
                 style={selStyle} />
          <span>~</span>
          <input type="date" value={filters.date_to}
                 onChange={e => setFilters({...filters, date_to: e.target.value})}
                 style={selStyle} />
          <select value={filters.currency} onChange={e => setFilters({...filters, currency: e.target.value})} style={selStyle}>
            <option value="">全部币种</option>
            <option value="CNY">CNY</option>
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
            <option value="GBP">GBP</option>
          </select>
          <select value={filters.status} onChange={e => setFilters({...filters, status: e.target.value})} style={selStyle}>
            <option value="active">仅有效</option>
            <option value="voided">仅作废</option>
            <option value="">全部</option>
          </select>
          <button onClick={load} style={btn}>查询</button>
          <button onClick={() => { setFilters({ keyword: "", date_from: "", date_to: "", currency: "", status: "active" }); }}
                  style={btn}>重置</button>
        </div>

        {/* 列表 */}
        {loading ? (
          <div style={{ padding: 30, textAlign: "center", color: "#888" }}>加载中...</div>
        ) : payments.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "#999" }}>
            暂无{direction === "AR" ? "收款" : "付款"}记录
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#fafafa", color: "#444" }}>
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
      </div>

      {editing && (
        <PaymentEditor
          payment={editing}
          direction={direction}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await load(); }}
        />
      )}
    </div>
  );
}

const th = { padding: "7px 6px", textAlign: "left", borderBottom: "1px solid #e8e8e8", fontWeight: 600 };
const td = { padding: 6 };
const subTh = { padding: "5px 6px", textAlign: "left", borderBottom: "1px solid #e8e8e8", fontWeight: 600, fontSize: 11, color: "#888" };
const subTd = { padding: "5px 6px" };
const btn = { padding: "5px 14px", background: "#fff", border: "1px solid #d9d9d9", borderRadius: 3, fontSize: 12, cursor: "pointer" };
const selStyle = { padding: "5px 8px", border: "1px solid #d9d9d9", borderRadius: 3, fontSize: 12 };
const linkStyle = { color: "#1990ff", cursor: "pointer", fontSize: 11 };
