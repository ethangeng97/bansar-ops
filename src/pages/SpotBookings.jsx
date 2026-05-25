// ============================================================================
// SpotBookings.jsx — 海运出口现舱
// 路由: #/spot_export
// 数据: spot_bookings 表 + shipments(关联反查已售/剩余) + customers(划给客户)
// 功能:
//   1) 列表 + 筛选(POL/POD/船公司/状态/ETD范围)
//   2) 新建/编辑 现舱
//   3) 划给客户 → 自动建 shipment 并关联 spot_booking_id
// ============================================================================

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase.js";

const STATUS_OPTS = ["可售", "部分已售", "全部已售", "已截单", "已取消"];
const STATUS_COLORS = {
  "可售":     { bg: "#f6ffed", fg: "#52c41a", bd: "#b7eb8f" },
  "部分已售": { bg: "#fff8e9", fg: "#c66800", bd: "#ffd28e" },
  "全部已售": { bg: "#f5f5f5", fg: "#888",    bd: "#ddd" },
  "已截单":   { bg: "#fff1f0", fg: "#cf1322", bd: "#ffa39e" },
  "已取消":   { bg: "#f5f5f5", fg: "#aaa",    bd: "#ddd" },
};

const fmtDate = (d) => {
  if (!d) return "—";
  const s = typeof d === "string" ? d.slice(0, 10) : new Date(d).toISOString().slice(0, 10);
  return s;
};
const fmtDateTime = (d) => {
  if (!d) return "—";
  const x = new Date(d);
  return `${String(x.getMonth()+1).padStart(2,"0")}-${String(x.getDate()).padStart(2,"0")} ${String(x.getHours()).padStart(2,"0")}:${String(x.getMinutes()).padStart(2,"0")}`;
};
const daysBetween = (from, to) => {
  if (!from || !to) return null;
  const a = new Date(from); a.setHours(0,0,0,0);
  const b = new Date(to);   b.setHours(0,0,0,0);
  return Math.round((b - a) / 86400000);
};

