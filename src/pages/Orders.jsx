import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "../supabase.js";
import { Spinner, ComboBox } from "../components/ui.jsx";
import { TmsTitle, Mi, MiDropdown, Tbl, Fi, TmsTabs, TmsInfoBar, TmsPagination, Df, DfCheckbox, LifecycleStamp, SopProgress } from "../components/tms.jsx";
import {
  STATUS_COLORS,
  TRADE_TERMS,
  CONTAINER_TYPES,
  BL_TYPES,
  FREIGHT_TERMS,
  TRANSPORT_TERMS,
  SHIPMENT_TYPES,
  SOP_NODES,
  isNodeDone,
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
  const [newType, setNewType] = useState("FCL");
  const [checkedIds, setCheckedIds] = useState(new Set());
  const [search, setSearch] = useState("");
  const [showFilter, setShowFilter] = useState(true);
  const [showDetail, setShowDetail] = useState(true);
  const [filters, setFilters] = useState({});
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [maxRows, setMaxRows] = useState(300);
  const [activeTab, setActiveTab] = useState("过滤");

  // 从 URL hash 解析 SOP 过滤参数（如 #/sea_export?sop=qc）
  const [sopFilter, setSopFilter] = useState(() => {
    const m = window.location.hash.match(/[?&]sop=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  });
  useEffect(() => {
    const onHashChange = () => {
      const m = window.location.hash.match(/[?&]sop=([^&]+)/);
      setSopFilter(m ? decodeURIComponent(m[1]) : null);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  const sopNode = sopFilter ? SOP_NODES.find(n => n.code === sopFilter) : null;

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
    // SOP 过滤：只显示该节点未完成 + 非已关闭/已完结的订单
    if (sopNode) {
      if (o.lifecycle === "已关闭" || o.lifecycle === "已完结") return false;
      if (sopNode.requiresHbl && !o.has_hbl) return false;
      if (isNodeDone(sopNode, o[sopNode.field])) return false;
    }
    const f = filters;
    if (f.supplier && o.supplier !== f.supplier) return false;
    if (f.customer && o.customer !== f.customer) return false;
    if (f.carrier && o.carrier !== f.carrier) return false;
    if (f.vessel && !(o.vessel || "").toLowerCase().includes(String(f.vessel).toLowerCase())) return false;
    if (f.voyage && !(o.voyage || "").toLowerCase().includes(String(f.voyage).toLowerCase())) return false;
    if (f.pol && o.pol !== f.pol) return false;
    if (f.pod && o.pod !== f.pod) return false;
    if (f.destination && o.destination !== f.destination) return false;
    if (f.booking_no && !(o.booking_no || "").toLowerCase().includes(String(f.booking_no).toLowerCase())) return false;
    if (f.booking_no && !(o.booking_no || "").toLowerCase().includes(String(f.booking_no).toLowerCase())) return false;
    if (f.container_no && !(o.container_no || "").toLowerCase().includes(String(f.container_no).toLowerCase())) return false;
    if (f.order_no && !(o.order_no || "").toLowerCase().includes(String(f.order_no).toLowerCase())) return false;
    if (f.po && !(o.po || "").toLowerCase().includes(String(f.po).toLowerCase())) return false;
    if (f.hbl_no && !(o.hbl_no || "").toLowerCase().includes(String(f.hbl_no).toLowerCase())) return false;
    if (f.etd_from && o.etd && o.etd < f.etd_from) return false;
    if (f.etd_to && o.etd && o.etd > f.etd_to) return false;
    if (search) {
      const q = search.toLowerCase();
      const pool = [o.po, o.customer_po, o.booking_no, o.container_no, o.vessel, o.voyage, o.supplier, o.order_no, o.customer, o.pol, o.pod];
      if (!pool.filter(Boolean).some(x => String(x).toLowerCase().includes(q))) return false;
    }
    return true;
  }), [shipments, filters, search, sopNode]);

  useEffect(() => { setPage(0); }, [filters, search]);

  const groupedRows = useMemo(() => {
    const mblG = {};
    const noMbl = [];
    filtered.forEach(o => {
      const k = o.booking_no;
      if (k) {
        if (!mblG[k]) mblG[k] = [];
        mblG[k].push(o);
      } else {
        noMbl.push(o);
      }
    });

    const rows = [];
    // 多票同 booking_no：主拼（order_no 不带 -N）放最上面，其他作为子分票排在下面
    Object.entries(mblG)
      .filter(([, v]) => v.length >= 2)
      .sort((a, b) => (b[1][0].created_at || "").localeCompare(a[1][0].created_at || ""))
      .forEach(([mbl, items]) => {
        // 主拼判定：order_no 不含 "-数字" 后缀
        const isMaster = (o) => o.order_no && !/-\d+$/.test(o.order_no);
        const master = items.find(isMaster) || items[0];
        const subs = items.filter(o => o !== master)
          .sort((a, b) => {
            // 分票按尾数排序（-1, -2, -3...）
            const na = parseInt((a.order_no || "").match(/-(\d+)$/)?.[1] || "999");
            const nb = parseInt((b.order_no || "").match(/-(\d+)$/)?.[1] || "999");
            return na - nb;
          });

        rows.push({ t: "s", d: master });
        subs.forEach(c => rows.push({ t: "sub", d: c }));
      });

    // 单票订单（无分组）按时间排
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

  // 列定义（默认宽度）
  const COLS_DEF = [
    { k: "chk",   w: 30,  label: "" },
    { k: "type",  w: 60,  label: "出运类型", center: true },
    { k: "ord",   w: 130, label: "作业号", link: true },
    { k: "po",    w: 140, label: "客户编号" },
    { k: "mbl",   w: 130, label: "MB/L No.", link: true },
    { k: "ves",   w: 150, label: "船名", link: true },
    { k: "voy",   w: 60,  label: "航次" },
    { k: "etd",   w: 100, label: "预计开航时间" },
    { k: "sup",   w: 180, label: "委托单位" },
    { k: "agt",   w: 140, label: "海外代理" },
    { k: "pol",   w: 110, label: "起运港名称" },
    { k: "pod",   w: 110, label: "卸货港名称" },
    { k: "dest",  w: 110, label: "目的地名称" },
    { k: "qty",   w: 80,  label: "箱型" },
    { k: "hbl",   w: 130, label: "HB/L No.", link: true },
  ];
  const COL_WIDTHS_KEY = "bansar_orders_col_widths_v1";

  // 列宽 state（从 localStorage 读，没有就用默认）
  const [colWidths, setColWidths] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(COL_WIDTHS_KEY) || "{}");
      return Object.fromEntries(COLS_DEF.map(c => [c.k, saved[c.k] || c.w]));
    } catch {
      return Object.fromEntries(COLS_DEF.map(c => [c.k, c.w]));
    }
  });

  // 持久化列宽
  const persistColWidths = (widths) => {
    setColWidths(widths);
    try { localStorage.setItem(COL_WIDTHS_KEY, JSON.stringify(widths)); } catch {}
  };

  // 拖动调整列宽：监听 mousedown
  const startColResize = (colKey, e) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = colWidths[colKey];
    const onMove = (ev) => {
      const newW = Math.max(40, startW + (ev.clientX - startX));
      setColWidths(p => ({ ...p, [colKey]: newW }));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      // 用最新值持久化
      setColWidths(latest => {
        try { localStorage.setItem(COL_WIDTHS_KEY, JSON.stringify(latest)); } catch {}
        return latest;
      });
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  // 双击列分隔线 = 重置该列宽度
  const resetColWidth = (colKey) => {
    const def = COLS_DEF.find(c => c.k === colKey);
    if (def) {
      const next = { ...colWidths, [colKey]: def.w };
      persistColWidths(next);
    }
  };

  const cols = COLS_DEF.map(c => ({ ...c, w: colWidths[c.k] }));
  const totalW = cols.reduce((a, c) => a + c.w, 0);

  return (
    <div className="tms">

      {/* 标题栏 + 顶部菜单（共享组件） */}
      <TmsTitle title={sopNode ? `海运出口 / ${sopNode.zh} 待办` : "作业 / 海运出口"} user={user} role={role} onClose={onBack} />

      {/* 工具栏 */}
      <div className="tms-mn">
        <Mi onClick={clearF}>清除</Mi>
        <Tbl/>
        <Mi checked={showDetail} onClick={() => setShowDetail(p => !p)}>显示明细</Mi>
        <Mi onClick={() => setShowFilter(p => !p)}>搜索</Mi>
        <Tbl/>
        <MiDropdown options={[
          { label: "整箱", onClick: () => { setNewType("FCL"); setShowNew(true); } },
          { label: "自拼", onClick: () => { setNewType("Console"); setShowNew(true); } },
          { label: "拼箱", onClick: () => { setNewType("LCL"); setShowNew(true); } },
        ]}>新建作业</MiDropdown>
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
            <Fi label="委托单位" refLabel>
              <ComboBox value={filters.customer || ""} onChange={v => sf("customer", v)} options={refs.customer} />
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
              <input value={filters.booking_no || ""} onChange={e => sf("booking_no", e.target.value)} />
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
        {sopNode && (
          <span style={{ marginLeft: 14, color: "#1990FF" }}>
            🔎 SOP 过滤：<b>{sopNode.zh}</b> 未完成
            <span style={{ marginLeft: 8, color: "#888", cursor: "pointer", textDecoration: "underline" }}
              onClick={() => { window.location.hash = "#/sea_export"; }}>
              清除
            </span>
          </span>
        )}
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
                      checked={paged.length > 0 && paged.every(r => checkedIds.has(r.d.id))}
                      onChange={e => {
                        const n = new Set(checkedIds);
                        if (e.target.checked) paged.forEach(r => n.add(r.d.id));
                        else paged.forEach(r => n.delete(r.d.id));
                        setCheckedIds(n);
                      }} />
                  ) : (
                    <span className="ht">{c.label}</span>
                  )}
                  <span
                    className="col-resize"
                    onMouseDown={e => startColResize(c.k, e)}
                    onDoubleClick={() => resetColWidth(c.k)}
                    title="拖动调整列宽，双击恢复默认"
                  />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paged.map((r, i) => {
              const o = r.d;
              const child = r.t === "sub";
              const checked = checkedIds.has(o.id);
              const evenOdd = i % 2 === 0 ? "even" : "odd";
              return (
                <tr key={o.id}
                  className={(checked ? "current " : "") + evenOdd}
                  onClick={() => setSelectedId(o.id)}>
                  <td className="center" onClick={e => e.stopPropagation()}>
                    <input type="checkbox" checked={checked} onChange={() => togChk(o.id)} />
                  </td>
                  <td className="center">{
                    o.shipment_type === "LCL" ? "拼箱"
                    : o.shipment_type === "Console" ? "自拼"
                    : "整箱"
                  }</td>
                  <td>
                    {child && <span className="ind">└</span>}
                    <span className="lk">{o.order_no || ""}</span>
                  </td>
                  <td>{o.po || o.customer_po || ""}</td>
                  <td><span className="lk">{o.booking_no || ""}</span></td>
                  <td><span className="lk">{o.vessel || ""}</span></td>
                  <td>{o.voyage || ""}</td>
                  <td>{o.etd || ""}</td>
                  <td>{o.customer || ""}</td>
                  <td>{o.overseas_agent || ""}</td>
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

      {showNew && <NewOrderModal defaultType={newType} onClose={() => setShowNew(false)} onSaved={() => { setShowNew(false); load(); }} />}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// OrderNoField - 作业号字段
// 主拼号主体（如 BSOEC260100001）永远 readonly
// 仅自拼分票场景下，"-N" 后缀可编辑
// 保存校验由 OrderDetail save() 调用 validateOrderNo() 处理
// ═══════════════════════════════════════════════════════════════
function OrderNoField({ order, editing, onChange }) {
  const orderNo = order.order_no || "";
  const isConsole = order.shipment_type === "Console";
  const dashIdx = orderNo.lastIndexOf("-");
  const hasSubSuffix = dashIdx > 0 && /^\d+$/.test(orderNo.substring(dashIdx + 1));

  // 非自拼柜 / 自拼主拼：完全 readonly
  if (!isConsole || !hasSubSuffix) {
    return <input value={orderNo} disabled className="readonly" />;
  }

  // 自拼分票：拆成主体 + 尾数
  const main = orderNo.substring(0, dashIdx);  // BSOEC260100001
  const tail = orderNo.substring(dashIdx + 1); // 1 / 23 / 99...

  if (!editing) {
    return <input value={orderNo} disabled className="readonly" />;
  }

  // 编辑模式：主体 readonly，尾数可改
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 0, width: "100%" }}>
      <input value={main + "-"} disabled className="readonly" style={{ flex: 1, minWidth: 0, borderRight: "none", borderTopRightRadius: 0, borderBottomRightRadius: 0 }} />
      <input
        value={tail}
        onChange={e => {
          const v = e.target.value.replace(/\D/g, "");  // 仅数字
          onChange("order_no", v ? main + "-" + v : main);
        }}
        style={{ width: 60, borderLeft: "none", borderTopLeftRadius: 0, borderBottomLeftRadius: 0, textAlign: "center", fontWeight: "bold", color: "#1990FF" }}
        placeholder="N"
        title="分票尾数（仅数字，同主拼下唯一）"
      />
    </div>
  );
}


