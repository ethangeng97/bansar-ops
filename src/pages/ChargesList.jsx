// ============================================================================
// ChargesList.jsx — 全局费用记录(只读审计视图)
// 路由:#/charges
// 数据源:charges + charge_items + customers + bills + shipments
// 编辑入口:不在此处,跳转到对应订单的费用面板(ChargesPanel)
// 操作:跳转订单/账单、CSV 导出
// ============================================================================

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase.js";

const BRAND = "#1f3864";

const STATUS_LABELS = {
  draft:     { label: "草稿",     color: "#888",    bg: "#fafafa" },
  confirmed: { label: "已确认",   color: "#1990ff", bg: "#e6f4ff" },
  settled:   { label: "已结算",   color: "#52c41a", bg: "#f6ffed" },
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

export default function ChargesList({ onBack }) {
  const [direction, setDirection] = useState("AR");
  const [charges, setCharges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    keyword: "", currency: "", bill_state: "", status: "",
    date_from: "", date_to: "",
  });
  // 关联字典
  const [itemMap, setItemMap] = useState({});      // charge_item_id → { name_zh, name_en, code }
  const [partnerMap, setPartnerMap] = useState({}); // partner_id → name
  const [billMap, setBillMap] = useState({});      // bill_id → { bill_no, status }
  const [shipMap, setShipMap] = useState({});      // shipment_id → { order_no, mbl_no, hbl_no, booking_no }

  const load = async () => {
    setLoading(true);
    try {
      let q = supabase.from("charges").select("*")
        .eq("direction", direction)
        .order("created_at", { ascending: false });
      if (filters.currency)  q = q.eq("currency", filters.currency);
      if (filters.status)    q = q.eq("status", filters.status);
      if (filters.date_from) q = q.gte("created_at", filters.date_from);
      if (filters.date_to)   q = q.lte("created_at", filters.date_to + "T23:59:59");

      const { data, error } = await q;
      if (error) { alert("加载失败: " + error.message); setLoading(false); return; }
      let rows = data || [];

      // 是否已挂账单的客户端过滤
      if (filters.bill_state === "billed")   rows = rows.filter(r => !!r.bill_id);
      if (filters.bill_state === "unbilled") rows = rows.filter(r => !r.bill_id);

      // 批量取关联字典
      const itemIds    = [...new Set(rows.map(r => r.charge_item_id).filter(Boolean))];
      const partnerIds = [...new Set(rows.map(r => r.partner_id).filter(Boolean))];
      const billIds    = [...new Set(rows.map(r => r.bill_id).filter(Boolean))];
      const shipIds    = [...new Set(rows.map(r => r.shipment_id).filter(Boolean))];

      const [itemRes, partnerRes, billRes, shipRes] = await Promise.all([
        itemIds.length    ? supabase.from("charge_items").select("id, code, name_zh, name_en").in("id", itemIds)                              : Promise.resolve({ data: [] }),
        partnerIds.length ? supabase.from("customers").select("id, name").in("id", partnerIds)                                                : Promise.resolve({ data: [] }),
        billIds.length    ? supabase.from("bills").select("id, bill_no, status").in("id", billIds)                                            : Promise.resolve({ data: [] }),
        shipIds.length    ? supabase.from("shipments").select("id, order_no, mbl_no, hbl_no, booking_no").in("id", shipIds)                  : Promise.resolve({ data: [] }),
      ]);

      const iMap = {}; (itemRes.data || []).forEach(x => { iMap[x.id] = x; });
      const pMap = {}; (partnerRes.data || []).forEach(x => { pMap[x.id] = x.name; });
      const bMap = {}; (billRes.data || []).forEach(x => { bMap[x.id] = x; });
      const sMap = {}; (shipRes.data || []).forEach(x => { sMap[x.id] = x; });

      // keyword 客户端过滤(订单号/费用类型/单位/账单号/备注)
      if (filters.keyword) {
        const k = filters.keyword.toLowerCase().trim();
        rows = rows.filter(r => {
          const ship = sMap[r.shipment_id];
          const item = iMap[r.charge_item_id];
          const bill = bMap[r.bill_id];
          const partner = pMap[r.partner_id] || "";
          const blNo = ship ? ((ship.mbl_no || "").trim() || (ship.booking_no || "").trim()) : "";
          return (
            (ship?.order_no || "").toLowerCase().includes(k) ||
            blNo.toLowerCase().includes(k) ||
            (ship?.hbl_no || "").toLowerCase().includes(k) ||
            (item?.name_zh || "").toLowerCase().includes(k) ||
            (item?.name_en || "").toLowerCase().includes(k) ||
            partner.toLowerCase().includes(k) ||
            (bill?.bill_no || "").toLowerCase().includes(k) ||
            (r.remark || "").toLowerCase().includes(k)
          );
        });
      }

      setCharges(rows);
      setItemMap(iMap);
      setPartnerMap(pMap);
      setBillMap(bMap);
      setShipMap(sMap);
    } catch (err) {
      alert("加载失败: " + (err.message || err));
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [direction, filters.currency, filters.status, filters.bill_state]);

  // 顶部汇总
  const summary = useMemo(() => {
    const byCcy = {};
    let cny = 0;
    for (const r of charges) {
      const total = Number(r.amount_total || (Number(r.quantity || 0) * Number(r.unit_price || 0) * (1 + Number(r.tax_rate || 0) / 100)));
      const c = r.currency || "CNY";
      byCcy[c] = (byCcy[c] || 0) + total;
      cny += Number(r.amount_cny || (total * Number(r.exchange_rate || 1)));
    }
    return { count: charges.length, byCcy, cny };
  }, [charges]);

  const computeAmount = (r) => {
    const total = r.amount_total != null
      ? Number(r.amount_total)
      : Number(r.quantity || 0) * Number(r.unit_price || 0) * (1 + Number(r.tax_rate || 0) / 100);
    const cny = r.amount_cny != null
      ? Number(r.amount_cny)
      : total * Number(r.exchange_rate || 1);
    return { total, cny };
  };

  const onExportCsv = () => {
    const header = ["订单号","提单号","HBL","方向","费用类型","结算单位","数量","单位","单价","币种","金额","汇率","折CNY","账单号","状态","备注","创建时间"];
    const lines = [csvRow(header)];
    for (const r of charges) {
      const ship = shipMap[r.shipment_id];
      const item = itemMap[r.charge_item_id];
      const bill = billMap[r.bill_id];
      const blNo = ship ? ((ship.mbl_no || "").trim() || (ship.booking_no || "").trim() || "") : "";
      const { total, cny } = computeAmount(r);
      lines.push(csvRow([
        ship?.order_no || "",
        blNo,
        ship?.hbl_no || "",
        r.direction === "AR" ? "应收" : "应付",
        item?.name_zh || item?.code || "",
        partnerMap[r.partner_id] || "",
        r.quantity ?? "",
        r.unit ?? "",
        r.unit_price ?? "",
        r.currency || "",
        total.toFixed(2),
        Number(r.exchange_rate || 1).toFixed(4),
        cny.toFixed(2),
        bill?.bill_no || "",
        STATUS_LABELS[r.status]?.label || r.status || "",
        (r.remark || "").replace(/\n/g, " "),
        formatDate(r.created_at),
      ]));
    }
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `charges_${direction}_${new Date().toISOString().slice(0,10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <h1 className="page-title">费用记录</h1>

      {/* AR/AP underline tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid var(--shell-border)", marginBottom: 12 }}>
        {[["AR", "应收(客户)"], ["AP", "应付(供应商)"]].map(([key, label]) => {
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

      {/* 筛选 */}
      <div className="page-section-bar">
        <input className="field-input" placeholder="订单号 / 费用类型 / 结算单位 / 账单号 / 备注"
               value={filters.keyword}
               onChange={e => setFilters({...filters, keyword: e.target.value})}
               onKeyDown={e => e.key === "Enter" && load()}
               style={{ width: 280 }} />
        <select className="field-select" value={filters.currency} onChange={e => setFilters({...filters, currency: e.target.value})} style={{ width: 120 }}>
          <option value="">全部币种</option>
          <option value="CNY">CNY</option><option value="USD">USD</option>
          <option value="EUR">EUR</option><option value="HKD">HKD</option><option value="JPY">JPY</option>
        </select>
        <select className="field-select" value={filters.bill_state} onChange={e => setFilters({...filters, bill_state: e.target.value})} style={{ width: 130 }}>
          <option value="">全部账单状态</option>
          <option value="billed">已挂账单</option>
          <option value="unbilled">未挂账单</option>
        </select>
        <select className="field-select" value={filters.status} onChange={e => setFilters({...filters, status: e.target.value})} style={{ width: 120 }}>
          <option value="">全部状态</option>
          <option value="draft">草稿</option>
          <option value="confirmed">已确认</option>
          <option value="settled">已结算</option>
        </select>
        <input className="field-input" type="date" value={filters.date_from}
               onChange={e => setFilters({...filters, date_from: e.target.value})} style={{ width: 130 }} />
        <span style={{ color: "var(--shell-text-3)" }}>~</span>
        <input className="field-input" type="date" value={filters.date_to}
               onChange={e => setFilters({...filters, date_to: e.target.value})} style={{ width: 130 }} />
        <button className="btn" onClick={load}>查询</button>
        <button className="btn" onClick={() => setFilters({ keyword: "", currency: "", bill_state: "", status: "", date_from: "", date_to: "" })}>重置</button>
      </div>

      {/* 汇总 + 导出 */}
      <div className="page-section-bar" style={{ background: "#fff" }}>
        <span style={{ flex: 1, color: "var(--shell-text-2)", fontSize: 12 }}>
          共 <b>{summary.count}</b> 条 · 折 CNY <b>¥ {summary.cny.toFixed(2)}</b>
          {Object.keys(summary.byCcy).length > 1 && (
            <span className="muted" style={{ marginLeft: 8 }}>
              ({Object.entries(summary.byCcy).map(([c, v]) => `${c} ${v.toFixed(2)}`).join(" / ")})
            </span>
          )}
        </span>
        <span style={{ fontSize: 11, color: "var(--shell-text-3)" }}>编辑请进入对应订单的费用面板</span>
        <button className="btn" onClick={onExportCsv} disabled={charges.length === 0}>↓ 导出 CSV</button>
      </div>

      <div className="page-card" style={{ padding: 0, overflow: "auto" }}>
        {loading ? <div className="empty-state empty-text">加载中...</div>
         : charges.length === 0 ? <div className="empty-state empty-text">暂无{direction === "AR" ? "应收" : "应付"}费用</div>
         : (
            <table className="tms-table" style={{ minWidth: 1200 }}>
              <thead>
                <tr>
                  <th>订单号</th>
                  <th>提单号</th>
                  <th>费用类型</th>
                  <th>结算单位</th>
                  <th style={{ textAlign: "right", width: 60 }}>数量</th>
                  <th style={{ textAlign: "center", width: 50 }}>单位</th>
                  <th style={{ textAlign: "right", width: 80 }}>单价</th>
                  <th style={{ textAlign: "right", width: 110 }}>金额</th>
                  <th style={{ textAlign: "right", width: 90 }}>折 CNY</th>
                  <th>账单号</th>
                  <th style={{ textAlign: "center", width: 70 }}>状态</th>
                  <th>备注</th>
                </tr>
              </thead>
              <tbody>
                {charges.map(r => {
                  const ship = shipMap[r.shipment_id];
                  const item = itemMap[r.charge_item_id];
                  const bill = billMap[r.bill_id];
                  const blNo = ship ? ((ship.mbl_no || "").trim() || (ship.booking_no || "").trim()) : "";
                  const { total, cny } = computeAmount(r);
                  const sLabel = STATUS_LABELS[r.status] || { label: r.status || "—", color: "#888", bg: "#fafafa" };
                  return (
                    <tr key={r.id} style={{ borderBottom: "1px solid #f5f5f5" }}>
                      <td style={{ ...td, fontFamily: "Consolas,monospace" }}>
                        {ship?.order_no ? (
                          <a href={`#/sea_export?id=${r.shipment_id}`} target="_blank" rel="noreferrer"
                             style={{ color: BRAND, textDecoration: "none", fontWeight: 600 }}>
                            {ship.order_no}
                          </a>
                        ) : <span style={{ color: "#bbb" }}>—</span>}
                      </td>
                      <td style={{ ...td, fontFamily: "Consolas,monospace", color: "#444" }}>
                        <div>{blNo || "—"}</div>
                        {ship?.hbl_no && <div style={{ color: "#888", fontSize: 10 }}>HBL: {ship.hbl_no}</div>}
                      </td>
                      <td style={td} title={item?.name_en || ""}>
                        {item?.name_zh || item?.code || <span style={{ color: "#bbb" }}>—</span>}
                      </td>
                      <td style={td}>{partnerMap[r.partner_id] || <span style={{ color: "#bbb" }}>—</span>}</td>
                      <td style={{ ...td, textAlign: "right", fontFamily: "Consolas,monospace" }}>
                        {r.quantity != null ? Number(r.quantity).toString() : "—"}
                      </td>
                      <td style={{ ...td, textAlign: "center", color: "#666" }}>{r.unit || "—"}</td>
                      <td style={{ ...td, textAlign: "right", fontFamily: "Consolas,monospace" }}>
                        {r.unit_price != null ? Number(r.unit_price).toFixed(2) : "—"}
                      </td>
                      <td style={{ ...td, textAlign: "right", fontFamily: "Consolas,monospace", fontWeight: 700 }}>
                        {r.currency} {total.toFixed(2)}
                      </td>
                      <td style={{ ...td, textAlign: "right", fontFamily: "Consolas,monospace", color: "#1990ff", fontWeight: 600 }}>
                        {cny.toFixed(2)}
                      </td>
                      <td style={{ ...td, fontFamily: "Consolas,monospace" }}>
                        {bill?.bill_no ? (
                          <a href={`#/bills/${r.bill_id}`} target="_blank" rel="noreferrer"
                             style={{ color: BRAND, textDecoration: "none" }}>
                            {bill.bill_no}
                          </a>
                        ) : <span style={{ color: "#bbb" }}>未挂</span>}
                      </td>
                      <td style={{ ...td, textAlign: "center" }}>
                        <span style={{ display: "inline-block", padding: "1px 8px", borderRadius: 3,
                                       background: sLabel.bg, color: sLabel.color, fontSize: 11, fontWeight: 600 }}>
                          {sLabel.label}
                        </span>
                      </td>
                      <td style={{ ...td, color: "#666", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                          title={r.remark || ""}>
                        {r.remark || <span style={{ color: "#ddd" }}>—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
        )}
      </div>
    </>
  );
}

const th = { padding: "7px 6px", textAlign: "left", borderBottom: "1px solid #e8e8e8", fontWeight: 600 };
const td = { padding: 6 };
const btn = { padding: "5px 14px", background: "#fff", border: "1px solid #d9d9d9", borderRadius: 3, fontSize: 12, cursor: "pointer" };
const selStyle = { padding: "5px 8px", border: "1px solid #d9d9d9", borderRadius: 3, fontSize: 12 };
