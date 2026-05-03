import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "../supabase.js";
import { Spinner, ComboBox } from "../components/ui.jsx";
import { TmsTitle, Mi, Tbl, Fi, TmsTabs, TmsInfoBar, TmsPagination } from "../components/tms.jsx";
import {
  STATUS_COLORS,
  TRADE_TERMS,
  CONTAINER_TYPES,
  BL_TYPES,
  FREIGHT_TERMS,
  TRANSPORT_TERMS,
  SHIPMENT_TYPES,
} from "../lib/constants.js";

/*
  Bansar OPS - 海运出口列表页
  样式来自 src/styles/tms.css（由 App.jsx 入口加载）
  公共组件来自 src/components/tms.jsx
  保留：filtered → groupedRows（Console Box）→ paged → stats
  保留：OrderDetail / NewOrderModal 不变（Phase 2 再重构）
*/

// ── Legacy 常量：OrderDetail / NewOrderModal 内部样式仍在使用 ──
const FAM = "'Segoe UI','Microsoft YaHei',Arial,sans-serif";
const F = FAM;
const mono = { fontFamily: "'Consolas','Microsoft YaHei',monospace" };
const C = {
  titleBlue: "#1990FF",
  titleBlue2: "#0e7fe6",
  topLine: "#0e7fe6",
  beige: "#fff0e3",
  beigeLine: "#ffd28e",
  panel: "#e6f4ff",
  panel2: "#cfe5ff",
  border: "#abadb3",
  grid: "#bbb",
  head1: "#f9f9f9",
  head2: "#f0f0f0",
  selected: "#eec99d",
  rowAlt: "#eee",
  hover: "#ecf3eb",
};

