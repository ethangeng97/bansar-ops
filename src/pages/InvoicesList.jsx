// ============================================================================
// InvoicesList.jsx — 开票记录管理
// 路由：#/invoices
// 数据源：bills.invoice_no IS NOT NULL，按 invoice_no 前端聚合
// 一行 = 一张发票（可能挂多张账单）
// 点 ▶ 展开看：账单号 / 提单号 / 作业号 / 对账单号 / 金额
// 操作：清票（解开所有挂在该 invoice_no 上的 bills）
// ============================================================================

import { useEffect, useState, Fragment } from "react";
import { supabase } from "../supabase.js";

const BRAND = "#1f3864";

const formatDate = (d) => {
  if (!d) return "—";
  const date = new Date(d);
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

export default function InvoicesList({ onBack }) {
  const [direction, setDirection] = useState("AR"); // AR=开票 / AP=收票
  const [invoices, setInvoices] = useState([]); // 聚合后的发票数组
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    keyword: "", date_from: "", date_to: "",
  });
  const [expanded, setExpanded] = useState(new Set()); // 展开的 invoice_no

  const load = async () => {
    setLoading(true);
    // 1. 拉所有有发票号的 bills
    let q = supabase.from("bills")
      .select("id, bill_no, invoice_no, invoice_date, partner_id, partner_name, shipment_id, statement_id, currency, amount_total, amount_cny, direction, status")
      .eq("direction", direction)
      .not("invoice_no", "is", null)
      .order("invoice_date", { ascending: false });

    if (filters.date_from) q = q.gte("invoice_date", filters.date_from);
    if (filters.date_to)   q = q.lte("invoice_date", filters.date_to + "T23:59:59");

    const { data, error } = await q;
    if (error) { alert("加载失败: " + error.message); setLoading(false); return; }
    const billRows = (data || []).filter(b => (b.invoice_no || "").trim() !== "");

    // 2. 拉 shipments（提单号、作业号）
    const shipIds = [...new Set(billRows.map(b => b.shipment_id).filter(Boolean))];
    let shipMap = {};
    if (shipIds.length > 0) {
      const { data: ss } = await supabase.from("shipments")
        .select("id, order_no, booking_no, hbl_no, mbl_no").in("id", shipIds);
      (ss || []).forEach(x => { shipMap[x.id] = x; });
    }

    // 3. 拉 statements（对账单号）
    const stmtIds = [...new Set(billRows.map(b => b.statement_id).filter(Boolean))];
    let stmtMap = {};
    if (stmtIds.length > 0) {
      const { data: ss } = await supabase.from("statements")
        .select("id, statement_no").in("id", stmtIds);
      (ss || []).forEach(x => { stmtMap[x.id] = x.statement_no; });
    }

    // 4. 给每张 bill 注入提单号、作业号、对账单号
    billRows.forEach(b => {
      const ship = shipMap[b.shipment_id];
      b._order_no = ship?.order_no || "—";
      b._mbl = ship ? ((ship.mbl_no || "").trim() || (ship.booking_no || "").trim() || "—") : "—";
      b._hbl = ship ? (ship.hbl_no || "").trim() : "";
      b._statement_no = b.statement_id ? (stmtMap[b.statement_id] || `#${b.statement_id}`) : null;
    });

    // 5. 按 invoice_no 聚合
    const byInvoice = {};
    billRows.forEach(b => {
      const key = b.invoice_no;
      if (!byInvoice[key]) {
        byInvoice[key] = {
          invoice_no: key,
          invoice_date: b.invoice_date,
          partner_id: b.partner_id,
          partner_name: b.partner_name,
          currency: b.currency,
          direction: b.direction,
          bills: [],
          amount_total: 0,
          amount_cny: 0,
        };
      }
      const grp = byInvoice[key];
      grp.bills.push(b);
      grp.amount_total += Number(b.amount_total || 0);
      grp.amount_cny += Number(b.amount_cny || 0);
      // 如果同发票号下币种不一致（异常），保留第一个
      // 取最新 invoice_date
      if (b.invoice_date && (!grp.invoice_date || b.invoice_date > grp.invoice_date)) {
        grp.invoice_date = b.invoice_date;
      }
    });

    let invs = Object.values(byInvoice);
    // partner_name 兜底
    const partnerIds = [...new Set(invs.map(i => i.partner_id).filter(Boolean))];
    if (partnerIds.length > 0) {
      const { data: ps } = await supabase.from("customers")
        .select("id, name").in("id", partnerIds);
      const pm = {}; (ps || []).forEach(p => { pm[p.id] = p.name; });
      invs.forEach(i => { if (!i.partner_name) i.partner_name = pm[i.partner_id] || ""; });
    }

    // 客户端过滤关键字（发票号 / 客户 / 账单号 / 提单号）
    if (filters.keyword) {
      const k = filters.keyword.toLowerCase().trim();
      invs = invs.filter(g =>
        (g.invoice_no || "").toLowerCase().includes(k) ||
        (g.partner_name || "").toLowerCase().includes(k) ||
        g.bills.some(b =>
          (b.bill_no || "").toLowerCase().includes(k) ||
          (b._mbl || "").toLowerCase().includes(k) ||
          (b._order_no || "").toLowerCase().includes(k)
        )
      );
    }

    // 按 invoice_date 倒序
    invs.sort((a, b) => (b.invoice_date || "").localeCompare(a.invoice_date || ""));
    setInvoices(invs);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [direction]);

  const toggleExpand = (invNo) => {
    const next = new Set(expanded);
    if (next.has(invNo)) next.delete(invNo); else next.add(invNo);
    setExpanded(next);
  };

  const onClearInvoice = async (inv) => {
    if (!confirm(`确认清票（删除发票号 ${inv.invoice_no}）？\n本操作将解除该发票号下所有 ${inv.bills.length} 张账单的开票记录。`)) return;
    const billIds = inv.bills.map(b => b.id);
    const { error } = await supabase.rpc("clear_invoice", { p_bill_ids: billIds });
    if (error) { alert("清票失败: " + error.message); return; }
    await load();
  };

  // 汇总
  const totalInvoices = invoices.length;
  const totalBills = invoices.reduce((s, i) => s + i.bills.length, 0);
  const totalCny = invoices.reduce((s, i) => s + i.amount_cny, 0);

  return (
    <div style={{ padding: 16, background: "#f0f2f5", minHeight: "100vh" }}>
      <div style={{ background: "#fff", borderRadius: 4, padding: 16,
                    boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>

        {/* 顶部 */}
        <div style={{ display: "flex", justifyContent: "space-between",
                      alignItems: "center", marginBottom: 12, paddingBottom: 12,
                      borderBottom: "1px solid #f0f0f0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            {onBack && <button onClick={onBack} style={btn}>← 返回</button>}
            <span style={{ fontSize: 16, fontWeight: 700 }}>开票/收票记录</span>
            <span style={{ marginLeft: 4, color: "#888", fontSize: 12 }}>
              共 {totalInvoices} 张发票 · {totalBills} 张账单 · 折 CNY ¥ {totalCny.toFixed(2)}
            </span>
          </div>
          <a href="#/statements"
             style={{ ...btn, textDecoration: "none", display: "inline-block" }}>
            去对账单管理批量开票 →
          </a>
        </div>

        {/* Tab */}
        <div style={{ display: "flex", gap: 0, marginBottom: 14, borderBottom: "1px solid #e8e8e8" }}>
          {[["AR", "开票记录（应收）"], ["AP", "收票记录（应付）"]].map(([key, label]) => (
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
          <input placeholder="发票号 / 客户 / 账单号 / 提单号 / 作业号"
                 value={filters.keyword}
                 onChange={e => setFilters({...filters, keyword: e.target.value})}
                 onKeyDown={e => e.key === "Enter" && load()}
                 style={{ flex: "0 0 280px", padding: "5px 8px", border: "1px solid #d9d9d9",
                          borderRadius: 3, fontSize: 12 }} />
          <span style={{ color: "#888" }}>开票日期</span>
          <input type="date" value={filters.date_from}
                 onChange={e => setFilters({...filters, date_from: e.target.value})}
                 style={selStyle} />
          <span>~</span>
          <input type="date" value={filters.date_to}
                 onChange={e => setFilters({...filters, date_to: e.target.value})}
                 style={selStyle} />
          <button onClick={load} style={btn}>查询</button>
          <button onClick={() => { setFilters({keyword: "", date_from: "", date_to: ""}); setTimeout(load, 0); }}
                  style={btn}>重置</button>
        </div>

        {/* 列表 */}
        {loading ? (
          <div style={{ padding: 30, textAlign: "center", color: "#888" }}>加载中...</div>
        ) : invoices.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "#999" }}>
            暂无{direction === "AR" ? "开票" : "收票"}记录
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#fafafa", color: "#444" }}>
                <th style={{ ...th, width: 28 }}></th>
                <th style={th}>发票号</th>
                <th style={th}>开票日期</th>
                <th style={th}>{direction === "AR" ? "客户" : "供应商"}</th>
                <th style={{ ...th, textAlign: "center" }}>账单数</th>
                <th style={{ ...th, textAlign: "right" }}>币 / 开票金额</th>
                <th style={{ ...th, textAlign: "right" }}>折 CNY</th>
                <th style={{ ...th, textAlign: "center", minWidth: 80 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map(inv => {
                const isExp = expanded.has(inv.invoice_no);
                return (
                  <Fragment key={inv.invoice_no}>
                    <tr style={{ borderBottom: "1px solid #f5f5f5", cursor: "pointer" }}
                        onClick={() => toggleExpand(inv.invoice_no)}>
                      <td style={{ ...td, textAlign: "center", color: "#999", userSelect: "none" }}>
                        {isExp ? "▼" : "▶"}
                      </td>
                      <td style={{ ...td, fontFamily: "Consolas,monospace", color: BRAND, fontWeight: 600 }}>
                        {inv.invoice_no}
                      </td>
                      <td style={{ ...td, fontFamily: "Consolas,monospace", color: "#444" }}>
                        {formatDate(inv.invoice_date)}
                      </td>
                      <td style={td}>{inv.partner_name || "—"}</td>
                      <td style={{ ...td, textAlign: "center" }}>
                        <span style={{ display: "inline-block", padding: "1px 8px",
                                        background: "#e6f4ff", color: "#1990ff", borderRadius: 3,
                                        fontSize: 11, fontWeight: 600 }}>
                          {inv.bills.length}
                        </span>
                      </td>
                      <td style={{ ...td, textAlign: "right", fontFamily: "Consolas,monospace", fontWeight: 700 }}>
                        {inv.currency} {inv.amount_total.toFixed(2)}
                      </td>
                      <td style={{ ...td, textAlign: "right", fontFamily: "Consolas,monospace", color: "#1990ff", fontWeight: 600 }}>
                        {inv.amount_cny.toFixed(2)}
                      </td>
                      <td style={{ ...td, textAlign: "center" }} onClick={e => e.stopPropagation()}>
                        <a onClick={() => onClearInvoice(inv)}
                           style={{ color: "#ff4d4f", cursor: "pointer", fontSize: 11 }}>清票</a>
                      </td>
                    </tr>
                    {isExp && (
                      <tr style={{ background: "#fafbfc" }}>
                        <td></td>
                        <td colSpan={7} style={{ padding: "8px 12px 12px 0" }}>
                          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
                            <thead>
                              <tr style={{ color: "#666" }}>
                                <th style={subTh}>账单号</th>
                                <th style={subTh}>作业号</th>
                                <th style={subTh}>提单号</th>
                                <th style={subTh}>对账单号</th>
                                <th style={{ ...subTh, textAlign: "right" }}>原币 / 金额</th>
                                <th style={{ ...subTh, textAlign: "right" }}>折 CNY</th>
                              </tr>
                            </thead>
                            <tbody>
                              {inv.bills.map(b => (
                                <tr key={b.id} style={{ borderTop: "1px solid #f0f0f0" }}>
                                  <td style={{ ...subTd, fontFamily: "Consolas,monospace" }}>
                                    <a href={`#/bills/${b.id}`} target="_blank" rel="noreferrer"
                                       style={{ color: BRAND, textDecoration: "none", fontWeight: 600 }}>
                                      {b.bill_no}
                                    </a>
                                  </td>
                                  <td style={{ ...subTd, fontFamily: "Consolas,monospace" }}>
                                    {b.shipment_id ? (
                                      <a href={`#/sea_export?id=${b.shipment_id}`} target="_blank" rel="noreferrer"
                                         style={{ color: "#1990ff", textDecoration: "none" }}>
                                        {b._order_no}
                                      </a>
                                    ) : "—"}
                                  </td>
                                  <td style={{ ...subTd, fontFamily: "Consolas,monospace" }}>
                                    <div style={{ color: "#444" }}>{b._mbl}</div>
                                    {b._hbl && <div style={{ color: "#888", fontSize: 10 }}>HBL: {b._hbl}</div>}
                                  </td>
                                  <td style={{ ...subTd, fontFamily: "Consolas,monospace" }}>
                                    {b._statement_no ? (
                                      <a href={`#/statements/${b.statement_id}`} target="_blank" rel="noreferrer"
                                         style={{ color: "#1990ff", textDecoration: "none" }}>
                                        {b._statement_no}
                                      </a>
                                    ) : <span style={{ color: "#bbb" }}>—</span>}
                                  </td>
                                  <td style={{ ...subTd, textAlign: "right", fontFamily: "Consolas,monospace" }}>
                                    {b.currency} {Number(b.amount_total).toFixed(2)}
                                  </td>
                                  <td style={{ ...subTd, textAlign: "right", fontFamily: "Consolas,monospace", color: "#1990ff" }}>
                                    {Number(b.amount_cny).toFixed(2)}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
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
    </div>
  );
}

const th = { padding: "7px 6px", textAlign: "left", borderBottom: "1px solid #e8e8e8", fontWeight: 600 };
const td = { padding: 6 };
const subTh = { padding: "5px 6px", textAlign: "left", borderBottom: "1px solid #e8e8e8",
                fontWeight: 600, fontSize: 11, color: "#888" };
const subTd = { padding: "5px 6px" };
const btn = { padding: "5px 14px", background: "#fff", border: "1px solid #d9d9d9",
              borderRadius: 3, fontSize: 12, cursor: "pointer" };
const selStyle = { padding: "5px 8px", border: "1px solid #d9d9d9", borderRadius: 3, fontSize: 12 };
