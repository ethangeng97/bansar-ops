// ============================================================================
// InvoicesList.jsx — 开票/收票记录管理（基于 invoices 表）
// 路由：#/invoices
// 数据源：invoices 表 + invoice_bills 关联表
// 操作：CSV 导入 / 新建 / 编辑（双向挂账单）/ 删除 / 行展开看挂账单详情
// kind tab：业务 / 非业务（仅 admin 可见）
// ============================================================================

import { useEffect, useState, Fragment, useMemo } from "react";
import { supabase } from "../supabase.js";
import InvoiceEditor from "./InvoiceEditor.jsx";
import InvoiceImportDialog from "./InvoiceImportDialog.jsx";

const BRAND = "#1f3864";

const formatDate = (d) => {
  if (!d) return "—";
  const date = new Date(d);
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
};

export default function InvoicesList({ user, onBack }) {
  const role = user?.profile?.role || "operator";
  const isAdmin = role === "admin";

  const [direction, setDirection] = useState("AR");
  const [kindFilter, setKindFilter] = useState("business"); // business / non_business / all
  const [invoices, setInvoices] = useState([]);
  const [billsByInvoice, setBillsByInvoice] = useState({});
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ keyword: "", date_from: "", date_to: "" });
  const [expanded, setExpanded] = useState(new Set());
  const [editing, setEditing] = useState(null);     // null | {} (新建) | invoice 对象（编辑）
  const [importing, setImporting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      let q = supabase.from("invoices").select("*").eq("direction", direction)
        .order("invoice_date", { ascending: false });
      if (kindFilter !== "all") q = q.eq("kind", kindFilter);
      if (filters.date_from) q = q.gte("invoice_date", filters.date_from);
      if (filters.date_to)   q = q.lte("invoice_date", filters.date_to);

      const { data: invs, error } = await q;
      if (error) { alert("加载失败: " + error.message); setLoading(false); return; }

      // 加载关联账单数（一次查全部 invoice_bills，客户端 group by）
      const invIds = (invs || []).map(i => i.id);
      let billsMap = {};
      if (invIds.length > 0) {
        const { data: ibs } = await supabase.from("invoice_bills")
          .select("invoice_id, bill_id, applied_amount").in("invoice_id", invIds);
        const billIds = [...new Set((ibs || []).map(x => x.bill_id))];
        const { data: bills } = billIds.length > 0
          ? await supabase.from("bills").select("id, bill_no, shipment_id, currency, amount_total, statement_id, status").in("id", billIds)
          : { data: [] };
        const billMap = {};
        (bills || []).forEach(b => { billMap[b.id] = b; });

        // 拉 shipments 拿 order_no/mbl_no
        const shipIds = [...new Set((bills || []).map(b => b.shipment_id).filter(Boolean))];
        let shipMap = {};
        if (shipIds.length > 0) {
          const { data: ships } = await supabase.from("shipments")
            .select("id, order_no, booking_no, mbl_no, hbl_no").in("id", shipIds);
          (ships || []).forEach(s => { shipMap[s.id] = s; });
        }

        (ibs || []).forEach(ib => {
          if (!billsMap[ib.invoice_id]) billsMap[ib.invoice_id] = [];
          const b = billMap[ib.bill_id];
          if (b) {
            const ship = shipMap[b.shipment_id];
            billsMap[ib.invoice_id].push({
              ...b,
              applied_amount: Number(ib.applied_amount),
              order_no: ship?.order_no || "—",
              mbl: ship ? (ship.mbl_no || ship.booking_no || "—") : "—",
              hbl: ship?.hbl_no || "",
            });
          }
        });
      }

      let filtered = invs || [];
      if (filters.keyword) {
        const k = filters.keyword.toLowerCase();
        filtered = filtered.filter(i =>
          (i.invoice_no || "").toLowerCase().includes(k) ||
          (i.partner_name || "").toLowerCase().includes(k)
        );
      }
      setInvoices(filtered);
      setBillsByInvoice(billsMap);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [direction, kindFilter]);

  const toggleExpand = (id) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id); else next.add(id);
    setExpanded(next);
  };

  const onDelete = async (inv) => {
    if (!confirm(`确认删除发票 ${inv.invoice_no}？\n关联的 ${(billsByInvoice[inv.id] || []).length} 张账单将解除关联。`)) return;
    const { error } = await supabase.from("invoices").delete().eq("id", inv.id);
    if (error) { alert("删除失败: " + error.message); return; }
    await load();
  };

  // 顶部汇总
  const summary = useMemo(() => {
    const byCcy = {};
    let totalCny = 0;
    invoices.forEach(i => {
      byCcy[i.currency] = (byCcy[i.currency] || 0) + Number(i.amount_total || 0);
      // 简化：CNY 直接累加（其他币种没汇率信息单独显示）
      if (i.currency === "CNY") totalCny += Number(i.amount_total || 0);
    });
    return { count: invoices.length, byCcy, totalCny };
  }, [invoices]);

  return (
    <div style={{ padding: 16, background: "#f0f2f5", minHeight: "100vh" }}>
      <div style={{ background: "#fff", borderRadius: 4, padding: 16, boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>

        {/* 顶部 */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, paddingBottom: 12, borderBottom: "1px solid #f0f0f0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            {onBack && <button onClick={onBack} style={btn}>← 返回</button>}
            <span style={{ fontSize: 16, fontWeight: 700 }}>开票/收票记录</span>
            <span style={{ marginLeft: 4, color: "#888", fontSize: 12 }}>
              共 {summary.count} 张
              {Object.entries(summary.byCcy).map(([c, v]) => ` · ${c} ${v.toFixed(2)}`).join("")}
            </span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setImporting(true)} style={btn}>⬆ CSV 导入</button>
            <button onClick={() => setEditing({})}
                    style={{ ...btn, background: BRAND, color: "#fff", borderColor: BRAND }}>
              + 新建{direction === "AR" ? "开票" : "收票"}
            </button>
          </div>
        </div>

        {/* AR/AP Tab */}
        <div style={{ display: "flex", gap: 0, marginBottom: 8, borderBottom: "1px solid #e8e8e8" }}>
          {[["AR","开票记录（应收）"],["AP","收票记录（应付）"]].map(([key, label]) => (
            <div key={key} onClick={() => setDirection(key)}
                 style={{
                   padding: "10px 24px", cursor: "pointer",
                   color: direction === key ? BRAND : "#666",
                   fontWeight: direction === key ? 700 : 500,
                   borderBottom: direction === key ? `2px solid ${BRAND}` : "2px solid transparent",
                   marginBottom: -1, fontSize: 13,
                 }}>
              {label}
            </div>
          ))}
        </div>

        {/* kind 子 tab */}
        <div style={{ display: "flex", gap: 6, marginBottom: 14, fontSize: 12 }}>
          {[
            ["business", "业务"],
            ...(isAdmin ? [["non_business", "非业务"], ["all", "全部"]] : []),
          ].map(([k, label]) => (
            <button key={k} onClick={() => setKindFilter(k)}
                    style={{
                      padding: "4px 12px", border: "1px solid",
                      borderColor: kindFilter === k ? BRAND : "#d9d9d9",
                      background: kindFilter === k ? "#e6f4ff" : "#fff",
                      color: kindFilter === k ? BRAND : "#666",
                      borderRadius: 3, cursor: "pointer", fontSize: 12,
                    }}>
              {label}
            </button>
          ))}
        </div>

        {/* 筛选 */}
        <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center", fontSize: 12, flexWrap: "wrap" }}>
          <input placeholder="发票号 / 对方"
                 value={filters.keyword}
                 onChange={e => setFilters({...filters, keyword: e.target.value})}
                 onKeyDown={e => e.key === "Enter" && load()}
                 style={{ flex: "0 0 240px", padding: "5px 8px", border: "1px solid #d9d9d9", borderRadius: 3, fontSize: 12 }} />
          <span style={{ color: "#888" }}>开票日期</span>
          <input type="date" value={filters.date_from} onChange={e => setFilters({...filters, date_from: e.target.value})} style={selStyle} />
          <span>~</span>
          <input type="date" value={filters.date_to} onChange={e => setFilters({...filters, date_to: e.target.value})} style={selStyle} />
          <button onClick={load} style={btn}>查询</button>
          <button onClick={() => { setFilters({keyword:"", date_from:"", date_to:""}); setTimeout(load,0); }} style={btn}>重置</button>
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
                <th style={{ ...th, width: 70 }}>类型</th>
                <th style={th}>日期</th>
                <th style={th}>对方</th>
                <th style={{ ...th, textAlign: "right" }}>币 / 金额</th>
                <th style={{ ...th, textAlign: "center" }}>挂账单</th>
                <th style={{ ...th, textAlign: "center", minWidth: 110 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map(inv => {
                const isExp = expanded.has(inv.id);
                const linkedBills = billsByInvoice[inv.id] || [];
                return (
                  <Fragment key={inv.id}>
                    <tr style={{ borderBottom: "1px solid #f5f5f5", cursor: "pointer" }}
                        onClick={() => toggleExpand(inv.id)}>
                      <td style={{ ...td, textAlign: "center", color: "#999", userSelect: "none" }}>
                        {linkedBills.length > 0 ? (isExp ? "▼" : "▶") : ""}
                      </td>
                      <td style={{ ...td, fontFamily: "monospace", color: BRAND, fontWeight: 600 }}>
                        {inv.invoice_no}
                      </td>
                      <td style={td}>
                        <span style={{
                          padding: "1px 6px", fontSize: 11, borderRadius: 2,
                          background: inv.kind === "non_business" ? "#fff7e6" : "#f0f7ff",
                          color: inv.kind === "non_business" ? "#fa8c16" : "#1990ff",
                          border: "1px solid",
                          borderColor: inv.kind === "non_business" ? "#ffd591" : "#bae0ff",
                        }}>
                          {inv.kind === "non_business" ? "非业务" : "业务"}
                        </span>
                      </td>
                      <td style={{ ...td, fontFamily: "monospace", color: "#444" }}>{formatDate(inv.invoice_date)}</td>
                      <td style={td}>{inv.partner_name || "—"}</td>
                      <td style={{ ...td, textAlign: "right", fontFamily: "monospace", fontWeight: 700 }}>
                        {inv.currency} {Number(inv.amount_total).toFixed(2)}
                      </td>
                      <td style={{ ...td, textAlign: "center" }}>
                        <span style={{ display: "inline-block", padding: "1px 8px",
                                       background: linkedBills.length > 0 ? "#e6f4ff" : "#fafafa",
                                       color: linkedBills.length > 0 ? "#1990ff" : "#aaa",
                                       borderRadius: 3, fontSize: 11, fontWeight: 600 }}>
                          {linkedBills.length}
                        </span>
                      </td>
                      <td style={{ ...td, textAlign: "center" }} onClick={e => e.stopPropagation()}>
                        <button onClick={() => setEditing(inv)} style={linkBtn}>编辑</button>
                        <span style={{ color: "#ddd", margin: "0 4px" }}>|</span>
                        <button onClick={() => onDelete(inv)} style={{ ...linkBtn, color: "#ff4d4f" }}>删除</button>
                      </td>
                    </tr>
                    {isExp && linkedBills.length > 0 && (
                      <tr style={{ background: "#fafbfc" }}>
                        <td></td>
                        <td colSpan={7} style={{ padding: "8px 12px 12px 0" }}>
                          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
                            <thead>
                              <tr style={{ color: "#666" }}>
                                <th style={subTh}>账单号</th>
                                <th style={subTh}>作业号</th>
                                <th style={subTh}>提单号</th>
                                <th style={{ ...subTh, textAlign: "right" }}>账单金额</th>
                                <th style={{ ...subTh, textAlign: "right" }}>分摊到本票</th>
                              </tr>
                            </thead>
                            <tbody>
                              {linkedBills.map(b => (
                                <tr key={b.id} style={{ borderTop: "1px solid #f0f0f0" }}>
                                  <td style={{ ...subTd, fontFamily: "monospace" }}>
                                    <a href={`#/bills/${b.id}`} target="_blank" rel="noreferrer"
                                       style={{ color: BRAND, textDecoration: "none", fontWeight: 600 }}>
                                      {b.bill_no}
                                    </a>
                                  </td>
                                  <td style={{ ...subTd, fontFamily: "monospace" }}>
                                    {b.shipment_id ? (
                                      <a href={`#/sea_export?id=${b.shipment_id}`} target="_blank" rel="noreferrer"
                                         style={{ color: "#1990ff", textDecoration: "none" }}>
                                        {b.order_no}
                                      </a>
                                    ) : "—"}
                                  </td>
                                  <td style={{ ...subTd, fontFamily: "monospace" }}>
                                    <div style={{ color: "#444" }}>{b.mbl}</div>
                                    {b.hbl && <div style={{ color: "#888", fontSize: 10 }}>HBL: {b.hbl}</div>}
                                  </td>
                                  <td style={{ ...subTd, textAlign: "right", fontFamily: "monospace" }}>
                                    {b.currency} {Number(b.amount_total).toFixed(2)}
                                  </td>
                                  <td style={{ ...subTd, textAlign: "right", fontFamily: "monospace", color: "#1990ff" }}>
                                    {Number(b.applied_amount).toFixed(2)}
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

      {editing && (
        <InvoiceEditor
          invoice={editing}
          direction={direction}
          role={role}
          onClose={() => setEditing(null)}
          onSaved={async () => { setEditing(null); await load(); }}
        />
      )}
      {importing && (
        <InvoiceImportDialog
          direction={direction}
          onClose={() => setImporting(false)}
          onImported={async () => { await load(); }}
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
const linkBtn = { background: "none", border: "none", color: "#1990ff", cursor: "pointer", fontSize: 12, padding: 0 };
const selStyle = { padding: "5px 8px", border: "1px solid #d9d9d9", borderRadius: 3, fontSize: 12 };
