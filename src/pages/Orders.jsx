import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "../supabase.js";
import { Spinner, ComboBox } from "../components/ui.jsx";
import { STATUS_CONFIGS, STATUS_COLORS, TRADE_TERMS, CONTAINER_TYPES, CONTAINER_OWNERS, BL_TYPES, FREIGHT_TERMS, TRANSPORT_TERMS, CARGO_TYPES, SHIPMENT_TYPES } from "../lib/constants.js";

/* ── Style constants ─────────────────────────────────────────── */
const F = "-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif";
const mono = { fontFamily: "'Cascadia Code','SF Mono','Consolas',monospace", fontSize: 11 };

/* ═══════════════════════════════════════════════════════════════ */
export function OrdersPage({ user, onBack }) {
  const role = user.profile?.role || "operator";
  const [shipments, setShipments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [checkedIds, setCheckedIds] = useState(new Set());
  const [search, setSearch] = useState("");
  const [showFilter, setShowFilter] = useState(true);
  const [filters, setFilters] = useState({});
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);

  const load = useCallback(async () => {
    const { data } = await supabase.from("shipments").select("*").order("created_at", { ascending: false });
    setShipments(data || []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  // Reference lists
  const refs = useMemo(() => {
    const ex = (f) => [...new Set(shipments.map(o => o[f]).filter(Boolean))].sort();
    return { supplier: ex("supplier"), customer: ex("customer"), carrier: ex("carrier"), vessel: ex("vessel"), pol: ex("pol"), pod: ex("pod"), destination: ex("destination") };
  }, [shipments]);

  // Filter
  const sf = (k, v) => setFilters(p => ({ ...p, [k]: v }));
  const filtered = useMemo(() => shipments.filter(o => {
    const f = filters;
    if (f.supplier && o.supplier !== f.supplier) return false;
    if (f.customer && o.customer !== f.customer) return false;
    if (f.carrier && o.carrier !== f.carrier) return false;
    if (f.vessel && !(o.vessel || "").toLowerCase().includes(f.vessel.toLowerCase())) return false;
    if (f.pol && o.pol !== f.pol) return false;
    if (f.pod && o.pod !== f.pod) return false;
    if (f.mbl_no && !(o.mbl_no || "").toLowerCase().includes(f.mbl_no.toLowerCase())) return false;
    if (f.booking_no && !(o.booking_no || "").toLowerCase().includes(f.booking_no.toLowerCase())) return false;
    if (f.container_no && !(o.container_no || "").toLowerCase().includes(f.container_no.toLowerCase())) return false;
    if (f.etd_from && o.etd && o.etd < f.etd_from) return false;
    if (f.etd_to && o.etd && o.etd > f.etd_to) return false;
    if (search) {
      const q = search.toLowerCase();
      if (![o.po, o.customer_po, o.booking_no, o.container_no, o.vessel, o.supplier, o.order_no, o.mbl_no, o.customer].filter(Boolean).some(x => x.toLowerCase().includes(q))) return false;
    }
    return true;
  }), [shipments, filters, search]);

  useEffect(() => { setPage(0); }, [filters, search]);

  // Console grouping
  const { rows: groupedRows } = useMemo(() => {
    const mblG = {}, noMbl = [];
    filtered.forEach(o => { const k = o.mbl_no || o.booking_no; k ? (mblG[k] = mblG[k] || []).push(o) : noMbl.push(o); });
    const rows = [];
    Object.entries(mblG).filter(([, v]) => v.length >= 2).sort((a, b) => (b[1][0].created_at || "").localeCompare(a[1][0].created_at || "")).forEach(([mbl, items]) => {
      rows.push({ t: "mbl", mbl, d: items[0], ch: items, n: items.length });
      items.forEach(c => rows.push({ t: "hbl", mbl, d: c }));
    });
    [...Object.entries(mblG).filter(([, v]) => v.length === 1).map(([, v]) => v[0]), ...noMbl]
      .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))
      .forEach(o => rows.push({ t: "s", d: o }));
    return { rows };
  }, [filtered]);

  const totalPages = Math.max(1, Math.ceil(groupedRows.length / pageSize));
  const paged = groupedRows.slice(page * pageSize, (page + 1) * pageSize);
  const [collapsed, setCollapsed] = useState(new Set());
  const togC = (m) => setCollapsed(p => { const n = new Set(p); n.has(m) ? n.delete(m) : n.add(m); return n; });

  // Stats
  const stats = useMemo(() => {
    const types = {}; let teu = 0;
    filtered.forEach(o => {
      for (const m of (o.qty_container || "").matchAll(/(\d+)x((?:20|40|45)(?:GP|HQ|RF|OT|FR))/gi)) {
        const c = parseInt(m[1]), t = m[2].toUpperCase(); types[t] = (types[t] || 0) + c; teu += t.startsWith("20") ? c : c * 2;
      }
    });
    return { n: filtered.length, teu, ts: Object.entries(types).map(([t, c]) => `${c}x${t}`).join(", ") };
  }, [filtered]);

  const togChk = (id) => setCheckedIds(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const clearF = () => { setFilters({}); setSearch(""); };

  const selOrder = shipments.find(o => o.id === selectedId);
  if (loading) return <Spinner />;
  if (selOrder) return <OrderDetail order={selOrder} role={role} user={user} onBack={() => { setSelectedId(null); load(); }} onReload={load} />;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", fontFamily: F, fontSize: 12, color: "#1a1a1a" }}>
      {/* ── Title bar ── */}
      <div style={{ background: "#d4e6f6", padding: "4px 10px", display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "#c0392b" }}>作业 / 海运出口</span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: "#2a5a8a" }}>{user.profile?.name || user.email} · {role}</span>
      </div>

      {/* ── Toolbar ── */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 0, padding: "2px 6px", background: "#e8eff6", borderBottom: "1px solid #b8c8d8", flexShrink: 0 }}>
        {[["清除", clearF], ["显示明细"], ["搜索", () => setShowFilter(p => !p)], ["新建作业", () => setShowNew(true)], ["|"], ["显示预览"], ["统计模板"], ["|"], ["隐藏面板", () => setShowFilter(p => !p)], ["数据范围"], ["|"], ["导出"], ["打印"], ["数据交换"], ["数据分析"], ["|"], ["关闭", onBack]].map(([label, fn], i) =>
          label === "|" ? <div key={i} style={{ width: 1, height: 16, background: "#b8c8d8", margin: "2px 1px", alignSelf: "center" }} />
          : <button key={i} onClick={fn} style={{ padding: "3px 8px", fontSize: 10, border: "none", background: "transparent", cursor: fn ? "pointer" : "default", color: fn ? "#2a5a8a" : "#8a9ab0" }}>{label}</button>
        )}
      </div>

      {/* ── Filter area ── */}
      {showFilter && (
        <div style={{ background: "#eef4fa", borderBottom: "1px solid #c0d0e0", padding: "4px 8px", flexShrink: 0 }}>
          {/* Filter tabs */}
          <div style={{ display: "flex", gap: 0, marginBottom: 3 }}>
            {["过滤", "动作", "打印", "通知", "查询方案"].map((t, i) => (
              <div key={t} style={{ padding: "2px 10px", fontSize: 10, border: "1px solid #c0d0e0", borderBottom: i === 0 ? "1px solid #fff" : "1px solid #c0d0e0", background: i === 0 ? "#fff" : "#dce8f0", cursor: "pointer", color: "#2a5a8a", marginRight: -1, marginBottom: i === 0 ? -1 : 0 }}>{t}</div>
            ))}
          </div>
          {/* Grid: label:input pairs, 4 columns */}
          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto 1fr auto 1fr auto 1fr", gap: "3px 4px", alignItems: "center" }}>
            <FL>委托方</FL><ComboBox value={filters.supplier || ""} onChange={v => sf("supplier", v)} options={refs.supplier} placeholder="请选择委托方" style={{ height: 22 }} />
            <FL>客户</FL><ComboBox value={filters.customer || ""} onChange={v => sf("customer", v)} options={refs.customer} placeholder="请选择客户" style={{ height: 22 }} />
            <FL>船公司</FL><ComboBox value={filters.carrier || ""} onChange={v => sf("carrier", v)} options={refs.carrier} placeholder="请选择船公司" style={{ height: 22 }} />
            <FL>船名</FL><FI value={filters.vessel || ""} onChange={e => sf("vessel", e.target.value)} placeholder="请选择船名" />

            <FL>起运港</FL><ComboBox value={filters.pol || ""} onChange={v => sf("pol", v)} options={refs.pol} placeholder="请选择起运港" style={{ height: 22 }} />
            <FL>卸货港</FL><ComboBox value={filters.pod || ""} onChange={v => sf("pod", v)} options={refs.pod} placeholder="请选择卸货港" style={{ height: 22 }} />
            <FL>MBL No.</FL><FI value={filters.mbl_no || ""} onChange={e => sf("mbl_no", e.target.value)} placeholder="请输入 MBL No." />
            <FL>Booking No.</FL><FI value={filters.booking_no || ""} onChange={e => sf("booking_no", e.target.value)} placeholder="" />

            <FL>柜号</FL><FI value={filters.container_no || ""} onChange={e => sf("container_no", e.target.value)} placeholder="请输入柜号，支持多柜号" />
            <FL>ETD 从</FL><FI type="date" value={filters.etd_from || ""} onChange={e => sf("etd_from", e.target.value)} />
            <FL>ETD 至</FL><FI type="date" value={filters.etd_to || ""} onChange={e => sf("etd_to", e.target.value)} />
            <FL>搜索关键词</FL>
            <div style={{ display: "flex", gap: 3 }}>
              <FI value={search} onChange={e => setSearch(e.target.value)} placeholder="支持作业号 / MBL / 客户 / 船名 / 柜号" style={{ flex: 1 }} />
              <button style={{ padding: "0 12px", height: 22, background: "#2563eb", color: "#fff", border: "none", fontSize: 10, cursor: "pointer" }}>搜索</button>
              <button onClick={clearF} style={{ padding: "0 8px", height: 22, border: "1px solid #b8c8d8", background: "#f8f8f8", fontSize: 10, cursor: "pointer" }}>重置</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Stats bar ── */}
      <div style={{ padding: "2px 10px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #c0d0e0", background: "#fff", flexShrink: 0 }}>
        <div style={{ fontSize: 11 }}>
          <span style={{ color: "#2a80b9", fontWeight: 500 }}>数据范围: 分公司</span>
          <span style={{ marginLeft: 10 }}>行数 <b>{stats.n}</b></span>
          <span style={{ marginLeft: 10 }}>TEU <b>{stats.teu}</b></span>
          {stats.ts && <span style={{ marginLeft: 10 }}>箱型 <b>{stats.ts}</b></span>}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {[["已关闭", "#3b82f6"], ["舱单确认", "#f59e0b"], ["放舱确认", "#8b5cf6"], ["已配载", "#10b981"]].map(([l, c]) => (
            <span key={l} style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 10, color: "#555" }}>
              <span style={{ width: 7, height: 7, borderRadius: 1, background: c, display: "inline-block" }} />{l}
            </span>
          ))}
        </div>
      </div>

      {/* ── TABLE ── */}
      <div style={{ flex: 1, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1400 }}>
          <thead><tr>
            <TH w={28}><input type="checkbox" style={{ width: 13, height: 13 }} /></TH>
            <TH w={52}>出运类型</TH><TH w={130}>作业号</TH><TH w={90}>客户编号</TH>
            <TH w={100}>MBL / No.</TH><TH>船名</TH><TH w={44}>航次</TH>
            <TH w={86}>预计开航时间</TH><TH>委托人</TH><TH>起运港名称</TH><TH>卸货港名称</TH>
            <TH>目的地名称</TH><TH w={64}>箱型</TH><TH w={64}>HB/L No.</TH>
            <TH w={74}>ENS截止日期</TH><TH w={50}>状态</TH>
          </tr></thead>
          <tbody>
            {paged.length === 0 && <tr><td colSpan={16} style={{ ...td, textAlign: "center", height: 60, color: "#999" }}>暂无数据</td></tr>}
            {paged.map((row, ri) => {
              if (row.t === "hbl" && collapsed.has(row.mbl)) return null;
              const o = row.d;

              // ── Console MBL parent ──
              if (row.t === "mbl") {
                const open = !collapsed.has(row.mbl);
                return (
                  <tr key={`m-${row.mbl}`} style={{ background: "#fff8e0" }}>
                    <td style={{ ...td, textAlign: "center", background: "#fff8e0" }}><input type="checkbox" style={{ width: 13, height: 13 }} /></td>
                    <td style={{ ...td, textAlign: "center", background: "#fff8e0" }}><span style={{ fontSize: 9, fontWeight: 500, padding: "1px 4px", background: "#fde68a", color: "#78350f" }}>自拼柜</span></td>
                    <td style={{ ...td, background: "#fff8e0" }} colSpan={2}>
                      <span onClick={() => togC(row.mbl)} style={{ cursor: "pointer", marginRight: 3, fontSize: 10, color: "#92400e" }}>{open ? "▼" : "▶"}</span>
                      <span style={{ ...mono, color: "#92400e", fontWeight: 600 }}>MBL {row.mbl}</span>
                      <span style={{ fontSize: 9, color: "#a16207", marginLeft: 6 }}>{row.n}票</span>
                    </td>
                    <td style={{ ...td, background: "#fff8e0", ...mono }}>{row.mbl}</td>
                    <td style={{ ...td, background: "#fff8e0" }}>{o.vessel || "—"}</td>
                    <td style={{ ...td, background: "#fff8e0" }}>{o.voyage || "—"}</td>
                    <td style={{ ...td, background: "#fff8e0", ...mono }}>{o.etd || "—"}</td>
                    <td style={{ ...td, background: "#fff8e0" }}>{o.customer || "—"}</td>
                    <td style={{ ...td, background: "#fff8e0" }}>{(o.pol || "").split("(")[0].trim() || "—"}</td>
                    <td style={{ ...td, background: "#fff8e0" }}>{(o.pod || "").split("(")[0].trim() || "—"}</td>
                    <td style={{ ...td, background: "#fff8e0" }}>{o.destination || "—"}</td>
                    <td style={{ ...td, background: "#fff8e0" }}>{o.qty_container || "—"}</td>
                    <td style={{ ...td, background: "#fff8e0" }}>—</td>
                    <td style={{ ...td, background: "#fff8e0" }}>—</td>
                    <td style={{ ...td, background: "#fff8e0" }}></td>
                  </tr>
                );
              }

              // ── Console HBL child ──
              if (row.t === "hbl") {
                return (
                  <tr key={o.id} style={{ cursor: "pointer" }} onClick={() => setSelectedId(o.id)}
                    onMouseEnter={e => { for (const c of e.currentTarget.cells) c.style.background = "#fef9c3"; }}
                    onMouseLeave={e => { for (const c of e.currentTarget.cells) c.style.background = "#fffdf0"; }}>
                    <td style={{ ...td, textAlign: "center", background: "#fffdf0" }}><input type="checkbox" checked={checkedIds.has(o.id)} onChange={() => togChk(o.id)} onClick={e => e.stopPropagation()} style={{ width: 13, height: 13 }} /></td>
                    <td style={{ ...td, background: "#fffdf0" }}></td>
                    <td style={{ ...td, background: "#fffdf0", paddingLeft: 16 }}><span style={{ color: "#bbb", marginRight: 2 }}>└</span><span style={{ ...mono, color: "#2563eb" }}>{o.order_no || o.po || "—"}</span></td>
                    <td style={{ ...td, background: "#fffdf0", ...mono }}>{o.customer_po || "—"}</td>
                    <td style={{ ...td, background: "#fffdf0" }}></td>
                    <td style={{ ...td, background: "#fffdf0" }}></td>
                    <td style={{ ...td, background: "#fffdf0" }}></td>
                    <td style={{ ...td, background: "#fffdf0" }}></td>
                    <td style={{ ...td, background: "#fffdf0" }}>{o.supplier || "—"}</td>
                    <td style={{ ...td, background: "#fffdf0" }}></td>
                    <td style={{ ...td, background: "#fffdf0" }}></td>
                    <td style={{ ...td, background: "#fffdf0" }}></td>
                    <td style={{ ...td, background: "#fffdf0" }}></td>
                    <td style={{ ...td, background: "#fffdf0" }}>—</td>
                    <td style={{ ...td, background: "#fffdf0" }}>—</td>
                    <td style={{ ...td, background: "#fffdf0" }}></td>
                  </tr>
                );
              }

              // ── Normal row ──
              const bg = ri % 2 === 0 ? "#fff" : "#f5f8fb";
              return (
                <tr key={o.id} style={{ cursor: "pointer" }} onClick={() => setSelectedId(o.id)}
                  onMouseEnter={e => { for (const c of e.currentTarget.cells) c.style.background = "#e8f0fa"; }}
                  onMouseLeave={e => { for (const c of e.currentTarget.cells) c.style.background = bg; }}>
                  <td style={{ ...td, textAlign: "center", background: bg }}><input type="checkbox" checked={checkedIds.has(o.id)} onChange={() => togChk(o.id)} onClick={e => e.stopPropagation()} style={{ width: 13, height: 13, accentColor: "#2563eb" }} /></td>
                  <td style={{ ...td, textAlign: "center", background: bg }}>{o.shipment_type === "LCL" ? "拼箱" : "整箱"}</td>
                  <td style={{ ...td, ...mono, background: bg }}><span style={{ color: "#2563eb" }}>{o.order_no || o.po || "—"}</span></td>
                  <td style={{ ...td, ...mono, background: bg }}>{o.customer_po || "—"}</td>
                  <td style={{ ...td, ...mono, background: bg }}>{o.mbl_no || o.booking_no || "—"}</td>
                  <td style={{ ...td, background: bg }}>{o.vessel || "—"}</td>
                  <td style={{ ...td, background: bg }}>{o.voyage || "—"}</td>
                  <td style={{ ...td, ...mono, background: bg }}>{o.etd || "—"}</td>
                  <td style={{ ...td, background: bg }}>{o.supplier || "—"}</td>
                  <td style={{ ...td, background: bg }}>{(o.pol || "").split("(")[0].trim() || "—"}</td>
                  <td style={{ ...td, background: bg }}>{(o.pod || "").split("(")[0].trim() || "—"}</td>
                  <td style={{ ...td, background: bg }}>{o.destination || "—"}</td>
                  <td style={{ ...td, background: bg }}>{o.qty_container || "—"}</td>
                  <td style={{ ...td, background: bg }}>—</td>
                  <td style={{ ...td, background: bg }}>—</td>
                  <td style={{ ...td, background: bg }}>{o.space_status ? <STag v={o.space_status} /> : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Pagination ── */}
      <div style={{ padding: "3px 10px", borderTop: "1px solid #c0d0e0", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 10, color: "#555", background: "#f0f0f0", flexShrink: 0 }}>
        <span>共 {filtered.length} 条</span>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(0); }} style={{ height: 20, padding: "0 3px", border: "1px solid #b8c8d8", fontSize: 10, outline: "none" }}>
            {[20, 50, 100, 200, 500].map(n => <option key={n} value={n}>{n}条/页</option>)}
          </select>
          <PB d={page === 0} onClick={() => setPage(0)}>‹‹</PB>
          <PB d={page === 0} onClick={() => setPage(page - 1)}>‹</PB>
          {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
            const p = page < 3 ? i : page - 2 + i;
            if (p >= totalPages) return null;
            return <PB key={p} on={p === page} onClick={() => setPage(p)}>{p + 1}</PB>;
          })}
          <PB d={page >= totalPages - 1} onClick={() => setPage(page + 1)}>›</PB>
          <PB d={page >= totalPages - 1} onClick={() => setPage(totalPages - 1)}>››</PB>
          <span>前往</span>
          <input style={{ width: 28, height: 18, border: "1px solid #b8c8d8", fontSize: 10, textAlign: "center" }}
            onKeyDown={e => { if (e.key === "Enter") { const v = parseInt(e.target.value) - 1; if (v >= 0 && v < totalPages) setPage(v); } }} />
          <span>页</span>
        </div>
      </div>

      {showNew && <NewOrderModal onClose={() => setShowNew(false)} onSaved={() => { setShowNew(false); load(); }} />}
    </div>
  );
}

