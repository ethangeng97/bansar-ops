// ============================================================================
// SettlementsList.jsx — 核销管理(以账单为视角的反向视图)
// 路由:#/settlements
// 数据源:bills + payment_bills + payments + customers + shipments
// 一行 = 一张非作废账单,展开看挂的所有付款记录
// 操作:跳转账单详情、跳转 PaymentsList、撤销单条 payment_bill 关联
// 联动:撤销关联会触发 DB trigger 自动重算 bills.settled_amount/status
// ============================================================================

import { useEffect, useMemo, useState, Fragment } from "react";
import { supabase } from "../supabase.js";

const BRAND = "#1f3864";

const STATUS_LABELS = {
  unsettled: { label: "未核销",   color: "#fa8c16", bg: "#fff7e6" },
  partial:   { label: "部分核销", color: "#1990ff", bg: "#e6f4ff" },
  settled:   { label: "已核销",   color: "#52c41a", bg: "#f6ffed" },
};

const formatDate = (d) => {
  if (!d) return "—";
  return new Date(d).toISOString().slice(0, 10);
};

const csvCell = (v) => {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csvRow = (cells) => cells.map(csvCell).join(",");

export default function SettlementsList({ onBack }) {
  const [direction, setDirection] = useState("AR");
  const [bills, setBills] = useState([]);
  const [paymentsByBill, setPaymentsByBill] = useState({}); // { bill_id: [{payment, applied_amount, pb_id}] }
  const [partnerMap, setPartnerMap] = useState({});
  const [shipMap, setShipMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    keyword: "", status: "unsettled,partial", currency: "",
    date_from: "", date_to: "",
  });
  const [expanded, setExpanded] = useState(new Set());

  const load = async () => {
    setLoading(true);
    try {
      let q = supabase.from("bills").select("*")
        .eq("direction", direction)
        .neq("status", "void")
        .order("created_at", { ascending: false });

      if (filters.currency)  q = q.eq("currency", filters.currency);
      if (filters.date_from) q = q.gte("created_at", filters.date_from);
      if (filters.date_to)   q = q.lte("created_at", filters.date_to + "T23:59:59");

      const { data, error } = await q;
      if (error) { alert("加载失败: " + error.message); setLoading(false); return; }
      let rows = data || [];

      // 状态多选(逗号分隔)
      if (filters.status) {
        const allowed = filters.status.split(",").filter(Boolean);
        rows = rows.filter(b => allowed.includes(b.status));
      }

      // 拉关联表
      const billIds    = rows.map(b => b.id);
      const partnerIds = [...new Set(rows.map(b => b.partner_id).filter(Boolean))];
      const shipIds    = [...new Set(rows.map(b => b.shipment_id).filter(Boolean))];

      const [pbRes, partnerRes, shipRes] = await Promise.all([
        billIds.length    ? supabase.from("payment_bills").select("id, payment_id, bill_id, applied_amount, created_at").in("bill_id", billIds) : Promise.resolve({ data: [] }),
        partnerIds.length ? supabase.from("customers").select("id, name").in("id", partnerIds)                                                  : Promise.resolve({ data: [] }),
        shipIds.length    ? supabase.from("shipments").select("id, order_no, mbl_no, hbl_no, booking_no").in("id", shipIds)                    : Promise.resolve({ data: [] }),
      ]);

      const pbList = pbRes.data || [];
      const paymentIds = [...new Set(pbList.map(x => x.payment_id))];
      const { data: pData } = paymentIds.length
        ? await supabase.from("payments").select("id, payment_no, payment_date, amount, currency, partner_name, status, payment_method").in("id", paymentIds)
        : { data: [] };
      const paymentMap = {}; (pData || []).forEach(p => { paymentMap[p.id] = p; });

      const pMap = {}; (partnerRes.data || []).forEach(p => { pMap[p.id] = p.name; });
      const sMap = {}; (shipRes.data || []).forEach(s => { sMap[s.id] = s; });

      // 按 bill_id 分组 payment_bills
      const byBill = {};
      pbList.forEach(pb => {
        (byBill[pb.bill_id] ||= []).push({
          pb_id: pb.id,
          applied_amount: Number(pb.applied_amount || 0),
          payment: paymentMap[pb.payment_id] || { id: pb.payment_id, payment_no: "(已删除)" },
          created_at: pb.created_at,
        });
      });
      // 每张账单按付款日期倒序
      Object.values(byBill).forEach(arr => arr.sort((a, b) =>
        (b.payment?.payment_date || "").localeCompare(a.payment?.payment_date || "")
      ));

      // keyword 过滤(账单号 / 客户 / 订单号 / 提单号 / 凭证号 / 发票号)
      if (filters.keyword) {
        const k = filters.keyword.toLowerCase().trim();
        rows = rows.filter(b => {
          const ship = sMap[b.shipment_id];
          const blNo = ship ? ((ship.mbl_no || "").trim() || (ship.booking_no || "").trim()) : "";
          return (
            (b.bill_no || "").toLowerCase().includes(k) ||
            (b.partner_name || pMap[b.partner_id] || "").toLowerCase().includes(k) ||
            (ship?.order_no || "").toLowerCase().includes(k) ||
            blNo.toLowerCase().includes(k) ||
            (ship?.hbl_no || "").toLowerCase().includes(k) ||
            (b.invoice_no || "").toLowerCase().includes(k) ||
            (b.voucher_no || "").toLowerCase().includes(k)
          );
        });
      }

      setBills(rows);
      setPaymentsByBill(byBill);
      setPartnerMap(pMap);
      setShipMap(sMap);
    } catch (err) {
      alert("加载失败: " + (err.message || err));
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [direction, filters.status, filters.currency]);

  const toggleExpand = (id) => {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id); else next.add(id);
    setExpanded(next);
  };

  // 撤销某条 payment_bill 关联(只解除关联,不影响 payment 本身)
  const onUnlinkPayment = async (pb_id, payment_no, bill_no) => {
    if (!confirm(`确认撤销付款 ${payment_no} 对账单 ${bill_no} 的核销关联?\n该笔付款本身保留,仅解除分摊;账单核销额会自动回退。`)) return;
    const { error } = await supabase.from("payment_bills").delete().eq("id", pb_id);
    if (error) { alert("撤销失败: " + error.message); return; }
    await load();
  };

  // 顶部汇总:未核销总额(原币按币种 + 折 CNY 估算)
  const summary = useMemo(() => {
    const byCcy = {};
    let cnyRemain = 0;
    let cnyTotal  = 0;
    for (const b of bills) {
      const total    = Number(b.amount_total || 0);
      const settled  = Number(b.settled_amount || 0);
      const remain   = Math.max(0, total - settled);
      const c = b.currency || "CNY";
      byCcy[c] = (byCcy[c] || 0) + remain;
      const rate = Number(b.exchange_rate || 1);
      cnyRemain += remain * rate;
      cnyTotal  += total  * rate;
    }
    return { count: bills.length, byCcy, cnyRemain, cnyTotal };
  }, [bills]);

  const onExportCsv = () => {
    const header = ["账单号","订单号","提单号","HBL","客户/供应商","币种","账单金额","已核销","未核销","状态","核销笔数","付款单号"];
    const lines = [csvRow(header)];
    for (const b of bills) {
      const ship = shipMap[b.shipment_id];
      const blNo = ship ? ((ship.mbl_no || "").trim() || (ship.booking_no || "").trim() || "") : "";
      const linked = paymentsByBill[b.id] || [];
      const payNos = linked.map(x => x.payment?.payment_no).filter(Boolean).join(" ");
      const remain = Math.max(0, Number(b.amount_total || 0) - Number(b.settled_amount || 0));
      lines.push(csvRow([
        b.bill_no || "",
        ship?.order_no || "",
        blNo,
        ship?.hbl_no || "",
        b.partner_name || partnerMap[b.partner_id] || "",
        b.currency || "",
        Number(b.amount_total || 0).toFixed(2),
        Number(b.settled_amount || 0).toFixed(2),
        remain.toFixed(2),
        STATUS_LABELS[b.status]?.label || b.status || "",
        linked.length,
        payNos,
      ]));
    }
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `settlements_${direction}_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <h1 className="page-title">核销管理</h1>

      <div style={{ display: "flex", borderBottom: "1px solid var(--shell-border)", marginBottom: 12 }}>
        {[["AR", "应收账单(收款核销)"], ["AP", "应付账单(付款核销)"]].map(([key, label]) => {
          const active = direction === key;
          return (
            <button key={key} onClick={() => setDirection(key)} style={{
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
        <input className="field-input" placeholder="账单号 / 客户 / 订单号 / 提单号 / 发票号"
               value={filters.keyword}
               onChange={e => setFilters({...filters, keyword: e.target.value})}
               onKeyDown={e => e.key === "Enter" && load()}
               style={{ width: 280 }} />
        <select className="field-select" value={filters.status} onChange={e => setFilters({...filters, status: e.target.value})} style={{ width: 160 }}>
          <option value="unsettled,partial">未结清(未核销+部分)</option>
          <option value="unsettled">仅未核销</option>
          <option value="partial">仅部分核销</option>
          <option value="settled">仅已核销</option>
          <option value="">全部</option>
        </select>
        <select className="field-select" value={filters.currency} onChange={e => setFilters({...filters, currency: e.target.value})} style={{ width: 110 }}>
          <option value="">全部币种</option>
          <option value="CNY">CNY</option><option value="USD">USD</option>
          <option value="EUR">EUR</option><option value="HKD">HKD</option><option value="JPY">JPY</option>
        </select>
        <input className="field-input" type="date" value={filters.date_from}
               onChange={e => setFilters({...filters, date_from: e.target.value})} style={{ width: 130 }} />
        <span style={{ color: "var(--shell-text-3)" }}>~</span>
        <input className="field-input" type="date" value={filters.date_to}
               onChange={e => setFilters({...filters, date_to: e.target.value})} style={{ width: 130 }} />
        <button className="btn" onClick={load}>查询</button>
        <button className="btn" onClick={() => setFilters({ keyword: "", status: "unsettled,partial", currency: "", date_from: "", date_to: "" })}>重置</button>
      </div>

      <div className="page-section-bar" style={{ background: "#fff" }}>
        <span style={{ flex: 1, color: "var(--shell-text-2)", fontSize: 12 }}>
          <b>{summary.count}</b> 张账单 · 未核销折 CNY <b>¥ {summary.cnyRemain.toFixed(2)}</b> / 总额 ¥ {summary.cnyTotal.toFixed(2)}
          {Object.keys(summary.byCcy).length > 0 && (
            <span className="muted" style={{ marginLeft: 8 }}>
              ({Object.entries(summary.byCcy).map(([c, v]) => `${c} ${v.toFixed(2)} 未核`).join(" / ")})
            </span>
          )}
        </span>
        <a href="#/payments" className="btn" style={{ textDecoration: "none" }}>去收付款记录 →</a>
        <button className="btn" onClick={onExportCsv} disabled={bills.length === 0}>↓ 导出 CSV</button>
      </div>

      <div className="page-card" style={{ padding: 0, overflow: "auto" }}>
        {loading ? (
          <div className="empty-state empty-text">加载中...</div>
        ) : bills.length === 0 ? (
          <div className="empty-state empty-text">暂无符合条件的账单</div>
        ) : (
          <table className="tms-table">
            <thead>
              <tr>
                <th style={{ ...th, width: 28 }}></th>
                <th style={th}>账单号</th>
                <th style={th}>订单号</th>
                <th style={th}>{direction === "AR" ? "客户" : "供应商"}</th>
                <th style={{ ...th, textAlign: "right" }}>币 / 账单金额</th>
                <th style={{ ...th, textAlign: "right" }}>已核销</th>
                <th style={{ ...th, textAlign: "right" }}>未核销</th>
                <th style={{ ...th, textAlign: "center", width: 80 }}>核销笔数</th>
                <th style={{ ...th, textAlign: "center", width: 90 }}>状态</th>
              </tr>
            </thead>
            <tbody>
              {bills.map(b => {
                const isExp = expanded.has(b.id);
                const linked = paymentsByBill[b.id] || [];
                const ship = shipMap[b.shipment_id];
                const total = Number(b.amount_total || 0);
                const settled = Number(b.settled_amount || 0);
                const remain = Math.max(0, total - settled);
                const sLabel = STATUS_LABELS[b.status] || { label: b.status || "—", color: "#888", bg: "#fafafa" };
                return (
                  <Fragment key={b.id}>
                    <tr style={{ borderBottom: "1px solid #f5f5f5", cursor: "pointer" }}
                        onClick={() => toggleExpand(b.id)}>
                      <td style={{ ...td, textAlign: "center", color: "#999", userSelect: "none" }}>
                        {linked.length > 0 ? (isExp ? "▼" : "▶") : ""}
                      </td>
                      <td style={{ ...td, fontFamily: "Consolas,monospace", color: BRAND, fontWeight: 600 }}
                          onClick={e => e.stopPropagation()}>
                        <a href={`#/bills/${b.id}`} target="_blank" rel="noreferrer"
                           style={{ color: BRAND, textDecoration: "none" }}>
                          {b.bill_no}
                        </a>
                      </td>
                      <td style={{ ...td, fontFamily: "Consolas,monospace" }} onClick={e => e.stopPropagation()}>
                        {ship?.order_no ? (
                          <a href={`#/sea_export?id=${b.shipment_id}`} target="_blank" rel="noreferrer"
                             style={{ color: "#1990ff", textDecoration: "none" }}>
                            {ship.order_no}
                          </a>
                        ) : <span style={{ color: "#bbb" }}>—</span>}
                      </td>
                      <td style={td}>{b.partner_name || partnerMap[b.partner_id] || "—"}</td>
                      <td style={{ ...td, textAlign: "right", fontFamily: "Consolas,monospace", fontWeight: 700 }}>
                        {b.currency} {total.toFixed(2)}
                      </td>
                      <td style={{ ...td, textAlign: "right", fontFamily: "Consolas,monospace", color: "#52c41a" }}>
                        {settled.toFixed(2)}
                      </td>
                      <td style={{ ...td, textAlign: "right", fontFamily: "Consolas,monospace", color: remain > 0 ? "#fa8c16" : "#999", fontWeight: remain > 0 ? 700 : 400 }}>
                        {remain.toFixed(2)}
                      </td>
                      <td style={{ ...td, textAlign: "center" }}>
                        {linked.length > 0 ? (
                          <span style={{ display: "inline-block", padding: "1px 8px", background: "#e6f4ff", color: "#1990ff", borderRadius: 3, fontSize: 11, fontWeight: 600 }}>
                            {linked.length}
                          </span>
                        ) : <span style={{ color: "#bbb" }}>—</span>}
                      </td>
                      <td style={{ ...td, textAlign: "center" }}>
                        <span style={{ display: "inline-block", padding: "1px 8px", borderRadius: 3,
                                       background: sLabel.bg, color: sLabel.color, fontSize: 11, fontWeight: 600 }}>
                          {sLabel.label}
                        </span>
                      </td>
                    </tr>
                    {isExp && linked.length > 0 && (
                      <tr style={{ background: "#fafbfc" }}>
                        <td></td>
                        <td colSpan={8} style={{ padding: "8px 12px 12px 0" }}>
                          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
                            <thead>
                              <tr style={{ color: "#666" }}>
                                <th style={subTh}>付款单号</th>
                                <th style={subTh}>付款日期</th>
                                <th style={subTh}>方式</th>
                                <th style={subTh}>付款方</th>
                                <th style={{ ...subTh, textAlign: "right" }}>付款总额</th>
                                <th style={{ ...subTh, textAlign: "right" }}>本笔分摊</th>
                                <th style={{ ...subTh, textAlign: "center" }}>付款状态</th>
                                <th style={{ ...subTh, textAlign: "center", width: 60 }}>操作</th>
                              </tr>
                            </thead>
                            <tbody>
                              {linked.map(({ pb_id, applied_amount, payment }) => {
                                const isVoidedPay = payment.status === "voided";
                                return (
                                  <tr key={pb_id} style={{ borderTop: "1px solid #f0f0f0", opacity: isVoidedPay ? 0.5 : 1 }}>
                                    <td style={{ ...subTd, fontFamily: "Consolas,monospace", color: BRAND, fontWeight: 600 }}>
                                      <a href="#/payments" style={{ color: BRAND, textDecoration: "none" }}>
                                        {payment.payment_no}
                                      </a>
                                    </td>
                                    <td style={{ ...subTd, fontFamily: "Consolas,monospace", color: "#444" }}>
                                      {formatDate(payment.payment_date)}
                                    </td>
                                    <td style={{ ...subTd, color: "#666" }}>
                                      {METHOD_LABEL[payment.payment_method] || "—"}
                                    </td>
                                    <td style={subTd}>{payment.partner_name || "—"}</td>
                                    <td style={{ ...subTd, textAlign: "right", fontFamily: "Consolas,monospace" }}>
                                      {payment.currency} {Number(payment.amount || 0).toFixed(2)}
                                    </td>
                                    <td style={{ ...subTd, textAlign: "right", fontFamily: "Consolas,monospace", fontWeight: 600 }}>
                                      {applied_amount.toFixed(2)}
                                    </td>
                                    <td style={{ ...subTd, textAlign: "center" }}>
                                      {isVoidedPay ? (
                                        <span style={{ color: "#888", fontSize: 10 }}>已作废</span>
                                      ) : (
                                        <span style={{ color: "#52c41a", fontSize: 10 }}>有效</span>
                                      )}
                                    </td>
                                    <td style={{ ...subTd, textAlign: "center" }}>
                                      <a onClick={() => onUnlinkPayment(pb_id, payment.payment_no, b.bill_no)}
                                         style={{ color: "#ff4d4f", cursor: "pointer", fontSize: 11 }}>
                                        撤销
                                      </a>
                                    </td>
                                  </tr>
                                );
                              })}
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
    </>
  );
}

const METHOD_LABEL = {
  transfer: "转账", cash: "现金", check: "支票", other: "其他",
};

const th = { padding: "7px 6px", textAlign: "left", borderBottom: "1px solid #e8e8e8", fontWeight: 600 };
const td = { padding: 6 };
const subTh = { padding: "5px 6px", textAlign: "left", borderBottom: "1px solid #e8e8e8", fontWeight: 600, fontSize: 11, color: "#888" };
const subTd = { padding: "5px 6px" };
const btn = { padding: "5px 14px", background: "#fff", border: "1px solid #d9d9d9", borderRadius: 3, fontSize: 12, cursor: "pointer" };
const selStyle = { padding: "5px 8px", border: "1px solid #d9d9d9", borderRadius: 3, fontSize: 12 };