export function OrdersPage({ user, onBack }) {
  const role = user.profile?.role || "operator";
  const [shipments, setShipments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [checkedIds, setCheckedIds] = useState(new Set());
  const [search, setSearch] = useState("");
  const [showFilter, setShowFilter] = useState(true);
  const [showDetail, setShowDetail] = useState(true);
  const [filters, setFilters] = useState({});
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [maxRows, setMaxRows] = useState(300);
  const [activeTab, setActiveTab] = useState("过滤");

  const load = useCallback(async () => {
    const { data } = await supabase.from("shipments").select("*").order("created_at", { ascending: false });
    setShipments(data || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const refs = useMemo(() => {
    const ex = (f) => [...new Set(shipments.map(o => o[f]).filter(Boolean))].sort();
    return {
      supplier: ex("supplier"),
      customer: ex("customer"),
      carrier: ex("carrier"),
      vessel: ex("vessel"),
      voyage: ex("voyage"),
      pol: ex("pol"),
      pod: ex("pod"),
      destination: ex("destination"),
    };
  }, [shipments]);

  const sf = (k, v) => setFilters(p => ({ ...p, [k]: v }));

  const filtered = useMemo(() => shipments.filter(o => {
    const f = filters;
    if (f.supplier && o.supplier !== f.supplier) return false;
    if (f.customer && o.customer !== f.customer) return false;
    if (f.carrier && o.carrier !== f.carrier) return false;
    if (f.vessel && !(o.vessel || "").toLowerCase().includes(String(f.vessel).toLowerCase())) return false;
    if (f.voyage && !(o.voyage || "").toLowerCase().includes(String(f.voyage).toLowerCase())) return false;
    if (f.pol && o.pol !== f.pol) return false;
    if (f.pod && o.pod !== f.pod) return false;
    if (f.destination && o.destination !== f.destination) return false;
    if (f.mbl_no && !(o.mbl_no || "").toLowerCase().includes(String(f.mbl_no).toLowerCase())) return false;
    if (f.booking_no && !(o.booking_no || "").toLowerCase().includes(String(f.booking_no).toLowerCase())) return false;
    if (f.container_no && !(o.container_no || "").toLowerCase().includes(String(f.container_no).toLowerCase())) return false;
    if (f.order_no && !(o.order_no || "").toLowerCase().includes(String(f.order_no).toLowerCase())) return false;
    if (f.po && !(o.po || "").toLowerCase().includes(String(f.po).toLowerCase())) return false;
    if (f.hbl_no && !(o.hbl_no || "").toLowerCase().includes(String(f.hbl_no).toLowerCase())) return false;
    if (f.etd_from && o.etd && o.etd < f.etd_from) return false;
    if (f.etd_to && o.etd && o.etd > f.etd_to) return false;
    if (search) {
      const q = search.toLowerCase();
      const pool = [o.po, o.customer_po, o.booking_no, o.container_no, o.vessel, o.voyage, o.supplier, o.order_no, o.mbl_no, o.customer, o.pol, o.pod];
      if (!pool.filter(Boolean).some(x => String(x).toLowerCase().includes(q))) return false;
    }
    return true;
  }), [shipments, filters, search]);

  useEffect(() => { setPage(0); }, [filters, search]);

  const groupedRows = useMemo(() => {
    const mblG = {};
    const noMbl = [];
    filtered.forEach(o => {
      const k = o.mbl_no || o.booking_no;
      if (k) {
        if (!mblG[k]) mblG[k] = [];
        mblG[k].push(o);
      } else {
        noMbl.push(o);
      }
    });

    const rows = [];
    Object.entries(mblG)
      .filter(([, v]) => v.length >= 2)
      .sort((a, b) => (b[1][0].created_at || "").localeCompare(a[1][0].created_at || ""))
      .forEach(([mbl, items]) => {
        rows.push({ t: "mbl", mbl, d: items[0], ch: items, n: items.length });
        items.forEach(c => rows.push({ t: "hbl", mbl, d: c }));
      });

    [
      ...Object.entries(mblG).filter(([, v]) => v.length === 1).map(([, v]) => v[0]),
      ...noMbl
    ].sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))
      .forEach(o => rows.push({ t: "s", d: o }));

    return rows;
  }, [filtered]);

  const stats = useMemo(() => {
    const types = {};
    let teu = 0;
    filtered.forEach(o => {
      for (const m of (o.qty_container || "").matchAll(/(\d+)\s*x\s*((?:20|40|45)(?:GP|HQ|RF|OT|FR)?)/gi)) {
        const count = parseInt(m[1], 10);
        const type = m[2].toUpperCase();
        types[type] = (types[type] || 0) + count;
        teu += type.startsWith("20") ? count : count * 2;
      }
    });
    return {
      n: filtered.length,
      teu,
      ts: Object.entries(types).map(([t, c]) => `${c}X${t}`).join(","),
    };
  }, [filtered]);

  const totalPages = Math.max(1, Math.ceil(groupedRows.length / pageSize));
  const paged = groupedRows.slice(page * pageSize, (page + 1) * pageSize);

  const togChk = (id) => setCheckedIds(p => {
    const n = new Set(p);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  const clearF = () => { setFilters({}); setSearch(""); };

  const selOrder = shipments.find(o => o.id === selectedId);

  if (loading) return <Spinner />;
  if (selOrder) return (
    <OrderDetail
      order={selOrder}
      role={role}
      user={user}
      onBack={() => { setSelectedId(null); load(); }}
      onReload={load}
    />
  );

  // 列定义
  const cols = [
    { k: "chk",   w: 30,  label: "" },
    { k: "type",  w: 60,  label: "出运类型", center: true },
    { k: "ord",   w: 130, label: "作业号", link: true },
    { k: "po",    w: 140, label: "客户编号" },
    { k: "mbl",   w: 130, label: "MB/L No.", link: true },
    { k: "ves",   w: 150, label: "船名", link: true },
    { k: "voy",   w: 60,  label: "航次" },
    { k: "etd",   w: 100, label: "预计开航时间" },
    { k: "sup",   w: 180, label: "委托人" },
    { k: "pol",   w: 110, label: "起运港名称" },
    { k: "pod",   w: 110, label: "卸货港名称" },
    { k: "dest",  w: 110, label: "目的地名称" },
    { k: "qty",   w: 80,  label: "箱型" },
    { k: "hbl",   w: 130, label: "HB/L No.", link: true },
  ];
  const totalW = cols.reduce((a, c) => a + c.w, 0);

  return (
    <div className="tms">

      {/* 标题栏 + 顶部菜单（共享组件） */}
      <TmsTitle title="作业 / 海运出口" user={user} role={role} onClose={onBack} />

      {/* 工具栏 */}
      <div className="tms-mn">
        <Mi onClick={clearF}>清除</Mi>
        <Tbl/>
        <Mi checked={showDetail} onClick={() => setShowDetail(p => !p)}>显示明细</Mi>
        <Mi onClick={() => setShowFilter(p => !p)}>搜索</Mi>
        <Tbl/>
        <Mi onClick={() => setShowNew(true)} arrow>新建作业</Mi>
        <Mi arrow>显示预览</Mi>
        <Mi>统计模板</Mi>
        <Tbl/>
        <Mi onClick={() => setShowFilter(p => !p)}>{showFilter ? "隐藏面板" : "显示面板"}</Mi>
        <Mi arrow>数据范围</Mi>
        <Tbl/>
        <Mi disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>上页</Mi>
        <Mi disabled={page >= totalPages - 1} onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}>下页</Mi>
        <Tbl/>
        <Mi arrow>导出</Mi>
        <Mi arrow>打印</Mi>
        <Mi arrow>数据交换</Mi>
        <Mi>数据分析</Mi>
        <Mi arrow>系统功能</Mi>
        <Tbl/>
        <Mi onClick={onBack}>关闭</Mi>

        <div className="tms-mn-r">
          <label>冻结列</label>
          <select style={{ width: 50 }}><option>1</option><option>2</option><option>3</option></select>
          <label>列筛选</label>
          <input style={{ width: 100 }} value={search} onChange={e => setSearch(e.target.value)} />
          <label>列布局</label>
          <select style={{ width: 110 }}><option></option></select>
          <label>列表表格式模板</label>
          <select style={{ width: 110 }}><option></option></select>
          <label>最大行数</label>
          <select value={maxRows} onChange={e => setMaxRows(+e.target.value)} style={{ width: 60 }}>
            <option>100</option><option>200</option><option>300</option><option>500</option><option>1000</option>
          </select>
        </div>
      </div>

      {/* 筛选面板 */}
      {showFilter && (
        <div className="tms-fp">
          <TmsTabs
            tabs={["过滤", "动作", "打印", "通知", "查询方案"]}
            active={activeTab}
            onChange={setActiveTab}
          />
          <div className="tms-fg">
            <Fi label="公司">
              <input className="readonly" readOnly value="BS（NB）GJ" />
            </Fi>
            <Fi label="作业号">
              <input value={filters.order_no || ""} onChange={e => sf("order_no", e.target.value)} />
            </Fi>
            <Fi label="预计开航时间">
              <input type="date" value={filters.etd_from || ""} onChange={e => sf("etd_from", e.target.value)} />
            </Fi>
            <Fi label="至">
              <input type="date" value={filters.etd_to || ""} onChange={e => sf("etd_to", e.target.value)} />
            </Fi>
            <Fi label="实际开航时间"><input disabled /></Fi>
            <Fi label="至"><input disabled /></Fi>

            <Fi label="船东" refLabel>
              <ComboBox value={filters.carrier || ""} onChange={v => sf("carrier", v)} options={refs.carrier} />
            </Fi>
            <Fi label="船名" refLabel>
              <ComboBox value={filters.vessel || ""} onChange={v => sf("vessel", v)} options={refs.vessel} />
            </Fi>
            <Fi label="航次">
              <ComboBox value={filters.voyage || ""} onChange={v => sf("voyage", v)} options={refs.voyage} />
            </Fi>
            <Fi label="订舱代理" refLabel><input disabled /></Fi>
            <Fi label="船东参考编号"><input disabled /></Fi>
            <Fi label="委托人" refLabel>
              <ComboBox value={filters.supplier || ""} onChange={v => sf("supplier", v)} options={refs.supplier} />
            </Fi>

            <Fi label="委托部门"><input disabled /></Fi>
            <Fi label="销售员"><input disabled /></Fi>
            <Fi label="客服"><input disabled /></Fi>
            <Fi label="操作员"><input disabled /></Fi>
            <Fi label="单证"><input disabled /></Fi>
            <Fi label="出运状态">
              <select disabled><option>出运</option></select>
            </Fi>

            <Fi label="费用状态"><input disabled /></Fi>
            <Fi label="费用提交"><input disabled /></Fi>
            <Fi label="费用审核"><input disabled /></Fi>
            <Fi label="航线" refLabel><input disabled /></Fi>
            <Fi label="航线确认"><input disabled /></Fi>
            <Fi label="舱单确认"><input disabled /></Fi>

            <Fi label="客户编号">
              <input value={filters.po || ""} onChange={e => sf("po", e.target.value)} />
            </Fi>
            <Fi label="MB/L No.">
              <input value={filters.mbl_no || ""} onChange={e => sf("mbl_no", e.target.value)} />
            </Fi>
            <Fi label="HB/L No.">
              <input value={filters.hbl_no || ""} onChange={e => sf("hbl_no", e.target.value)} />
            </Fi>
            <Fi label="状态"><input disabled /></Fi>
            <Fi label="箱号">
              <input value={filters.container_no || ""} onChange={e => sf("container_no", e.target.value)} />
            </Fi>
            <Fi label="目的地" refLabel>
              <ComboBox value={filters.destination || ""} onChange={v => sf("destination", v)} options={refs.destination} />
            </Fi>

            <Fi label="卸货港" refLabel>
              <ComboBox value={filters.pod || ""} onChange={v => sf("pod", v)} options={refs.pod} />
            </Fi>
            <Fi label="起运港" refLabel>
              <ComboBox value={filters.pol || ""} onChange={v => sf("pol", v)} options={refs.pol} />
            </Fi>
            <Fi label="发货人名称"><input disabled /></Fi>
            <Fi label="收货人名称"><input disabled /></Fi>
            <Fi label="清关日期"><input disabled type="date" /></Fi>
            <Fi label="至"><input disabled type="date" /></Fi>

            <Fi label="单证锁定"><input disabled /></Fi>
            <Fi label="商务"><input disabled /></Fi>
          </div>
        </div>
      )}

      {/* 信息栏 */}
      <TmsInfoBar scope="分公司">
        行数:<b>{stats.n}</b>
        TEU:<b>{stats.teu}</b>
        {stats.ts && <>箱型:<b>{stats.ts}</b></>}
      </TmsInfoBar>

      {/* 表格 */}
      <div className="tms-list">
        <table style={{ minWidth: totalW }}>
          <colgroup>
            {cols.map(c => <col key={c.k} style={{ width: c.w }} />)}
          </colgroup>
          <thead>
            <tr>
              {cols.map(c => (
                <th key={c.k} className={c.link ? "link" : ""}>
                  {c.k === "chk" ? (
                    <input type="checkbox"
                      checked={paged.length > 0 && paged.every(r => r.t === "mbl" || checkedIds.has(r.d.id))}
                      onChange={e => {
                        const n = new Set(checkedIds);
                        if (e.target.checked) paged.forEach(r => r.t !== "mbl" && n.add(r.d.id));
                        else paged.forEach(r => n.delete(r.d.id));
                        setCheckedIds(n);
                      }} />
                  ) : (
                    <span className="ht">{c.label}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paged.map((r, i) => {
              if (r.t === "mbl") {
                return (
                  <tr key={"g" + i} className="grp">
                    <td className="center"><input type="checkbox" /></td>
                    <td colSpan={cols.length - 1} style={{ paddingLeft: 6 }}>
                      <span style={{ color: "#0e7fe6" }}>{r.mbl}</span>
                      <span style={{ marginLeft: 12, color: "#666", fontWeight: "normal" }}>合计 {r.n} 票</span>
                      <span style={{ marginLeft: 12, color: "#666", fontWeight: "normal" }}>船名: {r.d.vessel} / {r.d.voyage}</span>
                    </td>
                  </tr>
                );
              }
              const o = r.d;
              const child = r.t === "hbl";
              const checked = checkedIds.has(o.id);
              const evenOdd = i % 2 === 0 ? "even" : "odd";
              return (
                <tr key={o.id}
                  className={(checked ? "current " : "") + evenOdd}
                  onClick={() => setSelectedId(o.id)}>
                  <td className="center" onClick={e => e.stopPropagation()}>
                    <input type="checkbox" checked={checked} onChange={() => togChk(o.id)} />
                  </td>
                  <td className="center">{o.shipment_type === "LCL" ? "拼箱" : "整箱"}</td>
                  <td>
                    {child && <span className="ind">└</span>}
                    <span className="lk">{o.order_no || ""}</span>
                  </td>
                  <td>{o.po || o.customer_po || ""}</td>
                  <td><span className="lk">{o.mbl_no || o.booking_no || ""}</span></td>
                  <td><span className="lk">{o.vessel || ""}</span></td>
                  <td>{o.voyage || ""}</td>
                  <td>{o.etd || ""}</td>
                  <td>{o.supplier || ""}</td>
                  <td>{cleanPort(o.pol)}</td>
                  <td>{cleanPort(o.pod)}</td>
                  <td>{o.destination || cleanPort(o.pod)}</td>
                  <td>{o.qty_container || ""}</td>
                  <td><span className="lk">{o.hbl_no || ""}</span></td>
                </tr>
              );
            })}
            {paged.length === 0 && (
              <tr><td colSpan={cols.length} style={{ textAlign: "center", padding: 30, color: "#999", borderRight: 0 }}>无数据</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 分页 */}
      <TmsPagination
        total={groupedRows.length}
        page={page}
        pageSize={pageSize}
        totalPages={totalPages}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
      />

      {showNew && <NewOrderModal onClose={() => setShowNew(false)} onSaved={() => { setShowNew(false); load(); }} />}
    </div>
  );
}

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
    ]).then(([s, c, p]) => setRefData({
      suppliers: (s.data || []).map(r => r.name),
      customers: (c.data || []).map(r => r.name),
      ports: (p.data || []).map(r => r.name),
    }));

    if (order.po || order.customer_po) {
      const q = order.po && order.customer_po
        ? supabase.from("container_items").select("*").eq("po", order.po).eq("customer_po", String(order.customer_po))
        : order.customer_po
          ? supabase.from("container_items").select("*").eq("customer_po", String(order.customer_po))
          : supabase.from("container_items").select("*").eq("po", order.po);
      q.then(({ data }) => setCargoItems(data || []));
    }
  }, [order.id]);

  const startEdit = () => { setEd({ ...order }); setEditing(true); };
  const cancel = () => setEditing(false);
  const save = async () => {
    const changes = {};
    for (const k of Object.keys(ed)) {
      if (ed[k] !== order[k] && !["id", "created_at", "updated_at"].includes(k)) {
        changes[k] = ed[k] === "" ? null : ed[k];
      }
    }
    if (Object.keys(changes).length) {
      const { error } = await supabase.from("shipments").update(changes).eq("id", order.id);
      if (error) { alert(error.message); return; }
    }
    setEditing(false);
    onReload();
  };

  const v = (f) => editing ? (ed[f] ?? "") : (order[f] ?? "");
  const ch = (f, val) => setEd(p => ({ ...p, [f]: val }));
  const tabs = ["作业", "装箱", "费用", "凭证", "代理对账单", "附件"];

  return (
    <div style={pageWrap}>
      <TmsTitle user={user} role={role} title={`${order.shipment_type === "LCL" ? "拼箱" : order.shipment_type === "Console" ? "拼柜" : "整箱"} / 海运出口`} />

      <Toolbar
        left={[
          ["返回", onBack, "text"],
          ["新建", undefined, "text"],
          ["删除", undefined, "text"],
          ["舱单确认", undefined, "text"],
          ["订舱确认", undefined, "text"],
          ["放舱确认", undefined, "text"],
          ["放箱确认", undefined, "text"],
          ["开船锁定", undefined, "text"],
          ["单证作业", undefined, "text"],
          ["内部利润分析", undefined, "text"],
          ["打印", undefined, "text"],
          ["编辑", startEdit, "box"],
        ]}
      />

      <div style={{ display: "flex", gap: 0, height: 27, background: "#f8fbff", borderBottom: `1px solid ${C.border}`, paddingLeft: 8 }}>
        {tabs.map(t => (
          <div key={t} onClick={() => setTab(t)} style={{
            height: 26,
            lineHeight: "26px",
            padding: "0 18px",
            border: `1px solid ${C.border}`,
            borderBottom: tab === t ? `1px solid ${C.panel}` : `1px solid ${C.border}`,
            background: tab === t ? C.panel : "linear-gradient(#fff,#e8f1fa)",
            marginRight: -1,
            fontWeight: tab === t ? 700 : 400,
            color: tab === t ? "#0055aa" : "#333",
            cursor: "pointer",
          }}>{t}</div>
        ))}
        <div style={{ flex: 1 }} />
        {editing && (
          <div style={{ display: "flex", alignItems: "center", gap: 5, paddingRight: 8 }}>
            <button onClick={save} style={primaryBtn}>保存</button>
            <button onClick={cancel} style={grayBtn}>取消</button>
          </div>
        )}
      </div>

      <div style={{ flex: 1, overflow: "auto", background: "#fff", padding: 8 }}>
        {tab === "作业" && (
          <div style={detailPanel}>
            <SectionTitle>基本信息</SectionTitle>
            <DetailGrid>
              <DL req>作业号</DL><DV edit={editing} v={v("order_no")} f="order_no" ch={ch} />
              <DL req>委托人</DL><DV edit={editing} v={v("supplier")} f="supplier" ch={ch} opts={refData.suppliers} />
              <DL>订舱代理</DL><DV edit={editing} v={v("carrier_agent")} f="carrier_agent" ch={ch} />
              <DL>操作员</DL><DV v={user.profile?.name || user.email} />

              <DL>出运类型</DL><DV edit={editing} v={v("shipment_type")} f="shipment_type" ch={ch} opts={SHIPMENT_TYPES.map(t => t.key)} />
              <DL req>客户</DL><DV edit={editing} v={v("customer")} f="customer" ch={ch} opts={refData.customers} />
              <DL>船东</DL><DV edit={editing} v={v("carrier")} f="carrier" ch={ch} />
              <DL>终端客户</DL><DV edit={editing} v={v("end_customer")} f="end_customer" ch={ch} />

              <DL req>订舱日期</DL><DV v={v("created_at")?.slice(0, 10)} />
              <DL>PO#</DL><DV edit={editing} v={v("po")} f="po" ch={ch} />
              <DL>Customer PO#</DL><DV edit={editing} v={v("customer_po")} f="customer_po" ch={ch} />
              <DL>贸易条款</DL><DV edit={editing} v={v("incoterms")} f="incoterms" ch={ch} opts={TRADE_TERMS} />

              <DL>船名</DL><DV edit={editing} v={v("vessel")} f="vessel" ch={ch} />
              <DL>航次</DL><DV edit={editing} v={v("voyage")} f="voyage" ch={ch} />
              <DL req>MB/L No.</DL><DV edit={editing} v={v("mbl_no")} f="mbl_no" ch={ch} mono />
              <DL>HB/L No.</DL><DV edit={editing} v={v("hbl_no")} f="hbl_no" ch={ch} />

              <DL req>预计开航时间</DL><DV edit={editing} v={v("etd")} f="etd" ch={ch} type="date" />
              <DL>实际开航时间</DL><DV edit={editing} v={v("atd")} f="atd" ch={ch} type="date" />
              <DL req>截单日期</DL><DV edit={editing} v={v("si_cutoff")} f="si_cutoff" ch={ch} type="date" />
              <DL>预计到港时间</DL><DV edit={editing} v={v("eta")} f="eta" ch={ch} type="date" />

              <DL>出单类型</DL><DV edit={editing} v={v("bl_type")} f="bl_type" ch={ch} opts={BL_TYPES} />
              <DL>付款方式</DL><DV edit={editing} v={v("freight_terms")} f="freight_terms" ch={ch} opts={FREIGHT_TERMS} />
              <DL>服务类型</DL><DV edit={editing} v={v("transport_terms")} f="transport_terms" ch={ch} opts={TRANSPORT_TERMS} />
              <DL>箱号</DL><DV edit={editing} v={v("container_no")} f="container_no" ch={ch} />

              <DL>起运港</DL><DV edit={editing} v={v("pol")} f="pol" ch={ch} opts={refData.ports} />
              <DL>卸货港</DL><DV edit={editing} v={v("pod")} f="pod" ch={ch} opts={refData.ports} />
              <DL>目的地</DL><DV edit={editing} v={v("destination")} f="destination" ch={ch} />
              <DL>码头</DL><DV edit={editing} v={v("terminal")} f="terminal" ch={ch} />
            </DetailGrid>

            <SectionTitle>发货人 / 收货人 / 通知方</SectionTitle>
            <div style={{ display: "grid", gridTemplateColumns: "88px 1fr 88px 1fr 88px 1fr", gap: "4px 8px", alignItems: "start" }}>
              <DL req>发货人</DL><DV edit={editing} v={v("shipper")} f="shipper" ch={ch} area />
              <DL req>收货人</DL><DV edit={editing} v={v("consignee")} f="consignee" ch={ch} area />
              <DL>通知人</DL><DV edit={editing} v={v("notify_party")} f="notify_party" ch={ch} area />
            </div>

            <SectionTitle>货物信息</SectionTitle>
            <DetailGrid>
              <DL>集装箱</DL><DV edit={editing} v={v("qty_container")} f="qty_container" ch={ch} />
              <DL>箱型</DL><DV edit={editing} v={v("container_type")} f="container_type" ch={ch} opts={CONTAINER_TYPES} />
              <DL>货物件数</DL><DV v={order.qty_packages} />
              <DL>毛重</DL><DV v={order.weight} />

              <DL>体积</DL><DV v={order.volume} />
              <DL>品名</DL><DV edit={editing} v={v("tuc")} f="tuc" ch={ch} />
              <DL>唛头</DL><DV edit={editing} v={v("marks")} f="marks" ch={ch} />
              <DL>SKU</DL><DV v={order.sku} />
            </DetailGrid>
          </div>
        )}

        {tab === "装箱" && (
          <div style={detailPanel}>
            <SectionTitle>装箱明细</SectionTitle>
            {cargoItems.length > 0 ? (
              <table style={{ ...tableStyle, minWidth: 900 }}>
                <thead><tr>{["B/L", "HBL", "柜号", "封号", "品名", "唛头", "件数", "毛重", "体积"].map(h => <TH key={h}>{h}</TH>)}</tr></thead>
                <tbody>
                  {cargoItems.map((it, i) => (
                    <tr key={it.id} style={{ background: i % 2 ? C.rowAlt : "#fff" }}>
                      <td style={td}>{order.mbl_no || ""}</td>
                      <td style={td}>{it.hbl || ""}</td>
                      <td style={{ ...td, color: "#0066cc" }}>{it.container_no || ""}</td>
                      <td style={td}>{it.seal_no || ""}</td>
                      <td style={td}>{it.tuc || ""}</td>
                      <td style={td}>{it.marks || ""}</td>
                      <td style={{ ...td, textAlign: "right" }}>{it.qty || ""}</td>
                      <td style={{ ...td, textAlign: "right" }}>{it.weight || ""}</td>
                      <td style={{ ...td, textAlign: "right" }}>{it.volume || ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <div style={{ color: "#888", padding: 12 }}>暂无装箱数据</div>}
          </div>
        )}

        {!["作业", "装箱"].includes(tab) && (
          <div style={detailPanel}>
            <SectionTitle>{tab}</SectionTitle>
            <div style={{ padding: 20, color: "#888" }}>功能开发中</div>
          </div>
        )}
      </div>
    </div>
  );
}

function NewOrderModal({ onClose, onSaved }) {
  const [form, setForm] = useState({
    po: "", customer_po: "", supplier: "", customer: "", carrier: "", carrier_agent: "",
    vessel: "", pol: "", pod: "", etd: "", incoterms: "FOB", booking_no: "", shipment_type: "FCL"
  });
  const [refData, setRefData] = useState({ suppliers: [], customers: [], ports: [] });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      supabase.from("suppliers").select("name").order("name"),
      supabase.from("customers").select("name").order("name"),
      supabase.from("ports").select("name").order("name")
    ]).then(([s, c, p]) => setRefData({
      suppliers: (s.data || []).map(r => r.name),
      customers: (c.data || []).map(r => r.name),
      ports: (p.data || []).map(r => r.name),
    }));
  }, []);

  const set = (k, val) => setForm(p => ({ ...p, [k]: val }));

  const save = async () => {
    if (!form.po && !form.customer_po) {
      alert("PO or Customer PO required");
      return;
    }
    setSaving(true);
    const data = { ...form };
    Object.keys(data).forEach(k => { if (data[k] === "") data[k] = null; });
    const { error } = await supabase.from("shipments").insert(data);
    if (error) {
      alert(error.message);
      setSaving(false);
      return;
    }
    setSaving(false);
    onSaved();
  };

  return (
    <div style={modalMask}>
      <div style={modalBox}>
        <TmsTitle title="新建作业 / 海运出口" compact />
        <div style={{ padding: 10, background: C.panel }}>
          <DetailGrid>
            <DL req>PO#</DL><FI value={form.po} onChange={e => set("po", e.target.value)} />
            <DL>Customer PO#</DL><FI value={form.customer_po} onChange={e => set("customer_po", e.target.value)} />
            <DL>出运类型</DL><ComboBox value={form.shipment_type} onChange={v => set("shipment_type", v)} options={SHIPMENT_TYPES.map(t => t.key)} style={{ height: 22 }} />
            <DL>Booking No</DL><FI value={form.booking_no} onChange={e => set("booking_no", e.target.value)} />

            <DL>委托方</DL><ComboBox value={form.supplier} onChange={v => set("supplier", v)} options={refData.suppliers} style={{ height: 22 }} />
            <DL>客户</DL><ComboBox value={form.customer} onChange={v => set("customer", v)} options={refData.customers} style={{ height: 22 }} />
            <DL>船公司</DL><FI value={form.carrier} onChange={e => set("carrier", e.target.value)} />
            <DL>订舱代理</DL><FI value={form.carrier_agent} onChange={e => set("carrier_agent", e.target.value)} />

            <DL>船名</DL><FI value={form.vessel} onChange={e => set("vessel", e.target.value)} />
            <DL>ETD</DL><FI type="date" value={form.etd} onChange={e => set("etd", e.target.value)} />
            <DL>起运港</DL><ComboBox value={form.pol} onChange={v => set("pol", v)} options={refData.ports} style={{ height: 22 }} />
            <DL>卸货港</DL><ComboBox value={form.pod} onChange={v => set("pod", v)} options={refData.ports} style={{ height: 22 }} />

            <DL>贸易条款</DL><ComboBox value={form.incoterms} onChange={v => set("incoterms", v)} options={TRADE_TERMS} style={{ height: 22 }} />
          </DetailGrid>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 10 }}>
            <button onClick={onClose} style={grayBtn}>取消</button>
            <button onClick={save} disabled={saving} style={primaryBtn}>{saving ? "保存中..." : "保存"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* Components */
function Toolbar({ left, right }) {
  return (
    <div style={toolBar}>
      <div style={{ display: "flex", alignItems: "center", height: "100%" }}>
        {left.map(([label, fn, type], i) => {
          if (label === "__sep") return <Sep key={i} />;
          return (
            <button key={i} onClick={fn} disabled={type === "disabled"} style={type === "box" ? toolBtnBox : type === "disabled" ? toolBtnDisabled : toolBtnText}>
              {label}
            </button>
          );
        })}
      </div>
      <div style={toolRight}>{right}</div>
    </div>
  );
}

function Sep() { return <div style={{ width: 1, height: 20, background: "#8db0d3", margin: "0 6px" }} />; }

function FilterTab({ active, children }) {
  return (
    <div style={{
      height: 27,
      lineHeight: "27px",
      padding: "0 15px",
      border: `1px solid ${C.border}`,
      borderBottom: active ? `1px solid ${C.panel}` : `1px solid ${C.border}`,
      background: active ? C.panel : "linear-gradient(#fff,#edf4fc)",
      fontWeight: active ? 700 : 400,
      marginRight: -1,
    }}>{children}</div>
  );
}

function FL({ children }) {
  return <label style={fl}>{children}</label>;
}

function FI({ style, search, select, ...props }) {
  return (
    <div style={{ position: "relative", width: "100%" }}>
      <input {...props} style={{ ...inputBase, ...style, paddingRight: search ? 18 : 4 }} />
      {search && <span style={inputIcon}>🔍</span>}
      {select && <span style={inputIcon}>⌄</span>}
    </div>
  );
}

function SearchBox({ value, setValue, options }) {
  return <ComboBox value={value || ""} onChange={setValue} options={options || []} placeholder="" style={{ height: 22, fontSize: 12 }} />;
}

function SmallSelect({ value, options, w = 54 }) {
  return (
    <select value={value} onChange={() => {}} style={{ height: 22, width: w, border: `1px solid ${C.border}`, fontSize: 12, background: "#fff" }}>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function SmallInput({ w = 58 }) {
  return <input style={{ height: 20, width: w, border: `1px solid ${C.border}`, fontSize: 12, background: "#fff" }} />;
}

function TH({ children, w }) {
  return <th style={{ ...th, width: w }}>{children}</th>;
}

function PB({ children, d, on, onClick }) {
  return <button disabled={d} onClick={onClick} style={{
    minWidth: 24,
    height: 22,
    padding: "0 7px",
    border: `1px solid ${C.border}`,
    background: on ? "#1a73e8" : "linear-gradient(#fff,#e8f1fa)",
    color: on ? "#fff" : d ? "#999" : "#111",
    fontSize: 12,
    cursor: d ? "default" : "pointer",
  }}>{children}</button>;
}

function STag({ v }) {
  const color = STATUS_COLORS[v] || "#555";
  return <span style={{ color, fontWeight: 700 }}>{v}</span>;
}

function SectionTitle({ children }) {
  return (
    <div style={{
      color: "#0055aa",
      fontWeight: 700,
      height: 25,
      lineHeight: "25px",
      borderBottom: `1px solid ${C.border}`,
      margin: "6px 0 8px",
      fontSize: 13,
    }}>{children}</div>
  );
}

function DetailGrid({ children }) {
  return <div style={detailGrid}>{children}</div>;
}

function DL({ children, req }) {
  return <label style={{ ...detailLabel, color: req ? "#c00000" : "#004b8d" }}>{children}{req ? " *" : ""}</label>;
}

function DV({ v, edit, f, ch, opts, type, mono: isMono, area }) {
  if (!edit || !f) {
    if (area) return <div style={{ ...displayBox, minHeight: 68, whiteSpace: "pre-wrap" }}>{v || ""}</div>;
    return <div style={{ ...displayBox, ...(isMono ? mono : {}) }}>{v || ""}</div>;
  }

  if (opts) return <ComboBox value={v || ""} onChange={val => ch(f, val)} options={opts} style={{ height: 22, fontSize: 12 }} />;
  if (area) return <textarea value={v || ""} onChange={e => ch(f, e.target.value)} rows={4} style={{ ...editInput, height: 72, resize: "vertical" }} />;
  return <input type={type || "text"} value={v || ""} onChange={e => ch(f, e.target.value)} style={{ ...editInput, ...(isMono ? mono : {}) }} />;
}

function cleanPort(v) {
  return (v || "").split("(")[0].trim();
}

/* Styles */
const pageWrap = {
  height: "100%",
  display: "flex",
  flexDirection: "column",
  fontFamily: F,
  fontSize: 12,
  color: "#111",
  background: "#fff",
  overflow: "hidden",
};

const titleBar = {
  flexShrink: 0,
  height: 40,
  background: `linear-gradient(${C.titleBlue}, ${C.titleBlue2})`,
  borderBottom: `1px solid ${C.topLine}`,
  display: "flex",
  alignItems: "center",
  padding: "0 14px",
  boxSizing: "border-box",
};

const titleRight = {
  marginLeft: "auto",
  color: "#fff",
  fontSize: 12,
  display: "flex",
  alignItems: "center",
  gap: 10,
  whiteSpace: "nowrap",
  fontWeight: 700,
};

const toolBar = {
  flexShrink: 0,
  height: 32,
  background: `linear-gradient(#fffaf3, ${C.beige})`,
  borderBottom: `1px solid ${C.beigeLine}`,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "0 8px",
  boxSizing: "border-box",
  overflow: "hidden",
};

const toolBtnText = {
  height: 22,
  padding: "0 7px",
  border: "none",
  background: "transparent",
  color: "#111",
  fontSize: 12,
  fontFamily: F,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const toolBtnBox = {
  height: 22,
  padding: "0 9px",
  border: `1px solid ${C.border}`,
  background: "linear-gradient(#fff,#dceaf7)",
  color: "#111",
  fontSize: 12,
  fontFamily: F,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const toolBtnDisabled = {
  ...toolBtnText,
  color: "#aaa",
  cursor: "default",
};

const toolRight = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  fontSize: 12,
  whiteSpace: "nowrap",
  marginLeft: 12,
};

const filterBox = {
  flexShrink: 0,
  background: C.panel,
  borderBottom: `1px solid ${C.border}`,
  padding: "0 8px 8px",
  boxSizing: "border-box",
};

const tabsRow = {
  display: "flex",
  alignItems: "end",
  height: 30,
};

const filterGrid = {
  display: "grid",
  gridTemplateColumns: "62px 130px 70px 130px 96px 130px 22px 130px 100px 130px 22px 130px",
  columnGap: 6,
  rowGap: 5,
  alignItems: "center",
};

const fl = {
  textAlign: "right",
  color: "#111",
  fontSize: 12,
  lineHeight: "22px",
  whiteSpace: "nowrap",
};

const between = {
  fontSize: 12,
  color: "#111",
  textAlign: "center",
};

const inputBase = {
  width: "100%",
  height: 22,
  lineHeight: "22px",
  boxSizing: "border-box",
  border: `1px solid ${C.border}`,
  background: "#fff",
  fontSize: 12,
  fontFamily: F,
  padding: "0 4px",
  outline: "none",
};

const inputIcon = {
  position: "absolute",
  right: 4,
  top: 1,
  height: 20,
  lineHeight: "20px",
  fontSize: 12,
  color: "#555",
  pointerEvents: "none",
};

const statsBar = {
  flexShrink: 0,
  height: 28,
  background: "linear-gradient(#fff,#efefef)",
  borderBottom: "1px solid #bdbdbd",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "0 8px",
  fontSize: 12,
  boxSizing: "border-box",
  whiteSpace: "nowrap",
};

const legend = {
  display: "flex",
  gap: 14,
  fontWeight: 700,
  fontSize: 12,
};

const tableWrap = {
  flex: 1,
  overflow: "auto",
  background: "#fff",
};

const tableStyle = {
  width: "100%",
  minWidth: 1680,
  borderCollapse: "collapse",
  tableLayout: "fixed",
  fontFamily: F,
  fontSize: 12,
};

const th = {
  height: 24,
  padding: "0 5px",
  background: `linear-gradient(${C.head1}, ${C.head2})`,
  borderLeft: `1px solid ${C.grid}`,
  borderRight: `1px solid ${C.grid}`,
  borderTop: "none",
  borderBottom: "1px solid #999",
  color: "#111",
  fontWeight: 700,
  textAlign: "center",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  position: "sticky",
  top: 0,
  zIndex: 2,
};

const td = {
  height: 24,
  padding: "0 6px",
  borderLeft: `1px solid ${C.grid}`,
  borderRight: `1px solid ${C.grid}`,
  borderBottom: "1px solid #ececec",
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  boxSizing: "border-box",
  fontSize: 12,
};

const chkStyle = {
  width: 14,
  height: 14,
  accentColor: "#1a73e8",
  verticalAlign: "middle",
};

const pagerBar = {
  flexShrink: 0,
  height: 34,
  background: "linear-gradient(#e8f1fa,#c9ddf0)",
  borderTop: `1px solid ${C.border}`,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "0 10px",
  boxSizing: "border-box",
  fontSize: 12,
};

const pagerSelect = {
  height: 22,
  border: `1px solid ${C.border}`,
  background: "#fff",
  fontSize: 12,
};

const gotoInput = {
  width: 42,
  height: 20,
  border: `1px solid ${C.border}`,
  background: "#fff",
  textAlign: "center",
  fontSize: 12,
  fontFamily: F,
};

const detailPanel = {
  background: C.panel,
  border: `1px solid ${C.border}`,
  padding: "6px 10px 12px",
  boxSizing: "border-box",
  minHeight: "100%",
};

const detailGrid = {
  display: "grid",
  gridTemplateColumns: "88px 1fr 88px 1fr 88px 1fr 88px 1fr",
  gap: "4px 8px",
  alignItems: "center",
};

const detailLabel = {
  fontSize: 12,
  textAlign: "right",
  lineHeight: "22px",
  whiteSpace: "nowrap",
};

const displayBox = {
  minHeight: 22,
  lineHeight: "20px",
  padding: "1px 5px",
  border: `1px solid ${C.border}`,
  background: "#fff",
  boxSizing: "border-box",
  color: "#111",
};

const editInput = {
  width: "100%",
  height: 22,
  padding: "0 5px",
  border: `1px solid ${C.border}`,
  background: "#fff",
  fontSize: 12,
  fontFamily: F,
  outline: "none",
  boxSizing: "border-box",
};

const primaryBtn = {
  height: 22,
  padding: "0 14px",
  border: "1px solid #005bbd",
  background: "linear-gradient(#4aa3ff,#1a73e8)",
  color: "#fff",
  fontSize: 12,
  fontFamily: F,
  cursor: "pointer",
};

const grayBtn = {
  height: 22,
  padding: "0 14px",
  border: `1px solid ${C.border}`,
  background: "linear-gradient(#fff,#e8f1fa)",
  color: "#111",
  fontSize: 12,
  fontFamily: F,
  cursor: "pointer",
};

const modalMask = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,.28)",
  zIndex: 999,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const modalBox = {
  width: 900,
  maxHeight: "88vh",
  overflow: "auto",
  background: "#fff",
  border: `1px solid ${C.border}`,
  boxShadow: "0 8px 28px rgba(0,0,0,.25)",
};
