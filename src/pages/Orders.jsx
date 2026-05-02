import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "../supabase.js";
import { Badge, Field, SectionHeader, Modal, Button, Input, Select, Spinner, EmptyState, FilterDropdown, ComboBox, EditField } from "../components/ui.jsx";
import { t } from "../lib/i18n.js";
import { STATUS_CONFIGS, STATUS_COLORS, TRADE_TERMS, CONTAINER_TYPES, CONTAINER_OWNERS, BL_TYPES, FREIGHT_TERMS, TRANSPORT_TERMS, CARGO_TYPES, SERVICE_TYPES } from "../lib/constants.js";

// ── All filterable columns definition ────────────────────────────
const ALL_FILTER_FIELDS = [
  { key: "supplier",     label: "委托方",     type: "combo" },
  { key: "customer",     label: "客户",       type: "combo" },
  { key: "carrier",      label: "船公司",     type: "combo" },
  { key: "vessel",       label: "船名",       type: "text" },
  { key: "voyage",       label: "航次",       type: "text" },
  { key: "pol",          label: "起运港",     type: "combo" },
  { key: "pod",          label: "卸货港",     type: "combo" },
  { key: "mbl_no",       label: "MB/L No.",   type: "text" },
  { key: "booking_no",   label: "Booking No.", type: "text" },
  { key: "container_no", label: "柜号",       type: "text" },
  { key: "etd_from",     label: "ETD 从",     type: "date" },
  { key: "etd_to",       label: "ETD 至",     type: "date" },
  { key: "destination",  label: "目的港",     type: "combo" },
  { key: "incoterms",    label: "贸易条款",   type: "combo" },
  { key: "container_type", label: "箱型",     type: "combo" },
  { key: "order_no",     label: "订单编号",   type: "text" },
  { key: "po",           label: "PO#",        type: "text" },
  { key: "customer_po",  label: "Customer PO#", type: "text" },
  { key: "end_customer", label: "终端客户",   type: "text" },
  { key: "carrier_agent", label: "订舱代理",  type: "text" },
  { key: "terminal",     label: "码头",       type: "text" },
  { key: "bl_type",      label: "提单形式",   type: "combo" },
];
const DEFAULT_FILTER_KEYS = ["supplier", "customer", "carrier", "vessel", "pol", "pod", "mbl_no", "booking_no", "container_no", "etd_from", "etd_to"];

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

  // Reference lists for combo filters
  const refLists = useMemo(() => {
    const extract = (field) => [...new Set(shipments.map(o => o[field]).filter(Boolean))].sort();
    return {
      supplier: extract("supplier"), customer: extract("customer"), carrier: extract("carrier"),
      vessel: extract("vessel"), pol: extract("pol"), pod: extract("pod"),
      destination: extract("destination"), incoterms: TRADE_TERMS,
      container_type: CONTAINER_TYPES, bl_type: BL_TYPES,
    };
  }, [shipments]);

  // Filter logic
  const filtered = useMemo(() => shipments.filter(o => {
    for (const key of activeFilterKeys) {
      const val = filters[key];
      if (!val) continue;
      const def = ALL_FILTER_FIELDS.find(f => f.key === key);
      if (!def) continue;

      if (key === "etd_from") { if (o.etd && o.etd < val) return false; continue; }
      if (key === "etd_to") { if (o.etd && o.etd > val) return false; continue; }

      if (def.type === "combo") {
        if (o[key] !== val) return false;
      } else {
        if (!(o[key] || "").toLowerCase().includes(val.toLowerCase())) return false;
      }
    }
    // Status filters
    if (filters.qc_status && filters.qc_status !== "All" && o.qc_status !== filters.qc_status) return false;
    if (filters.space_status && filters.space_status !== "All" && o.space_status !== filters.space_status) return false;
    if (filters.bl_status && filters.bl_status !== "All" && o.bl_status !== filters.bl_status) return false;

    if (search) {
      const q = search.toLowerCase();
      const fields = [o.po, o.customer_po, o.booking_no, o.container_no, o.vessel, o.supplier, o.order_no, o.mbl_no, o.customer].filter(Boolean);
      if (!fields.some(f => f.toLowerCase().includes(q))) return false;
    }
    return true;
  }), [shipments, filters, search, activeFilterKeys]);

  useEffect(() => { setPage(0); }, [filters, search]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pagedRows = filtered.slice(page * pageSize, (page + 1) * pageSize);

  // Stats
  const stats = useMemo(() => {
    const types = {};
    let teu = 0;
    filtered.forEach(o => {
      const qt = o.qty_container || "";
      const m = qt.match(/(\d+)x(\w+)/);
      if (m) {
        const cnt = parseInt(m[1]); const typ = m[2];
        types[typ] = (types[typ] || 0) + cnt;
        teu += typ === "20GP" ? cnt : cnt * 2;
      }
    });
    return { rows: filtered.length, teu, typeStr: Object.entries(types).map(([t, c]) => `${c}x${t}`).join(", ") };
  }, [filtered]);

  const toggleCheck = (id) => setCheckedIds(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => { if (checkedIds.size === pagedRows.length) setCheckedIds(new Set()); else setCheckedIds(new Set(pagedRows.map(o => o.id))); };

  const clearFilters = () => { setFilters({}); setSearch(""); };
  const activeCount = Object.entries(filters).filter(([k, v]) => v && v !== "All").length + (search ? 1 : 0);

  const selectedOrder = shipments.find(o => o.id === selectedId);

  const toggleFilterField = (key) => {
    setActiveFilterKeys(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };

  if (loading) return <Spinner />;

  if (selectedOrder) {
    return <OrderDetail order={selectedOrder} role={role} user={user} onBack={() => { setSelectedId(null); load(); }} onReload={load} />;
  }

  const fs = { padding: "5px 8px", borderRadius: 5, border: "1px solid #e2e8f0", fontSize: 11.5, outline: "none", background: "#fff", boxSizing: "border-box", minWidth: 0 };
  const fl = { fontSize: 10, fontWeight: 600, color: "#64748b", marginBottom: 2 };

  return (
    <div>
      {/* 1. Action bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, padding: "8px 12px", background: "#fff", borderRadius: 8, border: "1px solid #e2e8f0" }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <h1 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>海运出口</h1>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <Button small variant="secondary" onClick={() => setShowFilters(p => !p)}>{showFilters ? "隐藏筛选" : "显示筛选"} {activeCount > 0 && `(${activeCount})`}</Button>
          <Button small variant="secondary" onClick={clearFilters}>清除</Button>
          <Button small variant="secondary" onClick={() => setShowFieldPicker(p => !p)}>⚙ 自定义筛选</Button>
          <Button small onClick={() => setShowNew(true)}>+ 新建订单</Button>
        </div>
      </div>

      {/* Field picker */}
      {showFieldPicker && (
        <div style={{ background: "#fff", borderRadius: 8, border: "1px solid #e2e8f0", padding: "10px 12px", marginBottom: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", marginBottom: 8 }}>选择筛选字段（勾选显示）</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {ALL_FILTER_FIELDS.map(f => (
              <label key={f.key} style={{
                display: "flex", alignItems: "center", gap: 4, padding: "4px 10px",
                borderRadius: 6, fontSize: 11, cursor: "pointer",
                background: activeFilterKeys.includes(f.key) ? "#f0f9ff" : "#f8fafc",
                border: `1px solid ${activeFilterKeys.includes(f.key) ? "#bae6fd" : "#e2e8f0"}`,
                color: activeFilterKeys.includes(f.key) ? "#0369a1" : "#64748b",
              }}>
                <input type="checkbox" checked={activeFilterKeys.includes(f.key)} onChange={() => toggleFilterField(f.key)}
                  style={{ width: 12, height: 12 }} />
                {f.label}
              </label>
            ))}
          </div>
        </div>
      )}

      {/* 2. Filter fields */}
      {showFilters && (
        <div style={{ background: "#fff", borderRadius: 8, border: "1px solid #e2e8f0", padding: "10px 12px", marginBottom: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: "8px 10px" }}>
            {activeFilterKeys.map(key => {
              const def = ALL_FILTER_FIELDS.find(f => f.key === key);
              if (!def) return null;
              if (def.type === "combo") {
                const opts = refLists[key] || [...new Set(shipments.map(o => o[key]).filter(Boolean))].sort();
                return (
                  <div key={key}>
                    <div style={fl}>{def.label}</div>
                    <ComboBox
                      value={filters[key] || ""}
                      onChange={(v) => setFilters(p => ({ ...p, [key]: v }))}
                      options={opts}
                      placeholder={`${def.label}...`}
                    />
                  </div>
                );
              }
              if (def.type === "date") {
                return (
                  <div key={key}>
                    <div style={fl}>{def.label}</div>
                    <input type="date" value={filters[key] || ""} onChange={e => setFilters(p => ({ ...p, [key]: e.target.value }))} style={{ ...fs, width: "100%" }} />
                  </div>
                );
              }
              return (
                <div key={key}>
                  <div style={fl}>{def.label}</div>
                  <input value={filters[key] || ""} onChange={e => setFilters(p => ({ ...p, [key]: e.target.value }))} style={{ ...fs, width: "100%" }} placeholder={`${def.label}...`} />
                </div>
              );
            })}
            <div>
              <div style={fl}>搜索</div>
              <input value={search} onChange={e => setSearch(e.target.value)} style={{ ...fs, width: "100%" }} placeholder="PO / Cust PO / 关键词..." />
            </div>
          </div>
        </div>
      )}

      {/* 3. Stats + status quick filters */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10, padding: "6px 12px", background: "#f0f9ff", borderRadius: 8, border: "1px solid #bae6fd" }}>
        <div style={{ fontSize: 12, color: "#0369a1", fontWeight: 600 }}>
          行数: <strong>{stats.rows}</strong> &nbsp; TEU: <strong>{stats.teu}</strong> &nbsp; {stats.typeStr && <>箱型: <strong>{stats.typeStr}</strong></>}
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          <FilterDropdown label="QC" value={filters.qc_status || "All"} options={[...STATUS_CONFIGS.qc_status.options, "__empty__"]} optionLabels={{ "__empty__": "未设置" }} onChange={v => setFilters(p => ({ ...p, qc_status: v }))} />
          <FilterDropdown label="放舱" value={filters.space_status || "All"} options={[...STATUS_CONFIGS.space_status.options, "__empty__"]} optionLabels={{ "__empty__": "未设置" }} onChange={v => setFilters(p => ({ ...p, space_status: v }))} />
          <FilterDropdown label="提单" value={filters.bl_status || "All"} options={[...STATUS_CONFIGS.bl_status.options, "__empty__"]} optionLabels={{ "__empty__": "未设置" }} onChange={v => setFilters(p => ({ ...p, bl_status: v }))} />
        </div>
      </div>

      {/* Batch bar */}
      {checkedIds.size > 0 && (
        <div style={{ background: "#0f172a", borderRadius: 8, padding: "8px 14px", marginBottom: 10, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ color: "#e2e8f0", fontSize: 12, fontWeight: 600 }}>已选 {checkedIds.size} 条</span>
          <div style={{ display: "flex", gap: 6 }}>
            <Button small variant="secondary" onClick={() => setCheckedIds(new Set())}>取消</Button>
          </div>
        </div>
      )}

      {/* 4. Order list table */}
      <div style={{ background: "#fff", borderRadius: 8, border: "1px solid #e2e8f0", overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5, minWidth: 1200 }}>
            <thead><tr style={{ background: "#f8fafc" }}>
              <th style={{ padding: "8px 6px", width: 30, borderBottom: "1px solid #e2e8f0" }}><input type="checkbox" checked={checkedIds.size === pagedRows.length && pagedRows.length > 0} onChange={toggleAll} /></th>
              {["出运类型", "订单编号", "PO", "Cust PO", "委托方", "客户", "MB/L No.", "船名", "航次", "起运港", "卸货港", "箱型", "ETD", "QC", "放舱", "提单"].map(h =>
                <th key={h} style={{ padding: "8px 6px", textAlign: "left", fontWeight: 600, color: "#64748b", fontSize: 10, borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap" }}>{h}</th>
              )}
            </tr></thead>
            <tbody>
              {pagedRows.length === 0 && <tr><td colSpan={17} style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>暂无数据</td></tr>}
              {pagedRows.map((o) => {
                const bg = checkedIds.has(o.id) ? "#f0f9ff" : "transparent";
                return (
                <tr key={o.id} style={{ borderBottom: "1px solid #f1f5f9", cursor: "pointer", background: bg }}
                  onMouseEnter={e => { e.currentTarget.style.background = "#f8fafc"; }}
                  onMouseLeave={e => { e.currentTarget.style.background = bg; }}>
                  <td style={{ padding: "6px", textAlign: "center" }} onClick={e => e.stopPropagation()}><input type="checkbox" checked={checkedIds.has(o.id)} onChange={() => toggleCheck(o.id)} /></td>
                  <td style={{ padding: "6px", fontSize: 10 }} onClick={() => setSelectedId(o.id)}>{o.qty_container?.includes("Multi") ? "拼箱" : "整箱"}</td>
                  <td style={{ padding: "6px", fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#0369a1", fontWeight: 600 }} onClick={() => setSelectedId(o.id)}>{o.order_no || "—"}</td>
                  <td style={{ padding: "6px", fontFamily: "'DM Mono',monospace", fontSize: 10 }} onClick={() => setSelectedId(o.id)}>{o.po || "—"}</td>
                  <td style={{ padding: "6px", fontFamily: "'DM Mono',monospace", fontSize: 10 }} onClick={() => setSelectedId(o.id)}>{o.customer_po || "—"}</td>
                  <td style={{ padding: "6px", fontSize: 10 }} onClick={() => setSelectedId(o.id)}>{o.supplier || "—"}</td>
                  <td style={{ padding: "6px", fontSize: 10 }} onClick={() => setSelectedId(o.id)}>{o.customer || "—"}</td>
                  <td style={{ padding: "6px", fontFamily: "'DM Mono',monospace", fontSize: 10 }} onClick={() => setSelectedId(o.id)}>{o.mbl_no || o.booking_no || "—"}</td>
                  <td style={{ padding: "6px", fontSize: 10, maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} onClick={() => setSelectedId(o.id)}>{o.vessel || "—"}</td>
                  <td style={{ padding: "6px", fontSize: 10 }} onClick={() => setSelectedId(o.id)}>{o.voyage || "—"}</td>
                  <td style={{ padding: "6px", fontSize: 10 }} onClick={() => setSelectedId(o.id)}>{(o.pol || "").split("(")[0].trim() || "—"}</td>
                  <td style={{ padding: "6px", fontSize: 10 }} onClick={() => setSelectedId(o.id)}>{(o.pod || "").split("(")[0].trim() || "—"}</td>
                  <td style={{ padding: "6px", fontSize: 10 }} onClick={() => setSelectedId(o.id)}>{o.qty_container || "—"}</td>
                  <td style={{ padding: "6px", fontFamily: "'DM Mono',monospace", fontSize: 10 }} onClick={() => setSelectedId(o.id)}>{o.etd || "—"}</td>
                  <td style={{ padding: "6px" }} onClick={() => setSelectedId(o.id)}>{o.qc_status ? <Badge value={o.qc_status} small /> : "—"}</td>
                  <td style={{ padding: "6px" }} onClick={() => setSelectedId(o.id)}>{o.space_status ? <Badge value={o.space_status} small /> : "—"}</td>
                  <td style={{ padding: "6px" }} onClick={() => setSelectedId(o.id)}>{o.bl_status ? <Badge value={o.bl_status} small /> : "—"}</td>
                </tr>
              );})}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 10, fontSize: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: "#64748b" }}>每页</span>
          <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(0); }} style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid #e2e8f0", fontSize: 12, outline: "none" }}>
            {[20, 50, 100, 200, 500].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <span style={{ color: "#94a3b8" }}>{filtered.length} 条 · 第 {page + 1}/{totalPages} 页</span>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {[["⟨⟨", 0, page === 0], ["⟨", page - 1, page === 0], ["⟩", page + 1, page >= totalPages - 1], ["⟩⟩", totalPages - 1, page >= totalPages - 1]].map(([label, target, disabled]) =>
            <button key={label} disabled={disabled} onClick={() => setPage(target)} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #e2e8f0", background: "#fff", fontSize: 12, cursor: disabled ? "default" : "pointer", color: disabled ? "#cbd5e1" : "#0f172a" }}>{label}</button>
          )}
        </div>
      </div>

      {showNew && <NewOrderModal onClose={() => setShowNew(false)} onSaved={() => { setShowNew(false); load(); }} />}
    </div>
  );
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
        : order.customer_po
          ? supabase.from("container_items").select("*").eq("customer_po", String(order.customer_po))
          : supabase.from("container_items").select("*").eq("po", order.po);
      q.then(({ data }) => setCargoItems(data || []));
    }
  }, [order.id, order.po, order.customer_po]);

  const startEdit = () => { setEditData({ ...order }); setEditing(true); };
  const cancelEdit = () => { setEditing(false); };
  const saveEdit = async () => {
    const changes = {};
    for (const k of Object.keys(editData)) {
      if (editData[k] !== order[k] && !["id", "created_at", "updated_at"].includes(k)) {
        changes[k] = editData[k] === "" ? null : editData[k];
      }
    }
    if (Object.keys(changes).length > 0) {
      const { error } = await supabase.from("shipments").update(changes).eq("id", order.id);
      if (error) { alert(error.message); return; }
    }
    setEditing(false);
    onReload();
  };
  const ed = (f) => editing ? (editData[f] ?? "") : "";
  const setEd = (f, v) => setEditData(p => ({ ...p, [f]: v }));

  // Cargo editing
  const startCargoEdit = () => {
    setCargoEdits(cargoItems.map(it => ({ ...it })));
    setEditingCargo(true);
  };
  const cancelCargoEdit = () => { setEditingCargo(false); };
  const saveCargoEdit = async () => {
    for (const item of cargoEdits) {
      const { id, created_at, ...rest } = item;
      const { error } = await supabase.from("container_items").update(rest).eq("id", id);
      if (error) { alert(error.message); return; }
    }
    setEditingCargo(false);
    loadCargo();
  };
  const updateCargoItem = (id, field, value) => {
    setCargoEdits(prev => prev.map(it => it.id === id ? { ...it, [field]: value } : it));
  };

  return (
    <div>
      <button onClick={onBack} style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 0", border: "none", background: "none", color: "#0ea5e9", fontSize: 12.5, fontWeight: 600, cursor: "pointer", marginBottom: 8 }}>← 返回</button>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, fontFamily: "'DM Mono',monospace" }}>{order.order_no || order.po || "订单详情"}</h1>
          <p style={{ fontSize: 12, color: "#64748b", margin: "2px 0 0" }}>{order.supplier || ""} · {order.customer || ""} · {order.carrier || ""}</p>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {Object.keys(STATUS_CONFIGS).map(k => order[k] ? <Badge key={k} value={order[k]} /> : null)}
          {!editing && <Button small onClick={startEdit}>✎ 编辑</Button>}
          {editing && <><Button small onClick={saveEdit}>✓ 保存</Button><Button small variant="secondary" onClick={cancelEdit}>✕ 取消</Button></>}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginBottom: 14 }}>
        {[["info", "📋 订单信息"], ["charges", "💰 费用 & 账单"]].map(([k, label]) =>
          <button key={k} onClick={() => setTab(k)} style={{ padding: "7px 16px", borderRadius: "8px 8px 0 0", border: "1px solid #e2e8f0", borderBottom: tab === k ? "2px solid #0ea5e9" : "1px solid #e2e8f0", background: tab === k ? "#fff" : "#f8fafc", color: tab === k ? "#0f172a" : "#94a3b8", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>{label}</button>
        )}
      </div>

      {tab === "info" && (
        <>
          {/* Part 1: 基本信息 */}
          <div style={{ background: "#fff", borderRadius: 10, padding: 16, border: editing ? "2px solid #0ea5e9" : "1px solid #e2e8f0", marginBottom: 14 }}>
            <SectionHeader icon="📄" title="基本信息" accent="#0ea5e9" />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0 24px" }}>
              <EditField label="订单编号" field="order_no" editing={editing} value={ed("order_no")} displayValue={order.order_no} onChange={setEd} />
              <EditField label="委托单位" field="supplier" editing={editing} value={ed("supplier")} displayValue={order.supplier} onChange={setEd} options={refData.suppliers} />
              <EditField label="贸易条款" field="incoterms" editing={editing} value={ed("incoterms")} displayValue={order.incoterms} onChange={setEd} options={TRADE_TERMS} />
              <EditField label="货物类型" field="cargo_type" editing={editing} value={ed("cargo_type")} displayValue={order.cargo_type} onChange={setEd} options={CARGO_TYPES.map(c => c.label)} />
              <EditField label="PO#（业务编号）" field="po" editing={editing} value={ed("po")} displayValue={order.po} onChange={setEd} />
              <EditField label="Customer PO#（客户业务编号）" field="customer_po" editing={editing} value={ed("customer_po")} displayValue={order.customer_po} onChange={setEd} />
              <EditField label="客户" field="customer" editing={editing} value={ed("customer")} displayValue={order.customer} onChange={setEd} options={refData.customers} />
              <EditField label="终端客户" field="end_customer" editing={editing} value={ed("end_customer")} displayValue={order.end_customer} onChange={setEd} />
            </div>
          </div>

          {/* Part 2: 运输信息 */}
          <div style={{ background: "#fff", borderRadius: 10, padding: 16, border: editing ? "2px solid #6366f1" : "1px solid #e2e8f0", marginBottom: 14 }}>
            <SectionHeader icon="🚢" title="运输信息" accent="#6366f1" />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0 24px" }}>
              <EditField label="船公司 Carrier" field="carrier" editing={editing} value={ed("carrier")} displayValue={order.carrier} onChange={setEd} />
              <EditField label="订舱代理 Agent" field="carrier_agent" editing={editing} value={ed("carrier_agent")} displayValue={order.carrier_agent} onChange={setEd} />
              <EditField label="起运港 POL" field="pol" editing={editing} value={ed("pol")} displayValue={order.pol} onChange={setEd} options={refData.ports} />
              <EditField label="卸货港 POD" field="pod" editing={editing} value={ed("pod")} displayValue={order.pod} onChange={setEd} options={refData.ports} />
              <EditField label="目的港 Destination" field="destination" editing={editing} value={ed("destination")} displayValue={order.destination} onChange={setEd} />
              <EditField label="箱量" field="qty_container" editing={editing} value={ed("qty_container")} displayValue={order.qty_container} onChange={setEd} />
              <EditField label="箱型 Container Type" field="container_type" editing={editing} value={ed("container_type")} displayValue={order.container_type} onChange={setEd} options={CONTAINER_TYPES} />
              <EditField label="箱类型 COC/SOC" field="container_owner" editing={editing} value={ed("container_owner")} displayValue={order.container_owner} onChange={setEd} options={CONTAINER_OWNERS} />
              <EditField label="船名 Vessel" field="vessel" editing={editing} value={ed("vessel")} displayValue={order.vessel} onChange={setEd} />
              <EditField label="航次 Voyage" field="voyage" editing={editing} value={ed("voyage")} displayValue={order.voyage} onChange={setEd} />
              <EditField label="码头 Terminal" field="terminal" editing={editing} value={ed("terminal")} displayValue={order.terminal} onChange={setEd} />
              <div />
              <EditField label="ETD 预计开船" field="etd" type="date" editing={editing} value={ed("etd")} displayValue={order.etd} onChange={setEd} />
              <EditField label="ATD 实际开船" field="atd" type="date" editing={editing} value={ed("atd")} displayValue={order.atd} onChange={setEd} />
              <EditField label="ETA 预计到港" field="eta" type="date" editing={editing} value={ed("eta")} displayValue={order.eta} onChange={setEd} />
              <div />
              <EditField label="截单时间 SI Cutoff" field="si_cutoff" type="datetime-local" editing={editing} value={ed("si_cutoff")} displayValue={order.si_cutoff} onChange={setEd} />
              <EditField label="截关时间 CY Cutoff" field="cy_cutoff" type="datetime-local" editing={editing} value={ed("cy_cutoff")} displayValue={order.cy_cutoff} onChange={setEd} />
            </div>
          </div>

          {/* Part 3: 提单信息 + Shipper/Consignee */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
            <div style={{ background: "#fff", borderRadius: 10, padding: 16, border: editing ? "2px solid #f59e0b" : "1px solid #e2e8f0" }}>
              <SectionHeader icon="📜" title="提单信息" accent="#f59e0b" />
              <EditField label="Booking No 订舱号" field="booking_no" editing={editing} value={ed("booking_no")} displayValue={order.booking_no} onChange={setEd} />
              <EditField label="E-Booking No" field="e_booking_no" editing={editing} value={ed("e_booking_no")} displayValue={order.e_booking_no} onChange={setEd} />
              <EditField label="MBL No 主提单号" field="mbl_no" editing={editing} value={ed("mbl_no")} displayValue={order.mbl_no} onChange={setEd} />
              <EditField label="提单形式 BL Type" field="bl_type" editing={editing} value={ed("bl_type")} displayValue={order.bl_type} onChange={setEd} options={BL_TYPES} />
              <EditField label="付款方式 Freight Terms" field="freight_terms" editing={editing} value={ed("freight_terms")} displayValue={order.freight_terms} onChange={setEd} options={FREIGHT_TERMS} />
              <EditField label="运输条款 Transport Terms" field="transport_terms" editing={editing} value={ed("transport_terms")} displayValue={order.transport_terms} onChange={setEd} options={TRANSPORT_TERMS} />
            </div>
            <div style={{ background: "#fff", borderRadius: 10, padding: 16, border: editing ? "2px solid #8b5cf6" : "1px solid #e2e8f0" }}>
              <SectionHeader icon="👤" title="Shipper / Consignee / Notify" accent="#8b5cf6" />
              <EditField label="Shipper 发货人" field="shipper" editing={editing} value={ed("shipper")} displayValue={order.shipper} onChange={setEd} />
              <EditField label="Consignee 收货人" field="consignee" editing={editing} value={ed("consignee")} displayValue={order.consignee} onChange={setEd} />
              <EditField label="Notify Party 通知方" field="notify_party" editing={editing} value={ed("notify_party")} displayValue={order.notify_party} onChange={setEd} />
            </div>
          </div>

          {/* Part 4: 货物明细 */}
          <div style={{ background: "#fff", borderRadius: 10, padding: 16, border: "2px solid #10b981", marginBottom: 14 }}>
            <SectionHeader icon="📦" title="货物明细" accent="#10b981"
              right={
                cargoItems.length > 0 && !editingCargo ? (
                  <Button small variant="secondary" onClick={startCargoEdit} style={{ marginRight: 8 }}>✎ 编辑明细</Button>
                ) : editingCargo ? (
                  <div style={{ display: "flex", gap: 4, marginRight: 8 }}>
                    <Button small onClick={saveCargoEdit}>✓ 保存</Button>
                    <Button small variant="secondary" onClick={cancelCargoEdit}>✕ 取消</Button>
                  </div>
                ) : null
              }
            />

            {/* Shipment-level summary */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0 24px", marginBottom: 12, padding: 10, background: "#f8fafc", borderRadius: 8 }}>
              <Field label="品名 Description" value={order.tuc} />
              <Field label="SKU" value={order.sku} />
              <Field label="件数 Packages" value={order.qty_packages} />
              <Field label="毛重 Weight (KGS)" value={order.weight} />
              <Field label="体积 Volume (CBM)" value={order.volume} />
              <Field label="唛头 Marks" value={order.marks} />
            </div>

            {/* Container items table */}
            {(editingCargo ? cargoEdits : cargoItems).length > 0 && (
              <>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#065f46", marginBottom: 6 }}>
                  装柜明细{editingCargo ? "（编辑中）" : "（实际数据）"}
                </div>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                    <thead><tr style={{ background: "#ecfdf5" }}>
                      {["B/L", "HBL", "柜号 CNTR", "封号 Seal", "品名 Description", "唛头 Marks", "件数 QTY", "毛重 KGS", "体积 CBM"].map(h =>
                        <th key={h} style={{ padding: "6px 6px", textAlign: "left", fontWeight: 600, color: "#065f46", fontSize: 10, borderBottom: "2px solid #a7f3d0", whiteSpace: "nowrap" }}>{h}</th>
                      )}
                    </tr></thead>
                    <tbody>
                      {(editingCargo ? cargoEdits : cargoItems).map(it => (
                        <tr key={it.id} style={{ borderBottom: "1px solid #d1fae5" }}>
                          <td style={{ padding: "5px 6px", fontFamily: "'DM Mono',monospace", fontSize: 10 }}>
                            {order.mbl_no || order.booking_no || "—"}
                          </td>
                          {editingCargo ? (
                            <>
                              <CargoCell id={it.id} field="hbl" value={it.hbl} onChange={updateCargoItem} />
                              <CargoCell id={it.id} field="container_no" value={it.container_no} onChange={updateCargoItem} />
                              <CargoCell id={it.id} field="seal_no" value={it.seal_no} onChange={updateCargoItem} />
                              <CargoCell id={it.id} field="tuc" value={it.tuc} onChange={updateCargoItem} wide />
                              <CargoCell id={it.id} field="marks" value={it.marks} onChange={updateCargoItem} />
                              <CargoCell id={it.id} field="qty" value={it.qty} onChange={updateCargoItem} num />
                              <CargoCell id={it.id} field="weight" value={it.weight} onChange={updateCargoItem} num />
                              <CargoCell id={it.id} field="volume" value={it.volume} onChange={updateCargoItem} num />
                            </>
                          ) : (
                            <>
                              <td style={{ padding: "5px 6px", fontFamily: "'DM Mono',monospace", fontSize: 10 }}>{it.hbl || "—"}</td>
                              <td style={{ padding: "5px 6px", fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#0369a1" }}>{it.container_no || "—"}</td>
                              <td style={{ padding: "5px 6px", fontSize: 10 }}>{it.seal_no || "—"}</td>
                              <td style={{ padding: "5px 6px", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.tuc || "—"}</td>
                              <td style={{ padding: "5px 6px" }}>{it.marks || "—"}</td>
                              <td style={{ padding: "5px 6px", textAlign: "right" }}>{it.qty || "—"}</td>
                              <td style={{ padding: "5px 6px", textAlign: "right" }}>{it.weight || "—"}</td>
                              <td style={{ padding: "5px 6px", textAlign: "right" }}>{it.volume || "—"}</td>
                            </>
                          )}
                        </tr>
                      ))}
                      <tr style={{ background: "#ecfdf5", fontWeight: 700 }}>
                        <td colSpan={6} style={{ padding: "6px", textAlign: "right", fontSize: 10, color: "#065f46" }}>合计</td>
                        <td style={{ padding: "6px", textAlign: "right", fontSize: 10 }}>{(editingCargo ? cargoEdits : cargoItems).reduce((s, i) => s + (Number(i.qty) || 0), 0)}</td>
                        <td style={{ padding: "6px", textAlign: "right", fontSize: 10 }}>{(editingCargo ? cargoEdits : cargoItems).reduce((s, i) => s + (Number(i.weight) || 0), 0).toFixed(4)}</td>
                        <td style={{ padding: "6px", textAlign: "right", fontSize: 10 }}>{(editingCargo ? cargoEdits : cargoItems).reduce((s, i) => s + (Number(i.volume) || 0), 0).toFixed(4)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </>
            )}
            {cargoItems.length === 0 && !editingCargo && <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>暂无装柜明细 — 请在「柜子」模块中录入</div>}
          </div>
        </>
      )}

      {tab === "charges" && (
        <div style={{ background: "#fff", borderRadius: 10, padding: 16, border: "1px solid #e2e8f0" }}>
          <SectionHeader icon="💰" title="费用 & 账单" accent="#f59e0b" />
          <EmptyState>费用模块 — Phase 2 开发中</EmptyState>
        </div>
      )}
    </div>
  );
}

// ── Cargo cell editor (top-level component, no focus loss) ────────
function CargoCell({ id, field, value, onChange, num, wide }) {
  return (
    <td style={{ padding: "3px 4px" }}>
      <input
        value={value ?? ""}
        onChange={(e) => onChange(id, field, num ? e.target.value : e.target.value)}
        style={{
          width: "100%", padding: "3px 5px", borderRadius: 4,
          border: "1px solid #a7f3d0", background: "#f0fdf4",
          fontSize: 10, outline: "none", boxSizing: "border-box",
          fontFamily: num ? "'DM Mono',monospace" : "inherit",
          textAlign: num ? "right" : "left",
          minWidth: wide ? 120 : 60,
        }}
      />
    </td>
  );
}

// =========================================================================
// New Order Modal
// =========================================================================
function NewOrderModal({ onClose, onSaved }) {
  const [form, setForm] = useState({ po: "", customer_po: "", supplier: "", customer: "", carrier: "", carrier_agent: "", vessel: "", pol: "", pod: "", etd: "", incoterms: "FOB", booking_no: "", e_booking_no: "" });
  const [refData, setRefData] = useState({ suppliers: [], customers: [], ports: [] });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      supabase.from("suppliers").select("name").order("name"),
      supabase.from("customers").select("name").order("name"),
      supabase.from("ports").select("name").order("name"),
    ]).then(([s, c, p]) => {
      setRefData({ suppliers: (s.data || []).map(r => r.name), customers: (c.data || []).map(r => r.name), ports: (p.data || []).map(r => r.name) });
    });
  }, []);

  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  const save = async () => {
    if (!form.po && !form.customer_po) { alert("PO or Customer PO required"); return; }
    setSaving(true);
    const data = { ...form };
    for (const k of Object.keys(data)) { if (data[k] === "") data[k] = null; }
    const { error } = await supabase.from("shipments").insert(data);
    if (error) { alert(error.message); setSaving(false); return; }
    setSaving(false);
    onSaved();
  };

  return (
    <Modal onClose={onClose} title={t("New Order")} width={750}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
        <Input label="PO#" value={form.po} onChange={e => set("po", e.target.value)} />
        <Input label="Customer PO#" value={form.customer_po} onChange={e => set("customer_po", e.target.value)} />
        <div>
          <div style={{ fontSize: 10, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>{t("Supplier")}</div>
          <ComboBox value={form.supplier} onChange={v => set("supplier", v)} options={refData.suppliers} placeholder="搜索委托方..." />
        </div>
        <div>
          <div style={{ fontSize: 10, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>{t("Customer")}</div>
          <ComboBox value={form.customer} onChange={v => set("customer", v)} options={refData.customers} placeholder="搜索客户..." />
        </div>
        <Input label={t("Carrier")} value={form.carrier} onChange={e => set("carrier", e.target.value)} />
        <Input label={t("Agent")} value={form.carrier_agent} onChange={e => set("carrier_agent", e.target.value)} />
        <Input label={t("Vessel")} value={form.vessel} onChange={e => set("vessel", e.target.value)} />
        <div>
          <div style={{ fontSize: 10, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>{t("POL")}</div>
          <ComboBox value={form.pol} onChange={v => set("pol", v)} options={refData.ports} placeholder="搜索港口..." />
        </div>
        <div>
          <div style={{ fontSize: 10, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>{t("POD")}</div>
          <ComboBox value={form.pod} onChange={v => set("pod", v)} options={refData.ports} placeholder="搜索港口..." />
        </div>
        <Input label="ETD" type="date" value={form.etd} onChange={e => set("etd", e.target.value)} />
        <div>
          <div style={{ fontSize: 10, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>{t("Trade Terms")}</div>
          <ComboBox value={form.incoterms} onChange={v => set("incoterms", v)} options={TRADE_TERMS} placeholder="选择..." />
        </div>
        <Input label={t("Booking No")} value={form.booking_no} onChange={e => set("booking_no", e.target.value)} />
        <Input label="E-Booking" value={form.e_booking_no} onChange={e => set("e_booking_no", e.target.value)} />
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
        <Button variant="secondary" onClick={onClose}>{t("Cancel")}</Button>
        <Button onClick={save} disabled={saving}>{saving ? "..." : t("Save")}</Button>
      </div>
    </Modal>
  );
}