export default function SpotBookings({ user, onBack }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    keyword: "", carrier: "", pol: "", pod: "", status: "",
    etd_from: "", etd_to: "",
  });
  // shipment 关联反查（id → [{id, order_no, customer, qty_container, sell_price}]）
  const [shipmentsBySpot, setShipmentsBySpot] = useState({});
  const [customers, setCustomers] = useState([]);

  // 当前编辑 / 划分
  const [editing, setEditing] = useState(null);     // null | "new" | {...spot}
  const [allocating, setAllocating] = useState(null); // null | {...spot}

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("spot_bookings")
      .select("*")
      .order("etd", { ascending: true })
      .order("created_at", { ascending: false });
    if (error) { alert("加载失败：" + error.message); setLoading(false); return; }
    setRows(data || []);
    // 反查所有已划分的 shipment
    const spotIds = (data || []).map(r => r.id);
    if (spotIds.length > 0) {
      const { data: shps } = await supabase
        .from("shipments")
        .select("id, order_no, customer, qty_container, spot_booking_id")
        .in("spot_booking_id", spotIds);
      const map = {};
      for (const s of shps || []) {
        if (!map[s.spot_booking_id]) map[s.spot_booking_id] = [];
        map[s.spot_booking_id].push(s);
      }
      setShipmentsBySpot(map);
    } else {
      setShipmentsBySpot({});
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);
  useEffect(() => {
    supabase.from("customers").select("id, name, name_short").order("name").then(({ data }) => {
      setCustomers(data || []);
    });
  }, []);

  // 客户端过滤
  const filtered = useMemo(() => rows.filter(r => {
    const f = filters;
    if (f.carrier && !(r.carrier || "").toLowerCase().includes(f.carrier.toLowerCase())) return false;
    if (f.pol && !(r.pol || "").toLowerCase().includes(f.pol.toLowerCase())) return false;
    if (f.pod && !(r.pod || "").toLowerCase().includes(f.pod.toLowerCase())) return false;
    if (f.status && r.status !== f.status) return false;
    if (f.etd_from && r.etd && r.etd < f.etd_from) return false;
    if (f.etd_to   && r.etd && r.etd > f.etd_to) return false;
    if (f.keyword) {
      const q = f.keyword.toLowerCase();
      const pool = [r.carrier, r.vessel, r.voyage, r.route, r.pol, r.pod, r.booking_no, r.mbl_no, r.notes];
      if (!pool.some(x => (x || "").toLowerCase().includes(q))) return false;
    }
    return true;
  }), [rows, filters]);

  // 汇总
  const summary = useMemo(() => {
    let total = 0, sold = 0, remaining = 0;
    for (const r of filtered) {
      const soldHere = (shipmentsBySpot[r.id] || []).reduce((a, s) => a + (s.qty_container || 1), 0);
      total += r.total_qty || 0;
      sold += soldHere;
      remaining += Math.max(0, (r.total_qty || 0) - soldHere);
    }
    return { count: filtered.length, total, sold, remaining };
  }, [filtered, shipmentsBySpot]);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <h1 className="page-title">海运出口现舱</h1>

      {/* 筛选 */}
      <div className="page-section-bar">
        <input className="field-input" placeholder="船公司/船名/航次/港口/订舱号/备注"
               value={filters.keyword}
               onChange={e => setFilters({ ...filters, keyword: e.target.value })}
               style={{ width: 240 }} />
        <input className="field-input" placeholder="船公司" value={filters.carrier}
               onChange={e => setFilters({ ...filters, carrier: e.target.value })}
               style={{ width: 120 }} />
        <input className="field-input" placeholder="POL" value={filters.pol}
               onChange={e => setFilters({ ...filters, pol: e.target.value })}
               style={{ width: 100 }} />
        <input className="field-input" placeholder="POD" value={filters.pod}
               onChange={e => setFilters({ ...filters, pod: e.target.value })}
               style={{ width: 100 }} />
        <select className="field-select" value={filters.status}
                onChange={e => setFilters({ ...filters, status: e.target.value })}
                style={{ width: 120 }}>
          <option value="">全部状态</option>
          {STATUS_OPTS.map(s => <option key={s}>{s}</option>)}
        </select>
        <span style={{ fontSize: 12, color: "var(--shell-text-2)" }}>ETD</span>
        <input className="field-input" type="date" value={filters.etd_from}
               onChange={e => setFilters({ ...filters, etd_from: e.target.value })}
               style={{ width: 130 }} />
        <span style={{ color: "var(--shell-text-3)" }}>~</span>
        <input className="field-input" type="date" value={filters.etd_to}
               onChange={e => setFilters({ ...filters, etd_to: e.target.value })}
               style={{ width: 130 }} />
        <button className="btn" onClick={() => setFilters({ keyword: "", carrier: "", pol: "", pod: "", status: "", etd_from: "", etd_to: "" })}>重置</button>
        <div style={{ flex: 1 }} />
        <button className="btn primary" onClick={() => setEditing("new")}>+ 新增现舱</button>
      </div>

      {/* 汇总 */}
      <div className="page-section-bar" style={{ background: "#fff" }}>
        <span style={{ flex: 1, color: "var(--shell-text-2)", fontSize: 12 }}>
          共 <b>{summary.count}</b> 个现舱 ·
          总舱位 <b>{summary.total}</b> 柜 ·
          已售 <b style={{ color: "#52c41a" }}>{summary.sold}</b> ·
          剩 <b style={{ color: "#1989ff" }}>{summary.remaining}</b>
        </span>
        <button className="btn" onClick={load}>↻ 刷新</button>
      </div>

      <div className="page-card" style={{ padding: 0, overflow: "auto" }}>
        {loading ? <div style={{ padding: 30, textAlign: "center", color: "#888" }}>加载中...</div>
         : filtered.length === 0 ? <div style={{ padding: 30, textAlign: "center", color: "#888" }}>暂无现舱，点右上「+ 新增现舱」开始</div>
         : (
           <table className="tms-table" style={{ minWidth: 1500 }}>
             <thead>
               <tr>
                 <th style={{ width: 80 }}>船公司</th>
                 <th style={{ width: 160 }}>船名 / 航次</th>
                 <th style={{ width: 130 }}>POL → POD</th>
                 <th style={{ width: 80 }}>柜型</th>
                 <th style={{ textAlign: "right", width: 60 }}>总数</th>
                 <th style={{ textAlign: "right", width: 60 }}>已售</th>
                 <th style={{ textAlign: "right", width: 60 }}>剩余</th>
                 <th style={{ width: 90 }}>ETD</th>
                 <th style={{ width: 80 }}>离船期</th>
                 <th style={{ width: 100 }}>SI 截单</th>
                 <th style={{ width: 130 }}>售价区间</th>
                 <th style={{ width: 80 }}>状态</th>
                 <th style={{ width: 180 }}>操作</th>
               </tr>
             </thead>
             <tbody>
               {filtered.map(r => {
                 const soldShips = shipmentsBySpot[r.id] || [];
                 const soldQty = soldShips.reduce((a, s) => a + (s.qty_container || 1), 0);
                 const remaining = Math.max(0, (r.total_qty || 0) - soldQty);
                 const daysToEtd = daysBetween(today, r.etd);
                 const statusColor = STATUS_COLORS[r.status] || STATUS_COLORS["可售"];
                 const etdTextColor = daysToEtd != null && daysToEtd >= 0 && daysToEtd <= 3 && remaining > 0 ? "#cf1322" : "var(--shell-text-2)";
                 return (
                   <tr key={r.id}>
                     <td>{r.carrier || "—"}</td>
                     <td>{r.vessel || "—"}{r.voyage ? ` / ${r.voyage}` : ""}</td>
                     <td>{r.pol || "—"} → {r.pod || "—"}</td>
                     <td>{r.container_size || ""}{r.container_type || ""}</td>
                     <td style={{ textAlign: "right" }}><b>{r.total_qty || 0}</b></td>
                     <td style={{ textAlign: "right", color: "#52c41a", fontWeight: 600 }}>{soldQty}</td>
                     <td style={{ textAlign: "right", color: remaining > 0 ? "#1989ff" : "#bbb", fontWeight: 600 }}>{remaining}</td>
                     <td>{fmtDate(r.etd)}</td>
                     <td style={{ color: etdTextColor, fontSize: 12 }}>
                       {daysToEtd == null ? "—" : daysToEtd < 0 ? `过 ${-daysToEtd}天` : daysToEtd === 0 ? "今天" : `${daysToEtd}天后`}
                     </td>
                     <td style={{ fontSize: 12 }}>{fmtDateTime(r.si_cutoff)}</td>
                     <td style={{ fontSize: 12 }}>
                       {r.sell_price_min || r.sell_price_max
                         ? `${r.currency || "USD"} ${r.sell_price_min || "?"} ~ ${r.sell_price_max || "?"}`
                         : "—"}
                     </td>
                     <td>
                       <span style={{
                         display: "inline-block", padding: "2px 8px", fontSize: 11, borderRadius: 999,
                         background: statusColor.bg, color: statusColor.fg, border: `1px solid ${statusColor.bd}`,
                       }}>{r.status || "可售"}</span>
                     </td>
                     <td>
                       <button className="btn" style={{ padding: "3px 10px", fontSize: 12, marginRight: 6 }}
                               onClick={() => setEditing(r)}>编辑</button>
                       <button className="btn primary" style={{ padding: "3px 10px", fontSize: 12, marginRight: 6 }}
                               disabled={remaining <= 0}
                               onClick={() => setAllocating(r)}>划给客户</button>
                       {soldShips.length > 0 && (
                         <span title={soldShips.map(s => `${s.order_no} ${s.customer || ""}`).join("\n")}
                               style={{ fontSize: 11, color: "var(--shell-text-3)", cursor: "help" }}>
                           已 {soldShips.length} 单
                         </span>
                       )}
                     </td>
                   </tr>
                 );
               })}
             </tbody>
           </table>
         )
        }
      </div>

      {editing && (
        <SpotEditor
          spot={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
      {allocating && (
        <AllocateModal
          spot={allocating}
          soldQty={(shipmentsBySpot[allocating.id] || []).reduce((a, s) => a + (s.qty_container || 1), 0)}
          customers={customers}
          user={user}
          onClose={() => setAllocating(null)}
          onAllocated={() => { setAllocating(null); load(); }}
        />
      )}
    </>
  );
}

// ─── 新建 / 编辑现舱 ───────────────────────────────────────────
function SpotEditor({ spot, onClose, onSaved }) {
  const [form, setForm] = useState(() => spot ? { ...spot } : {
    carrier: "", vessel: "", voyage: "", route: "", pol: "", pod: "",
    etd: "", eta: "",
    container_size: "40", container_type: "HC", total_qty: 1,
    si_cutoff: null, vgm_cutoff: null, customs_cutoff: null, port_cutoff: null,
    purchase_price: null, sell_price_min: null, sell_price_max: null, currency: "USD",
    booking_no: "", mbl_no: "",
    status: "可售", notes: "",
  });
  const [saving, setSaving] = useState(false);
  const ch = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const isNew = !spot;

  const save = async () => {
    if (!form.carrier || !form.pol || !form.pod) {
      alert("船公司 / POL / POD 必填"); return;
    }
    setSaving(true);
    const payload = {
      ...form,
      total_qty: Number(form.total_qty) || 0,
      purchase_price: form.purchase_price ? Number(form.purchase_price) : null,
      sell_price_min: form.sell_price_min ? Number(form.sell_price_min) : null,
      sell_price_max: form.sell_price_max ? Number(form.sell_price_max) : null,
      etd: form.etd || null, eta: form.eta || null,
      si_cutoff: form.si_cutoff || null,
      vgm_cutoff: form.vgm_cutoff || null,
      customs_cutoff: form.customs_cutoff || null,
      port_cutoff: form.port_cutoff || null,
    };
    delete payload.id;
    delete payload.created_at;
    delete payload.updated_at;
    let err;
    if (isNew) {
      ({ error: err } = await supabase.from("spot_bookings").insert(payload));
    } else {
      ({ error: err } = await supabase.from("spot_bookings").update(payload).eq("id", spot.id));
    }
    setSaving(false);
    if (err) { alert("保存失败：" + err.message); return; }
    onSaved?.();
  };

  return (
    <ModalShell title={isNew ? "新增现舱" : "编辑现舱"} onClose={onClose}
                actions={
                  <>
                    <button className="btn" onClick={onClose}>取消</button>
                    <button className="btn primary" onClick={save} disabled={saving}>{saving ? "保存中..." : "保存"}</button>
                  </>
                }>
      <FormGrid>
        <Group title="船期">
          <Fld label="船公司 *"><input className="field-input" value={form.carrier} onChange={e => ch("carrier", e.target.value)} /></Fld>
          <Fld label="船名"><input className="field-input" value={form.vessel} onChange={e => ch("vessel", e.target.value.toUpperCase())} /></Fld>
          <Fld label="航次"><input className="field-input" value={form.voyage} onChange={e => ch("voyage", e.target.value.toUpperCase())} /></Fld>
          <Fld label="航线"><input className="field-input" value={form.route} onChange={e => ch("route", e.target.value)} /></Fld>
          <Fld label="POL *"><input className="field-input" value={form.pol} onChange={e => ch("pol", e.target.value.toUpperCase())} /></Fld>
          <Fld label="POD *"><input className="field-input" value={form.pod} onChange={e => ch("pod", e.target.value.toUpperCase())} /></Fld>
          <Fld label="ETD"><input className="field-input" type="date" value={form.etd || ""} onChange={e => ch("etd", e.target.value)} /></Fld>
          <Fld label="ETA"><input className="field-input" type="date" value={form.eta || ""} onChange={e => ch("eta", e.target.value)} /></Fld>
        </Group>

        <Group title="柜信息">
          <Fld label="柜型尺寸"><select className="field-select" value={form.container_size || ""} onChange={e => ch("container_size", e.target.value)}>
            <option value="20">20</option><option value="40">40</option><option value="45">45</option>
          </select></Fld>
          <Fld label="柜型类型"><select className="field-select" value={form.container_type || ""} onChange={e => ch("container_type", e.target.value)}>
            <option value="GP">GP</option><option value="HC">HC</option><option value="HQ">HQ</option><option value="RF">RF</option>
          </select></Fld>
          <Fld label="总舱位数 *"><input className="field-input" type="number" min="1" value={form.total_qty} onChange={e => ch("total_qty", e.target.value)} /></Fld>
        </Group>

        <Group title="截单">
          <Fld label="SI 截单"><input className="field-input" type="datetime-local" value={form.si_cutoff ? form.si_cutoff.slice(0,16) : ""} onChange={e => ch("si_cutoff", e.target.value || null)} /></Fld>
          <Fld label="VGM 截单"><input className="field-input" type="datetime-local" value={form.vgm_cutoff ? form.vgm_cutoff.slice(0,16) : ""} onChange={e => ch("vgm_cutoff", e.target.value || null)} /></Fld>
          <Fld label="报关截单"><input className="field-input" type="datetime-local" value={form.customs_cutoff ? form.customs_cutoff.slice(0,16) : ""} onChange={e => ch("customs_cutoff", e.target.value || null)} /></Fld>
          <Fld label="截港"><input className="field-input" type="datetime-local" value={form.port_cutoff ? form.port_cutoff.slice(0,16) : ""} onChange={e => ch("port_cutoff", e.target.value || null)} /></Fld>
        </Group>

        <Group title="价格">
          <Fld label="进价（单柜）"><input className="field-input" type="number" step="0.01" value={form.purchase_price ?? ""} onChange={e => ch("purchase_price", e.target.value)} /></Fld>
          <Fld label="售价下限"><input className="field-input" type="number" step="0.01" value={form.sell_price_min ?? ""} onChange={e => ch("sell_price_min", e.target.value)} /></Fld>
          <Fld label="售价上限"><input className="field-input" type="number" step="0.01" value={form.sell_price_max ?? ""} onChange={e => ch("sell_price_max", e.target.value)} /></Fld>
          <Fld label="币种"><select className="field-select" value={form.currency || "USD"} onChange={e => ch("currency", e.target.value)}>
            <option>USD</option><option>CNY</option><option>EUR</option>
          </select></Fld>
        </Group>

        <Group title="船公司侧">
          <Fld label="订舱号"><input className="field-input" value={form.booking_no || ""} onChange={e => ch("booking_no", e.target.value)} /></Fld>
          <Fld label="MBL"><input className="field-input" value={form.mbl_no || ""} onChange={e => ch("mbl_no", e.target.value)} /></Fld>
        </Group>

        <Group title="业务">
          <Fld label="状态"><select className="field-select" value={form.status || "可售"} onChange={e => ch("status", e.target.value)}>
            {STATUS_OPTS.map(s => <option key={s}>{s}</option>)}
          </select></Fld>
          <Fld label="备注" span={3}><textarea className="field-input" value={form.notes || ""} onChange={e => ch("notes", e.target.value)} style={{ minHeight: 60 }} /></Fld>
        </Group>
      </FormGrid>
    </ModalShell>
  );
}

// ─── 划给客户 ────────────────────────────────────────────────
function AllocateModal({ spot, soldQty, customers, user, onClose, onAllocated }) {
  const remaining = Math.max(0, (spot.total_qty || 0) - soldQty);
  const [customerId, setCustomerId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [qty, setQty] = useState(1);
  const [sellPrice, setSellPrice] = useState(spot.sell_price_max || "");
  const [orderNo, setOrderNo] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  // 自动建议订单号: BSOEF + YYMM + 5位序号
  useEffect(() => {
    (async () => {
      const now = new Date();
      const prefix = `BSOEF${String(now.getFullYear()).slice(2)}${String(now.getMonth()+1).padStart(2,"0")}`;
      const { data } = await supabase
        .from("shipments")
        .select("order_no")
        .like("order_no", `${prefix}%`)
        .order("order_no", { ascending: false })
        .limit(1);
      let nextSeq = 1;
      if (data && data.length > 0) {
        const m = (data[0].order_no || "").match(/(\d+)(?:-\d+)?$/);
        if (m) nextSeq = parseInt(m[1], 10) + 1;
      }
      setOrderNo(`${prefix}${String(nextSeq).padStart(5,"0")}`);
    })();
  }, []);

  const allocate = async () => {
    if (!customerName.trim()) { alert("请填客户"); return; }
    const q = parseInt(qty, 10);
    if (!q || q <= 0) { alert("件数必须 >= 1"); return; }
    if (q > remaining) { alert(`只剩 ${remaining} 个柜，不够 ${q}`); return; }
    if (!orderNo.trim()) { alert("订单号不能为空"); return; }

    setSaving(true);
    // 创建 shipment（FCL 多柜归一票）
    const containerLabel = `${spot.container_size || ""}${spot.container_type || ""}`;
    const payload = {
      business_type: "sea_export",
      shipment_type: q > 1 ? "FCL" : "FCL",  // 默认 FCL（拼柜场景再说）
      order_no: orderNo.trim(),
      customer: customerName,
      customer_id: customerId || null,
      carrier: spot.carrier,
      vessel: spot.vessel,
      voyage: spot.voyage,
      route: spot.route,
      pol: spot.pol,
      pod: spot.pod,
      etd: spot.etd,
      eta: spot.eta,
      booking_no: spot.booking_no || null,
      mbl_no: spot.mbl_no || null,
      qty_container: q,
      lifecycle: "处理中",
      finance_status: "未创建",
      has_hbl: true,
      solicit_type: "代理货",
      spot_booking_id: spot.id,
      internal_note: notes || null,
    };
    const { data, error } = await supabase.from("shipments").insert(payload).select().single();
    if (error) { setSaving(false); alert("创建订单失败：" + error.message); return; }

    // 如有售价记录，写到 spot_bookings.notes 增量（先简单化，后续 charges 可写）
    // 这里只更新 spot 状态：如果全卖完，标记"全部已售"
    const newSold = soldQty + q;
    if (newSold >= (spot.total_qty || 0)) {
      await supabase.from("spot_bookings").update({ status: "全部已售" }).eq("id", spot.id);
    } else if (newSold > 0 && spot.status === "可售") {
      await supabase.from("spot_bookings").update({ status: "部分已售" }).eq("id", spot.id);
    }

    setSaving(false);
    if (confirm(`✓ 已划给 ${customerName} ${q} 个 ${containerLabel}，新建订单 ${orderNo}。\n\n马上去打开新订单？`)) {
      window.open(`#/sea_export?id=${data.id}`, "_blank");
    }
    onAllocated?.();
  };

  return (
    <ModalShell title={`划给客户 — ${spot.carrier} ${spot.vessel || ""} ${spot.voyage || ""}`} onClose={onClose}
                actions={
                  <>
                    <button className="btn" onClick={onClose}>取消</button>
                    <button className="btn primary" onClick={allocate} disabled={saving || remaining === 0}>
                      {saving ? "处理中..." : "划走并建订单"}
                    </button>
                  </>
                }>
      <div style={{ padding: "0 4px" }}>
        <div style={{ marginBottom: 16, padding: 12, background: "var(--shell-bg)", borderRadius: 6, fontSize: 13, lineHeight: 1.7 }}>
          <div><b>{spot.pol} → {spot.pod}</b> · {spot.container_size}{spot.container_type} · ETD {fmtDate(spot.etd)}</div>
          <div style={{ color: "var(--shell-text-2)" }}>
            总 {spot.total_qty} 柜 · 已售 {soldQty} · <b style={{ color: "#1989ff" }}>剩 {remaining}</b>
          </div>
        </div>

        <FormGrid>
          <Group title="划分">
            <Fld label="客户 *" span={2}>
              <input className="field-input" list="alloc-customers" value={customerName}
                     onChange={e => {
                       setCustomerName(e.target.value);
                       const c = customers.find(c => c.name === e.target.value);
                       setCustomerId(c?.id || "");
                     }}
                     placeholder="输入客户名" />
              <datalist id="alloc-customers">
                {customers.map(c => <option key={c.id} value={c.name}>{c.name_short || ""}</option>)}
              </datalist>
            </Fld>
            <Fld label="柜数 *">
              <input className="field-input" type="number" min="1" max={remaining}
                     value={qty} onChange={e => setQty(e.target.value)} />
            </Fld>
            <Fld label="售价 / 柜">
              <input className="field-input" type="number" step="0.01" value={sellPrice}
                     onChange={e => setSellPrice(e.target.value)}
                     placeholder={spot.currency || "USD"} />
            </Fld>
            <Fld label="新订单号 *" span={2}>
              <input className="field-input" value={orderNo} onChange={e => setOrderNo(e.target.value.toUpperCase())} />
            </Fld>
            <Fld label="备注" span={3}>
              <textarea className="field-input" value={notes} onChange={e => setNotes(e.target.value)}
                        style={{ minHeight: 50 }} placeholder="划分备注（写入新订单内部备注）" />
            </Fld>
          </Group>
        </FormGrid>

        <div style={{ marginTop: 12, padding: 10, background: "#fff8e9", border: "1px solid #ffd28e", borderRadius: 6, fontSize: 12, color: "#c66800" }}>
          ⓘ 点「划走」会立即创建一条海运出口订单（已带船公司/船名/航次/POL/POD/ETD），并关联回此现舱。售价目前不写入费用表，需要去新订单的费用面板录入。
        </div>
      </div>
    </ModalShell>
  );
}

// ─── 通用 modal / form 工具 ───────────────────────────────────
function ModalShell({ title, children, actions, onClose }) {
  return (
    <div onClick={onClose} style={{
      position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
      background: "rgba(0,0,0,.35)", zIndex: 100,
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: "#fff", borderRadius: 10, width: "min(900px, 95vw)",
        maxHeight: "92vh", display: "flex", flexDirection: "column",
        boxShadow: "0 20px 60px rgba(0,0,0,.2)",
      }}>
        <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--shell-border)",
                      display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontWeight: 600, fontSize: 15 }}>{title}</span>
          <button onClick={onClose} style={{ border: "none", background: "transparent", fontSize: 20, cursor: "pointer", color: "#999" }}>×</button>
        </div>
        <div style={{ padding: 20, overflowY: "auto", flex: 1 }}>{children}</div>
        <div style={{ padding: "12px 20px", borderTop: "1px solid var(--shell-border)",
                      display: "flex", justifyContent: "flex-end", gap: 8 }}>
          {actions}
        </div>
      </div>
    </div>
  );
}

function FormGrid({ children }) {
  return <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>{children}</div>;
}
function Group({ title, children }) {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 600, color: "var(--shell-text-2)", marginBottom: 8,
                    paddingBottom: 4, borderBottom: "1px solid var(--shell-border-2)" }}>{title}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
        {children}
      </div>
    </div>
  );
}
function Fld({ label, children, span = 1 }) {
  return (
    <div style={{ gridColumn: `span ${span}` }}>
      <div style={{ fontSize: 11, color: "var(--shell-text-3)", marginBottom: 4 }}>{label}</div>
      {children}
    </div>
  );
}