function OrderDetail({ order, role, user, onBack, onReload }) {
  const [editing, setEditing] = useState(false);
  const [ed, setEd] = useState({});
  const [tab, setTab] = useState("作业");
  const [subtab, setSubtab] = useState("托单信息");
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

    // 校验：order_no 改动后，同主拼下尾数不能重复
    if (changes.order_no && changes.order_no !== order.order_no) {
      const newNo = changes.order_no;
      // 检查全库唯一性
      const { data: dup } = await supabase.from("shipments")
        .select("id")
        .eq("order_no", newNo)
        .neq("id", order.id)
        .limit(1);
      if (dup && dup.length > 0) {
        // 自动建议下一个空位
        const dashIdx = newNo.lastIndexOf("-");
        if (dashIdx > 0) {
          const main = newNo.substring(0, dashIdx);
          const { data: siblings } = await supabase.from("shipments")
            .select("order_no")
            .like("order_no", main + "-%");
          const usedNumbers = new Set((siblings || [])
            .map(s => parseInt(s.order_no.substring(main.length + 1)))
            .filter(n => !Number.isNaN(n)));
          let next = 1;
          while (usedNumbers.has(next)) next++;
          alert(`尾数 ${newNo.substring(dashIdx + 1)} 已被使用。建议使用 ${next}（即 ${main}-${next}）`);
          return;
        }
        alert(`作业号 ${newNo} 已被使用，请改其他号`);
        return;
      }
    }

    if (Object.keys(changes).length) {
      const { error } = await supabase.from("shipments").update(changes).eq("id", order.id);
      if (error) { alert(error.message); return; }
    }
    setEditing(false);
    onReload();
  };

  // 单字段直接保存（SOP 节点状态变更、has_hbl 切换、生命周期变更等）
  const updateField = async (field, value) => {
    const { error } = await supabase.from("shipments").update({ [field]: value }).eq("id", order.id);
    if (error) { alert(error.message); return; }
    onReload();
  };

  const setLifecycle = async (lc) => {
    const updates = { lifecycle: lc };
    if (lc === "已完结") {
      updates.completed_at = new Date().toISOString();
      updates.completed_by = user?.id || null;
    }
    const { error } = await supabase.from("shipments").update(updates).eq("id", order.id);
    if (error) { alert(error.message); return; }
    onReload();
  };

  const v = (f) => editing ? (ed[f] ?? "") : (order[f] ?? "");
  const ch = (f, val) => setEd(p => ({ ...p, [f]: val }));

  const titlePrefix = order.shipment_type === "LCL" ? "拼箱" : order.shipment_type === "Console" ? "自拼" : "整箱";
  const isLocked = order.lifecycle === "已完结" || order.lifecycle === "已关闭";

  // 主拼判定：自拼柜 且 order_no 不含 -N 后缀
  const isMaster = order.shipment_type === "Console"
    && order.order_no
    && !/-\d+$/.test(order.order_no);

  // 创建分票
  const createSubTicket = async () => {
    if (!isMaster) return;
    // 找已用的尾数
    const { data: siblings } = await supabase.from("shipments")
      .select("order_no")
      .like("order_no", order.order_no + "-%");
    const usedNumbers = new Set((siblings || [])
      .map(s => parseInt(s.order_no.substring(order.order_no.length + 1)))
      .filter(n => !Number.isNaN(n)));

    // 找下一个空位
    let suggested = 1;
    while (usedNumbers.has(suggested)) suggested++;

    const input = prompt(`新建分票尾数（数字，留空使用 ${suggested}）：`, suggested);
    if (input === null) return;  // 取消
    const tail = String(input).trim() || String(suggested);
    if (!/^\d+$/.test(tail)) { alert("尾数必须是数字"); return; }
    if (usedNumbers.has(parseInt(tail))) {
      alert(`尾数 ${tail} 已被使用，请改其他号`);
      return;
    }

    const newOrderNo = order.order_no + "-" + tail;
    // 复制主拼的关键字段创建分票
    const newRow = {
      order_no: newOrderNo,
      shipment_type: "Console",
      booking_no: order.booking_no,
      vessel: order.vessel,
      voyage: order.voyage,
      pol: order.pol,
      pod: order.pod,
      destination: order.destination,
      etd: order.etd,
      carrier: order.carrier,
      overseas_agent: order.overseas_agent,
      solicit_type: order.solicit_type,
      lifecycle: '处理中',
    };
    const { error } = await supabase.from("shipments").insert(newRow);
    if (error) { alert("新建失败：" + error.message); return; }
    alert(`分票 ${newOrderNo} 已创建。请在列表中找到并完善其他信息。`);
    onReload();
  };

  const cargoFromContainerItems = cargoItems;

  return (
    <div className="tms">
      <TmsTitle title={`${titlePrefix} / 海运出口`} user={user} role={role} onClose={onBack} />

      {/* 第一行工具栏：主操作（白底） */}
      <div className="tms-dtb1">
        <Mi onClick={onBack}>返回</Mi>
        <Tbl/>
        <Mi disabled={isLocked}>新建</Mi>
        <Mi disabled={isLocked}>复制</Mi>
        {isMaster && <Mi disabled={isLocked} onClick={createSubTicket}>+ 分票</Mi>}
        <Mi disabled={isLocked}>删除</Mi>
        <Tbl/>
        <Mi disabled={isLocked}>舱单确认</Mi>
        <Mi disabled={isLocked}>航线确认</Mi>
        <Mi disabled={isLocked}>订舱确认</Mi>
        <Mi disabled={isLocked}>放舱确认</Mi>
        <Mi disabled={isLocked}>放箱确认</Mi>
        <Mi disabled={isLocked}>开船确认</Mi>
        <Mi disabled={isLocked}>单证锁定</Mi>
        <Tbl/>
        <Mi disabled={order.lifecycle === "已关闭"} onClick={() => {
          if (confirm("确定关闭此作业？")) setLifecycle("已关闭");
        }}>关闭作业</Mi>
        <Mi disabled={order.lifecycle === "已完结" || order.lifecycle === "已关闭"} onClick={() => {
          if (confirm("确定完结此作业？完结后只能查看，不能编辑。")) setLifecycle("已完结");
        }}>完结作业</Mi>
        {(order.lifecycle === "已完结" || order.lifecycle === "已关闭") && (
          <Mi onClick={() => setLifecycle("处理中")}>恢复处理中</Mi>
        )}
        <Tbl/>
        <Mi>内部利润分析</Mi>
        <Mi arrow>动作</Mi>
        <Mi arrow>打印</Mi>
        <Mi disabled>上行</Mi>
        <Mi disabled>下行</Mi>
        <Tbl/>
        <Mi onClick={onBack}>关闭</Mi>
      </div>

      {/* 大 tab：作业 / 装箱 / 费用 / 凭证 / 代理对账单 / 附件 / SOP 进度 */}
      <div className="tms-bigtabs">
        {["作业", "装箱", "费用", "凭证", "代理对账单", "附件", "SOP 进度"].map(t => (
          <div key={t} className={"bt " + (tab === t ? "act" : "")} onClick={() => setTab(t)}>
            {t === "SOP 进度" && (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 11 12 14 22 4"/>
                <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
              </svg>
            )}
            {t}
          </div>
        ))}
      </div>

      {/* 第二行工具栏：子操作（米色） */}
      <div className="tms-dtb2">
        {!editing ? (
          <Mi disabled={isLocked} onClick={startEdit}>编辑</Mi>
        ) : (
          <>
            <Mi onClick={save}>保存</Mi>
            <Mi onClick={cancel}>取消</Mi>
          </>
        )}
        <Mi arrow>订舱模板</Mi>
        <Mi arrow>费用确认</Mi>
        <Mi arrow>相关操作</Mi>
        <Mi arrow>动作</Mi>
        <Mi onClick={onReload}>刷新</Mi>
        <Mi>显示预览</Mi>
        <Mi arrow>数据交换</Mi>
        <Mi arrow>通知</Mi>
        <Mi arrow>打印</Mi>
        <Mi>工作流</Mi>
        <Mi>附件</Mi>
        <Mi>历史</Mi>
        <Mi arrow>系统功能</Mi>
      </div>

      {/* 主体 */}
      <div className="tms-detail-body">
        <LifecycleStamp shipment={order} />

        {tab === "作业" && (
          <>
            {/* ─── 基本信息 ─── */}
            <div className="tms-detail-section">基本信息</div>
            <div className="tms-detail-panel">
              <div className="tms-detail-grid">
                <Df label="作业号"><OrderNoField order={order} editing={editing} onChange={ch} /></Df>
                <Df label="委托单位" required>
                  {editing
                    ? <ComboBox value={v("customer")} onChange={val => ch("customer", val)} options={refData.customers} />
                    : <input value={v("customer")} disabled className="notnull" />}
                </Df>
                <Df label="订舱代理"><input value={v("booking_agent")} onChange={e => ch("booking_agent", e.target.value)} disabled={!editing} /></Df>
                <Df label="操作员"><input value={v("operator")} onChange={e => ch("operator", e.target.value)} disabled={!editing} /></Df>
                <Df label="销售员"><input value={v("salesperson")} onChange={e => ch("salesperson", e.target.value)} disabled={!editing} /></Df>
                <Df label="客服"><input value={v("cs")} onChange={e => ch("cs", e.target.value)} disabled={!editing} /></Df>

                <Df label="出运类型">
                  <select value={v("shipment_type")} onChange={e => ch("shipment_type", e.target.value)} disabled={!editing}>
                    <option value="FCL">整箱</option>
                    <option value="LCL">拼箱</option>
                    <option value="Console">自拼</option>
                  </select>
                </Df>
                <Df label="联系人"><input value={v("contact")} onChange={e => ch("contact", e.target.value)} disabled={!editing} /></Df>
                <Df label="船东">
                  {editing
                    ? <ComboBox value={v("carrier")} onChange={val => ch("carrier", val)} options={refData.suppliers} />
                    : <input value={v("carrier")} disabled />}
                </Df>
                <Df label="单证"><input value={v("documenter")} onChange={e => ch("documenter", e.target.value)} disabled={!editing} /></Df>
                <Df label="商务"><input value={v("commercial")} onChange={e => ch("commercial", e.target.value)} disabled={!editing} /></Df>
                <Df label="委托部门"><input value={v("entrust_dept")} onChange={e => ch("entrust_dept", e.target.value)} disabled={!editing} /></Df>

                <Df label="出运状态">
                  <select value={v("space_status") || "未订舱"} onChange={e => ch("space_status", e.target.value)} disabled={!editing}>
                    <option>未订舱</option><option>已订舱</option>
                  </select>
                </Df>
                <Df label="电话"><input value={v("phone")} onChange={e => ch("phone", e.target.value)} disabled={!editing} /></Df>
                <Df label="船名" refLabel>
                  {editing
                    ? <ComboBox value={v("vessel")} onChange={val => ch("vessel", val)} options={[]} />
                    : <input value={v("vessel")} disabled className="notnull" />}
                </Df>
                <Df label="状态"><input value={v("status") || "处理中"} disabled className="readonly" /></Df>
                <Df label="贸易条款">
                  <select value={v("trade_term") || ""} onChange={e => ch("trade_term", e.target.value)} disabled={!editing}>
                    <option value=""></option>
                    {TRADE_TERMS.map(t => <option key={t}>{t}</option>)}
                  </select>
                </Df>
                <Df label="航线"><input value={v("route")} onChange={e => ch("route", e.target.value)} disabled={!editing} /></Df>

                <Df label="MB/L No." required><input value={v("booking_no")} onChange={e => ch("booking_no", e.target.value)} disabled={!editing} className="notnull" /></Df>
                <Df label="委托人手机"><input value={v("contact_phone")} onChange={e => ch("contact_phone", e.target.value)} disabled={!editing} /></Df>
                <Df label="航次" refLabel><input value={v("voyage")} onChange={e => ch("voyage", e.target.value)} disabled={!editing} className="notnull" /></Df>
                <Df label="揽货类型">
                  <select value={v("solicit_type") || "代理货"} onChange={e => ch("solicit_type", e.target.value)} disabled={!editing}>
                    <option>自揽货</option>
                    <option>代理货</option>
                    <option>待订舱</option>
                  </select>
                </Df>
                <Df label="揽货代理"><input value={v("solicitation_agent")} onChange={e => ch("solicitation_agent", e.target.value)} disabled={!editing} /></Df>
                <Df label="海外代理">
                  {editing
                    ? <ComboBox value={v("overseas_agent")} onChange={val => ch("overseas_agent", val)} options={refData.customers} />
                    : <input value={v("overseas_agent")} disabled />}
                </Df>

                <Df label="HB/L No." optional>
                  <input value={v("hbl_no")} onChange={e => ch("hbl_no", e.target.value)} disabled={!editing} placeholder={!order.has_hbl ? "未签 HBL" : ""} />
                </Df>
                <Df label="邮件"><input value={v("email")} onChange={e => ch("email", e.target.value)} disabled={!editing} /></Df>
                <Df label="预计开航时间"><input type="date" value={v("etd")} onChange={e => ch("etd", e.target.value)} disabled={!editing} /></Df>
                <Df label="实际开航时间"><input type="date" value={v("atd")} onChange={e => ch("atd", e.target.value)} disabled={!editing} /></Df>
                <Df label="预计到港时间"><input type="date" value={v("eta")} onChange={e => ch("eta", e.target.value)} disabled={!editing} /></Df>
                <Df label="清关日期"><input type="date" value={v("customs_clear_date")} onChange={e => ch("customs_clear_date", e.target.value)} disabled={!editing} /></Df>

                <Df label="客户编号"><input value={v("po")} onChange={e => ch("po", e.target.value)} disabled={!editing} /></Df>
                <Df label="付款方式">
                  <select value={v("payment_term") || ""} onChange={e => ch("payment_term", e.target.value)} disabled={!editing}>
                    <option value=""></option>
                    {FREIGHT_TERMS.map(t => <option key={t}>{t}</option>)}
                  </select>
                </Df>
                <Df label="出单类型">
                  <select value={v("bl_type") || ""} onChange={e => ch("bl_type", e.target.value)} disabled={!editing}>
                    <option value=""></option>
                    {BL_TYPES.map(t => <option key={t}>{t}</option>)}
                  </select>
                </Df>
                <Df label="正本份数"><input type="number" value={v("original_count")} onChange={e => ch("original_count", e.target.value)} disabled={!editing} /></Df>
                <Df label="副本份数"><input type="number" value={v("copy_count")} onChange={e => ch("copy_count", e.target.value)} disabled={!editing} /></Df>
                <Df label="服务类型">
                  <select value={v("service_type") || ""} onChange={e => ch("service_type", e.target.value)} disabled={!editing}>
                    <option value=""></option>
                    {TRANSPORT_TERMS.map(t => <option key={t}>{t}</option>)}
                  </select>
                </Df>

                <Df label="操作备注" span={3}><textarea value={v("operator_note")} onChange={e => ch("operator_note", e.target.value)} disabled={!editing} /></Df>
                <Df label="内部备注" span={3}><textarea value={v("internal_note")} onChange={e => ch("internal_note", e.target.value)} disabled={!editing} /></Df>
              </div>
            </div>

            {/* ─── 业务勾选 ─── */}
            <div className="tms-detail-cbgroup">
              <DfCheckbox label="拖车" checked={v("has_trucking")} onChange={val => editing ? ch("has_trucking", val) : updateField("has_trucking", val)} />
              <DfCheckbox label="报关" checked={v("has_customs")} onChange={val => editing ? ch("has_customs", val) : updateField("has_customs", val)} />
              <DfCheckbox label="仓储" checked={v("has_warehouse")} onChange={val => editing ? ch("has_warehouse", val) : updateField("has_warehouse", val)} />
              <DfCheckbox label="保险" checked={v("has_insurance")} onChange={val => editing ? ch("has_insurance", val) : updateField("has_insurance", val)} />
              <DfCheckbox label="AMS" checked={v("has_ams")} onChange={val => editing ? ch("has_ams", val) : updateField("has_ams", val)} />
              <DfCheckbox label="ENS" checked={v("has_ens")} onChange={val => editing ? ch("has_ens", val) : updateField("has_ens", val)} />
              <span style={{ marginLeft: "auto", color: "#1990FF", fontWeight: "bold" }}>
                <DfCheckbox label="签 HB/L 提单" checked={v("has_hbl")} onChange={val => editing ? ch("has_hbl", val) : updateField("has_hbl", val)} />
              </span>
            </div>

            {/* ─── 子 tab：托单信息 / 船东舱单 / 货物 / 集装箱 / MB/L / HB/L / 其它信息 / 目的港信息 ─── */}
            <div className="tms-subtabs">
              {["托单信息", "船东舱单", "货物", "集装箱", "MB/L", "HB/L", "其它信息", "目的港信息"].filter(t => t !== "HB/L" || order.has_hbl).map(t => (
                <div key={t} className={"st " + (subtab === t ? "act" : "")} onClick={() => setSubtab(t)}>{t}</div>
              ))}
            </div>

            <div className="tms-detail-panel-light">
              {subtab === "托单信息" && (
                <div className="tms-detail-grid">
                  <Df label="发货人" refLabel span={2}><textarea value={v("shipper_name")} onChange={e => ch("shipper_name", e.target.value)} disabled={!editing} /></Df>
                  <Df label="收货人" refLabel span={2}><textarea value={v("consignee_name")} onChange={e => ch("consignee_name", e.target.value)} disabled={!editing} /></Df>
                  <Df label="通知人" span={2}><textarea value={v("notify_party")} onChange={e => ch("notify_party", e.target.value)} disabled={!editing} /></Df>
                  <Df label="起运港" refLabel><input value={v("pol")} onChange={e => ch("pol", e.target.value)} disabled={!editing} /></Df>
                  <Df label="卸货港" refLabel><input value={v("pod")} onChange={e => ch("pod", e.target.value)} disabled={!editing} /></Df>
                  <Df label="目的地"><input value={v("destination")} onChange={e => ch("destination", e.target.value)} disabled={!editing} /></Df>
                  <Df label="箱型箱量"><input value={v("qty_container")} onChange={e => ch("qty_container", e.target.value)} disabled={!editing} /></Df>
                  <Df label="货物种类"><input value={v("cargo_type") || "普通"} onChange={e => ch("cargo_type", e.target.value)} disabled={!editing} /></Df>
                  <Df label="唛头" span={2}><textarea value={v("marks")} onChange={e => ch("marks", e.target.value)} disabled={!editing} /></Df>
                  <Df label="品名货描" span={3}><textarea value={v("description")} onChange={e => ch("description", e.target.value)} disabled={!editing} /></Df>
                </div>
              )}

              {subtab === "船东舱单" && (
                <div className="tms-detail-grid">
                  <Df label="发货人" refLabel><input value={v("carrier_shipper")} onChange={e => ch("carrier_shipper", e.target.value)} disabled={!editing} /></Df>
                  <Df label="收货地代码"><input value={v("place_of_receipt_code") || "CNNGB"} disabled={!editing} onChange={e => ch("place_of_receipt_code", e.target.value)} /></Df>
                  <Df label="收货地"><input value={v("place_of_receipt") || "NINGBO"} disabled={!editing} onChange={e => ch("place_of_receipt", e.target.value)} /></Df>
                  <Df label="起运港" refLabel><input value={v("carrier_pol_code") || "CNNGB"} disabled={!editing} onChange={e => ch("carrier_pol_code", e.target.value)} /></Df>
                  <Df label="卸货港" refLabel><input value={v("carrier_pod_code")} disabled={!editing} onChange={e => ch("carrier_pod_code", e.target.value)} /></Df>
                  <Df label="交货地"><input value={v("place_of_delivery_code")} disabled={!editing} onChange={e => ch("place_of_delivery_code", e.target.value)} /></Df>
                  <Df label="目的地"><input value={v("destination_code")} disabled={!editing} onChange={e => ch("destination_code", e.target.value)} /></Df>
                  <Df label="付款方式"><input value={v("carrier_payment_term") || "预付"} disabled={!editing} onChange={e => ch("carrier_payment_term", e.target.value)} /></Df>
                  <Df label="服务类型"><input value={v("carrier_service") || "CY-CY"} disabled={!editing} onChange={e => ch("carrier_service", e.target.value)} /></Df>
                  <Df label="企业代码" required><input value={v("enterprise_code")} disabled={!editing} onChange={e => ch("enterprise_code", e.target.value)} /></Df>
                </div>
              )}

              {subtab === "货物" && (
                <div style={{ overflow: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: "linear-gradient(#f9f9f9,#f0f0f0)" }}>
                        <th style={cellHead}>行号</th><th style={cellHead}>流水号</th><th style={cellHead}>MB/L No.</th>
                        <th style={cellHead}>船东参考编号</th><th style={cellHead}>品名</th><th style={cellHead}>HSCode</th>
                        <th style={cellHead}>件数</th><th style={cellHead}>包装</th><th style={cellHead}>毛重</th><th style={cellHead}>体积</th>
                      </tr>
                    </thead>
                    <tbody>
                      {cargoFromContainerItems.length === 0 ? (
                        <tr><td colSpan={10} style={{ padding: 30, textAlign: "center", color: "#888" }}>暂无货物明细</td></tr>
                      ) : cargoFromContainerItems.map((it, i) => (
                        <tr key={it.id || i} style={{ background: i % 2 ? "#fafafa" : "#fff" }}>
                          <td style={cellBody}>{(i + 1) * 10}</td>
                          <td style={cellBody}>{it.serial_no || it.id}</td>
                          <td style={cellBody}>{order.booking_no || ""}</td>
                          <td style={cellBody}>{it.carrier_ref || ""}</td>
                          <td style={cellBody}>{it.product_name || ""}</td>
                          <td style={cellBody}>{it.hs_code || ""}</td>
                          <td style={cellBody}>{it.cartons || ""}</td>
                          <td style={cellBody}>{it.package || "CARTONS"}</td>
                          <td style={cellBody}>{it.gross_weight || ""}</td>
                          <td style={cellBody}>{it.volume || ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {subtab === "集装箱" && (
                <div style={{ overflow: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: "linear-gradient(#f9f9f9,#f0f0f0)" }}>
                        <th style={cellHead}>行号</th><th style={cellHead}>流水号</th><th style={cellHead}>MB/L No.</th>
                        <th style={cellHead}>HB/L No.</th><th style={cellHead}>箱型</th><th style={cellHead}>箱号</th>
                        <th style={cellHead}>封号</th><th style={cellHead}>件数</th><th style={cellHead}>包装</th>
                        <th style={cellHead}>毛重</th><th style={cellHead}>体积</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        const matches = (order.qty_container || "").match(/(\d+)\s*x\s*((?:20|40|45)(?:GP|HQ|RF|OT|FR)?)/gi) || [];
                        const rows = [];
                        let row = 1;
                        for (const m of matches) {
                          const [, count, type] = m.match(/(\d+)\s*x\s*((?:20|40|45)(?:GP|HQ|RF|OT|FR)?)/i);
                          for (let i = 0; i < parseInt(count); i++) {
                            rows.push({ no: row * 10, type });
                            row++;
                          }
                        }
                        return rows.length === 0 ? (
                          <tr><td colSpan={11} style={{ padding: 30, textAlign: "center", color: "#888" }}>暂无集装箱信息</td></tr>
                        ) : rows.map((r, i) => (
                          <tr key={i} style={{ background: i % 2 ? "#fafafa" : "#fff" }}>
                            <td style={cellBody}>{r.no}</td>
                            <td style={cellBody}>{order.order_no}-{i + 1}</td>
                            <td style={cellBody}>{order.booking_no || ""}</td>
                            <td style={cellBody}>{order.hbl_no || ""}</td>
                            <td style={cellBody}>{r.type}</td>
                            <td style={cellBody}></td>
                            <td style={cellBody}></td>
                            <td style={cellBody}></td>
                            <td style={cellBody}></td>
                            <td style={cellBody}></td>
                            <td style={cellBody}></td>
                          </tr>
                        ));
                      })()}
                    </tbody>
                  </table>
                </div>
              )}

              {subtab === "MB/L" && (
                <div className="tms-detail-grid">
                  <Df label="MB/L No." required><input value={v("booking_no")} onChange={e => ch("booking_no", e.target.value)} disabled={!editing} className="notnull" /></Df>
                  <Df label="MB/L 状态">
                    <select value={v("mbl_status") || "未签单"} onChange={e => ch("mbl_status", e.target.value)} disabled={!editing}>
                      <option>未签单</option><option>已签单</option><option>已放单</option><option>已电放</option>
                    </select>
                  </Df>
                  <Df label="签发地"><input value={v("place_of_issue")} onChange={e => ch("place_of_issue", e.target.value)} disabled={!editing} /></Df>
                  <Df label="签发日期"><input type="date" value={v("date_of_issue")} onChange={e => ch("date_of_issue", e.target.value)} disabled={!editing} /></Df>
                  <Df label="电放号"><input value={v("telex_release_no")} onChange={e => ch("telex_release_no", e.target.value)} disabled={!editing} /></Df>
                  <Df label="电放日期"><input type="date" value={v("telex_release_date")} onChange={e => ch("telex_release_date", e.target.value)} disabled={!editing} /></Df>
                </div>
              )}

              {subtab === "HB/L" && order.has_hbl && (
                <div className="tms-detail-grid">
                  <Df label="HB/L No."><input value={v("hbl_no")} onChange={e => ch("hbl_no", e.target.value)} disabled={!editing} /></Df>
                  <Df label="HB/L 状态">
                    <select value={v("hbl_status") || "未签单"} onChange={e => ch("hbl_status", e.target.value)} disabled={!editing}>
                      <option>未签单</option><option>已签单</option><option>已放单</option><option>已电放</option>
                    </select>
                  </Df>
                  <Df label="签发地"><input value={v("hbl_place_of_issue")} onChange={e => ch("hbl_place_of_issue", e.target.value)} disabled={!editing} /></Df>
                  <Df label="签发日期"><input type="date" value={v("hbl_date_of_issue")} onChange={e => ch("hbl_date_of_issue", e.target.value)} disabled={!editing} /></Df>
                </div>
              )}

              {subtab === "其它信息" && (
                <div className="tms-detail-grid">
                  <Df label="约号"><input value={v("contract_no")} onChange={e => ch("contract_no", e.target.value)} disabled={!editing} /></Df>
                  <Df label="订舱日期"><input type="date" value={v("booking_date")} onChange={e => ch("booking_date", e.target.value)} disabled={!editing} /></Df>
                  <Df label="截单日期"><input type="date" value={v("doc_cutoff_date")} onChange={e => ch("doc_cutoff_date", e.target.value)} disabled={!editing} /></Df>
                  <Df label="AMS截止日期"><input type="date" value={v("ams_cutoff")} onChange={e => ch("ams_cutoff", e.target.value)} disabled={!editing} /></Df>
                  <Df label="ENS截止日期"><input type="date" value={v("ens_cutoff")} onChange={e => ch("ens_cutoff", e.target.value)} disabled={!editing} /></Df>
                  <Df label="业务类型"><input value={v("business_type")} onChange={e => ch("business_type", e.target.value)} disabled={!editing} /></Df>
                  <Df label="海运提单类型">
                    <select value={v("ocean_bl_type") || "正本提单"} onChange={e => ch("ocean_bl_type", e.target.value)} disabled={!editing}>
                      <option>正本提单</option><option>电放提单</option><option>SWB</option>
                    </select>
                  </Df>
                  <Df label="报关行"><input value={v("customs_broker")} onChange={e => ch("customs_broker", e.target.value)} disabled={!editing} /></Df>
                </div>
              )}

              {subtab === "目的港信息" && (
                <div className="tms-detail-grid">
                  <Df label="目的港代理"><input value={v("destination_agent")} onChange={e => ch("destination_agent", e.target.value)} disabled={!editing} /></Df>
                  <Df label="第三方付款地"><input value={v("third_party_payment_place")} onChange={e => ch("third_party_payment_place", e.target.value)} disabled={!editing} /></Df>
                  <Df label="目的港码头"><input value={v("destination_terminal")} onChange={e => ch("destination_terminal", e.target.value)} disabled={!editing} /></Df>
                </div>
              )}
            </div>
          </>
        )}

        {tab === "装箱" && (
          <div style={{ padding: 30, color: "#888", textAlign: "center" }}>
            装箱详细信息（暂用作业 tab 下的"集装箱"子 tab 替代）
          </div>
        )}

        {tab === "费用" && (
          <div style={{ padding: 30, color: "#888", textAlign: "center" }}>
            费用录入功能开发中
          </div>
        )}

        {tab === "凭证" && (
          <div style={{ padding: 30, color: "#888", textAlign: "center" }}>凭证管理功能开发中</div>
        )}

        {tab === "代理对账单" && (
          <div style={{ padding: 30, color: "#888", textAlign: "center" }}>代理对账单功能开发中</div>
        )}

        {tab === "附件" && (
          <div style={{ padding: 30, color: "#888", textAlign: "center" }}>附件管理功能开发中</div>
        )}

        {tab === "SOP 进度" && (
          <SopProgress shipment={order} onUpdate={updateField} disabled={isLocked} />
        )}
      </div>
    </div>
  );
}

const cellHead = { padding: "5px 8px", border: "1px solid #ddd", fontSize: 12, fontWeight: "bold", color: "#444", textAlign: "left", whiteSpace: "nowrap" };
const cellBody = { padding: "5px 8px", border: "1px solid #ddd", fontSize: 12, whiteSpace: "nowrap" };


function NewOrderModal({ onClose, onSaved, defaultType = "FCL" }) {
  const [form, setForm] = useState({
    po: "", customer_po: "", supplier: "", customer: "", carrier: "", carrier_agent: "",
    vessel: "", pol: "", pod: "", etd: "", incoterms: "FOB", booking_no: "", shipment_type: defaultType
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
