import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "../supabase.js";
import { Badge, Field, SectionHeader, Modal, Button, Input, Select, Spinner, EmptyState, FilterDropdown } from "../components/ui.jsx";
import { t } from "../lib/i18n.js";
import { STATUS_CONFIGS, STATUS_COLORS, TRADE_TERMS, CONTAINER_TYPES, CONTAINER_OWNERS, BL_TYPES, FREIGHT_TERMS, TRANSPORT_TERMS, CARGO_TYPES, SERVICE_TYPES } from "../lib/constants.js";

export function OrdersPage({ user }) {
  const role = user.profile?.role || "operator";
  const [shipments, setShipments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState({ qc_status: "All", space_status: "All", carrier: "All", customer: "All" });
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);

  const load = useCallback(async () => {
    const { data } = await supabase.from("shipments").select("*").order("created_at", { ascending: false });
    setShipments(data || []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  const customerList = useMemo(() => [...new Set(shipments.map(o => o.customer).filter(Boolean))].sort(), [shipments]);
  const carrierList = useMemo(() => [...new Set(shipments.map(o => o.carrier).filter(Boolean))].sort(), [shipments]);

  const filtered = useMemo(() => shipments.filter(o => {
    if (filters.qc_status !== "All" && o.qc_status !== filters.qc_status) return false;
    if (filters.space_status !== "All" && o.space_status !== filters.space_status) return false;
    if (filters.carrier !== "All" && o.carrier !== filters.carrier) return false;
    if (filters.customer !== "All" && o.customer !== filters.customer) return false;
    if (search) {
      const q = search.toLowerCase();
      const fields = [o.po, o.customer_po, o.booking_no, o.container_no, o.vessel, o.supplier, o.order_no].filter(Boolean);
      if (!fields.some(f => f.toLowerCase().includes(q))) return false;
    }
    return true;
  }), [shipments, filters, search]);

  useEffect(() => { setPage(0); }, [filters, search]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pagedRows = filtered.slice(page * pageSize, (page + 1) * pageSize);

  const selectedOrder = shipments.find(o => o.id === selectedId);

  if (loading) return <Spinner />;

  if (selectedOrder) {
    return <OrderDetail order={selectedOrder} role={role} user={user} onBack={() => { setSelectedId(null); load(); }} onReload={load} />;
  }

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 14 }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>{t("Orders")} <span style={{ fontSize: 13, color: "#94a3b8", fontWeight: 400 }}>— {t("Sea Export")}</span></h1>
          <p style={{ fontSize: 12, color: "#94a3b8", margin: "3px 0 0" }}>{filtered.length} {t("records")}</p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Button onClick={() => setShowNew(true)}>+ {t("New Order")}</Button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        <Input placeholder={t("Search") + "..."} value={search} onChange={e => setSearch(e.target.value)} style={{ width: 220 }} />
        <FilterDropdown label="QC" value={filters.qc_status} options={STATUS_CONFIGS.qc_status.options} onChange={v => setFilters(p => ({ ...p, qc_status: v }))} />
        <FilterDropdown label="Space" value={filters.space_status} options={STATUS_CONFIGS.space_status.options} onChange={v => setFilters(p => ({ ...p, space_status: v }))} />
        <FilterDropdown label="Carrier" value={filters.carrier} options={carrierList} onChange={v => setFilters(p => ({ ...p, carrier: v }))} />
        <FilterDropdown label="Customer" value={filters.customer} options={customerList} onChange={v => setFilters(p => ({ ...p, customer: v }))} />
      </div>

      {/* Table */}
      <div style={{ background: "#fff", borderRadius: 10, border: "1px solid #e2e8f0", overflow: "hidden" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead><tr style={{ background: "#f8fafc" }}>
            {[t("Order No"), "PO", "Cust PO", t("Supplier"), t("Customer"), t("Carrier"), t("Vessel"), "ETD", t("QC"), t("Space"), t("Status")].map(h =>
              <th key={h} style={{ padding: "10px 8px", textAlign: "left", fontWeight: 600, color: "#64748b", fontSize: 10.5, borderBottom: "1px solid #e2e8f0" }}>{h}</th>
            )}
          </tr></thead>
          <tbody>
            {pagedRows.length === 0 && <tr><td colSpan={11} style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>{t("No data")}</td></tr>}
            {pagedRows.map((o, i) => (
              <tr key={o.id} onClick={() => setSelectedId(o.id)} style={{ cursor: "pointer", borderBottom: i < pagedRows.length - 1 ? "1px solid #f1f5f9" : "none" }}
                onMouseEnter={e => e.currentTarget.style.background = "#f8fafc"} onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                <td style={{ padding: "8px", fontFamily: "'DM Mono',monospace", fontWeight: 600, color: "#0369a1" }}>{o.order_no || "—"}</td>
                <td style={{ padding: "8px", fontFamily: "'DM Mono',monospace" }}>{o.po || "—"}</td>
                <td style={{ padding: "8px", fontFamily: "'DM Mono',monospace" }}>{o.customer_po || "—"}</td>
                <td style={{ padding: "8px" }}>{o.supplier || "—"}</td>
                <td style={{ padding: "8px" }}>{o.customer || "—"}</td>
                <td style={{ padding: "8px" }}>{o.carrier || "—"}</td>
                <td style={{ padding: "8px", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.vessel || "—"}</td>
                <td style={{ padding: "8px", fontFamily: "'DM Mono',monospace" }}>{o.etd || "—"}</td>
                <td style={{ padding: "8px" }}>{o.qc_status ? <Badge value={o.qc_status} small /> : "—"}</td>
                <td style={{ padding: "8px" }}>{o.space_status ? <Badge value={o.space_status} small /> : "—"}</td>
                <td style={{ padding: "8px" }}>{o.bl_status ? <Badge value={o.bl_status} small /> : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, fontSize: 12 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: "#64748b" }}>{t("per page")}</span>
          <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(0); }} style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid #e2e8f0", fontSize: 12, outline: "none" }}>
            {[20, 50, 100, 200].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <span style={{ color: "#94a3b8" }}>{filtered.length} {t("records")} · {page + 1}/{totalPages}</span>
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
// Order Detail — Page 1: order info, Page 2: charges
// =========================================================================
function OrderDetail({ order, role, user, onBack, onReload }) {
  const [tab, setTab] = useState("info");
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState({});
  const [refData, setRefData] = useState({ suppliers: [], customers: [], ports: [] });
  const [cargoItems, setCargoItems] = useState([]);

  useEffect(() => {
    Promise.all([
      supabase.from("suppliers").select("name").order("name"),
      supabase.from("customers").select("name").order("name"),
      supabase.from("ports").select("name").order("name"),
    ]).then(([s, c, p]) => {
      setRefData({ suppliers: (s.data || []).map(r => r.name), customers: (c.data || []).map(r => r.name), ports: (p.data || []).map(r => r.name) });
    });
    // Load container_items as cargo detail
    if (order.po || order.customer_po) {
      const q = order.po && order.customer_po
        ? supabase.from("container_items").select("*").eq("po", order.po).eq("customer_po", String(order.customer_po))
        : order.customer_po
          ? supabase.from("container_items").select("*").eq("customer_po", String(order.customer_po))
          : supabase.from("container_items").select("*").eq("po", order.po);
      q.then(({ data }) => setCargoItems(data || []));
    }
  }, [order.id]);

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
  const ed = (f) => editing ? (editData[f] ?? "") : null;
  const setEd = (f, v) => setEditData(p => ({ ...p, [f]: v }));

  const EF = ({ label, field, type, options }) => {
    if (!editing) return <Field label={label} value={order[field]} />;
    if (options) return (
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: "#8896a7", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 3 }}>{label}</div>
        <select value={ed(field)} onChange={e => setEd(field, e.target.value)} style={{ width: "100%", padding: "5px 8px", borderRadius: 5, border: "1px solid #bae6fd", background: "#f0f9ff", fontSize: 12, fontWeight: 600, outline: "none", color: "#0c4a6e", boxSizing: "border-box" }}>
          <option value="">—</option>{options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
    );
    return (
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 10, fontWeight: 600, color: "#8896a7", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 3 }}>{label}</div>
        <input type={type || "text"} value={ed(field)} onChange={e => setEd(field, e.target.value)} style={{ width: "100%", padding: "5px 8px", borderRadius: 5, border: "1px solid #bae6fd", background: "#f0f9ff", fontSize: 12, fontWeight: 600, outline: "none", color: "#0c4a6e", boxSizing: "border-box", fontFamily: "'DM Mono',monospace" }} />
      </div>
    );
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
              <EF label="订单编号" field="order_no" />
              <EF label="委托单位" field="supplier" options={refData.suppliers} />
              <EF label="贸易条款" field="incoterms" options={TRADE_TERMS} />
              <EF label="货物类型" field="cargo_type" options={CARGO_TYPES.map(c => c.label)} />
              <EF label="PO#（业务编号）" field="po" />
              <EF label="Customer PO#（客户业务编号）" field="customer_po" />
              <EF label="客户" field="customer" options={refData.customers} />
              <EF label="终端客户" field="end_customer" />
            </div>
          </div>

          {/* Part 2: 运输信息 */}
          <div style={{ background: "#fff", borderRadius: 10, padding: 16, border: editing ? "2px solid #6366f1" : "1px solid #e2e8f0", marginBottom: 14 }}>
            <SectionHeader icon="🚢" title="运输信息" accent="#6366f1" />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0 24px" }}>
              <EF label="船公司 Carrier" field="carrier" />
              <EF label="订舱代理 Agent" field="carrier_agent" />
              <EF label="起运港 POL" field="pol" options={refData.ports} />
              <EF label="卸货港 POD" field="pod" options={refData.ports} />
              <EF label="目的港 Destination" field="destination" />
              <EF label="箱量" field="qty_container" />
              <EF label="箱型 Container Type" field="container_type" options={CONTAINER_TYPES} />
              <EF label="箱类型 COC/SOC" field="container_owner" options={CONTAINER_OWNERS} />
              <EF label="船名 Vessel" field="vessel" />
              <EF label="航次 Voyage" field="voyage" />
              <EF label="码头 Terminal" field="terminal" />
              <div />
              <EF label="ETD 预计开船" field="etd" type="date" />
              <EF label="ATD 实际开船" field="atd" type="date" />
              <EF label="ETA 预计到港" field="eta" type="date" />
              <div />
              <EF label="截单时间 SI Cutoff" field="si_cutoff" type="datetime-local" />
              <EF label="截关时间 CY Cutoff" field="cy_cutoff" type="datetime-local" />
            </div>
          </div>

          {/* Part 3: 提单信息 */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14 }}>
            <div style={{ background: "#fff", borderRadius: 10, padding: 16, border: editing ? "2px solid #f59e0b" : "1px solid #e2e8f0" }}>
              <SectionHeader icon="📜" title="提单信息" accent="#f59e0b" />
              <EF label="Booking No 订舱号" field="booking_no" />
              <EF label="E-Booking No" field="e_booking_no" />
              <EF label="MBL No 主提单号" field="mbl_no" />
              <EF label="提单形式 BL Type" field="bl_type" options={BL_TYPES} />
              <EF label="付款方式 Freight Terms" field="freight_terms" options={FREIGHT_TERMS} />
              <EF label="运输条款 Transport Terms" field="transport_terms" options={TRANSPORT_TERMS} />
            </div>
            <div style={{ background: "#fff", borderRadius: 10, padding: 16, border: editing ? "2px solid #8b5cf6" : "1px solid #e2e8f0" }}>
              <SectionHeader icon="👤" title="Shipper / Consignee / Notify" accent="#8b5cf6" />
              <EF label="Shipper 发货人" field="shipper" />
              <EF label="Consignee 收货人" field="consignee" />
              <EF label="Notify Party 通知方" field="notify_party" />
            </div>
          </div>

          {/* Part 4: 货物明细 — 多行表格 */}
          <div style={{ background: "#fff", borderRadius: 10, padding: 16, border: "2px solid #10b981", marginBottom: 14 }}>
            <SectionHeader icon="📦" title="货物明细" accent="#10b981" />

            {/* 原始数据（shipment 上的） */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0 24px", marginBottom: 12, padding: 10, background: "#f8fafc", borderRadius: 8 }}>
              <Field label="品名 Description" value={order.tuc} />
              <Field label="SKU" value={order.sku} />
              <Field label="件数 Packages" value={order.qty_packages} />
              <Field label="毛重 Weight (KGS)" value={order.weight} />
              <Field label="体积 Volume (CBM)" value={order.volume} />
              <Field label="唛头 Marks" value={order.marks} />
            </div>

            {/* 装柜明细（从 container_items） */}
            {cargoItems.length > 0 && (
              <>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#065f46", marginBottom: 6 }}>装柜明细（实际数据）</div>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                    <thead><tr style={{ background: "#ecfdf5" }}>
                      {["B/L", "HBL", "柜号 CNTR", "封号 Seal", "品名 Description", "唛头 Marks", "件数 QTY", "毛重 KGS", "体积 CBM"].map(h =>
                        <th key={h} style={{ padding: "6px 6px", textAlign: "left", fontWeight: 600, color: "#065f46", fontSize: 10, borderBottom: "2px solid #a7f3d0", whiteSpace: "nowrap" }}>{h}</th>
                      )}
                    </tr></thead>
                    <tbody>
                      {cargoItems.map(it => (
                        <tr key={it.id} style={{ borderBottom: "1px solid #d1fae5" }}>
                          <td style={{ padding: "5px 6px", fontFamily: "'DM Mono',monospace", fontSize: 10 }}>{order.mbl_no || order.booking_no || "—"}</td>
                          <td style={{ padding: "5px 6px", fontFamily: "'DM Mono',monospace", fontSize: 10 }}>{it.hbl || "—"}</td>
                          <td style={{ padding: "5px 6px", fontFamily: "'DM Mono',monospace", fontSize: 10, color: "#0369a1" }}>{it.container_no || "—"}</td>
                          <td style={{ padding: "5px 6px", fontSize: 10 }}>{it.seal_no || "—"}</td>
                          <td style={{ padding: "5px 6px", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.tuc || "—"}</td>
                          <td style={{ padding: "5px 6px" }}>{it.marks || "—"}</td>
                          <td style={{ padding: "5px 6px", textAlign: "right" }}>{it.qty || "—"}</td>
                          <td style={{ padding: "5px 6px", textAlign: "right" }}>{it.weight || "—"}</td>
                          <td style={{ padding: "5px 6px", textAlign: "right" }}>{it.volume || "—"}</td>
                        </tr>
                      ))}
                      <tr style={{ background: "#ecfdf5", fontWeight: 700 }}>
                        <td colSpan={6} style={{ padding: "6px", textAlign: "right", fontSize: 10, color: "#065f46" }}>合计</td>
                        <td style={{ padding: "6px", textAlign: "right", fontSize: 10 }}>{cargoItems.reduce((s, i) => s + (Number(i.qty) || 0), 0)}</td>
                        <td style={{ padding: "6px", textAlign: "right", fontSize: 10 }}>{cargoItems.reduce((s, i) => s + (Number(i.weight) || 0), 0).toFixed(4)}</td>
                        <td style={{ padding: "6px", textAlign: "right", fontSize: 10 }}>{cargoItems.reduce((s, i) => s + (Number(i.volume) || 0), 0).toFixed(4)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </>
            )}
            {cargoItems.length === 0 && <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>暂无装柜明细 — 请在「柜子」模块中录入</div>}
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
        <Select label={t("Supplier")} value={form.supplier} onChange={e => set("supplier", e.target.value)} options={refData.suppliers} />
        <Select label={t("Customer")} value={form.customer} onChange={e => set("customer", e.target.value)} options={refData.customers} />
        <Input label={t("Carrier")} value={form.carrier} onChange={e => set("carrier", e.target.value)} />
        <Input label={t("Agent")} value={form.carrier_agent} onChange={e => set("carrier_agent", e.target.value)} />
        <Input label={t("Vessel")} value={form.vessel} onChange={e => set("vessel", e.target.value)} />
        <Select label={t("POL")} value={form.pol} onChange={e => set("pol", e.target.value)} options={refData.ports} />
        <Select label={t("POD")} value={form.pod} onChange={e => set("pod", e.target.value)} options={refData.ports} />
        <Input label="ETD" type="date" value={form.etd} onChange={e => set("etd", e.target.value)} />
        <Select label={t("Trade Terms")} value={form.incoterms} onChange={e => set("incoterms", e.target.value)} options={TRADE_TERMS} />
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
