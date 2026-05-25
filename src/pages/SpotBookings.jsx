// ============================================================================
// SpotBookings.jsx — 海运出口现舱
// 路由: #/spot_export
// 数据: spot_bookings + shipments(反查已售) + customers(划给客户)
// 功能:
//   1) 列表 + 筛选 + 汇总
//   2) 新建/编辑现舱
//   3) 划给客户 → 自动建 shipment 并关联 spot_booking_id
// 使用 HEAD 现有 TMS 风格组件（TmsTitle/Mi/Tbl/tms-list）
// ============================================================================

import { useState, useEffect, useMemo } from "react";
import { supabase } from "../supabase.js";
import { TmsTitle, Mi, Tbl, TmsInfoBar, TmsPagination } from "../components/tms.jsx";

const STATUS_OPTS = ["可售", "部分已售", "全部已售", "已截单", "已取消"];
const STATUS_BG = {
  "可售":     { bg: "#f6ffed", fg: "#52c41a", bd: "#b7eb8f" },
  "部分已售": { bg: "#fff8e9", fg: "#c66800", bd: "#ffd28e" },
  "全部已售": { bg: "#f5f5f5", fg: "#888",    bd: "#ddd"    },
  "已截单":   { bg: "#fff1f0", fg: "#cf1322", bd: "#ffa39e" },
  "已取消":   { bg: "#f5f5f5", fg: "#aaa",    bd: "#ddd"    },
};

