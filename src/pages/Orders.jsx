import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "../supabase.js";
import { Badge, Field, SectionHeader, Modal, Button, Input, Spinner, EmptyState, ComboBox, EditField } from "../components/ui.jsx";
import { t } from "../lib/i18n.js";
import { STATUS_CONFIGS, STATUS_COLORS, TRADE_TERMS, CONTAINER_TYPES, CONTAINER_OWNERS, BL_TYPES, FREIGHT_TERMS, TRANSPORT_TERMS, CARGO_TYPES, SERVICE_TYPES, SHIPMENT_TYPES } from "../lib/constants.js";

// ── Table style constants ──
const mono = { fontFamily: "'SF Mono','Cascadia Code','Consolas',monospace", fontSize: 11 };
const thS = { padding: "0 6px", textAlign: "left", fontWeight: 500, color: "#5f6b7a", fontSize: 10, height: 30, borderBottom: "2px solid #d0d5dd", borderRight: "1px solid #ebeef2", whiteSpace: "nowrap", background: "#f5f6f8", position: "sticky", top: 0, zIndex: 2 };
const tdS = { padding: "0 6px", height: 28, borderBottom: "1px dotted #e4e7eb", borderRight: "1px solid #f0f1f4", fontSize: 11, color: "#1a1a1a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: 160 };
const STATUS_DOTS = [
  { label: "已关闭", color: "#3b82f6" },
  { label: "舱单确认", color: "#f59e0b" },
  { label: "放舱确认", color: "#8b5cf6" },
  { label: "已配载", color: "#10b981" },
];

// ── Filter fields ──
const ALL_FILTER_FIELDS = [
  { key: "supplier", label: "委托方", type: "combo" },
  { key: "customer", label: "客户", type: "combo" },
  { key: "shipment_type", label: "出运类型", type: "combo" },
  { key: "carrier", label: "船公司", type: "combo" },
  { key: "vessel", label: "船名", type: "text" },
  { key: "voyage", label: "航次", type: "text" },
  { key: "pol", label: "起运港", type: "combo" },
  { key: "pod", label: "卸货港", type: "combo" },
  { key: "mbl_no", label: "MBL No.", type: "text" },
  { key: "booking_no", label: "Booking No.", type: "text" },
  { key: "container_no", label: "柜号", type: "text" },
  { key: "etd_from", label: "ETD 从", type: "date" },
  { key: "etd_to", label: "ETD 至", type: "date" },
  { key: "destination", label: "目的地", type: "combo" },
  { key: "incoterms", label: "贸易条款", type: "combo" },
  { key: "container_type", label: "箱型", type: "combo" },
  { key: "order_no", label: "订单编号", type: "text" },
  { key: "po", label: "PO#", type: "text" },
  { key: "customer_po", label: "Customer PO#", type: "text" },
  { key: "end_customer", label: "终端客户", type: "text" },
  { key: "carrier_agent", label: "订舱代理", type: "text" },
  { key: "terminal", label: "码头", type: "text" },
  { key: "bl_type", label: "提单形式", type: "combo" },
];
const DEFAULT_FILTER_KEYS = ["supplier", "customer", "carrier", "vessel", "pol", "pod", "mbl_no", "booking_no", "container_no", "etd_from", "etd_to"];

// ═══════════════════════════════════════════════════════════════
export function OrdersPage({ user }) {
  const role = user.profile?.role || "operator";
  const [shipments, setShipments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [showFilters, setShowFilters] = useState(true);
  const [checkedIds, setCheckedIds] = useState(new Set());
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState({});
  const [activeFilterKeys, setActiveFilterKeys] = useState(DEFAULT_FILTER_KEYS);
  const [showFieldPicker, setShowFieldPicker] = useState(false);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);

  const load = useCallback(async () => {
    const { data } = await supabase.from("shipments").select("*").order("created_at", { ascending: false });
    setShipments(data || []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const refLists = useMemo(() => {
    const ex = (f) => [...new Set(shipments.map(o => o[f]).filter(Boolean))].sort();
    return { supplier: ex("supplier"), customer: ex("customer"), carrier: ex("carrier"), vessel: ex("vessel"), pol: ex("pol"), pod: ex("pod"), destination: ex("destination"), incoterms: TRADE_TERMS, container_type: CONTAINER_TYPES, bl_type: BL_TYPES, shipment_type: SHIPMENT_TYPES.map(t => t.key) };
  }, [shipments]);

  const filtered = useMemo(() => shipments.filter(o => {
    for (const key of activeFilterKeys) {
      const val = filters[key]; if (!val) continue;
      const def = ALL_FILTER_FIELDS.find(f => f.key === key); if (!def) continue;
      if (key === "etd_from") { if (o.etd && o.etd < val) return false; continue; }
      if (key === "etd_to") { if (o.etd && o.etd > val) return false; continue; }
      if (def.type === "combo") { if (o[key] !== val) return false; }
      else { if (!(o[key] || "").toLowerCase().includes(val.toLowerCase())) return false; }
    }
    if (filters.qc_status && filters.qc_status !== "All" && o.qc_status !== filters.qc_status) return false;
    if (filters.space_status && filters.space_status !== "All" && o.space_status !== filters.space_status) return false;
    if (filters.bl_status && filters.bl_status !== "All" && o.bl_status !== filters.bl_status) return false;
    if (search) {
      const q = search.toLowerCase();
      if (![o.po, o.customer_po, o.booking_no, o.container_no, o.vessel, o.supplier, o.order_no, o.mbl_no, o.customer].filter(Boolean).some(f => f.toLowerCase().includes(q))) return false;
    }
    return true;
  }), [shipments, filters, search, activeFilterKeys]);

  useEffect(() => { setPage(0); }, [filters, search]);

  // ── Console Box grouping ──
  const { groupedRows, flatCount } = useMemo(() => {
    const mblG = {}, noMbl = [];
    filtered.forEach(o => { const k = o.mbl_no || o.booking_no; k ? (mblG[k] = mblG[k] || []).push(o) : noMbl.push(o); });
    const rows = [];
    Object.entries(mblG).filter(([, v]) => v.length >= 2).sort((a, b) => (b[1][0].created_at || "").localeCompare(a[1][0].created_at || "")).forEach(([mbl, items]) => {
      rows.push({ type: "mbl", mbl, data: items[0], children: items, count: items.length });
      items.forEach(c => rows.push({ type: "hbl", mbl, data: c }));
    });
    [...Object.entries(mblG).filter(([, v]) => v.length === 1).map(([, v]) => v[0]), ...noMbl]
      .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))
      .forEach(o => rows.push({ type: "single", data: o }));
    return { groupedRows: rows, flatCount: filtered.length };
  }, [filtered]);

  const totalPages = Math.max(1, Math.ceil(groupedRows.length / pageSize));
  const pagedRows = groupedRows.slice(page * pageSize, (page + 1) * pageSize);
  const [collapsed, setCollapsed] = useState(new Set());
  const togMbl = (m) => setCollapsed(p => { const n = new Set(p); n.has(m) ? n.delete(m) : n.add(m); return n; });

  const stats = useMemo(() => {
    const types = {}; let teu = 0;
    filtered.forEach(o => {
      const ms = (o.qty_container || "").matchAll(/(\d+)x((?:20|40|45)(?:GP|HQ|RF|OT|FR))/gi);
      for (const m of ms) { const c = parseInt(m[1]), t = m[2].toUpperCase(); types[t] = (types[t] || 0) + c; teu += t.startsWith("20") ? c : c * 2; }
    });
    return { rows: filtered.length, teu, typeStr: Object.entries(types).map(([t, c]) => `${c}x${t}`).join(", ") };
  }, [filtered]);

  const toggleCheck = (id) => setCheckedIds(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => { const ids = pagedRows.filter(r => r.data).map(r => r.data.id); checkedIds.size === ids.length ? setCheckedIds(new Set()) : setCheckedIds(new Set(ids)); };
  const clearFilters = () => { setFilters({}); setSearch(""); };
  const activeCount = Object.entries(filters).filter(([, v]) => v && v !== "All").length + (search ? 1 : 0);
  const toggleFilterField = (k) => setActiveFilterKeys(p => p.includes(k) ? p.filter(x => x !== k) : [...p, k]);

  const selectedOrder = shipments.find(o => o.id === selectedId);
  if (loading) return <Spinner />;
  if (selectedOrder) return <OrderDetail order={selectedOrder} role={role} user={user} onBack={() => { setSelectedId(null); load(); }} onReload={load} />;

  const fis = { padding: "4px 8px", borderRadius: 3, border: "1px solid #d0d5dd", fontSize: 11, outline: "none", background: "#fff", boxSizing: "border-box", minWidth: 0, height: 26 };
  const fla = { fontSize: 10, fontWeight: 500, color: "#5f6b7a", marginBottom: 2 };

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <h1 style={{ fontSize: 17, fontWeight: 700, margin: 0, color: "#1a1a1a" }}>海运出口</h1>
          <span style={{ fontSize: 11, color: "#94a3b8" }}>Ocean Export</span>
        </div>
        <button onClick={() => setShowNew(true)} style={{ padding: "6px 16px", borderRadius: 4, background: "#2563eb", color: "#fff", fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer" }}>+ 新建订单</button>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", alignItems: "center", borderBottom: "1px solid #e0e0e0", marginBottom: 8 }}>
        {[["搜索", showFilters, () => setShowFilters(p => !p)], ["新建作业", false, () => setShowNew(true)], ["批量操作"], ["导出"], ["统计"]].map(([l, a, fn], i) => (
          <button key={i} onClick={fn} style={{ padding: "6px 12px", border: "none", borderBottom: a ? "2px solid #2563eb" : "2px solid transparent", background: "transparent", fontSize: 11, color: a ? "#2563eb" : "#5f6b7a", cursor: fn ? "pointer" : "default", fontWeight: a ? 600 : 400 }}>{l}</button>
        ))}
        <div style={{ flex: 1 }} />
        {activeCount > 0 && <button onClick={clearFilters} style={{ padding: "3px 8px", borderRadius: 3, border: "1px solid #d0d5dd", background: "#fff", fontSize: 10, color: "#5f6b7a", cursor: "pointer" }}>重置 ({activeCount})</button>}
        <button onClick={() => setShowFieldPicker(p => !p)} style={{ padding: "3px 6px", borderRadius: 3, border: "1px solid #d0d5dd", background: "#fff", fontSize: 10, color: "#5f6b7a", cursor: "pointer", marginLeft: 4 }}>⚙</button>
      </div>

      {/* Field picker */}
      {showFieldPicker && (
        <div style={{ background: "#fff", borderRadius: 4, border: "1px solid #e0e0e0", padding: "6px 8px", marginBottom: 6 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
            {ALL_FILTER_FIELDS.map(f => (
              <label key={f.key} style={{ display: "flex", alignItems: "center", gap: 3, padding: "2px 7px", borderRadius: 3, fontSize: 10, cursor: "pointer", background: activeFilterKeys.includes(f.key) ? "#eff6ff" : "#f8f8f8", border: `1px solid ${activeFilterKeys.includes(f.key) ? "#93c5fd" : "#e0e0e0"}`, color: activeFilterKeys.includes(f.key) ? "#1d4ed8" : "#5f6b7a" }}>
                <input type="checkbox" checked={activeFilterKeys.includes(f.key)} onChange={() => toggleFilterField(f.key)} style={{ width: 10, height: 10 }} />{f.label}
              </label>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      {showFilters && (
        <div style={{ background: "#fff", borderRadius: 4, border: "1px solid #e0e0e0", padding: "8px 10px", marginBottom: 6 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "5px 8px" }}>
            {activeFilterKeys.map(key => {
              const def = ALL_FILTER_FIELDS.find(f => f.key === key); if (!def) return null;
              if (def.type === "combo") {
                const opts = refLists[key] || [...new Set(shipments.map(o => o[key]).filter(Boolean))].sort();
                return <div key={key}><div style={fla}>{def.label}</div><ComboBox value={filters[key] || ""} onChange={v => setFilters(p => ({ ...p, [key]: v }))} options={opts} placeholder={`${def.label}...`} /></div>;
              }
              if (def.type === "date") return <div key={key}><div style={fla}>{def.label}</div><input type="date" value={filters[key] || ""} onChange={e => setFilters(p => ({ ...p, [key]: e.target.value }))} style={{ ...fis, width: "100%" }} /></div>;
              return <div key={key}><div style={fla}>{def.label}</div><input value={filters[key] || ""} onChange={e => setFilters(p => ({ ...p, [key]: e.target.value }))} style={{ ...fis, width: "100%" }} placeholder={`${def.label}...`} /></div>;
            })}
            <div><div style={fla}>搜索关键词</div><input value={search} onChange={e => setSearch(e.target.value)} style={{ ...fis, width: "100%" }} placeholder="MBL / 客户 / 船名 / 柜号..." /></div>
          </div>
        </div>
      )}

      {/* Stats bar — thin */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 10px", marginBottom: 6, background: "#eef4fb", borderRadius: 3, border: "1px solid #c7daf0" }}>
        <div style={{ fontSize: 11, color: "#1d4ed8", fontWeight: 500 }}>
          数据范围: 分公司 &nbsp;&nbsp; 行数 <b>{stats.rows}</b> &nbsp;&nbsp; TEU <b>{stats.teu}</b> &nbsp;&nbsp; {stats.typeStr && <>箱型 <b>{stats.typeStr}</b></>}
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          {STATUS_DOTS.map(d => (
            <span key={d.label} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "#5f6b7a" }}>
              <span style={{ width: 7, height: 7, borderRadius: 99, background: d.color, display: "inline-block" }} />{d.label}
            </span>
          ))}
        </div>
      </div>

      {/* Batch bar */}
      {checkedIds.size > 0 && (
        <div style={{ background: "#1a1a2e", borderRadius: 3, padding: "4px 10px", marginBottom: 6, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ color: "#e2e8f0", fontSize: 11 }}>已选 {checkedIds.size} 条</span>
          <button onClick={() => setCheckedIds(new Set())} style={{ padding: "2px 8px", borderRadius: 3, border: "1px solid #334155", background: "transparent", color: "#94a3b8", fontSize: 10, cursor: "pointer" }}>取消</button>
        </div>
      )}

      {/* TABLE — high density grid */}
      <div style={{ background: "#fff", borderRadius: 4, border: "1px solid #d0d5dd", overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1400, tableLayout: "fixed" }}>
            <colgroup>
              <col style={{ width: 32 }} /><col style={{ width: 56 }} /><col style={{ width: 110 }} />
              <col style={{ width: 100 }} /><col style={{ width: 100 }} /><col style={{ width: 130 }} />
              <col style={{ width: 100 }} /><col style={{ width: 90 }} /><col style={{ width: 50 }} />
              <col style={{ width: 80 }} /><col style={{ width: 90 }} /><col style={{ width: 90 }} />
              <col style={{ width: 70 }} /><col style={{ width: 75 }} /><col style={{ width: 60 }} />
              <col style={{ width: 60 }} /><col style={{ width: 60 }} />
            </colgroup>
            <thead><tr>
              <th style={{ ...thS, width: 32, textAlign: "center" }}><input type="checkbox" onChange={toggleAll} checked={checkedIds.size > 0 && checkedIds.size === pagedRows.filter(r => r.data).length} style={{ width: 13, height: 13 }} /></th>
              {["出运类型","作业号","客户编号","MBL / No.","船名","航次","预计开航时间","委托人","起运港名称","卸货港名称","目的地名称","箱型","HB/L No.","ENS截止日期","状态"].map(h =>
                <th key={h} style={thS}>{h}</th>
              )}
            </tr></thead>
            <tbody>
              {pagedRows.length === 0 && <tr><td colSpan={17} style={{ padding: 30, textAlign: "center", color: "#94a3b8", fontSize: 12 }}>暂无数据</td></tr>}
              {pagedRows.map((row, ri) => {
                if (row.type === "hbl" && collapsed.has(row.mbl)) return null;
                const o = row.data;
                const even = ri % 2 === 0;

                // ── Console Parent (MBL) ──
                if (row.type === "mbl") {
                  const isOpen = !collapsed.has(row.mbl);
                  return (
                    <tr key={`mbl-${row.mbl}`} style={{ background: "#fefce8" }}>
                      <td style={{ ...tdS, textAlign: "center" }}><input type="checkbox" checked={row.children.every(c => checkedIds.has(c.id))} onChange={() => row.children.forEach(c => toggleCheck(c.id))} style={{ width: 13, height: 13 }} /></td>
                      <td style={tdS}><span style={{ fontSize: 9, fontWeight: 600, padding: "1px 5px", borderRadius: 2, background: "#fbbf24", color: "#713f12" }}>自拼柜</span></td>
                      <td style={tdS} colSpan={2}>
                        <button onClick={() => togMbl(row.mbl)} style={{ border: "none", background: "none", cursor: "pointer", padding: 0, fontSize: 10, color: "#92400e", marginRight: 3 }}>{isOpen ? "▼" : "▶"}</button>
                        <span style={{ ...mono, color: "#92400e", fontWeight: 600 }}>MBL {row.mbl}</span>
                        <span style={{ fontSize: 9, color: "#a16207", marginLeft: 6, fontWeight: 500 }}>{row.count}票</span>
                      </td>
                      <td style={tdS}>{o.vessel || "—"}</td>
                      <td style={tdS}>{o.voyage || "—"}</td>
                      <td style={{ ...tdS, ...mono }}>{o.etd || "—"}</td>
                      <td style={tdS}>{o.customer || "—"}</td>
                      <td style={tdS}>{(o.pol || "").split("(")[0].trim() || "—"}</td>
                      <td style={tdS}>{(o.pod || "").split("(")[0].trim() || "—"}</td>
                      <td style={tdS}>{o.destination || "—"}</td>
                      <td style={tdS}>{o.qty_container || "—"}</td>
                      <td style={tdS}>—</td>
                      <td style={tdS}>—</td>
                      <td style={tdS}>{o.space_status ? <StatusTag v={o.space_status} /> : "—"}</td>
                    </tr>
                  );
                }

                // ── Console Child (HBL) ──
                if (row.type === "hbl") {
                  return (
                    <tr key={o.id} style={{ background: "#fffef5", cursor: "pointer" }} onClick={() => setSelectedId(o.id)}
                      onMouseEnter={e => e.currentTarget.style.background = "#fef9c3"} onMouseLeave={e => e.currentTarget.style.background = "#fffef5"}>
                      <td style={{ ...tdS, textAlign: "center" }} onClick={e => e.stopPropagation()}><input type="checkbox" checked={checkedIds.has(o.id)} onChange={() => toggleCheck(o.id)} style={{ width: 13, height: 13 }} /></td>
                      <td style={tdS}></td>
                      <td style={{ ...tdS, ...mono, paddingLeft: 20 }}><span style={{ color: "#94a3b8", marginRight: 3 }}>└</span><span style={{ color: "#2563eb" }}>{o.order_no || o.po || "—"}</span></td>
                      <td style={{ ...tdS, ...mono, color: "#64748b" }}>{o.customer_po || "—"}</td>
                      <td style={tdS} colSpan={3}></td>
                      <td style={tdS}>{o.supplier || "—"}</td>
                      <td style={tdS} colSpan={4}></td>
                      <td style={tdS}>—</td>
                      <td style={tdS}>—</td>
                      <td style={tdS}>{o.qc_status ? <StatusTag v={o.qc_status} /> : "—"}</td>
                    </tr>
                  );
                }

                // ── Normal row ──
                const bg = checkedIds.has(o.id) ? "#eff6ff" : even ? "#fff" : "#fafafa";
                return (
                  <tr key={o.id} style={{ background: bg, cursor: "pointer" }} onClick={() => setSelectedId(o.id)}
                    onMouseEnter={e => e.currentTarget.style.background = "#f0f4f8"} onMouseLeave={e => e.currentTarget.style.background = bg}>
                    <td style={{ ...tdS, textAlign: "center" }} onClick={e => e.stopPropagation()}><input type="checkbox" checked={checkedIds.has(o.id)} onChange={() => toggleCheck(o.id)} style={{ width: 13, height: 13 }} /></td>
                    <td style={{ ...tdS, fontSize: 10, color: "#5f6b7a" }}>{o.shipment_type === "LCL" ? "拼箱" : "整箱"}</td>
                    <td style={{ ...tdS, ...mono }}><span style={{ color: "#2563eb", cursor: "pointer" }}>{o.order_no || o.po || "—"}</span></td>
                    <td style={{ ...tdS, ...mono }}>{o.customer_po || "—"}</td>
                    <td style={{ ...tdS, ...mono }}>{o.mbl_no || o.booking_no || "—"}</td>
                    <td style={tdS}>{o.vessel || "—"}</td>
                    <td style={tdS}>{o.voyage || "—"}</td>
                    <td style={{ ...tdS, ...mono }}>{o.etd || "—"}</td>
                    <td style={tdS}>{o.supplier || "—"}</td>
                    <td style={tdS}>{(o.pol || "").split("(")[0].trim() || "—"}</td>
                    <td style={tdS}>{(o.pod || "").split("(")[0].trim() || "—"}</td>
                    <td style={tdS}>{o.destination || "—"}</td>
                    <td style={tdS}>{o.qty_container || "—"}</td>
                    <td style={tdS}>—</td>
                    <td style={tdS}>—</td>
                    <td style={tdS}>{o.space_status ? <StatusTag v={o.space_status} /> : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination — compact */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6, fontSize: 11 }}>
        <span style={{ color: "#5f6b7a" }}>共 {flatCount} 条</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(0); }} style={{ padding: "2px 6px", borderRadius: 3, border: "1px solid #d0d5dd", fontSize: 11, outline: "none" }}>
            {[20, 50, 100, 200, 500].map(n => <option key={n} value={n}>{n}条/页</option>)}
          </select>
          {[["‹‹", 0, page === 0], ["‹", page - 1, page === 0], ["›", page + 1, page >= totalPages - 1], ["››", totalPages - 1, page >= totalPages - 1]].map(([l, t, d]) =>
            <button key={l} disabled={d} onClick={() => setPage(t)} style={{ padding: "2px 8px", borderRadius: 3, border: "1px solid #d0d5dd", background: "#fff", fontSize: 11, cursor: d ? "default" : "pointer", color: d ? "#c8c8c8" : "#1a1a1a" }}>{l}</button>
          )}
          <span style={{ color: "#5f6b7a" }}>{page + 1} / {totalPages}</span>
        </div>
      </div>

      {showNew && <NewOrderModal onClose={() => setShowNew(false)} onSaved={() => { setShowNew(false); load(); }} />}
    </div>
  );
}

function StatusTag({ v }) {
  const c = STATUS_COLORS[v] || "#94a3b8";
  return <span style={{ fontSize: 9, fontWeight: 500, padding: "1px 5px", borderRadius: 2, background: c + "18", color: c, border: `1px solid ${c}33` }}>{v}</span>;
}

// =========================================================================
// Order Detail
// =========================================================================
function OrderDetail({ order, role, user, onBack, onReload }) {
  const [tab, setTab] = useState("info");
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState({});
  const [refData, setRefData] = useState({ suppliers: [], customers: [], ports: [] });
  const [cargoItems, setCargoItems] = useState([]);
  const [editingCargo, setEditingCargo] = useState(false);
  const [cargoEdits, setCargoEdits] = useState([]);

  useEffect(() => {
    Promise.all([
      supabase.from("suppliers").select("name").order("name"),
      supabase.from("customers").select("name").order("name"),
      supabase.from("ports").select("name").order("name"),
    ]).then(([s, c, p]) => {
      setRefData({ suppliers: (s.data || []).map(r => r.name), customers: (c.data || []).map(r => r.name), ports: (p.data || []).map(r => r.name) });
    });
    loadCargo();
  }, [order.id]);

  const loadCargo = useCallback(() => {
    if (order.po || order.customer_po) {
      const q = order.po && order.customer_po
        ? supabase.from("container_items").select("*").eq("po", order.po).eq("customer_po", String(order.customer_po))
        : order.customer_po ? supabase.from("container_items").select("*").eq("customer_po", String(order.customer_po))
        : supabase.from("container_items").select("*").eq("po", order.po);
      q.then(({ data }) => setCargoItems(data || []));
    }
  }, [order.id, order.po, order.customer_po]);

  const startEdit = () => { setEditData({ ...order }); setEditing(true); };
  const cancelEdit = () => setEditing(false);
  const saveEdit = async () => {
    const changes = {};
    for (const k of Object.keys(editData)) { if (editData[k] !== order[k] && !["id", "created_at", "updated_at"].includes(k)) changes[k] = editData[k] === "" ? null : editData[k]; }
    if (Object.keys(changes).length > 0) { const { error } = await supabase.from("shipments").update(changes).eq("id", order.id); if (error) { alert(error.message); return; } }
    setEditing(false); onReload();
  };
  const ed = (f) => editing ? (editData[f] ?? "") : "";
  const setEd = (f, v) => setEditData(p => ({ ...p, [f]: v }));
  const startCargoEdit = () => { setCargoEdits(cargoItems.map(it => ({ ...it }))); setEditingCargo(true); };
  const cancelCargoEdit = () => setEditingCargo(false);
  const saveCargoEdit = async () => {
    for (const item of cargoEdits) { const { id, created_at, ...rest } = item; const { error } = await supabase.from("container_items").update(rest).eq("id", id); if (error) { alert(error.message); return; } }
    setEditingCargo(false); loadCargo();
  };
  const updateCargoItem = (id, field, value) => setCargoEdits(p => p.map(it => it.id === id ? { ...it, [field]: value } : it));

  return (
    <div>
      <button onClick={onBack} style={{ display: "flex", alignItems: "center", gap: 4, padding: "4px 0", border: "none", background: "none", color: "#2563eb", fontSize: 12, fontWeight: 500, cursor: "pointer", marginBottom: 8 }}>← 返回列表</button>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div>
          <h1 style={{ fontSize: 16, fontWeight: 700, margin: 0, ...mono }}>{order.order_no || order.po || "订单详情"}</h1>
          <p style={{ fontSize: 11, color: "#5f6b7a", margin: "2px 0 0" }}>{order.supplier || ""} · {order.customer || ""} · {order.carrier || ""}</p>
        </div>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          {Object.keys(STATUS_CONFIGS).map(k => order[k] ? <StatusTag key={k} v={order[k]} /> : null)}
          {!editing && <button onClick={startEdit} style={{ padding: "4px 12px", borderRadius: 3, border: "1px solid #d0d5dd", background: "#fff", fontSize: 11, cursor: "pointer" }}>编辑</button>}
          {editing && <><button onClick={saveEdit} style={{ padding: "4px 12px", borderRadius: 3, background: "#2563eb", color: "#fff", fontSize: 11, border: "none", cursor: "pointer" }}>保存</button><button onClick={cancelEdit} style={{ padding: "4px 12px", borderRadius: 3, border: "1px solid #d0d5dd", background: "#fff", fontSize: 11, cursor: "pointer" }}>取消</button></>}
        </div>
      </div>

      <div style={{ display: "flex", gap: 0, marginBottom: 10, borderBottom: "1px solid #e0e0e0" }}>
        {[["info", "订单信息"], ["charges", "费用 & 账单"]].map(([k, l]) =>
          <button key={k} onClick={() => setTab(k)} style={{ padding: "6px 14px", border: "none", borderBottom: tab === k ? "2px solid #2563eb" : "2px solid transparent", background: "transparent", color: tab === k ? "#1a1a1a" : "#94a3b8", fontSize: 12, fontWeight: tab === k ? 600 : 400, cursor: "pointer" }}>{l}</button>
        )}
      </div>

      {tab === "info" && (
        <>
          <div style={{ background: "#fff", borderRadius: 4, padding: 14, border: editing ? "1px solid #93c5fd" : "1px solid #e0e0e0", marginBottom: 10 }}>
            <SectionHeader icon="📄" title="基本信息" accent="#2563eb" />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0 20px" }}>
              <EditField label="订单编号" field="order_no" editing={editing} value={ed("order_no")} displayValue={order.order_no} onChange={setEd} />
              <EditField label="出运类型" field="shipment_type" editing={editing} value={ed("shipment_type")} displayValue={(SHIPMENT_TYPES.find(t => t.key === order.shipment_type) || SHIPMENT_TYPES[0]).label} onChange={setEd} options={SHIPMENT_TYPES.map(t => t.key)} />
              <EditField label="委托单位" field="supplier" editing={editing} value={ed("supplier")} displayValue={order.supplier} onChange={setEd} options={refData.suppliers} />
              <EditField label="贸易条款" field="incoterms" editing={editing} value={ed("incoterms")} displayValue={order.incoterms} onChange={setEd} options={TRADE_TERMS} />
              <EditField label="货物类型" field="cargo_type" editing={editing} value={ed("cargo_type")} displayValue={order.cargo_type} onChange={setEd} options={CARGO_TYPES.map(c => c.label)} />
              <EditField label="PO#" field="po" editing={editing} value={ed("po")} displayValue={order.po} onChange={setEd} />
              <EditField label="Customer PO#" field="customer_po" editing={editing} value={ed("customer_po")} displayValue={order.customer_po} onChange={setEd} />
              <EditField label="客户" field="customer" editing={editing} value={ed("customer")} displayValue={order.customer} onChange={setEd} options={refData.customers} />
              <EditField label="终端客户" field="end_customer" editing={editing} value={ed("end_customer")} displayValue={order.end_customer} onChange={setEd} />
            </div>
          </div>

          <div style={{ background: "#fff", borderRadius: 4, padding: 14, border: editing ? "1px solid #a5b4fc" : "1px solid #e0e0e0", marginBottom: 10 }}>
            <SectionHeader icon="🚢" title="运输信息" accent="#4f46e5" />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0 20px" }}>
              <EditField label="船公司" field="carrier" editing={editing} value={ed("carrier")} displayValue={order.carrier} onChange={setEd} />
              <EditField label="订舱代理" field="carrier_agent" editing={editing} value={ed("carrier_agent")} displayValue={order.carrier_agent} onChange={setEd} />
              <EditField label="起运港 POL" field="pol" editing={editing} value={ed("pol")} displayValue={order.pol} onChange={setEd} options={refData.ports} />
              <EditField label="卸货港 POD" field="pod" editing={editing} value={ed("pod")} displayValue={order.pod} onChange={setEd} options={refData.ports} />
              <EditField label="目的港" field="destination" editing={editing} value={ed("destination")} displayValue={order.destination} onChange={setEd} />
              <EditField label="箱量" field="qty_container" editing={editing} value={ed("qty_container")} displayValue={order.qty_container} onChange={setEd} />
              <EditField label="箱型" field="container_type" editing={editing} value={ed("container_type")} displayValue={order.container_type} onChange={setEd} options={CONTAINER_TYPES} />
              <EditField label="COC/SOC" field="container_owner" editing={editing} value={ed("container_owner")} displayValue={order.container_owner} onChange={setEd} options={CONTAINER_OWNERS} />
              <EditField label="船名" field="vessel" editing={editing} value={ed("vessel")} displayValue={order.vessel} onChange={setEd} />
              <EditField label="航次" field="voyage" editing={editing} value={ed("voyage")} displayValue={order.voyage} onChange={setEd} />
              <EditField label="码头" field="terminal" editing={editing} value={ed("terminal")} displayValue={order.terminal} onChange={setEd} />
              <div />
              <EditField label="ETD" field="etd" type="date" editing={editing} value={ed("etd")} displayValue={order.etd} onChange={setEd} />
              <EditField label="ATD" field="atd" type="date" editing={editing} value={ed("atd")} displayValue={order.atd} onChange={setEd} />
              <EditField label="ETA" field="eta" type="date" editing={editing} value={ed("eta")} displayValue={order.eta} onChange={setEd} />
              <div />
              <EditField label="SI Cutoff" field="si_cutoff" type="datetime-local" editing={editing} value={ed("si_cutoff")} displayValue={order.si_cutoff} onChange={setEd} />
              <EditField label="CY Cutoff" field="cy_cutoff" type="datetime-local" editing={editing} value={ed("cy_cutoff")} displayValue={order.cy_cutoff} onChange={setEd} />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
            <div style={{ background: "#fff", borderRadius: 4, padding: 14, border: editing ? "1px solid #fcd34d" : "1px solid #e0e0e0" }}>
              <SectionHeader icon="📜" title="提单信息" accent="#d97706" />
              <EditField label="Booking No" field="booking_no" editing={editing} value={ed("booking_no")} displayValue={order.booking_no} onChange={setEd} />
              <EditField label="E-Booking No" field="e_booking_no" editing={editing} value={ed("e_booking_no")} displayValue={order.e_booking_no} onChange={setEd} />
              <EditField label="MBL No" field="mbl_no" editing={editing} value={ed("mbl_no")} displayValue={order.mbl_no} onChange={setEd} />
              <EditField label="BL Type" field="bl_type" editing={editing} value={ed("bl_type")} displayValue={order.bl_type} onChange={setEd} options={BL_TYPES} />
              <EditField label="Freight Terms" field="freight_terms" editing={editing} value={ed("freight_terms")} displayValue={order.freight_terms} onChange={setEd} options={FREIGHT_TERMS} />
              <EditField label="Transport Terms" field="transport_terms" editing={editing} value={ed("transport_terms")} displayValue={order.transport_terms} onChange={setEd} options={TRANSPORT_TERMS} />
            </div>
            <div style={{ background: "#fff", borderRadius: 4, padding: 14, border: editing ? "1px solid #c4b5fd" : "1px solid #e0e0e0" }}>
              <SectionHeader icon="👤" title="Shipper / Consignee / Notify" accent="#7c3aed" />
              <EditField label="Shipper" field="shipper" editing={editing} value={ed("shipper")} displayValue={order.shipper} onChange={setEd} />
              <EditField label="Consignee" field="consignee" editing={editing} value={ed("consignee")} displayValue={order.consignee} onChange={setEd} />
              <EditField label="Notify Party" field="notify_party" editing={editing} value={ed("notify_party")} displayValue={order.notify_party} onChange={setEd} />
            </div>
          </div>

          <div style={{ background: "#fff", borderRadius: 4, padding: 14, border: "1px solid #e0e0e0", marginBottom: 10 }}>
            <SectionHeader icon="📦" title="货物明细" accent="#059669"
              right={cargoItems.length > 0 && !editingCargo ? <button onClick={startCargoEdit} style={{ padding: "3px 10px", borderRadius: 3, border: "1px solid #d0d5dd", background: "#fff", fontSize: 10, cursor: "pointer", marginRight: 8 }}>编辑明细</button>
                : editingCargo ? <div style={{ display: "flex", gap: 3, marginRight: 8 }}><button onClick={saveCargoEdit} style={{ padding: "3px 10px", borderRadius: 3, background: "#2563eb", color: "#fff", fontSize: 10, border: "none", cursor: "pointer" }}>保存</button><button onClick={cancelCargoEdit} style={{ padding: "3px 10px", borderRadius: 3, border: "1px solid #d0d5dd", background: "#fff", fontSize: 10, cursor: "pointer" }}>取消</button></div> : null} />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0 20px", marginBottom: 10, padding: 8, background: "#f8f8f8", borderRadius: 3 }}>
              <Field label="品名" value={order.tuc} /><Field label="SKU" value={order.sku} /><Field label="件数" value={order.qty_packages} /><Field label="毛重 KGS" value={order.weight} />
              <Field label="体积 CBM" value={order.volume} /><Field label="唛头" value={order.marks} />
            </div>
            {(editingCargo ? cargoEdits : cargoItems).length > 0 && (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
                  <thead><tr style={{ background: "#f0fdf4" }}>
                    {["B/L", "HBL", "柜号", "封号", "品名", "唛头", "件数", "毛重", "体积"].map(h => <th key={h} style={{ padding: "4px 5px", textAlign: "left", fontWeight: 500, color: "#065f46", fontSize: 9, borderBottom: "1px solid #a7f3d0" }}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {(editingCargo ? cargoEdits : cargoItems).map(it => (
                      <tr key={it.id} style={{ borderBottom: "1px solid #d1fae5" }}>
                        <td style={{ padding: "3px 5px", ...mono, fontSize: 9 }}>{order.mbl_no || order.booking_no || "—"}</td>
                        {editingCargo ? <>
                          <CCell id={it.id} f="hbl" v={it.hbl} fn={updateCargoItem} />
                          <CCell id={it.id} f="container_no" v={it.container_no} fn={updateCargoItem} />
                          <CCell id={it.id} f="seal_no" v={it.seal_no} fn={updateCargoItem} />
                          <CCell id={it.id} f="tuc" v={it.tuc} fn={updateCargoItem} w />
                          <CCell id={it.id} f="marks" v={it.marks} fn={updateCargoItem} />
                          <CCell id={it.id} f="qty" v={it.qty} fn={updateCargoItem} n />
                          <CCell id={it.id} f="weight" v={it.weight} fn={updateCargoItem} n />
                          <CCell id={it.id} f="volume" v={it.volume} fn={updateCargoItem} n />
                        </> : <>
                          <td style={{ padding: "3px 5px", ...mono, fontSize: 9 }}>{it.hbl || "—"}</td>
                          <td style={{ padding: "3px 5px", ...mono, fontSize: 9, color: "#2563eb" }}>{it.container_no || "—"}</td>
                          <td style={{ padding: "3px 5px", fontSize: 9 }}>{it.seal_no || "—"}</td>
                          <td style={{ padding: "3px 5px", maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis" }}>{it.tuc || "—"}</td>
                          <td style={{ padding: "3px 5px" }}>{it.marks || "—"}</td>
                          <td style={{ padding: "3px 5px", textAlign: "right" }}>{it.qty || "—"}</td>
                          <td style={{ padding: "3px 5px", textAlign: "right" }}>{it.weight || "—"}</td>
                          <td style={{ padding: "3px 5px", textAlign: "right" }}>{it.volume || "—"}</td>
                        </>}
                      </tr>
                    ))}
                    <tr style={{ background: "#f0fdf4", fontWeight: 600 }}>
                      <td colSpan={6} style={{ padding: "4px 5px", textAlign: "right", fontSize: 9, color: "#065f46" }}>合计</td>
                      <td style={{ padding: "4px 5px", textAlign: "right", fontSize: 9 }}>{(editingCargo ? cargoEdits : cargoItems).reduce((s, i) => s + (Number(i.qty) || 0), 0)}</td>
                      <td style={{ padding: "4px 5px", textAlign: "right", fontSize: 9 }}>{(editingCargo ? cargoEdits : cargoItems).reduce((s, i) => s + (Number(i.weight) || 0), 0).toFixed(3)}</td>
                      <td style={{ padding: "4px 5px", textAlign: "right", fontSize: 9 }}>{(editingCargo ? cargoEdits : cargoItems).reduce((s, i) => s + (Number(i.volume) || 0), 0).toFixed(3)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
            {cargoItems.length === 0 && !editingCargo && <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 4 }}>暂无装柜明细</div>}
          </div>
        </>
      )}
      {tab === "charges" && (
        <div style={{ background: "#fff", borderRadius: 4, padding: 14, border: "1px solid #e0e0e0" }}>
          <SectionHeader icon="💰" title="费用 & 账单" accent="#d97706" />
          <EmptyState>费用模块开发中</EmptyState>
        </div>
      )}
    </div>
  );
}

function CCell({ id, f, v, fn, n, w }) {
  return <td style={{ padding: "2px 3px" }}><input value={v ?? ""} onChange={e => fn(id, f, e.target.value)} style={{ width: "100%", padding: "2px 4px", borderRadius: 2, border: "1px solid #a7f3d0", background: "#f0fdf4", fontSize: 9, outline: "none", boxSizing: "border-box", textAlign: n ? "right" : "left", minWidth: w ? 100 : 50, ...mono }} /></td>;
}

function NewOrderModal({ onClose, onSaved }) {
  const [form, setForm] = useState({ po: "", customer_po: "", supplier: "", customer: "", carrier: "", carrier_agent: "", vessel: "", pol: "", pod: "", etd: "", incoterms: "FOB", booking_no: "", e_booking_no: "", shipment_type: "FCL" });
  const [refData, setRefData] = useState({ suppliers: [], customers: [], ports: [] });
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    Promise.all([supabase.from("suppliers").select("name").order("name"), supabase.from("customers").select("name").order("name"), supabase.from("ports").select("name").order("name")])
      .then(([s, c, p]) => setRefData({ suppliers: (s.data || []).map(r => r.name), customers: (c.data || []).map(r => r.name), ports: (p.data || []).map(r => r.name) }));
  }, []);
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const save = async () => {
    if (!form.po && !form.customer_po) { alert("PO or Customer PO required"); return; }
    setSaving(true);
    const data = { ...form }; for (const k of Object.keys(data)) { if (data[k] === "") data[k] = null; }
    const { error } = await supabase.from("shipments").insert(data);
    if (error) { alert(error.message); setSaving(false); return; }
    setSaving(false); onSaved();
  };
  const lbl = { fontSize: 10, fontWeight: 500, color: "#5f6b7a", marginBottom: 3 };
  return (
    <Modal onClose={onClose} title={t("New Order")} width={700}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        <Input label="PO#" value={form.po} onChange={e => set("po", e.target.value)} />
        <Input label="Customer PO#" value={form.customer_po} onChange={e => set("customer_po", e.target.value)} />
        <div><div style={lbl}>出运类型</div><ComboBox value={form.shipment_type} onChange={v => set("shipment_type", v)} options={SHIPMENT_TYPES.map(t => t.key)} /></div>
        <div><div style={lbl}>{t("Supplier")}</div><ComboBox value={form.supplier} onChange={v => set("supplier", v)} options={refData.suppliers} placeholder="搜索委托方..." /></div>
        <div><div style={lbl}>{t("Customer")}</div><ComboBox value={form.customer} onChange={v => set("customer", v)} options={refData.customers} placeholder="搜索客户..." /></div>
        <Input label={t("Carrier")} value={form.carrier} onChange={e => set("carrier", e.target.value)} />
        <Input label={t("Agent")} value={form.carrier_agent} onChange={e => set("carrier_agent", e.target.value)} />
        <Input label={t("Vessel")} value={form.vessel} onChange={e => set("vessel", e.target.value)} />
        <div><div style={lbl}>{t("POL")}</div><ComboBox value={form.pol} onChange={v => set("pol", v)} options={refData.ports} placeholder="搜索港口..." /></div>
        <div><div style={lbl}>{t("POD")}</div><ComboBox value={form.pod} onChange={v => set("pod", v)} options={refData.ports} placeholder="搜索港口..." /></div>
        <Input label="ETD" type="date" value={form.etd} onChange={e => set("etd", e.target.value)} />
        <div><div style={lbl}>{t("Trade Terms")}</div><ComboBox value={form.incoterms} onChange={v => set("incoterms", v)} options={TRADE_TERMS} /></div>
        <Input label="Booking No" value={form.booking_no} onChange={e => set("booking_no", e.target.value)} />
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 12 }}>
        <button onClick={onClose} style={{ padding: "5px 14px", borderRadius: 3, border: "1px solid #d0d5dd", background: "#fff", fontSize: 12, cursor: "pointer" }}>{t("Cancel")}</button>
        <button onClick={save} disabled={saving} style={{ padding: "5px 14px", borderRadius: 3, background: "#2563eb", color: "#fff", fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer", opacity: saving ? 0.5 : 1 }}>{saving ? "..." : t("Save")}</button>
      </div>
    </Modal>
  );
}