/* ── Small helper components ── */
const th = { padding: "0 4px", height: 24, textAlign: "center", fontWeight: 500, color: "#2a5a8a", fontSize: 10, background: "#dbe8f4", border: "1px solid #b8c8d8", whiteSpace: "nowrap", position: "sticky", top: 0, zIndex: 2 };
const td = { padding: "0 4px", height: 23, border: "1px solid #d8dde3", fontSize: 11, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 160 };

function TH({ children, w }) { return <th style={{ ...th, width: w }}>{children}</th>; }
function FL({ children }) { return <label style={{ fontSize: 10, color: "#2a5a8a", whiteSpace: "nowrap", textAlign: "right", paddingRight: 2 }}>{children}</label>; }
function FI({ style: s, ...p }) { return <input {...p} style={{ height: 22, padding: "0 4px", border: "1px solid #b8c8d8", fontSize: 10, outline: "none", background: "#fff", boxSizing: "border-box", width: "100%", ...s }} />; }
function PB({ children, d, on, onClick }) {
  return <button disabled={d} onClick={onClick} style={{ padding: "1px 6px", border: "1px solid #b8c8d8", background: on ? "#2563eb" : "#f8f8f8", color: on ? "#fff" : d ? "#ccc" : "#1a1a1a", fontSize: 10, cursor: d ? "default" : "pointer" }}>{children}</button>;
}
function STag({ v }) {
  const c = STATUS_COLORS[v] || "#999";
  return <span style={{ fontSize: 9, fontWeight: 500, padding: "0 4px", background: c + "18", color: c }}>{v}</span>;
}