const fmtDate = (d) => {
  if (!d) return "—";
  return typeof d === "string" ? d.slice(0, 10) : new Date(d).toISOString().slice(0, 10);
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

const COLS = [
  { k: "carrier",  w: 80,  label: "船公司" },
  { k: "vessel",   w: 160, label: "船名 / 航次" },
  { k: "route",    w: 130, label: "POL → POD" },
  { k: "container",w: 80,  label: "柜型" },
  { k: "total",    w: 60,  label: "总数",   align: "right" },
  { k: "sold",     w: 60,  label: "已售",   align: "right" },
  { k: "left",     w: 60,  label: "剩余",   align: "right" },
  { k: "etd",      w: 90,  label: "ETD" },
  { k: "days",     w: 80,  label: "离船期" },
  { k: "si",       w: 110, label: "SI 截单" },
  { k: "price",    w: 130, label: "售价区间" },
  { k: "status",   w: 80,  label: "状态",   center: true },
  { k: "act",      w: 200, label: "操作",   center: true },
];

export function SpotBookingsPage({ user, onBack }) {
  const role = user?.profile?.role || "operator";
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    keyword: "", carrier: "", pol: "", pod: "", status: "",
    etd_from: "", etd_to: "",
  });
  const [shipmentsBySpot, setShipmentsBySpot] = useState({});
  const [customers, setCustomers] = useState([]);
  const [editing, setEditing] = useState(null);
  const [allocating, setAllocating] = useState(null);
  const [page, setPage] = useState(0);
  const pageSize = 50;

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("spot_bookings")
      .select("*")
      .order("etd", { ascending: true })
      .order("created_at", { ascending: false });
    if (error) { alert("加载失败：" + error.message); setLoading(false); return; }
    setRows(data || []);
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

  const summary = useMemo(() => {
    let total = 0, sold = 0;
    for (const r of filtered) {
      const soldHere = (shipmentsBySpot[r.id] || []).reduce((a, s) => a + (s.qty_container || 1), 0);
      total += r.total_qty || 0;
      sold += soldHere;
    }
    return { count: filtered.length, total, sold, left: Math.max(0, total - sold) };
  }, [filtered, shipmentsBySpot]);

  const totalPages = Math.ceil(filtered.length / pageSize) || 1;
  const paged = filtered.slice(page * pageSize, (page + 1) * pageSize);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="tms">
      <TmsTitle title="海运出口 / 现舱" user={user} role={role} onClose={onBack} />

      <div className="tms-tb">
        <Mi onClick={onBack}>返回</Mi>
        <Tbl/>
        <Mi onClick={() => setEditing("new")}>+ 新增现舱</Mi>
        <Mi onClick={load}>刷新</Mi>
        <Tbl/>
        <Mi onClick={() => setFilters({ keyword: "", carrier: "", pol: "", pod: "", status: "", etd_from: "", etd_to: "" })}>清除筛选</Mi>
        <Tbl/>
        <Mi onClick={onBack}>关闭</Mi>
      </div>

      <div className="tms-filter-bar" style={{ padding: "8px 14px", background: "#e6f4ff", borderBottom: "1px solid #c8dfff", display: "flex", gap: 8, alignItems: "center", fontSize: 12, flexWrap: "wrap" }}>
        <input placeholder="关键词(船公司/船名/航次/港口/订舱号/备注)" value={filters.keyword}
               onChange={e => setFilters({ ...filters, keyword: e.target.value })}
               style={{ width: 240, padding: "3px 6px", border: "1px solid #c8dfff", borderRadius: 3 }} />
        <input placeholder="船公司" value={filters.carrier}
               onChange={e => setFilters({ ...filters, carrier: e.target.value })}
               style={{ width: 100, padding: "3px 6px", border: "1px solid #c8dfff", borderRadius: 3 }} />
        <input placeholder="POL" value={filters.pol}
               onChange={e => setFilters({ ...filters, pol: e.target.value })}
               style={{ width: 80, padding: "3px 6px", border: "1px solid #c8dfff", borderRadius: 3 }} />
        <input placeholder="POD" value={filters.pod}
               onChange={e => setFilters({ ...filters, pod: e.target.value })}
               style={{ width: 80, padding: "3px 6px", border: "1px solid #c8dfff", borderRadius: 3 }} />
        <select value={filters.status}
                onChange={e => setFilters({ ...filters, status: e.target.value })}
                style={{ width: 100, padding: "3px 6px", border: "1px solid #c8dfff", borderRadius: 3 }}>
          <option value="">全部状态</option>
          {STATUS_OPTS.map(s => <option key={s}>{s}</option>)}
        </select>
        <span>ETD</span>
        <input type="date" value={filters.etd_from}
               onChange={e => setFilters({ ...filters, etd_from: e.target.value })}
               style={{ padding: "3px 6px", border: "1px solid #c8dfff", borderRadius: 3 }} />
        <span>~</span>
        <input type="date" value={filters.etd_to}
               onChange={e => setFilters({ ...filters, etd_to: e.target.value })}
               style={{ padding: "3px 6px", border: "1px solid #c8dfff", borderRadius: 3 }} />
      </div>

      <TmsInfoBar scope="分公司">
        <span style={{ marginLeft: 16 }}>
          共 <b>{summary.count}</b> 个现舱 · 总 <b>{summary.total}</b> 柜 ·
          已售 <b style={{ color: "#52c41a" }}>{summary.sold}</b> ·
          剩 <b style={{ color: "#1990FF" }}>{summary.left}</b>
        </span>
      </TmsInfoBar>

      <div className="tms-list">
        {loading ? (
          <div style={{ padding: 30, textAlign: "center", color: "#888" }}>加载中...</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 30, textAlign: "center", color: "#888" }}>
            暂无现舱，点上方「+ 新增现舱」开始
          </div>
        ) : (
          <table>
            <colgroup>
              {COLS.map(c => <col key={c.k} style={{ width: c.w }} />)}
            </colgroup>
            <thead>
              <tr>
                {COLS.map(c => (
                  <th key={c.k} className={c.center ? "center" : ""}>
                    <span className="ht">{c.label}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paged.map((r, i) => {
                const soldShips = shipmentsBySpot[r.id] || [];
                const soldQty = soldShips.reduce((a, s) => a + (s.qty_container || 1), 0);
                const remaining = Math.max(0, (r.total_qty || 0) - soldQty);
                const daysToEtd = daysBetween(today, r.etd);
                const sc = STATUS_BG[r.status] || STATUS_BG["可售"];
                const daysColor = daysToEtd != null && daysToEtd >= 0 && daysToEtd <= 3 && remaining > 0
                                   ? "#cf1322" : "#666";
                return (
                  <tr key={r.id} className={i % 2 ? "ev" : ""}>
                    <td>{r.carrier || "—"}</td>
                    <td>{r.vessel || "—"}{r.voyage ? ` / ${r.voyage}` : ""}</td>
                    <td>{r.pol || "—"} → {r.pod || "—"}</td>
                    <td>{r.container_size || ""}{r.container_type || ""}</td>
                    <td style={{ textAlign: "right" }}><b>{r.total_qty || 0}</b></td>
                    <td style={{ textAlign: "right", color: "#52c41a", fontWeight: 600 }}>{soldQty}</td>
                    <td style={{ textAlign: "right", color: remaining > 0 ? "#1990FF" : "#bbb", fontWeight: 600 }}>{remaining}</td>
                    <td>{fmtDate(r.etd)}</td>
                    <td style={{ color: daysColor, fontSize: 12 }}>
                      {daysToEtd == null ? "—" : daysToEtd < 0 ? `过 ${-daysToEtd}天` : daysToEtd === 0 ? "今天" : `${daysToEtd}天后`}
                    </td>
                    <td style={{ fontSize: 12 }}>{fmtDateTime(r.si_cutoff)}</td>
                    <td style={{ fontSize: 12 }}>
                      {r.sell_price_min || r.sell_price_max
                        ? `${r.currency || "USD"} ${r.sell_price_min ?? "?"}~${r.sell_price_max ?? "?"}`
                        : "—"}
                    </td>
                    <td className="center">
                      <span style={{
                        display: "inline-block", padding: "2px 8px", fontSize: 11, borderRadius: 99,
                        background: sc.bg, color: sc.fg, border: `1px solid ${sc.bd}`,
                      }}>{r.status || "可售"}</span>
                    </td>
                    <td className="center">
                      <span className="lk" style={{ marginRight: 8 }} onClick={() => setEditing(r)}>编辑</span>
                      {remaining > 0 ? (
                        <span className="lk" style={{ color: "#1990FF", fontWeight: 600 }}
                              onClick={() => setAllocating(r)}>划给客户</span>
                      ) : (
                        <span style={{ color: "#bbb", marginRight: 8 }}>已售完</span>
                      )}
                      {soldShips.length > 0 && (
                        <span title={soldShips.map(s => `${s.order_no} ${s.customer || ""}`).join("\n")}
                              style={{ fontSize: 11, color: "#999", marginLeft: 8, cursor: "help" }}>
                          {soldShips.length}单
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <TmsPagination page={page} setPage={setPage} totalPages={totalPages} pageSize={pageSize} total={filtered.length} />

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
          onClose={() => setAllocating(null)}
          onAllocated={() => { setAllocating(null); load(); }}
        />
      )}
    </div>
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
    if (!form.carrier || !form.pol || !form.pod) { alert("船公司 / POL / POD 必填"); return; }
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
    if (isNew) ({ error: err } = await supabase.from("spot_bookings").insert(payload));
    else       ({ error: err } = await supabase.from("spot_bookings").update(payload).eq("id", spot.id));
    setSaving(false);
    if (err) { alert("保存失败：" + err.message); return; }
    onSaved?.();
  };

  return (
    <ModalShell title={isNew ? "新增现舱" : "编辑现舱"} onClose={onClose}
                actions={<>
                  <button onClick={onClose} style={modalBtnSecondary}>取消</button>
                  <button onClick={save} disabled={saving} style={modalBtnPrimary}>{saving ? "保存中..." : "保存"}</button>
                </>}>
      <Group title="船期">
        <Fld label="船公司 *"><input style={fldInput} value={form.carrier} onChange={e => ch("carrier", e.target.value)} /></Fld>
        <Fld label="船名"><input style={fldInput} value={form.vessel} onChange={e => ch("vessel", e.target.value.toUpperCase())} /></Fld>
        <Fld label="航次"><input style={fldInput} value={form.voyage} onChange={e => ch("voyage", e.target.value.toUpperCase())} /></Fld>
        <Fld label="航线"><input style={fldInput} value={form.route} onChange={e => ch("route", e.target.value)} /></Fld>
        <Fld label="POL *"><input style={fldInput} value={form.pol} onChange={e => ch("pol", e.target.value.toUpperCase())} /></Fld>
        <Fld label="POD *"><input style={fldInput} value={form.pod} onChange={e => ch("pod", e.target.value.toUpperCase())} /></Fld>
        <Fld label="ETD"><input style={fldInput} type="date" value={form.etd || ""} onChange={e => ch("etd", e.target.value)} /></Fld>
        <Fld label="ETA"><input style={fldInput} type="date" value={form.eta || ""} onChange={e => ch("eta", e.target.value)} /></Fld>
      </Group>
      <Group title="柜信息">
        <Fld label="柜型尺寸"><select style={fldInput} value={form.container_size || ""} onChange={e => ch("container_size", e.target.value)}>
          <option value="20">20</option><option value="40">40</option><option value="45">45</option>
        </select></Fld>
        <Fld label="柜型类型"><select style={fldInput} value={form.container_type || ""} onChange={e => ch("container_type", e.target.value)}>
          <option value="GP">GP</option><option value="HC">HC</option><option value="HQ">HQ</option><option value="RF">RF</option>
        </select></Fld>
        <Fld label="总舱位 *"><input style={fldInput} type="number" min="1" value={form.total_qty} onChange={e => ch("total_qty", e.target.value)} /></Fld>
      </Group>
      <Group title="截单">
        <Fld label="SI 截单"><input style={fldInput} type="datetime-local" value={form.si_cutoff ? form.si_cutoff.slice(0,16) : ""} onChange={e => ch("si_cutoff", e.target.value || null)} /></Fld>
        <Fld label="VGM 截单"><input style={fldInput} type="datetime-local" value={form.vgm_cutoff ? form.vgm_cutoff.slice(0,16) : ""} onChange={e => ch("vgm_cutoff", e.target.value || null)} /></Fld>
        <Fld label="报关截单"><input style={fldInput} type="datetime-local" value={form.customs_cutoff ? form.customs_cutoff.slice(0,16) : ""} onChange={e => ch("customs_cutoff", e.target.value || null)} /></Fld>
        <Fld label="截港"><input style={fldInput} type="datetime-local" value={form.port_cutoff ? form.port_cutoff.slice(0,16) : ""} onChange={e => ch("port_cutoff", e.target.value || null)} /></Fld>
      </Group>
      <Group title="价格">
        <Fld label="进价(单柜)"><input style={fldInput} type="number" step="0.01" value={form.purchase_price ?? ""} onChange={e => ch("purchase_price", e.target.value)} /></Fld>
        <Fld label="售价下限"><input style={fldInput} type="number" step="0.01" value={form.sell_price_min ?? ""} onChange={e => ch("sell_price_min", e.target.value)} /></Fld>
        <Fld label="售价上限"><input style={fldInput} type="number" step="0.01" value={form.sell_price_max ?? ""} onChange={e => ch("sell_price_max", e.target.value)} /></Fld>
        <Fld label="币种"><select style={fldInput} value={form.currency || "USD"} onChange={e => ch("currency", e.target.value)}>
          <option>USD</option><option>CNY</option><option>EUR</option>
        </select></Fld>
      </Group>
      <Group title="船公司侧">
        <Fld label="订舱号"><input style={fldInput} value={form.booking_no || ""} onChange={e => ch("booking_no", e.target.value)} /></Fld>
        <Fld label="MBL"><input style={fldInput} value={form.mbl_no || ""} onChange={e => ch("mbl_no", e.target.value)} /></Fld>
      </Group>
      <Group title="业务">
        <Fld label="状态"><select style={fldInput} value={form.status || "可售"} onChange={e => ch("status", e.target.value)}>
          {STATUS_OPTS.map(s => <option key={s}>{s}</option>)}
        </select></Fld>
        <Fld label="备注" span={3}><textarea style={{ ...fldInput, minHeight: 60 }} value={form.notes || ""} onChange={e => ch("notes", e.target.value)} /></Fld>
      </Group>
    </ModalShell>
  );
}

// ─── 划给客户 ─────────────────────────────────────────────────
function AllocateModal({ spot, soldQty, customers, onClose, onAllocated }) {
  const remaining = Math.max(0, (spot.total_qty || 0) - soldQty);
  const [customerId, setCustomerId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [qty, setQty] = useState(1);
  const [sellPrice, setSellPrice] = useState(spot.sell_price_max || "");
  const [orderNo, setOrderNo] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const now = new Date();
      const prefix = `BSOEF${String(now.getFullYear()).slice(2)}${String(now.getMonth()+1).padStart(2,"0")}`;
      const { data } = await supabase
        .from("shipments").select("order_no")
        .like("order_no", `${prefix}%`)
        .order("order_no", { ascending: false }).limit(1);
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
    if (!q || q <= 0) { alert("柜数必须 >= 1"); return; }
    if (q > remaining) { alert(`只剩 ${remaining} 个柜，不够 ${q}`); return; }
    if (!orderNo.trim()) { alert("订单号不能为空"); return; }
    setSaving(true);
    const payload = {
      business_type: "sea_export",
      shipment_type: "FCL",
      order_no: orderNo.trim(),
      customer: customerName,
      customer_id: customerId || null,
      carrier: spot.carrier, vessel: spot.vessel, voyage: spot.voyage,
      route: spot.route, pol: spot.pol, pod: spot.pod,
      etd: spot.etd, eta: spot.eta,
      booking_no: spot.booking_no || null,
      mbl_no: spot.mbl_no || null,
      qty_container: q,
      lifecycle: "处理中", finance_status: "未创建",
      has_hbl: true, solicit_type: "代理货",
      spot_booking_id: spot.id,
      internal_note: notes || null,
    };
    const { data, error } = await supabase.from("shipments").insert(payload).select().single();
    if (error) { setSaving(false); alert("创建订单失败：" + error.message); return; }
    const newSold = soldQty + q;
    if (newSold >= (spot.total_qty || 0)) {
      await supabase.from("spot_bookings").update({ status: "全部已售" }).eq("id", spot.id);
    } else if (newSold > 0 && spot.status === "可售") {
      await supabase.from("spot_bookings").update({ status: "部分已售" }).eq("id", spot.id);
    }
    setSaving(false);
    if (confirm(`✓ 已划给 ${customerName} ${q} 柜，新建订单 ${orderNo}。\n\n马上打开新订单？`)) {
      window.open(`#/sea_export?id=${data.id}`, "_blank");
    }
    onAllocated?.();
  };

  return (
    <ModalShell title={`划给客户 — ${spot.carrier} ${spot.vessel || ""} ${spot.voyage || ""}`} onClose={onClose}
                actions={<>
                  <button onClick={onClose} style={modalBtnSecondary}>取消</button>
                  <button onClick={allocate} disabled={saving || remaining === 0} style={modalBtnPrimary}>
                    {saving ? "处理中..." : "划走并建订单"}
                  </button>
                </>}>
      <div style={{ marginBottom: 16, padding: 12, background: "#e6f4ff", border: "1px solid #c8dfff", borderRadius: 4, fontSize: 13, lineHeight: 1.8 }}>
        <div><b>{spot.pol} → {spot.pod}</b> · {spot.container_size}{spot.container_type} · ETD {fmtDate(spot.etd)}</div>
        <div style={{ color: "#666" }}>总 {spot.total_qty} · 已售 {soldQty} · <b style={{ color: "#1990FF" }}>剩 {remaining}</b></div>
      </div>
      <Group title="划分">
        <Fld label="客户 *" span={2}>
          <input style={fldInput} list="alloc-customers" value={customerName}
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
        <Fld label="柜数 *"><input style={fldInput} type="number" min="1" max={remaining} value={qty} onChange={e => setQty(e.target.value)} /></Fld>
        <Fld label="售价 / 柜"><input style={fldInput} type="number" step="0.01" value={sellPrice} onChange={e => setSellPrice(e.target.value)} placeholder={spot.currency || "USD"} /></Fld>
        <Fld label="新订单号 *" span={2}><input style={fldInput} value={orderNo} onChange={e => setOrderNo(e.target.value.toUpperCase())} /></Fld>
        <Fld label="备注" span={3}><textarea style={{ ...fldInput, minHeight: 50 }} value={notes} onChange={e => setNotes(e.target.value)} placeholder="划分备注（写入新订单内部备注）" /></Fld>
      </Group>
      <div style={{ marginTop: 12, padding: 10, background: "#fff7e6", border: "1px solid #ffd28e", borderRadius: 4, fontSize: 12, color: "#c66800" }}>
        ⓘ 划走会立即建一条海运出口订单（带船期/POL/POD/ETD/订舱号），并关联回此现舱。售价目前不写入费用表，需要去新订单的费用面板录入。
      </div>
    </ModalShell>
  );
}

// ─── 通用 modal & form ─────────────────────────────────────────
function ModalShell({ title, children, actions, onClose }) {
  return (
    <div onClick={onClose} style={{
      position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
      background: "rgba(0,0,0,.35)", zIndex: 100,
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: "#fff", borderRadius: 6, width: "min(900px, 95vw)",
        maxHeight: "92vh", display: "flex", flexDirection: "column",
        boxShadow: "0 10px 40px rgba(0,0,0,.2)",
      }}>
        <div style={{ padding: "12px 18px", borderBottom: "1px solid #e8e8e8",
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      background: "linear-gradient(#fafafa,#f0f0f0)" }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>{title}</span>
          <button onClick={onClose} style={{ border: "none", background: "transparent", fontSize: 18, cursor: "pointer", color: "#999" }}>×</button>
        </div>
        <div style={{ padding: 18, overflowY: "auto", flex: 1 }}>{children}</div>
        <div style={{ padding: "10px 18px", borderTop: "1px solid #e8e8e8",
                      display: "flex", justifyContent: "flex-end", gap: 8 }}>{actions}</div>
      </div>
    </div>
  );
}

function Group({ title, children }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "#555", marginBottom: 8,
                    paddingBottom: 4, borderBottom: "1px solid #eee" }}>{title}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>{children}</div>
    </div>
  );
}
function Fld({ label, children, span = 1 }) {
  return (
    <div style={{ gridColumn: `span ${span}` }}>
      <div style={{ fontSize: 11, color: "#888", marginBottom: 3 }}>{label}</div>
      {children}
    </div>
  );
}

const fldInput = {
  width: "100%", padding: "4px 6px", border: "1px solid #c1c1c1",
  borderRadius: 3, fontSize: 12, fontFamily: "inherit", boxSizing: "border-box",
};
const modalBtnPrimary = {
  padding: "6px 16px", background: "#1990ff", color: "#fff", border: "1px solid #1990ff",
  borderRadius: 3, fontSize: 12, cursor: "pointer", fontWeight: 600,
};
const modalBtnSecondary = {
  padding: "6px 16px", background: "#fff", color: "#333", border: "1px solid #d9d9d9",
  borderRadius: 3, fontSize: 12, cursor: "pointer",
};
