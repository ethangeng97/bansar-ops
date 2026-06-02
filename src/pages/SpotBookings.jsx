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
import { TmsTitle, Mi, Tbl, TmsInfoBar, TmsPagination, ModalShell } from "../components/tms.jsx";
import SpotBookingImportModal from "../components/SpotBookingImportModal.jsx";
import { COMMON_CARRIERS } from "../lib/carriers.js";
import { getCachedRef } from "../lib/ref-cache.js";
import { numQty, recalcSpotStatus } from "../lib/spot-inventory.js";

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
  { k: "booking_no", w: 120, label: "订舱号" },
  { k: "carrier",    w: 80,  label: "船公司" },
  { k: "vessel",     w: 160, label: "船名 / 航次" },
  { k: "pol",        w: 100, label: "POL" },
  { k: "pod",        w: 100, label: "POD" },
  { k: "container",  w: 80,  label: "柜型" },
  { k: "total",      w: 60,  label: "总数",   align: "right" },
  { k: "sold",       w: 60,  label: "已售",   align: "right" },
  { k: "left",       w: 60,  label: "剩余",   align: "right" },
  { k: "etd",        w: 90,  label: "ETD" },
  { k: "days",       w: 80,  label: "离船期" },
  { k: "si",         w: 110, label: "SI 截单" },
  { k: "booking_agent", w: 120, label: "订舱代理" },
  { k: "partner",    w: 140, label: "关联客户/代理" },
  { k: "price",      w: 130, label: "售价区间" },
  { k: "status",     w: 80,  label: "状态",   center: true },
  { k: "act",        w: 180, label: "操作",   center: true },
];
const COL_WIDTHS_KEY = "bansar_spot_col_widths_v1";

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
  const [importOpen, setImportOpen] = useState(false);
  const [page, setPage] = useState(0);
  const pageSize = 50;

  // 列宽：可拖拽 + localStorage 持久化（双击 reset）
  const [colWidths, setColWidths] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(COL_WIDTHS_KEY) || "{}");
      return Object.fromEntries(COLS.map(c => [c.k, saved[c.k] || c.w]));
    } catch {
      return Object.fromEntries(COLS.map(c => [c.k, c.w]));
    }
  });
  const startColResize = (colKey, e) => {
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX;
    const startW = colWidths[colKey];
    const onMove = (ev) => {
      const newW = Math.max(40, startW + (ev.clientX - startX));
      setColWidths(p => ({ ...p, [colKey]: newW }));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      setColWidths(latest => {
        try { localStorage.setItem(COL_WIDTHS_KEY, JSON.stringify(latest)); } catch {}
        return latest;
      });
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };
  const resetColWidth = (colKey) => {
    const def = COLS.find(c => c.k === colKey);
    if (!def) return;
    const next = { ...colWidths, [colKey]: def.w };
    setColWidths(next);
    try { localStorage.setItem(COL_WIDTHS_KEY, JSON.stringify(next)); } catch {}
  };
  const colsWithW = COLS.map(c => ({ ...c, w: colWidths[c.k] }));
  const totalW = colsWithW.reduce((a, c) => a + c.w, 0);

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
  const [customerPartyMap, setCustomerPartyMap] = useState({});
  useEffect(() => {
    // 全部 partner_type 都拉（客户 / 海外代理 / 订舱代理...）给现舱关联用
    supabase.from("customers").select("id, name, name_short, partner_type").order("name").then(({ data }) => {
      setCustomers(data || []);
    });
    // 客户常用 shipper/consignee 记忆 —— 划走时自动带
    getCachedRef("customer_party_map").then(map => setCustomerPartyMap(map || {}));
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
      const soldHere = (shipmentsBySpot[r.id] || []).reduce((a, s) => a + numQty(s.qty_container), 0);
      total += Number(r.total_qty) || 0;
      sold  += Number(soldHere)    || 0;
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
        <Mi onClick={() => setImportOpen(true)}>📥 批量导入</Mi>
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
               onChange={e => setFilters({ ...filters, carrier: e.target.value.toUpperCase() })}
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
          <table style={{ minWidth: totalW }}>
            <colgroup>
              {colsWithW.map(c => <col key={c.k} style={{ width: c.w }} />)}
            </colgroup>
            <thead>
              <tr>
                {colsWithW.map(c => (
                  <th key={c.k} className={c.center ? "center" : ""} style={{ position: "relative", textAlign: c.align || (c.center ? "center" : "left") }}>
                    <span className="ht">{c.label}</span>
                    <span className="col-resize"
                          onMouseDown={e => startColResize(c.k, e)}
                          onDoubleClick={() => resetColWidth(c.k)}
                          aria-hidden="true" />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paged.map((r, i) => {
                const soldShips = shipmentsBySpot[r.id] || [];
                const soldQty = soldShips.reduce((a, s) => a + numQty(s.qty_container), 0);
                const remaining = Math.max(0, (r.total_qty || 0) - soldQty);
                const daysToEtd = daysBetween(today, r.etd);
                const sc = STATUS_BG[r.status] || STATUS_BG["可售"];
                const daysColor = daysToEtd != null && daysToEtd >= 0 && daysToEtd <= 3 && remaining > 0
                                   ? "#cf1322" : "#666";
                return (
                  <tr key={r.id} className={i % 2 ? "ev" : ""}>
                    <td style={{ fontFamily: "Consolas,monospace", fontSize: 12 }}>{r.booking_no || "—"}</td>
                    <td>{r.carrier || "—"}</td>
                    <td>{r.vessel || "—"}{r.voyage ? ` / ${r.voyage}` : ""}</td>
                    <td>{r.pol || "—"}</td>
                    <td>{r.pod || "—"}</td>
                    <td>{r.container_size || ""}{r.container_type || ""}</td>
                    <td style={{ textAlign: "right" }}><b>{r.total_qty || 0}</b></td>
                    <td style={{ textAlign: "right", color: "#52c41a", fontWeight: 600 }}>{soldQty}</td>
                    <td style={{ textAlign: "right", color: remaining > 0 ? "#1990FF" : "#bbb", fontWeight: 600 }}>{remaining}</td>
                    <td>{fmtDate(r.etd)}</td>
                    <td style={{ color: daysColor, fontSize: 12 }}>
                      {daysToEtd == null ? "—" : daysToEtd < 0 ? `过 ${-daysToEtd}天` : daysToEtd === 0 ? "今天" : `${daysToEtd}天后`}
                    </td>
                    <td style={{ fontSize: 12 }}>{fmtDateTime(r.si_cutoff)}</td>
                    <td style={{ fontSize: 12 }} title={r.booking_agent_name || ""}>{r.booking_agent_name || "—"}</td>
                    <td style={{ fontSize: 12 }} title={r.partner_name || ""}>{r.partner_name || "—"}</td>
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
                        <div style={{ marginTop: 4, fontSize: 11, lineHeight: 1.5 }}>
                          {soldShips.map(s => (
                            <a key={s.id} href={`#/sea_export?id=${s.id}`} target="_blank" rel="noopener"
                               className="lk" style={{ display: "block", color: "#666" }}
                               title={`${s.order_no} → ${s.customer || "—"} (${numQty(s.qty_container)}柜)`}>
                              {s.order_no} <span style={{ color: "#999" }}>· {s.customer || "—"}</span>
                            </a>
                          ))}
                        </div>
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
          customers={customers}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
      {allocating && (
        <AllocateModal
          spot={allocating}
          soldQty={(shipmentsBySpot[allocating.id] || []).reduce((a, s) => a + numQty(s.qty_container), 0)}
          customers={customers}
          customerPartyMap={customerPartyMap}
          onClose={() => setAllocating(null)}
          onAllocated={() => { setAllocating(null); load(); }}
        />
      )}
      <SpotBookingImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={load}
      />
    </div>
  );
}

// ─── 新建 / 编辑现舱 ───────────────────────────────────────────
function SpotEditor({ spot, customers, onClose, onSaved }) {
  const [form, setForm] = useState(() => spot ? { ...spot } : {
    carrier: "", vessel: "", voyage: "", route: "", pol: "", pod: "",
    etd: "", eta: "",
    container_size: "40", container_type: "HC", total_qty: 1,
    si_cutoff: null, vgm_cutoff: null, customs_cutoff: null, port_cutoff: null,
    purchase_price: null, sell_price_min: null, sell_price_max: null, currency: "USD",
    booking_no: "", mbl_no: "",
    partner_id: null, partner_name: "",
    booking_agent_id: null, booking_agent_name: "",
    status: "可售", notes: "",
  });
  const [saving, setSaving] = useState(false);
  const ch = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const isNew = !spot;

  const save = async () => {
    if (!form.carrier || !form.pol || !form.pod) { alert("船公司 / POL / POD 必填"); return; }
    setSaving(true);

    // 互斥校验：新建 / 改 booking_no 时，订舱号不能在另一张表已存在
    const bn = (form.booking_no || "").trim();
    if (bn) {
      const bnChanged = isNew || bn !== (spot?.booking_no || "");
      if (bnChanged) {
        // 1) 查 spot_bookings（自己除外）
        const { data: spotHit } = await supabase.from("spot_bookings")
          .select("id, booking_no, carrier").eq("booking_no", bn).limit(1);
        if (spotHit && spotHit.length > 0 && spotHit[0].id !== spot?.id) {
          setSaving(false);
          alert(`订舱号 ${bn} 已存在于现舱表（${spotHit[0].carrier}）`);
          return;
        }
        // 2) 查 shipments（booking_no 或 mbl_no）
        const { data: shipHit } = await supabase.from("shipments")
          .select("order_no, booking_no, mbl_no")
          .or(`booking_no.eq."${bn}",mbl_no.eq."${bn}"`).limit(1);
        if (shipHit && shipHit.length > 0) {
          setSaving(false);
          alert(`订舱号 ${bn} 已是海运出口订单 ${shipHit[0].order_no}，跟现舱互斥，不能录入`);
          return;
        }
      }
    }

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
        <Fld label="船公司 *">
          <input style={fldInput} value={form.carrier} list="spot-carriers-dl" onChange={e => ch("carrier", e.target.value.toUpperCase())} />
          <datalist id="spot-carriers-dl">{COMMON_CARRIERS.map(c => <option key={c} value={c} />)}</datalist>
        </Fld>
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
        <Fld label="订舱代理（仅 ops 可见）" span={2}>
          <input style={fldInput} list="spot-booking-agents" value={form.booking_agent_name || ""}
                 onChange={e => {
                   const v = e.target.value;
                   ch("booking_agent_name", v);
                   const c = (customers || []).find(c => c.name === v);
                   ch("booking_agent_id", c?.id || null);
                 }}
                 placeholder="跟船公司订舱的中间人(可选)" />
          <datalist id="spot-booking-agents">
            {(customers || []).filter(c => c.partner_type === "订舱代理").map(c => (
              <option key={c.id} value={c.name}>{c.name_short || ""}</option>
            ))}
          </datalist>
        </Fld>
        <Fld label="关联客户 / 海外代理" span={2}>
          <input style={fldInput} list="spot-partners" value={form.partner_name || ""}
                 onChange={e => {
                   const v = e.target.value;
                   ch("partner_name", v);
                   const c = (customers || []).find(c => c.name === v);
                   ch("partner_id", c?.id || null);
                 }}
                 placeholder="输入客户/代理名（可选）" />
          <datalist id="spot-partners">
            {(customers || []).map(c => (
              <option key={c.id} value={c.name}>
                {c.partner_type || ""} · {c.name_short || ""}
              </option>
            ))}
          </datalist>
        </Fld>
        <Fld label="状态"><select style={fldInput} value={form.status || "可售"} onChange={e => ch("status", e.target.value)}>
          {STATUS_OPTS.map(s => <option key={s}>{s}</option>)}
        </select></Fld>
        <Fld label="备注" span={4}><textarea style={{ ...fldInput, minHeight: 60 }} value={form.notes || ""} onChange={e => ch("notes", e.target.value)} /></Fld>
      </Group>
    </ModalShell>
  );
}

// ─── 划给客户 ─────────────────────────────────────────────────
function AllocateModal({ spot, soldQty, customers, customerPartyMap, onClose, onAllocated }) {
  const remaining = Math.max(0, (spot.total_qty || 0) - soldQty);
  // 分配清单：可加多行，一次划给多个客户。订单号由系统在提交时生成，不要让用户填
  const [rows, setRows] = useState([
    { customerId: "", customerName: "", qty: remaining, sellPrice: spot.sell_price_max || "", po: "", notes: "" },
  ]);
  const [saving, setSaving] = useState(false);

  const totalAlloc = rows.reduce((a, r) => a + (parseInt(r.qty, 10) || 0), 0);
  const overAlloc = totalAlloc > remaining;

  const updateRow = (i, patch) => setRows(rs => rs.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  const addRow = () => {
    setRows(rs => [...rs, {
      customerId: "", customerName: "", qty: 1, sellPrice: spot.sell_price_max || "",
      po: "", notes: "",
    }]);
  };
  const removeRow = (i) => setRows(rs => rs.length > 1 ? rs.filter((_, idx) => idx !== i) : rs);

  const onCustomerChange = (i, name) => {
    const c = (customers || []).find(c => c.name === name);
    updateRow(i, { customerName: name, customerId: c?.id || "" });
  };

  const allocate = async () => {
    // 校验
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!r.customerName.trim()) { alert(`第 ${i+1} 行：请填客户`); return; }
      const q = parseInt(r.qty, 10);
      if (!q || q <= 0) { alert(`第 ${i+1} 行：柜数必须 >= 1`); return; }
    }
    if (overAlloc) { alert(`总分配 ${totalAlloc} 柜超过剩余 ${remaining} 柜`); return; }

    setSaving(true);
    // 提交时生成订单号序列：BSOEF + YYMM + 5位序号
    const now = new Date();
    const prefix = `BSOEF${String(now.getFullYear()).slice(2)}${String(now.getMonth()+1).padStart(2,"0")}`;
    // 严格只看 BSOEFYYMM + 5位数字 (允许 -N 分票后缀) 的合法订单号
    // 不能用旧的 regex /(\d+)(?:-\d+)?$/, 因为 greedy 会把 BSOEFYYMM 里的数字也抓进来
    const orderNoRe = new RegExp(`^${prefix}(\\d{5})(?:-\\d+)?$`);
    const { data: existing } = await supabase
      .from("shipments").select("order_no")
      .like("order_no", `${prefix}%`)
      .order("order_no", { ascending: false }).limit(50);
    let maxSeq = 0;
    for (const row of (existing || [])) {
      const m = (row.order_no || "").match(orderNoRe);
      if (m) {
        const s = parseInt(m[1], 10);
        if (s > maxSeq) maxSeq = s;
      }
    }
    const nextSeq = maxSeq + 1;
    // 批量构造 + 自动带客户常用 shipper/consignee/notify
    const payloads = rows.map((r, idx) => {
      const remembered = customerPartyMap?.[r.customerName] || {};
      const orderNo = `${prefix}${String(nextSeq + idx).padStart(5,"0")}`;
      return {
        business_type: "sea_export",
        shipment_type: "FCL",
        order_no: orderNo,
        po: r.po.trim() || null,
        customer: r.customerName,
        customer_id: r.customerId || null,
        carrier: spot.carrier, vessel: spot.vessel, voyage: spot.voyage,
        pol: spot.pol, pod: spot.pod,
        etd: spot.etd, eta: spot.eta,
        booking_no: spot.booking_no || null,
        mbl_no: spot.mbl_no || null,
        qty_container: parseInt(r.qty, 10),
        lifecycle: "处理中", finance_status: "未创建",
        has_hbl: true, solicit_type: "代理货",
        spot_booking_id: spot.id,
        shipper:       remembered.shipper       || null,
        consignee:     remembered.consignee     || null,
        notify_party:  remembered.notify_party  || null,
        internal_note: r.notes || null,
      };
    });
    const { data, error } = await supabase.from("shipments").insert(payloads).select();
    if (error) { setSaving(false); alert("批量创建失败：" + error.message); return; }
    // 重算现舱状态（统一走 helper，跟订单删除时退柜同套逻辑）
    await recalcSpotStatus(spot.id);
    setSaving(false);
    const orderList = (data || []).map((d, i) => `  ${i+1}) ${d.order_no} → ${rows[i].customerName} (${rows[i].qty}柜)`).join("\n");
    if (rows.length === 1 && confirm(`✓ 已划给 ${rows[0].customerName} ${rows[0].qty} 柜，新建订单 ${data?.[0]?.order_no}。\n\n马上打开新订单？`)) {
      window.open(`#/sea_export?id=${data[0].id}`, "_blank");
    } else if (rows.length > 1) {
      alert(`✓ 已批量创建 ${rows.length} 个订单：\n\n${orderList}`);
    }
    onAllocated?.();
  };

  return (
    <ModalShell title={`划给客户 — ${spot.carrier} ${spot.vessel || ""} ${spot.voyage || ""}`} onClose={onClose}
                actions={<>
                  <button onClick={onClose} style={modalBtnSecondary}>取消</button>
                  <button onClick={allocate} disabled={saving || remaining === 0 || overAlloc} style={modalBtnPrimary}>
                    {saving ? "处理中..." : `划走并建 ${rows.length} 个订单`}
                  </button>
                </>}>
      {/* 现舱信息 */}
      <div style={{ marginBottom: 12, padding: 12, background: "#e6f4ff", border: "1px solid #c8dfff", borderRadius: 4, fontSize: 13, lineHeight: 1.8 }}>
        <div><b>{spot.pol} → {spot.pod}</b> · {spot.container_size}{spot.container_type} · ETD {fmtDate(spot.etd)}</div>
        <div style={{ color: "#666" }}>
          总 {spot.total_qty} · 已售 {soldQty} · <b style={{ color: "#1990FF" }}>剩 {remaining}</b> ·
          本次分配 <b style={{ color: overAlloc ? "#cf1322" : "#52c41a" }}>{totalAlloc}</b>
          {overAlloc && <span style={{ color: "#cf1322", marginLeft: 8 }}>⚠ 超出剩余</span>}
        </div>
      </div>

      {/* 分配清单：可加多行 */}
      <div style={{ marginBottom: 10, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "#555" }}>分配清单 ({rows.length} 行)</span>
        <button onClick={addRow} style={{ padding: "3px 12px", fontSize: 12, border: "1px dashed #1990FF", background: "#fff", color: "#1990FF", borderRadius: 3, cursor: "pointer" }}>+ 加一行</button>
      </div>

      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
        <thead style={{ background: "#fafafa" }}>
          <tr>
            <th style={{ padding: 6, textAlign: "left", borderBottom: "1px solid #e8e8e8" }}>#</th>
            <th style={{ padding: 6, textAlign: "left", borderBottom: "1px solid #e8e8e8" }}>客户 *</th>
            <th style={{ padding: 6, textAlign: "right", borderBottom: "1px solid #e8e8e8", width: 70 }}>柜数 *</th>
            <th style={{ padding: 6, textAlign: "right", borderBottom: "1px solid #e8e8e8", width: 100 }}>售价/柜</th>
            <th style={{ padding: 6, textAlign: "left", borderBottom: "1px solid #e8e8e8", width: 140 }}>客户 PO（客户业务编号）</th>
            <th style={{ padding: 6, textAlign: "left", borderBottom: "1px solid #e8e8e8" }}>备注</th>
            <th style={{ padding: 6, width: 32, borderBottom: "1px solid #e8e8e8" }}></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const remembered = customerPartyMap?.[r.customerName];
            return (
              <tr key={i}>
                <td style={{ padding: 4, color: "#999" }}>{i + 1}</td>
                <td style={{ padding: 4 }}>
                  <input style={{ ...fldInput, fontSize: 11 }} list={`alloc-customers-${i}`}
                         value={r.customerName}
                         onChange={e => onCustomerChange(i, e.target.value)}
                         placeholder="客户名" />
                  <datalist id={`alloc-customers-${i}`}>
                    {customers.map(c => <option key={c.id} value={c.name}>{c.name_short || ""}</option>)}
                  </datalist>
                  {remembered && (remembered.shipper || remembered.consignee) && (
                    <div style={{ fontSize: 10, color: "#52c41a", marginTop: 2 }} title={[
                      remembered.shipper && `SHIPPER: ${remembered.shipper}`,
                      remembered.consignee && `CONSIGNEE: ${remembered.consignee}`,
                      remembered.notify_party && `NOTIFY: ${remembered.notify_party}`,
                    ].filter(Boolean).join("\n")}>
                      ✓ 自动带 shipper/consignee
                    </div>
                  )}
                </td>
                <td style={{ padding: 4 }}>
                  <input style={{ ...fldInput, fontSize: 11, textAlign: "right" }} type="number" min="1" max={remaining}
                         value={r.qty} onChange={e => updateRow(i, { qty: e.target.value })} />
                </td>
                <td style={{ padding: 4 }}>
                  <input style={{ ...fldInput, fontSize: 11, textAlign: "right" }} type="number" step="0.01"
                         value={r.sellPrice} onChange={e => updateRow(i, { sellPrice: e.target.value })}
                         placeholder={spot.currency || "USD"} />
                </td>
                <td style={{ padding: 4 }}>
                  <input style={{ ...fldInput, fontSize: 11, fontFamily: "Consolas,monospace" }}
                         value={r.po} onChange={e => updateRow(i, { po: e.target.value })}
                         placeholder="客户业务编号" />
                </td>
                <td style={{ padding: 4 }}>
                  <input style={{ ...fldInput, fontSize: 11 }} value={r.notes}
                         onChange={e => updateRow(i, { notes: e.target.value })} placeholder="备注" />
                </td>
                <td style={{ padding: 4, textAlign: "center" }}>
                  {rows.length > 1 && (
                    <button onClick={() => removeRow(i)} title="删除此行"
                            style={{ border: "none", background: "transparent", color: "#cf1322", cursor: "pointer", fontSize: 14 }}>✕</button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div style={{ marginTop: 12, padding: 10, background: "#fff7e6", border: "1px solid #ffd28e", borderRadius: 4, fontSize: 12, color: "#c66800" }}>
        ⓘ 一次提交可建多个订单（每行一个）。订单号系统自动生成（BSOEF + 年月 + 5位序号），客户 PO 是给客户做业务对账用的（可选）。继承船公司/POL/POD/ETD/订舱号 + 客户常用 shipper/consignee。售价不写入费用表，去新订单的费用面板录入。
      </div>
    </ModalShell>
  );
}

// ─── 通用 modal & form ─────────────────────────────────────────
// ModalShell 已抽到 components/tms.jsx 共享，这里直接 import 使用

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