/* ═══════════════════════════════════════════════════════════════ */
/* Order Detail — traditional form layout matching reference      */
/* ═══════════════════════════════════════════════════════════════ */
function OrderDetail({ order, role, user, onBack, onReload }) {
  const [editing, setEditing] = useState(false);
  const [ed, setEd] = useState({});
  const [tab, setTab] = useState("作业");
  const [refData, setRefData] = useState({ suppliers: [], customers: [], ports: [] });
  const [cargoItems, setCargoItems] = useState([]);

  useEffect(() => {
    Promise.all([
      supabase.from("suppliers").select("name").order("name"),
      supabase.from("customers").select("name").order("name"),
      supabase.from("ports").select("name").order("name"),
    ]).then(([s, c, p]) => setRefData({ suppliers: (s.data || []).map(r => r.name), customers: (c.data || []).map(r => r.name), ports: (p.data || []).map(r => r.name) }));
    // Load cargo
    if (order.po || order.customer_po) {
      const q = order.po && order.customer_po
        ? supabase.from("container_items").select("*").eq("po", order.po).eq("customer_po", String(order.customer_po))
        : order.customer_po ? supabase.from("container_items").select("*").eq("customer_po", String(order.customer_po))
        : supabase.from("container_items").select("*").eq("po", order.po);
      q.then(({ data }) => setCargoItems(data || []));
    }
  }, [order.id]);

  const startEdit = () => { setEd({ ...order }); setEditing(true); };
  const cancel = () => setEditing(false);
  const save = async () => {
    const changes = {};
    for (const k of Object.keys(ed)) { if (ed[k] !== order[k] && !["id", "created_at", "updated_at"].includes(k)) changes[k] = ed[k] === "" ? null : ed[k]; }
    if (Object.keys(changes).length) { const { error } = await supabase.from("shipments").update(changes).eq("id", order.id); if (error) { alert(error.message); return; } }
    setEditing(false); onReload();
  };
  const v = (f) => editing ? (ed[f] ?? "") : (order[f] ?? "");
  const ch = (f, val) => setEd(p => ({ ...p, [f]: val }));

  const tabs = ["作业", "装箱", "费用", "凭证", "代理对账单", "附件"];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", fontFamily: F, fontSize: 12, color: "#1a1a1a" }}>
      {/* Title */}
      <div style={{ background: "#d4e6f6", padding: "4px 10px", display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "#c0392b" }}>
          {order.shipment_type === "LCL" ? "拼箱" : order.shipment_type === "Console" ? "拼柜" : "整箱"} / 海运出口
        </span>
        <div style={{ flex: 1 }} />
        {order.space_status && <span style={{ fontSize: 16, fontWeight: 700, color: order.space_status === "Booked" ? "#10b981" : "#f59e0b", background: "#fff8", padding: "2px 12px", border: "2px solid", borderRadius: 4 }}>{order.space_status === "Booked" ? "已确认" : "处理中"}</span>}
      </div>

      {/* Toolbar */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 0, padding: "2px 6px", background: "#e8eff6", borderBottom: "1px solid #b8c8d8", flexShrink: 0 }}>
        {[["← 返回", onBack], ["新建"], ["复制"], ["删除"], ["|"], ["舱单确认"], ["航线确认"], ["订舱确认"], ["放舱确认"], ["放箱确认"], ["开船确认"], ["单证锁定"], ["|"], ["关闭作业"], ["内部利润分析"], ["|"], ["打印"], ["|"], ["编辑", startEdit]].map(([l, fn], i) =>
          l === "|" ? <div key={i} style={{ width: 1, height: 16, background: "#b8c8d8", margin: "2px 1px", alignSelf: "center" }} />
          : <button key={i} onClick={fn} style={{ padding: "3px 8px", fontSize: 10, border: "none", background: "transparent", cursor: fn ? "pointer" : "default", color: fn ? "#2a5a8a" : "#8a9ab0" }}>{l}</button>
        )}
        {editing && <>
          <button onClick={save} style={{ padding: "3px 10px", fontSize: 10, background: "#2563eb", color: "#fff", border: "none", cursor: "pointer", marginLeft: 6 }}>保存</button>
          <button onClick={cancel} style={{ padding: "3px 8px", fontSize: 10, border: "1px solid #b8c8d8", background: "#f8f8f8", cursor: "pointer", marginLeft: 2 }}>取消</button>
        </>}
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 0, padding: "4px 8px 0", background: "#fff", borderBottom: "1px solid #c0d0e0", flexShrink: 0 }}>
        {tabs.map(t => (
          <div key={t} onClick={() => setTab(t)} style={{
            padding: "4px 12px", fontSize: 11, cursor: "pointer", borderBottom: tab === t ? "2px solid #2563eb" : "2px solid transparent",
            color: tab === t ? "#1a1a1a" : "#666", fontWeight: tab === t ? 500 : 400,
          }}>{t}</div>
        ))}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: "auto", padding: "8px 10px", background: "#fff" }}>
        {tab === "作业" && (
          <div>
            {/* 基本信息 */}
            <div style={{ fontSize: 12, fontWeight: 600, color: "#2a80b9", marginBottom: 6, borderBottom: "1px solid #c0d8e8", paddingBottom: 2 }}>基本信息</div>
            <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto 1fr auto 1fr auto 1fr", gap: "4px 6px", alignItems: "center", marginBottom: 14 }}>
              <DL>作业号</DL><DV edit={editing} v={v("order_no")} f="order_no" ch={ch} />
              <DL>委托人</DL><DV edit={editing} v={v("supplier")} f="supplier" ch={ch} opts={refData.suppliers} />
              <DL>订舱代理</DL><DV edit={editing} v={v("carrier_agent")} f="carrier_agent" ch={ch} />
              <DL>操作员</DL><DV v={user.profile?.name || user.email} />

              <DL>出运类型</DL><DV edit={editing} v={v("shipment_type")} f="shipment_type" ch={ch} opts={SHIPMENT_TYPES.map(t => t.key)} />
              <DL>客户</DL><DV edit={editing} v={v("customer")} f="customer" ch={ch} opts={refData.customers} />
              <DL>船东</DL><DV edit={editing} v={v("carrier")} f="carrier" ch={ch} />
              <DL>终端客户</DL><DV edit={editing} v={v("end_customer")} f="end_customer" ch={ch} />

              <DL c>订舱日期</DL><DV edit={editing} v={v("created_at")?.slice(0, 10)} />
              <DL>PO#</DL><DV edit={editing} v={v("po")} f="po" ch={ch} />
              <DL>Customer PO#</DL><DV edit={editing} v={v("customer_po")} f="customer_po" ch={ch} />
              <DL>贸易条款</DL><DV edit={editing} v={v("incoterms")} f="incoterms" ch={ch} opts={TRADE_TERMS} />

              <DL>船名</DL><DV edit={editing} v={v("vessel")} f="vessel" ch={ch} />
              <DL>航次</DL><DV edit={editing} v={v("voyage")} f="voyage" ch={ch} />
              <DL c>MB/L No.</DL><DV edit={editing} v={v("mbl_no")} f="mbl_no" ch={ch} mono />
              <DL>HB/L No.</DL><DV edit={editing} v={v("hbl_no")} f="hbl_no" ch={ch} />

              <DL c>预计开航时间</DL><DV edit={editing} v={v("etd")} f="etd" ch={ch} type="date" />
              <DL>实际开航时间</DL><DV edit={editing} v={v("atd")} f="atd" ch={ch} type="date" />
              <DL c>截单日期</DL><DV edit={editing} v={v("si_cutoff")} f="si_cutoff" ch={ch} type="date" />
              <DL>预计到港时间</DL><DV edit={editing} v={v("eta")} f="eta" ch={ch} type="date" />

              <DL>出单类型</DL><DV edit={editing} v={v("bl_type")} f="bl_type" ch={ch} opts={BL_TYPES} />
              <DL>付款方式</DL><DV edit={editing} v={v("freight_terms")} f="freight_terms" ch={ch} opts={FREIGHT_TERMS} />
              <DL>服务类型</DL><DV edit={editing} v={v("transport_terms")} f="transport_terms" ch={ch} opts={TRANSPORT_TERMS} />
              <DL>箱号</DL><DV edit={editing} v={v("container_no")} f="container_no" ch={ch} />

              <DL>起运港</DL><DV edit={editing} v={v("pol")} f="pol" ch={ch} opts={refData.ports} />
              <DL>卸货港</DL><DV edit={editing} v={v("pod")} f="pod" ch={ch} opts={refData.ports} />
              <DL>目的地</DL><DV edit={editing} v={v("destination")} f="destination" ch={ch} />
              <DL>码头</DL><DV edit={editing} v={v("terminal")} f="terminal" ch={ch} />
            </div>

            {/* Shipper / Consignee */}
            <div style={{ fontSize: 12, fontWeight: 600, color: "#2a80b9", marginBottom: 6, borderBottom: "1px solid #c0d8e8", paddingBottom: 2 }}>发货人 / 收货人 / 通知方</div>
            <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto 1fr auto 1fr", gap: "4px 6px", alignItems: "start", marginBottom: 14 }}>
              <DL c>发货人</DL><DV edit={editing} v={v("shipper")} f="shipper" ch={ch} area />
              <DL c>收货人</DL><DV edit={editing} v={v("consignee")} f="consignee" ch={ch} area />
              <DL>通知人</DL><DV edit={editing} v={v("notify_party")} f="notify_party" ch={ch} area />
            </div>

            {/* Cargo summary */}
            <div style={{ fontSize: 12, fontWeight: 600, color: "#2a80b9", marginBottom: 6, borderBottom: "1px solid #c0d8e8", paddingBottom: 2 }}>货物信息</div>
            <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto 1fr auto 1fr auto 1fr", gap: "4px 6px", alignItems: "center", marginBottom: 14 }}>
              <DL>集装箱</DL><DV edit={editing} v={v("qty_container")} f="qty_container" ch={ch} />
              <DL>箱型</DL><DV edit={editing} v={v("container_type")} f="container_type" ch={ch} opts={CONTAINER_TYPES} />
              <DL>货物件数</DL><DV v={order.qty_packages} />
              <DL>毛重</DL><DV v={order.weight} />

              <DL>体积</DL><DV v={order.volume} />
              <DL>品名</DL><DV edit={editing} v={v("tuc")} f="tuc" ch={ch} />
              <DL>唛头</DL><DV edit={editing} v={v("marks")} f="marks" ch={ch} />
              <DL>SKU</DL><DV v={order.sku} />
            </div>
          </div>
        )}

        {tab === "装箱" && (
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#2a80b9", marginBottom: 6 }}>装箱明细</div>
            {cargoItems.length > 0 ? (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                <thead><tr>
                  {["B/L", "HBL", "柜号", "封号", "品名", "唛头", "件数", "毛重", "体积"].map(h => <th key={h} style={{ ...th, fontSize: 10 }}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {cargoItems.map(it => (
                    <tr key={it.id}>
                      <td style={td}>{order.mbl_no || "—"}</td>
                      <td style={td}>{it.hbl || "—"}</td>
                      <td style={{ ...td, color: "#2563eb" }}>{it.container_no || "—"}</td>
                      <td style={td}>{it.seal_no || "—"}</td>
                      <td style={td}>{it.tuc || "—"}</td>
                      <td style={td}>{it.marks || "—"}</td>
                      <td style={{ ...td, textAlign: "right" }}>{it.qty || "—"}</td>
                      <td style={{ ...td, textAlign: "right" }}>{it.weight || "—"}</td>
                      <td style={{ ...td, textAlign: "right" }}>{it.volume || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <div style={{ color: "#999", padding: 10 }}>暂无装箱数据</div>}
          </div>
        )}

        {!["作业", "装箱"].includes(tab) && (
          <div style={{ padding: 20, textAlign: "center", color: "#999" }}>
            {tab} — 功能开发中
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Detail form helpers ── */
function DL({ children, c }) {
  return <label style={{ fontSize: 10, color: c ? "#c0392b" : "#2a5a8a", whiteSpace: "nowrap", textAlign: "right", paddingRight: 3, fontWeight: 400 }}>{children}</label>;
}

function DV({ v, edit, f, ch, opts, type, mono: isMono, area }) {
  if (!edit || !f) {
    // Display mode
    if (area) return <div style={{ padding: "2px 4px", fontSize: 11, minHeight: 40, border: "1px solid #e8e8e8", background: "#fafafa", whiteSpace: "pre-wrap" }}>{v || ""}</div>;
    return <div style={{ padding: "2px 4px", fontSize: 11, borderBottom: "1px solid #e8e8e8", minHeight: 20, ...(isMono ? mono : {}) }}>{v || ""}</div>;
  }
  // Edit mode
  if (opts) return <ComboBox value={v} onChange={val => ch(f, val)} options={opts} style={{ height: 22 }} />;
  if (area) return <textarea value={v} onChange={e => ch(f, e.target.value)} rows={3} style={{ width: "100%", padding: "2px 4px", border: "1px solid #b8c8d8", fontSize: 11, outline: "none", resize: "vertical" }} />;
  return <input type={type || "text"} value={v} onChange={e => ch(f, e.target.value)} style={{ width: "100%", height: 22, padding: "0 4px", border: "1px solid #b8c8d8", fontSize: 11, outline: "none", boxSizing: "border-box", ...(isMono ? mono : {}) }} />;
}

/* ═══════════════════════════════════════════════════════════════ */
/* New Order Modal                                                 */
/* ═══════════════════════════════════════════════════════════════ */
function NewOrderModal({ onClose, onSaved }) {
  const [form, setForm] = useState({ po: "", customer_po: "", supplier: "", customer: "", carrier: "", carrier_agent: "", vessel: "", pol: "", pod: "", etd: "", incoterms: "FOB", booking_no: "", shipment_type: "FCL" });
  const [refData, setRefData] = useState({ suppliers: [], customers: [], ports: [] });
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    Promise.all([supabase.from("suppliers").select("name").order("name"), supabase.from("customers").select("name").order("name"), supabase.from("ports").select("name").order("name")])
      .then(([s, c, p]) => setRefData({ suppliers: (s.data || []).map(r => r.name), customers: (c.data || []).map(r => r.name), ports: (p.data || []).map(r => r.name) }));
  }, []);
  const s = (k, val) => setForm(p => ({ ...p, [k]: val }));
  const save = async () => {
    if (!form.po && !form.customer_po) { alert("PO or Customer PO required"); return; }
    setSaving(true);
    const data = { ...form }; for (const k of Object.keys(data)) { if (data[k] === "") data[k] = null; }
    const { error } = await supabase.from("shipments").insert(data);
    if (error) { alert(error.message); setSaving(false); return; }
    setSaving(false); onSaved();
  };
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.3)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 999 }}>
      <div style={{ background: "#fff", width: 680, maxHeight: "80vh", overflow: "auto", border: "1px solid #b8c8d8" }}>
        <div style={{ background: "#d4e6f6", padding: "6px 12px", fontSize: 12, fontWeight: 600, color: "#2a5a8a", display: "flex", justifyContent: "space-between" }}>
          <span>新建作业 — 海运出口</span>
          <button onClick={onClose} style={{ border: "none", background: "none", cursor: "pointer", fontSize: 14, color: "#666" }}>✕</button>
        </div>
        <div style={{ padding: "10px 14px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto 1fr auto 1fr", gap: "4px 6px", alignItems: "center" }}>
            <FL>PO#</FL><FI value={form.po} onChange={e => s("po", e.target.value)} />
            <FL>Customer PO#</FL><FI value={form.customer_po} onChange={e => s("customer_po", e.target.value)} />
            <FL>出运类型</FL><ComboBox value={form.shipment_type} onChange={v => s("shipment_type", v)} options={SHIPMENT_TYPES.map(t => t.key)} style={{ height: 22 }} />

            <FL>委托方</FL><ComboBox value={form.supplier} onChange={v => s("supplier", v)} options={refData.suppliers} style={{ height: 22 }} />
            <FL>客户</FL><ComboBox value={form.customer} onChange={v => s("customer", v)} options={refData.customers} style={{ height: 22 }} />
            <FL>船公司</FL><FI value={form.carrier} onChange={e => s("carrier", e.target.value)} />

            <FL>订舱代理</FL><FI value={form.carrier_agent} onChange={e => s("carrier_agent", e.target.value)} />
            <FL>船名</FL><FI value={form.vessel} onChange={e => s("vessel", e.target.value)} />
            <FL>ETD</FL><FI type="date" value={form.etd} onChange={e => s("etd", e.target.value)} />

            <FL>起运港</FL><ComboBox value={form.pol} onChange={v => s("pol", v)} options={refData.ports} style={{ height: 22 }} />
            <FL>卸货港</FL><ComboBox value={form.pod} onChange={v => s("pod", v)} options={refData.ports} style={{ height: 22 }} />
            <FL>贸易条款</FL><ComboBox value={form.incoterms} onChange={v => s("incoterms", v)} options={TRADE_TERMS} style={{ height: 22 }} />

            <FL>Booking No</FL><FI value={form.booking_no} onChange={e => s("booking_no", e.target.value)} />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 4, marginTop: 10 }}>
            <button onClick={onClose} style={{ padding: "4px 14px", border: "1px solid #b8c8d8", background: "#f8f8f8", fontSize: 11, cursor: "pointer" }}>取消</button>
            <button onClick={save} disabled={saving} style={{ padding: "4px 14px", background: "#2563eb", color: "#fff", fontSize: 11, fontWeight: 600, border: "none", cursor: "pointer", opacity: saving ? .5 : 1 }}>{saving ? "..." : "保存"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
