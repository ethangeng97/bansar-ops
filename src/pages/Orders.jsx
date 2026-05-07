import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { supabase } from "../supabase.js";
import { Spinner, ComboBox } from "../components/ui.jsx";
import { TmsTitle, Mi, MiDropdown, Tbl, Fi, TmsTabs, TmsInfoBar, TmsPagination, Df, DfCheckbox, LifecycleStamp, SopProgress } from "../components/tms.jsx";
import PortPicker from "../components/PortPicker.jsx";
import ContainerEditor from "../components/ContainerEditor.jsx";
import { validateAsciiOnly, validateNoFullWidthSymbols, liveUpper } from "../lib/validators.js";
import { getCachedRef, invalidate as invalidateRef } from "../lib/ref-cache.js";
import { filterShipmentPayload } from "../lib/shipment-fields.js";
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

// 列定义（OrdersPage 共用，组件外避免每次渲染重建）
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

// 小票表格列定义（主拼详情页"小票" tab 用）
const TX_COLS_DEF = [
  { k: "ord", w: 140, label: "业务编号" },
  { k: "hbl", w: 130, label: "HBL" },
  { k: "cus", w: 160, label: "委托单位" },
  { k: "des", w: 200, label: "品名" },
  { k: "pkg", w: 80,  label: "件数",       align: "right" },
  { k: "wt",  w: 100, label: "毛重 (KG)",  align: "right" },
  { k: "vol", w: 90,  label: "体积 (CBM)", align: "right" },
  { k: "act", w: 60,  label: "操作",       align: "center" },
];
const TX_COL_WIDTHS_KEY = "bansar_subtickets_col_widths_v1";

export function OrdersPage({ user, onBack }) {
  const role = user.profile?.role || "operator";
  const [shipments, setShipments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(() => {
    const m = window.location.hash.match(/[?&]id=([^&]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  });
  // 详情页用的完整订单数据（列表 select 精简了字段，详情页要全字段）
  const [fullOrder, setFullOrder] = useState(null);
  const [fullOrderLoading, setFullOrderLoading] = useState(false);
  useEffect(() => {
    if (!selectedId) { setFullOrder(null); return; }
    setFullOrderLoading(true);
    supabase.from("shipments").select("*").eq("id", selectedId).single()
      .then(({ data, error }) => {
        if (!error && data) setFullOrder(data);
        setFullOrderLoading(false);
      });
  }, [selectedId]);
  const [checkedIds, setCheckedIds] = useState(new Set());
  const [search, setSearch] = useState("");
  const [showFilter, setShowFilter] = useState(true);
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

  // 创建模式状态（来自 ?action=new&type=xxx）
  const [createMode, setCreateMode] = useState(() => {
    const m = window.location.hash.match(/[?&]action=([^&]+)/);
    if (m && m[1] === "new") {
      const tm = window.location.hash.match(/[?&]type=([^&]+)/);
      if (tm) {
        const t = decodeURIComponent(tm[1]);
        return ["FCL", "LCL", "Console"].includes(t) ? t : "FCL";
      }
      // 没 type → null，下面会显示类型选择对话框
    }
    return null;
  });
  // 类型选择对话框（当 URL 有 action=new 但没 type 时显示）
  const [showTypePicker, setShowTypePicker] = useState(() => {
    const m = window.location.hash.match(/[?&]action=([^&]+)/);
    if (m && m[1] === "new") {
      return !window.location.hash.match(/[?&]type=([^&]+)/);
    }
    return false;
  });

  // 列表页 / 详情页 title 由 OrderDetail 内部维护；列表态用通用名
  useEffect(() => {
    if (!selectedId) document.title = "海运出口 - Bansar OPS";
  }, [selectedId]);

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

  // 拖动调整列宽
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
      setColWidths(latest => {
        try { localStorage.setItem(COL_WIDTHS_KEY, JSON.stringify(latest)); } catch {}
        return latest;
      });
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  // 双击列分隔线 = 重置该列
  const resetColWidth = (colKey) => {
    const def = COLS_DEF.find(c => c.k === colKey);
    if (def) {
      const next = { ...colWidths, [colKey]: def.w };
      persistColWidths(next);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // ── 性能优化 ──
      // 1. 只 select 列表展示和筛选用到的字段（减 ~65% 流量 vs select *）
      // 2. 默认 limit 500，排除已关闭/已完结（减少 RTT）
      // 3. 详情页另起 select * 拉全字段
      const COLUMNS = [
        "id", "order_no", "shipment_type", "po", "customer_po",
        "booking_no", "vessel", "voyage", "etd",
        "customer", "supplier", "overseas_agent", "carrier",
        "pol", "pod", "destination", "qty_container", "container_no",
        "hbl_no", "mbl_no",
        "lifecycle", "has_hbl", "created_at",
        "qc_status", "space_status", "hbl_status", "mbl_status", "finance_status",
        "operator_id", "salesperson_id",
      ].join(",");

      let query = supabase.from("shipments")
        .select(COLUMNS)
        .order("created_at", { ascending: false })
        .limit(500);

      // 权限过滤：admin / finance 看全部；operator 看自己操作；sales 看自己销售；agent 看自己代理
      const userId = user?.id;
      if (role === "operator") {
        query = query.eq("operator_id", userId);
      } else if (role === "sales") {
        query = query.eq("salesperson_id", userId);
      } else if (role === "customer" || role === "agent") {
        const customerName = user?.profile?.customer_name;
        if (customerName) {
          query = query.eq("overseas_agent", customerName);
        } else {
          query = query.eq("id", "00000000-0000-0000-0000-000000000000");
        }
      }
      // admin / finance：不加过滤

      const { data, error } = await query;
      if (error) console.error("load shipments error:", error);
      setShipments(data || []);
    } finally {
      setLoading(false);
    }
  }, [role, user?.id, user?.profile?.full_name]);

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

  // 详情态优先用完整数据（含所有字段），fallback 到列表精简数据
  const selOrder = fullOrder && fullOrder.id === selectedId
    ? fullOrder
    : shipments.find(o => o.id === selectedId);

  if (loading) return <Spinner />;

  // 从外部 URL ?id=xxx 进来但找不到该订单 → 显示提示
  // （但 fullOrder 还在拉时，不算"未找到"，先等）
  if (selectedId && !selOrder && !fullOrderLoading) return (
    <div style={{ padding: 50, textAlign: "center", color: "#999" }}>
      <div style={{ fontSize: 16, marginBottom: 12 }}>订单未找到</div>
      <div style={{ fontSize: 12, marginBottom: 20 }}>该订单可能已被删除，或您没有访问权限</div>
      <button onClick={() => { setSelectedId(null); window.history.replaceState(null, "", "#/sea_export"); }}
        style={{ padding: "6px 16px", background: "#1990FF", color: "#fff", border: "none", borderRadius: 3, cursor: "pointer" }}>
        返回列表
      </button>
    </div>
  );

  // 类型选择对话框
  if (showTypePicker) {
    const pickType = (t) => {
      setShowTypePicker(false);
      setCreateMode(t);
      window.history.replaceState(null, "", `#/sea_export?action=new&type=${t}`);
    };
    const closeTypePicker = () => {
      setShowTypePicker(false);
      window.history.replaceState(null, "", "#/sea_export");
    };
    const types = [
      { v: "FCL", label: "整箱", desc: "FCL · Full Container Load", color: "#1990FF" },
      { v: "LCL", label: "拼箱", desc: "LCL · Less than Container Load", color: "#52c41a" },
      { v: "Console", label: "自拼柜", desc: "Console · 自营拼箱主单", color: "#faad14" },
    ];
    return (
      <div style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000
      }}>
        <div style={{ background: "#fff", borderRadius: 6, width: 480, padding: "24px 28px",
                      boxShadow: "0 8px 32px rgba(0,0,0,0.2)" }}>
          <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>新建作业</div>
          <div style={{ fontSize: 12, color: "#999", marginBottom: 18 }}>请选择业务类型</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {types.map(t => (
              <div key={t.v}
                onClick={() => pickType(t.v)}
                style={{
                  padding: "14px 16px", border: "1px solid #e6e6e6", borderRadius: 4,
                  cursor: "pointer", display: "flex", alignItems: "center", gap: 14,
                  transition: "all 0.15s",
                }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = t.color; e.currentTarget.style.background = "#fafafa"; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = "#e6e6e6"; e.currentTarget.style.background = "#fff"; }}
              >
                <div style={{
                  width: 38, height: 38, borderRadius: 4, background: t.color + "15",
                  color: t.color, fontWeight: 700, fontSize: 13, display: "flex",
                  alignItems: "center", justifyContent: "center",
                }}>{t.v}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#222" }}>{t.label}</div>
                  <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>{t.desc}</div>
                </div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 18, display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button onClick={closeTypePicker} style={{
              padding: "6px 16px", background: "#fff", color: "#666",
              border: "1px solid #d9d9d9", borderRadius: 3, cursor: "pointer", fontSize: 13,
            }}>取消</button>
          </div>
        </div>
      </div>
    );
  }

  // 创建模式：渲染空白订单详情页（OrderDetail 用 createMode prop）
  if (createMode) {
    const blankOrder = {
      id: null,
      shipment_type: createMode,
      lifecycle: "处理中",
      finance_status: "未创建",
      // qc_status / space_status / mbl_status / hbl_status 不在此设默认值
      // 让 DB 用各自的 DEFAULT 填（避免和 CHECK 约束的允许值冲突）
      has_hbl: false,
      overseas_agent: "Keplin",
      solicit_type: "代理货",
    };
    return (
      <OrderDetail
        order={blankOrder}
        role={role}
        user={user}
        createMode={createMode}
        onBack={() => {
          // 关闭新建标签，或回列表
          if (window.history.length <= 1) {
            window.close();
          }
          window.history.replaceState(null, "", "#/sea_export");
          setCreateMode(null);
          load();
        }}
        onCreated={(newId, newData) => {
          // 保存成功后跳转到该订单详情态（同标签内切换 mode）
          // INSERT returning 已带完整数据，直接放入 fullOrder 省一次 fetch
          if (newData) setFullOrder(newData);
          setCreateMode(null);
          setSelectedId(newId);
          window.history.replaceState(null, "", `#/sea_export?id=${newId}`);
          load();
        }}
        onReload={load}
      />
    );
  }

  if (selOrder) return (
    <OrderDetail
      order={selOrder}
      role={role}
      user={user}
      onBack={() => {
        // 如果是新标签打开（URL 有 ?id=），关闭标签；否则回列表
        const fromUrlId = window.location.hash.match(/[?&]id=/);
        if (fromUrlId && window.history.length <= 1) {
          window.close();  // 浏览器不一定允许，失败时回列表
        }
        setSelectedId(null);
        window.history.replaceState(null, "", "#/sea_export");
        load();
      }}
      onReload={load}
    />
  );

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
        <Mi checked={showFilter} onClick={() => setShowFilter(p => !p)}>显示明细</Mi>
        <Mi onClick={load} disabled={loading}>{loading ? "搜索中..." : "搜索"}</Mi>
        <Tbl/>
        <MiDropdown options={[
          { label: "整箱", onClick: () => window.open("#/sea_export?action=new&type=FCL", "_blank") },
          { label: "自拼", onClick: () => window.open("#/sea_export?action=new&type=Console", "_blank") },
          { label: "拼箱", onClick: () => window.open("#/sea_export?action=new&type=LCL", "_blank") },
        ]}>新建作业</MiDropdown>
        <Mi arrow>显示预览</Mi>
        <Mi>统计模板</Mi>
        <Tbl/>
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
                  className={(checked ? "current " : "") + evenOdd + (child ? " tr-sub" : "")}>
                  <td className="center">
                    <input type="checkbox" checked={checked} onChange={() => togChk(o.id)} />
                  </td>
                  <td className="center">{
                    o.shipment_type === "LCL" ? "拼箱"
                    : o.shipment_type === "Console" ? "自拼"
                    : "整箱"
                  }</td>
                  <td>
                    {child && <span className="ind">└</span>}
                    <a href={`#/sea_export?id=${o.id}`} target="_blank" rel="noopener" className="lk">{o.order_no || ""}</a>
                  </td>
                  <td>{o.po || o.customer_po || ""}</td>
                  <td><a href={`#/sea_export?id=${o.id}`} target="_blank" rel="noopener" className="lk">{o.booking_no || ""}</a></td>
                  <td><a href={`#/sea_export?id=${o.id}`} target="_blank" rel="noopener" className="lk">{o.vessel || ""}</a></td>
                  <td>{o.voyage || ""}</td>
                  <td>{o.etd || ""}</td>
                  <td>{o.customer || ""}</td>
                  <td>{o.overseas_agent || ""}</td>
                  <td>{cleanPort(o.pol)}</td>
                  <td>{cleanPort(o.pod)}</td>
                  <td>{o.destination || cleanPort(o.pod)}</td>
                  <td>{o.qty_container || ""}</td>
                  <td><a href={`#/sea_export?id=${o.id}`} target="_blank" rel="noopener" className="lk">{o.hbl_no || ""}</a></td>
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


function OrderDetail({ order, role, user, onBack, onReload, createMode = null, onCreated = null }) {
  const isCreating = !!createMode;
  // 创建模式：editing 默认 true，初始 ed 已填默认值
  const [editing, setEditing] = useState(isCreating);
  const [ed, setEd] = useState(isCreating ? { ...order } : {});
  const [tab, setTab] = useState("作业");
  const [subtab, setSubtab] = useState("托单信息");
  const [refData, setRefData] = useState({ suppliers: [], customers: [], ports: [], staff: [] });
  const [cargoItems, setCargoItems] = useState([]);
  const [subTickets, setSubTickets] = useState([]);  // 主拼下面的所有分票
  // V5 字典：计件单位 + 货物种类（走全局缓存）
  const [pkgUnits, setPkgUnits] = useState([]);
  const [cargoTypes, setCargoTypes] = useState([]);
  // 集装箱汇总（由 ContainerEditor onChange 回调更新，托单信息 tab 单行汇总用）
  const [containerSummary, setContainerSummary] = useState("");

  // OrderDetail mount / order.id 变化时预拉 shipment_containers 计算汇总（托单信息 tab 单行用）
  useEffect(() => {
    if (!order?.id) { setContainerSummary(""); return; }
    supabase.from("shipment_containers")
      .select("container_size, container_type, qty")
      .eq("shipment_id", order.id)
      .then(({ data }) => {
        const rows = data || [];
        const map = {};
        for (const r of rows) {
          const key = `${r.container_size}${r.container_type}`;
          map[key] = (map[key] || 0) + (parseInt(r.qty) || 0);
        }
        const text = Object.entries(map)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, q]) => `${q}x${k}`)
          .join(",");
        setContainerSummary(text);
      });
  }, [order?.id]);
  useEffect(() => {
    getCachedRef("pkg_units").then(d => setPkgUnits(d || [])).catch(()=>{});
    getCachedRef("cargo_types").then(d => setCargoTypes(d || [])).catch(()=>{});
  }, []);

  // 设置浏览器标签页标题（方便多标签场景识别）
  useEffect(() => {
    if (isCreating) {
      const t = createMode === "Console" ? "新建自拼" : createMode === "LCL" ? "新建拼箱" : "新建整柜";
      document.title = `${t} - 海运出口`;
    } else {
      const t = order?.order_no || order?.booking_no || "订单";
      document.title = `${t} - 海运出口`;
    }
    return () => { document.title = "Bansar OPS"; };
  }, [order?.order_no, order?.booking_no, isCreating, createMode]);

  // 小票表格列宽 state（独立于订单列表）
  const [txColWidths, setTxColWidths] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(TX_COL_WIDTHS_KEY) || "{}");
      return Object.fromEntries(TX_COLS_DEF.map(c => [c.k, saved[c.k] || c.w]));
    } catch {
      return Object.fromEntries(TX_COLS_DEF.map(c => [c.k, c.w]));
    }
  });

  const startTxColResize = (colKey, e) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = txColWidths[colKey];
    const onMove = (ev) => {
      const newW = Math.max(40, startW + (ev.clientX - startX));
      setTxColWidths(p => ({ ...p, [colKey]: newW }));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      setTxColWidths(latest => {
        try { localStorage.setItem(TX_COL_WIDTHS_KEY, JSON.stringify(latest)); } catch {}
        return latest;
      });
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  const resetTxColWidth = (colKey) => {
    const def = TX_COLS_DEF.find(c => c.k === colKey);
    if (def) {
      const next = { ...txColWidths, [colKey]: def.w };
      setTxColWidths(next);
      try { localStorage.setItem(TX_COL_WIDTHS_KEY, JSON.stringify(next)); } catch {}
    }
  };

  const txCols = TX_COLS_DEF.map(c => ({ ...c, w: txColWidths[c.k] }));

  useEffect(() => {
    // 业务字典走全局缓存（首次加载后页内复用，详情页重开不再重复请求）
    Promise.all([
      getCachedRef("suppliers"),
      getCachedRef("customers"),
      getCachedRef("staff"),
    ]).then(([suppliers, customers, staff]) => {
      // 防御：任何字段为 undefined 时回退到 []
      setRefData({
        suppliers: suppliers || [],
        customers: customers || [],
        ports: [],
        staff: staff || [],
      });
    }).catch(err => console.error("loadRefs error:", err));

    if (order.po || order.customer_po) {
      const q = order.po && order.customer_po
        ? supabase.from("container_items").select("*").eq("po", order.po).eq("customer_po", String(order.customer_po))
        : order.customer_po
          ? supabase.from("container_items").select("*").eq("customer_po", String(order.customer_po))
          : supabase.from("container_items").select("*").eq("po", order.po);
      q.then(({ data }) => setCargoItems(data || []));
    }

    // 主拼：加载所有分票
    const isMasterCheck = order.shipment_type === "Console"
      && order.order_no
      && !/-\d+$/.test(order.order_no);
    if (isMasterCheck && order.booking_no) {
      supabase.from("shipments")
        .select("*")
        .eq("booking_no", order.booking_no)
        .like("order_no", order.order_no + "-%")
        .then(({ data }) => {
          const sorted = (data || []).sort((a, b) => {
            const na = parseInt((a.order_no || "").match(/-(\d+)$/)?.[1] || "999");
            const nb = parseInt((b.order_no || "").match(/-(\d+)$/)?.[1] || "999");
            return na - nb;
          });
          setSubTickets(sorted);
        });
    }
  }, [order.id]);

  const startEdit = () => { setEd({ ...order }); setEditing(true); };
  const cancel = () => setEditing(false);
  const save = async () => {
    // ── 创建模式：INSERT 新订单 ──
    if (isCreating) {
      const isConsole = createMode === "Console";
      // 校验
      if (!isConsole && !ed.customer?.trim()) { alert("委托单位 必填"); return; }
      if (!ed.booking_no?.trim()) { alert("MB/L No. 必填"); return; }

      const payload = { ...ed };
      // 自拼主拼空壳：清空票级字段
      if (isConsole) {
        payload.customer = null;
        payload.po = null;
        payload.customer_po = null;
        payload.qty_packages = null;
        payload.weight = null;
        payload.volume = null;
        payload.description = null;
      }
      // 数字字段空字符串 → null
      ["qty_packages", "weight", "volume"].forEach(k => {
        if (payload[k] === "" || payload[k] === undefined) payload[k] = null;
      });
      // 其他空字符串 → null
      Object.keys(payload).forEach(k => {
        if (payload[k] === "") payload[k] = null;
        if (k === "id" && payload[k] === null) delete payload[k];  // 让 Postgres 自己生成 id
      });

      // 过滤：只保留 DB 实际存在的字段，避免 schema cache 错误
      const cleanPayload = filterShipmentPayload(payload);

      const { data, error } = await supabase.from("shipments").insert(cleanPayload).select().single();
      if (error) { alert("创建失败：" + error.message); return; }
      if (data?.id && onCreated) {
        onCreated(data.id, data);
      }
      return;
    }

    // ── 编辑现有订单：UPDATE ──
    const changes = {};
    for (const k of Object.keys(ed)) {
      if (ed[k] !== order[k] && !["id", "created_at", "updated_at"].includes(k)) {
        changes[k] = ed[k] === "" ? null : ed[k];
      }
    }

    // 校验：order_no 改动后，同主拼下尾数不能重复
    if (changes.order_no && changes.order_no !== order.order_no) {
      const newNo = changes.order_no;
      const { data: dup } = await supabase.from("shipments")
        .select("id")
        .eq("order_no", newNo)
        .neq("id", order.id)
        .limit(1);
      if (dup && dup.length > 0) {
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
      const cleanChanges = filterShipmentPayload(changes);
      const { error } = await supabase.from("shipments").update(cleanChanges).eq("id", order.id);
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

  // 创建模式下的主拼判定（订单还没保存，order_no 为空）
  const isCreatingMaster = isCreating && createMode === "Console";

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
    const { error } = await supabase.from("shipments").insert(filterShipmentPayload(newRow));
    if (error) { alert("新建失败：" + error.message); return; }
    // 重新加载分票列表
    const { data: refreshed } = await supabase.from("shipments")
      .select("*")
      .eq("booking_no", order.booking_no)
      .like("order_no", order.order_no + "-%");
    if (refreshed) {
      setSubTickets(refreshed.sort((a, b) => {
        const na = parseInt((a.order_no || "").match(/-(\d+)$/)?.[1] || "999");
        const nb = parseInt((b.order_no || "").match(/-(\d+)$/)?.[1] || "999");
        return na - nb;
      }));
    }
    alert(`分票 ${newOrderNo} 已创建。`);
  };

  // 删除分票
  const deleteSubTicket = async (subTicket) => {
    if (!confirm(`确定删除分票 ${subTicket.order_no} ？此操作不可恢复。`)) return;
    const { error } = await supabase.from("shipments").delete().eq("id", subTicket.id);
    if (error) { alert("删除失败：" + error.message); return; }
    setSubTickets(prev => prev.filter(s => s.id !== subTicket.id));
  };

  // 主拼汇总数据（仅自拼主拼有意义）
  const masterSummary = useMemo(() => {
    if (!isMaster || subTickets.length === 0) return null;
    let totalPkg = 0, totalWt = 0, totalVol = 0;
    const descriptions = [];
    subTickets.forEach(s => {
      totalPkg += parseFloat(s.qty_packages) || 0;
      totalWt  += parseFloat(s.weight) || 0;
      totalVol += parseFloat(s.volume) || 0;
      if (s.description && !descriptions.includes(s.description)) descriptions.push(s.description);
    });
    return {
      n: subTickets.length,
      qty_packages: totalPkg || null,
      weight: totalWt ? totalWt.toFixed(3) : null,
      volume: totalVol ? totalVol.toFixed(3) : null,
      description: descriptions.join("\n") || null,
    };
  }, [isMaster, subTickets]);

  const cargoFromContainerItems = cargoItems;

  return (
    <div className="tms">
      <TmsTitle title={`${titlePrefix} / 海运出口`} user={user} role={role} onClose={onBack} />

      {/* 第一行工具栏：主操作（白底） */}
      <div className="tms-dtb1">
        <Mi onClick={onBack}>{isCreating ? "取消" : "返回"}</Mi>
        <Tbl/>
        {isCreating ? (
          <>
            <Mi onClick={save} className="primary">保存创建</Mi>
            <Tbl/>
            <Mi onClick={onBack}>关闭</Mi>
          </>
        ) : (
          <>
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
          </>
        )}
      </div>

      {/* 创建模式提示 */}
      {isCreating && (
        <div style={{
          padding: "8px 16px",
          background: isCreatingMaster ? "#fff7e6" : "#e6f4ff",
          borderBottom: `1px solid ${isCreatingMaster ? "#ffd28e" : "#c8dfff"}`,
          color: isCreatingMaster ? "#c66800" : "#0e7fe6",
          fontSize: 12,
        }}>
          ⓘ 当前正在新建{createMode === "Console" ? "自拼柜（主拼）" : createMode === "LCL" ? "拼箱" : "整柜"}作业。
          填写必填字段（委托单位、MB/L No.）后点 <b>「保存创建」</b>，作业号会自动生成。
          {isCreatingMaster && " 自拼主拼为整柜数据壳，不录入委托单位/件数等票级字段。"}
        </div>
      )}

      {/* 大 tab：作业 / 装箱 / 费用 / 凭证 / 代理对账单 / 附件 / SOP 进度 */}
      <div className="tms-bigtabs">
        {(isCreating
          ? ["作业"]
          : isMaster
            ? ["作业", "小票", "装箱", "费用", "凭证", "代理对账单", "附件", "SOP 进度"]
            : ["作业", "装箱", "费用", "凭证", "代理对账单", "附件", "SOP 进度"]
        ).map(t => (
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
                <Df label="委托单位" required={!isMaster && !isCreatingMaster}>
                  {(isMaster || isCreatingMaster) ? (
                    <input value={isCreatingMaster ? "（自拼主拼，无委托单位）" : (order.customer || "（多客户拼柜，详见小票）")} disabled className="placeholder-italic" />
                  ) : editing
                    ? <ComboBox value={v("customer")} onChange={val => ch("customer", val)} options={refData.customers} />
                    : <input value={v("customer")} disabled className="notnull" />}
                </Df>
                <Df label="订舱代理"><input value={v("booking_agent")} onChange={e => ch("booking_agent", e.target.value)} disabled={!editing} /></Df>
                <Df label="操作员">
                  {editing ? (
                    <select value={v("operator_id") || ""} onChange={e => ch("operator_id", e.target.value || null)}>
                      <option value="">— 未指派 —</option>
                      {(refData.staff || []).filter(u => u.role === "operator" || u.role === "admin").map(u => (
                        <option key={u.id} value={u.id}>{u.display_name || u.full_name || u.email}</option>
                      ))}
                    </select>
                  ) : (
                    <input value={(() => {
                      const u = (refData.staff || []).find(u => u.id === v("operator_id"));
                      return u ? (u.display_name || u.full_name || u.email) : (v("operator") || "");
                    })()} disabled />
                  )}
                </Df>
                <Df label="销售员">
                  {editing ? (
                    <select value={v("salesperson_id") || ""} onChange={e => ch("salesperson_id", e.target.value || null)}>
                      <option value="">— 未指派 —</option>
                      {(refData.staff || []).filter(u => u.role === "sales" || u.role === "admin").map(u => (
                        <option key={u.id} value={u.id}>{u.display_name || u.full_name || u.email}</option>
                      ))}
                    </select>
                  ) : (
                    <input value={(() => {
                      const u = (refData.staff || []).find(u => u.id === v("salesperson_id"));
                      return u ? (u.display_name || u.full_name || u.email) : (v("salesperson") || "");
                    })()} disabled />
                  )}
                </Df>
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
                  <select value={v("freight_terms") || ""} onChange={e => ch("freight_terms", e.target.value)} disabled={!editing}>
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

                {isMaster && masterSummary && (
                  <>
                    <Df label="合计件数" span={1}>
                      <input value={masterSummary.qty_packages || ""} disabled className="calc" title="所有分票汇总" />
                    </Df>
                    <Df label="合计毛重" span={1}>
                      <input value={masterSummary.weight ? `${masterSummary.weight} KG` : ""} disabled className="calc" title="所有分票汇总" />
                    </Df>
                    <Df label="合计体积" span={1}>
                      <input value={masterSummary.volume ? `${masterSummary.volume} CBM` : ""} disabled className="calc" title="所有分票汇总" />
                    </Df>
                    <Df label="合计品名" span={3}>
                      <textarea value={masterSummary.description || ""} disabled className="calc" style={{ minHeight: 40 }} title="所有分票汇总（多品名换行）" />
                    </Df>
                  </>
                )}
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
                <div style={tmStyles.wrap}>

                  {/* ━━━━━━━━━━━ 段 1：集装箱提示 ━━━━━━━━━━━ */}
                  <div style={tmStyles.section}>
                    <div style={tmStyles.row}>
                      <label style={{ ...tmStyles.label, ...tmStyles.labelReadonly, ...tmStyles.labelNotnull }}>集装箱</label>
                      <input
                        value={(() => {
                          // 优先用 ContainerEditor 实时汇总（如果用户刚操作过），fallback 到 DB 上的 qty_container 字段
                          return containerSummary || v("qty_container") || "";
                        })()}
                        readOnly
                        placeholder="点右侧 + 跳到集装箱子 tab 编辑"
                        style={{ ...tmStyles.input, width: 200, fontFamily: "Consolas,monospace", color: "#666" }}
                      />
                      <button onClick={() => setSubtab("集装箱")} style={tmStyles.btnPlus} disabled={!order?.id}>+</button>
                    </div>
                  </div>

                  {/* ━━━━━━━━━━━ 段 2：件数 / 单位 / 毛重 / 体积 ━━━━━━━━━━━ */}
                  <div style={tmStyles.section}>
                    <div style={tmStyles.row}>
                      <label style={tmStyles.label}>货物件数</label>
                      <input type="number"
                             value={v("qty_packages") || ""}
                             onChange={e => ch("qty_packages", e.target.value === "" ? null : Number(e.target.value))}
                             disabled={!editing}
                             style={{ ...tmStyles.input, width: 114 }} />

                      <label style={{ ...tmStyles.label, marginLeft: 16 }}>包装</label>
                      <span style={{ display: "inline-block", width: 114 }}>
                        <ComboBox
                          value={v("pkg_unit") || ""}
                          onChange={val => ch("pkg_unit", val ? liveUpper(val) : null)}
                          options={(pkgUnits || []).map(u => u.code)}
                          placeholder="CARTONS"
                        />
                      </span>

                      <label style={{ ...tmStyles.label, marginLeft: 16 }}>毛重</label>
                      <input type="number" step="0.001"
                             value={v("weight") || ""}
                             onChange={e => ch("weight", e.target.value === "" ? null : Number(e.target.value))}
                             disabled={!editing}
                             style={{ ...tmStyles.input, width: 114, fontFamily: "Consolas,monospace", textAlign: "right" }} />

                      <label style={{ ...tmStyles.label, marginLeft: 16 }}>体积</label>
                      <input type="number" step="0.001"
                             value={v("volume") || ""}
                             onChange={e => ch("volume", e.target.value === "" ? null : Number(e.target.value))}
                             disabled={!editing}
                             style={{ ...tmStyles.input, width: 114, fontFamily: "Consolas,monospace", textAlign: "right" }} />
                    </div>
                  </div>

                  {/* ━━━━━━━━━━━ 段 3：大写数量 + 货物种类 ━━━━━━━━━━━ */}
                  <div style={tmStyles.section}>
                    <div style={{ ...tmStyles.row, alignItems: "flex-start" }}>
                      <label style={tmStyles.label}>大写数量</label>
                      <input value={v("qty_in_words")}
                             onChange={e => ch("qty_in_words", liveUpper(e.target.value))}
                             disabled={!editing}
                             placeholder="SAY: ONE HUNDRED CARTONS ONLY"
                             style={{ ...tmStyles.input, width: 318, fontFamily: "Consolas,monospace" }} />

                      <label style={{ ...tmStyles.label, marginLeft: 24 }}>货物种类</label>
                      <select value={v("cargo_type") || "general"}
                              onChange={e => ch("cargo_type", e.target.value)}
                              disabled={!editing}
                              style={{ ...tmStyles.input, width: 110 }}>
                        {cargoTypes.length === 0 && <option value="general">普通货</option>}
                        {(cargoTypes || []).map(t => <option key={t.code} value={t.code}>{t.name_zh}</option>)}
                      </select>
                    </div>
                  </div>

                  {/* ━━━━━━━━━━━ 段 4：3 列大网格 ━━━━━━━━━━━ */}
                  <div style={tmStyles.threeColWrap}>

                    {/* ──── 左列：发货人 / 收货人 / 通知人 ──── */}
                    <div style={tmStyles.col}>
                      {/* 发货人 */}
                      <div style={tmStyles.subSection}>
                        <div style={tmStyles.row}>
                          <label style={{ ...tmStyles.label, ...tmStyles.labelBlue, ...tmStyles.labelRef }}>发货人</label>
                          <input
                            value={v("shipper")}
                            onChange={e => ch("shipper", e.target.value)}
                            onBlur={e => {
                              const err = validateAsciiOnly(e.target.value);
                              if (err) alert("发货人：" + err);
                            }}
                            disabled={!editing}
                            placeholder="英文公司名 + 地址（仅半角字符）"
                            style={{ ...tmStyles.input, width: 270, fontFamily: "Consolas,monospace" }}
                          />
                        </div>
                        <div style={{ ...tmStyles.row, marginTop: 4 }}>
                          <textarea
                            value={v("shipper")}
                            onChange={e => ch("shipper", e.target.value)}
                            disabled={!editing}
                            style={{ ...tmStyles.input, width: 369, height: 98, resize: "vertical", fontFamily: "Consolas,monospace" }}
                          />
                        </div>
                      </div>

                      {/* 收货人 */}
                      <div style={tmStyles.subSection}>
                        <div style={tmStyles.row}>
                          <label style={{ ...tmStyles.label, ...tmStyles.labelBlue, ...tmStyles.labelRef }}>收货人</label>
                          <input
                            value={v("consignee")}
                            onChange={e => ch("consignee", e.target.value)}
                            onBlur={e => {
                              const err = validateAsciiOnly(e.target.value);
                              if (err) alert("收货人：" + err);
                            }}
                            disabled={!editing}
                            placeholder="英文公司名 + 地址"
                            style={{ ...tmStyles.input, width: 270, fontFamily: "Consolas,monospace" }}
                          />
                        </div>
                        <div style={{ ...tmStyles.row, marginTop: 4 }}>
                          <textarea
                            value={v("consignee")}
                            onChange={e => ch("consignee", e.target.value)}
                            disabled={!editing}
                            style={{ ...tmStyles.input, width: 369, height: 98, resize: "vertical", fontFamily: "Consolas,monospace" }}
                          />
                        </div>
                      </div>

                      {/* 通知人 */}
                      <div style={tmStyles.subSection}>
                        <div style={tmStyles.row}>
                          <label style={{ ...tmStyles.label, ...tmStyles.labelRef }}>通知人</label>
                          <input
                            value={v("notify_party")}
                            onChange={e => ch("notify_party", e.target.value)}
                            onBlur={e => {
                              const err = validateAsciiOnly(e.target.value);
                              if (err) alert("通知人：" + err);
                            }}
                            disabled={!editing}
                            placeholder="可与收货人相同"
                            style={{ ...tmStyles.input, width: 270, fontFamily: "Consolas,monospace" }}
                          />
                        </div>
                        <div style={{ ...tmStyles.row, marginTop: 4 }}>
                          <textarea
                            value={v("notify_party")}
                            onChange={e => ch("notify_party", e.target.value)}
                            disabled={!editing}
                            style={{ ...tmStyles.input, width: 369, height: 98, resize: "vertical", fontFamily: "Consolas,monospace" }}
                          />
                        </div>
                      </div>
                    </div>

                    {/* ──── 中列：唛头 + 品名 ──── */}
                    <div style={tmStyles.col}>
                      <div style={tmStyles.subSection}>
                        <div style={{ ...tmStyles.row, alignItems: "flex-start" }}>
                          <label style={{ ...tmStyles.label, ...tmStyles.labelVertical }}>唛头</label>
                          <textarea
                            value={v("marks")}
                            onChange={e => ch("marks", e.target.value)}
                            onBlur={e => {
                              const err = validateNoFullWidthSymbols(e.target.value);
                              if (err) alert("唛头：" + err);
                            }}
                            disabled={!editing}
                            placeholder="N/M"
                            style={{ ...tmStyles.input, width: 345, height: 125, resize: "vertical", fontFamily: "Consolas,monospace" }}
                          />
                        </div>
                      </div>

                      <div style={tmStyles.subSection}>
                        <div style={{ ...tmStyles.row, alignItems: "flex-start" }}>
                          <label style={{ ...tmStyles.label, ...tmStyles.labelVertical }}>品名货描</label>
                          <textarea
                            value={v("description")}
                            onChange={e => ch("description", e.target.value)}
                            disabled={!editing}
                            placeholder="完整货描"
                            style={{ ...tmStyles.input, width: 369, height: 125, resize: "vertical", fontFamily: "Consolas,monospace" }}
                          />
                        </div>
                      </div>

                      <div style={tmStyles.subSection}>
                        <div style={{ ...tmStyles.row, alignItems: "flex-start" }}>
                          <label style={{ ...tmStyles.label, ...tmStyles.labelVertical }}>中文品名</label>
                          <textarea
                            value={v("desc_zh")}
                            onChange={e => ch("desc_zh", e.target.value)}
                            onBlur={e => {
                              const err = validateNoFullWidthSymbols(e.target.value);
                              if (err) alert("中文品名：" + err);
                            }}
                            disabled={!editing}
                            style={{ ...tmStyles.input, width: 369, height: 71, resize: "vertical" }}
                          />
                        </div>
                      </div>

                      <div style={tmStyles.subSection}>
                        <div style={{ ...tmStyles.row, alignItems: "flex-start" }}>
                          <label style={{ ...tmStyles.label, ...tmStyles.labelVertical }}>英文品名</label>
                          <textarea
                            value={v("desc_en")}
                            onChange={e => ch("desc_en", e.target.value)}
                            onBlur={e => {
                              const err = validateAsciiOnly(e.target.value);
                              if (err) alert("英文品名：" + err);
                            }}
                            disabled={!editing}
                            placeholder="英文 (仅半角字符)"
                            style={{ ...tmStyles.input, width: 345, height: 71, resize: "vertical", fontFamily: "Consolas,monospace" }}
                          />
                        </div>
                      </div>
                    </div>

                    {/* ──── 右列：港口 + 票据 + HSCode + 箱号 ──── */}
                    <div style={tmStyles.col}>
                      {/* 收货地 */}
                      <PortRow label="收货地"
                               value={{ code: v("receipt_place_code"), name: v("receipt_place_name") }}
                               onChange={({code, name}) => { ch("receipt_place_code", code); ch("receipt_place_name", name); }}
                               disabled={!editing} />

                      {/* 起运港 - 必填 */}
                      <PortRow label="起运港" required
                               value={{ code: v("pol_code"), name: v("pol") }}
                               onChange={({code, name}) => { ch("pol_code", code); ch("pol", name); }}
                               disabled={!editing} />

                      {/* 中转港 */}
                      <PortRow label="中转港"
                               value={{ code: v("transit_port_code"), name: v("transit_port_name") }}
                               onChange={({code, name}) => { ch("transit_port_code", code); ch("transit_port_name", name); }}
                               disabled={!editing} />

                      {/* 卸货港 - 必填 */}
                      <PortRow label="卸货港" required
                               value={{ code: v("pod_code"), name: v("pod") }}
                               onChange={({code, name}) => { ch("pod_code", code); ch("pod", name); }}
                               disabled={!editing} />

                      {/* 目的港 - 必填 */}
                      <PortRow label="目的港" required
                               value={{ code: v("destination_code"), name: v("destination") }}
                               onChange={({code, name}) => { ch("destination_code", code); ch("destination", name); }}
                               disabled={!editing} />

                      {/* 起运港码头（单框） */}
                      <div style={{ ...tmStyles.subSection, ...tmStyles.row }}>
                        <label style={{ ...tmStyles.label, ...tmStyles.labelRef }}>起运港码头</label>
                        <input
                          value={v("terminal")}
                          onChange={e => ch("terminal", liveUpper(e.target.value))}
                          disabled={!editing}
                          placeholder="如 BEILUN PORT"
                          style={{ ...tmStyles.input, width: 269, fontFamily: "Consolas,monospace" }}
                        />
                      </div>

                      {/* 间隔 */}
                      <div style={{ height: 8 }}></div>

                      {/* 电放号 */}
                      <div style={{ ...tmStyles.subSection, ...tmStyles.row }}>
                        <label style={tmStyles.label}>电放号</label>
                        <input
                          value={v("swb_no")}
                          onChange={e => ch("swb_no", liveUpper(e.target.value))}
                          disabled={!editing}
                          style={{ ...tmStyles.input, width: 269, fontFamily: "Consolas,monospace" }}
                        />
                      </div>
                      <div style={{ ...tmStyles.subSection, ...tmStyles.row }}>
                        <label style={tmStyles.label}>电放日期</label>
                        <input type="date"
                               value={v("swb_date") || ""}
                               onChange={e => ch("swb_date", e.target.value || null)}
                               disabled={!editing}
                               style={{ ...tmStyles.input, width: 269 }} />
                      </div>

                      {/* 签发地 */}
                      <PortRow label="签发地"
                               value={{ code: v("issue_place_code"), name: v("issue_place_name") }}
                               onChange={({code, name}) => { ch("issue_place_code", code); ch("issue_place_name", name); }}
                               disabled={!editing} />

                      <div style={{ ...tmStyles.subSection, ...tmStyles.row }}>
                        <label style={tmStyles.label}>签发日期</label>
                        <input type="date"
                               value={v("issue_date") || ""}
                               onChange={e => ch("issue_date", e.target.value || null)}
                               disabled={!editing}
                               style={{ ...tmStyles.input, width: 269 }} />
                      </div>

                      {/* HSCode */}
                      <div style={{ ...tmStyles.subSection, ...tmStyles.row }}>
                        <label style={tmStyles.label}>HSCode</label>
                        <input
                          value={v("hs_code")}
                          onChange={e => ch("hs_code", e.target.value.replace(/[^\d.]/g, ""))}
                          disabled={!editing}
                          placeholder="如 8523.49"
                          style={{ ...tmStyles.input, width: 269, fontFamily: "Consolas,monospace" }}
                        />
                      </div>

                      {/* 船名 / 航次 */}
                      <div style={{ ...tmStyles.subSection, ...tmStyles.row }}>
                        <label style={tmStyles.label}>船名</label>
                        <input
                          value={v("vessel")}
                          onChange={e => ch("vessel", liveUpper(e.target.value))}
                          disabled={!editing}
                          style={{ ...tmStyles.input, width: 269, fontFamily: "Consolas,monospace" }}
                        />
                      </div>
                      <div style={{ ...tmStyles.subSection, ...tmStyles.row }}>
                        <label style={tmStyles.label}>航次</label>
                        <input
                          value={v("voyage")}
                          onChange={e => ch("voyage", liveUpper(e.target.value))}
                          disabled={!editing}
                          style={{ ...tmStyles.input, width: 269, fontFamily: "Consolas,monospace" }}
                        />
                      </div>

                      {/* MBL / HBL */}
                      <div style={{ ...tmStyles.subSection, ...tmStyles.row }}>
                        <label style={tmStyles.label}>提单号 (MBL)</label>
                        <input
                          value={v("mbl_no")}
                          onChange={e => ch("mbl_no", liveUpper(e.target.value))}
                          disabled={!editing}
                          style={{ ...tmStyles.input, width: 269, fontFamily: "Consolas,monospace" }}
                        />
                      </div>
                      <div style={{ ...tmStyles.subSection, ...tmStyles.row }}>
                        <label style={tmStyles.label}>分提单 (HBL)</label>
                        <input
                          value={v("hbl_no")}
                          onChange={e => ch("hbl_no", liveUpper(e.target.value))}
                          disabled={!editing}
                          style={{ ...tmStyles.input, width: 269, fontFamily: "Consolas,monospace" }}
                        />
                      </div>
                    </div>

                  </div>
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
                  <Df label="服务类型"><input value={v("service_type") || "CY-CY"} disabled={!editing} onChange={e => ch("service_type", e.target.value)} /></Df>
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
                  <ContainerEditor
                    shipmentId={order?.id}
                    readOnly={!editing && !isCreating}
                    onChange={(rows) => {
                      // 聚合 rows 为 "1x40HQ,2x20GP" 字符串，给托单信息 tab 单行汇总用
                      const map = {};
                      for (const r of rows) {
                        const key = `${r.container_size}${r.container_type}`;
                        map[key] = (map[key] || 0) + (parseInt(r.qty) || 0);
                      }
                      const text = Object.entries(map)
                        .sort(([a], [b]) => a.localeCompare(b))
                        .map(([k, q]) => `${q}x${k}`)
                        .join(",");
                      setContainerSummary(text);
                    }}
                  />
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

        {tab === "小票" && isMaster && (
          <div>
            {/* 顶部汇总条 */}
            <div className="tms-tx-summary">
              <span><span className="lbl">总票数:</span><span className="val">{masterSummary?.n || 0}</span></span>
              <span><span className="lbl">合计件数:</span><span className="val">{masterSummary?.qty_packages || "—"}</span></span>
              <span><span className="lbl">合计毛重:</span><span className="val">{masterSummary?.weight ? `${masterSummary.weight} KG` : "—"}</span></span>
              <span><span className="lbl">合计体积:</span><span className="val">{masterSummary?.volume ? `${masterSummary.volume} CBM` : "—"}</span></span>
              {masterSummary?.description && (
                <span style={{ flexBasis: "100%", marginTop: 4, paddingTop: 6, borderTop: "1px dashed #c8dfff" }}>
                  <span className="lbl">品名:</span>
                  <span className="val" style={{ fontSize: 12, fontWeight: "normal", whiteSpace: "pre-line" }}>{masterSummary.description}</span>
                </span>
              )}
            </div>

            {/* 工具栏 */}
            <div className="tms-tx-toolbar">
              <button className="primary" disabled={isLocked} onClick={createSubTicket}>+ 新增分票</button>
              <button disabled title="点击下方表格中分票号即可编辑">编辑分票</button>
              <button disabled title="开发中">加入分票</button>
              <button disabled title="开发中">移除分票</button>
            </div>

            {/* 分票表格 */}
            <table className="tms-tx-table" style={{ width: txCols.reduce((a, c) => a + c.w, 0) }}>
              <colgroup>
                {txCols.map(c => <col key={c.k} style={{ width: c.w }} />)}
              </colgroup>
              <thead>
                <tr>
                  {txCols.map(c => (
                    <th key={c.k} style={{ textAlign: c.align || "left", position: "relative" }}>
                      {c.label}
                      <span
                        className="col-resize"
                        onMouseDown={e => startTxColResize(c.k, e)}
                        onDoubleClick={() => resetTxColWidth(c.k)}
                        title="拖动调整列宽，双击恢复默认"
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {subTickets.length === 0 ? (
                  <tr><td colSpan={txCols.length} style={{ padding: 30, textAlign: "center", color: "#888" }}>
                    暂无分票，请点击「+ 新增分票」添加
                  </td></tr>
                ) : (
                  <>
                    {subTickets.map(s => (
                      <tr key={s.id}>
                        <td><a href={`#/sea_export?id=${s.id}`} target="_blank" rel="noopener" className="lk">{s.order_no}</a></td>
                        <td>{s.hbl_no || "—"}</td>
                        <td>{s.customer || "—"}</td>
                        <td style={{ whiteSpace: "pre-wrap" }}>{s.description || "—"}</td>
                        <td style={{ textAlign: "right" }}>{s.qty_packages || "—"}</td>
                        <td style={{ textAlign: "right" }}>{s.weight || "—"}</td>
                        <td style={{ textAlign: "right" }}>{s.volume || "—"}</td>
                        <td style={{ textAlign: "center" }}>
                          <span className="delete-btn" onClick={(e) => {
                            e.stopPropagation();
                            deleteSubTicket(s);
                          }}>删除</span>
                        </td>
                      </tr>
                    ))}
                    <tr className="sum-row">
                      <td colSpan={3} style={{ textAlign: "right" }}>合计:</td>
                      <td>{(() => {
                        const descs = subTickets.map(s => s.description).filter(Boolean);
                        const uniq = [...new Set(descs)];
                        return uniq.length > 0 ? `${uniq.length} 种品名` : "—";
                      })()}</td>
                      <td style={{ textAlign: "right" }}>{masterSummary?.qty_packages || "—"}</td>
                      <td style={{ textAlign: "right" }}>{masterSummary?.weight || "—"}</td>
                      <td style={{ textAlign: "right" }}>{masterSummary?.volume || "—"}</td>
                      <td></td>
                    </tr>
                  </>
                )}
              </tbody>
            </table>
          </div>
        )}

        {tab === "装箱" && (
          <div style={{ padding: 30, color: "#888", textAlign: "center" }}>
            装箱详细信息（暂用作业 tab 下的"集装箱"子 tab 替代）
          </div>
        )}

        {tab === "费用" && (
          <ChargesPanel order={order} role={role} user={user} isLocked={isLocked} />
        )}

        {tab === "凭证" && (
          <DocsPanel shipmentId={order.id} canPrint={!!order.id} blType={order.bl_type} />
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


// ═══════════════════════════════════════════════════════════════
// ChargesPanel — 费用管理面板 v2（多行批量编辑+计费单位+税率+拖拽）
// ═══════════════════════════════════════════════════════════════

const UNIT_SUGGESTIONS = ["票", "40HQ", "40GP", "20GP", "45HQ", "CBM", "KGS", "day", "次"];
const CURRENCIES = ["CNY", "USD", "EUR", "HKD", "JPY"];

// PartnerCombo — 输入+下拉合一，无候选时支持 + 新增
// props:
//   value: partner.id (uuid 或 "") | onChange(id)
//   options: [{id, code, name, partner_type}]（已按方向过滤过）
//   onCreateNew(name) → Promise<id>  父组件负责持久化并刷新 partners
//   defaultPartnerType: 当 + 新增时记入哪种 partner_type（中文枚举："客户" / "供应商"）
//   disabled
function PartnerCombo({ value, onChange, options, onCreateNew, defaultPartnerType, disabled }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const wrapRef = useRef(null);

  // 同步外部 value → 显示名
  useEffect(() => {
    if (!value) { setText(""); return; }
    const p = options.find(x => x.id === value);
    if (p) setText(p.name);
  }, [value, options]);

  // 点外部关闭
  useEffect(() => {
    const fn = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, []);

  const q = text.trim().toLowerCase();
  const matched = !q ? options.slice(0, 50)
    : options.filter(p =>
        (p.name || "").toLowerCase().includes(q) ||
        (p.code || "").toLowerCase().includes(q)
      ).slice(0, 50);

  const canCreate = !!q && !options.some(p => (p.name || "").trim().toLowerCase() === q);

  return (
    <div ref={wrapRef} style={{ position: "relative", width: "100%" }}>
      <input
        type="text"
        value={text}
        disabled={disabled}
        onFocus={() => setOpen(true)}
        onChange={e => { setText(e.target.value); setOpen(true); if (!e.target.value) onChange(""); }}
        placeholder="—"
        style={inlineInput}
      />
      {open && !disabled && (
        <div style={{
          position: "absolute", top: "100%", left: 0, right: 0, zIndex: 100,
          background: "#fff", border: "1px solid #d9d9d9", borderRadius: 3,
          maxHeight: 220, overflowY: "auto", boxShadow: "0 2px 8px rgba(0,0,0,.12)",
          fontSize: 11,
        }}>
          {matched.map(p => (
            <div key={p.id}
              onClick={() => { onChange(p.id); setText(p.name); setOpen(false); }}
              style={{ padding: "4px 8px", cursor: "pointer",
                       background: value === p.id ? "#e6f7ff" : "#fff" }}
              onMouseEnter={e => e.currentTarget.style.background = "#f5f5f5"}
              onMouseLeave={e => e.currentTarget.style.background = value === p.id ? "#e6f7ff" : "#fff"}
            >
              <span style={{ color: "#999", marginRight: 6 }}>{p.code}</span>
              {p.name}
              <span style={{ marginLeft: 6, color: "#bbb", fontSize: 10 }}>{p.partner_type}</span>
            </div>
          ))}
          {canCreate && (
            <div
              onClick={async () => {
                const newName = text.trim();
                const id = await onCreateNew(newName, defaultPartnerType);
                if (id) { onChange(id); setText(newName); setOpen(false); }
              }}
              style={{ padding: "6px 8px", cursor: "pointer", color: "#fa8c16",
                       background: "#fff7e6", borderTop: "1px solid #f0f0f0", fontWeight: 500 }}
            >
              + 新增「{text.trim()}」为{defaultPartnerType}
            </div>
          )}
          {matched.length === 0 && !canCreate && (
            <div style={{ padding: 8, textAlign: "center", color: "#999" }}>无匹配</div>
          )}
        </div>
      )}
    </div>
  );
}

// ChargeItemCombo — 费用名称专用 ComboBox（输入+下拉，可+新增到 charge_items 表）
// props:
//   value: charge_item.id (uuid 或 "") | onChange(id)
//   options: [{id, code, name_zh}]
//   onCreateNew(name) → Promise<id>
//   disabled
function ChargeItemCombo({ value, onChange, options, onCreateNew, disabled }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const wrapRef = useRef(null);

  useEffect(() => {
    if (!value) { setText(""); return; }
    const it = options.find(x => x.id === value);
    if (it) setText(it.name_zh);
  }, [value, options]);

  useEffect(() => {
    const fn = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, []);

  const q = text.trim().toLowerCase();
  const matched = !q ? options.slice(0, 100)
    : options.filter(it =>
        (it.name_zh || "").toLowerCase().includes(q) ||
        (it.code || "").toLowerCase().includes(q)
      ).slice(0, 100);

  const canCreate = !!q && !options.some(it => (it.name_zh || "").trim().toLowerCase() === q);

  return (
    <div ref={wrapRef} style={{ position: "relative", width: "100%" }}>
      <input
        type="text"
        value={text}
        disabled={disabled}
        onFocus={() => setOpen(true)}
        onChange={e => { setText(e.target.value); setOpen(true); if (!e.target.value) onChange(""); }}
        placeholder="— 选择 —"
        style={inlineInput}
      />
      {open && !disabled && (
        <div style={{
          position: "absolute", top: "100%", left: 0, right: 0, zIndex: 100,
          background: "#fff", border: "1px solid #d9d9d9", borderRadius: 3,
          maxHeight: 240, overflowY: "auto", boxShadow: "0 2px 8px rgba(0,0,0,.12)",
          fontSize: 11,
        }}>
          {matched.map(it => (
            <div key={it.id}
              onClick={() => { onChange(it.id); setText(it.name_zh); setOpen(false); }}
              style={{ padding: "4px 8px", cursor: "pointer",
                       background: value === it.id ? "#e6f7ff" : "#fff" }}
              onMouseEnter={e => e.currentTarget.style.background = "#f5f5f5"}
              onMouseLeave={e => e.currentTarget.style.background = value === it.id ? "#e6f7ff" : "#fff"}
            >
              <span style={{ color: "#999", marginRight: 6, fontFamily: "'Consolas',monospace" }}>{it.code}</span>
              {it.name_zh}
            </div>
          ))}
          {canCreate && (
            <div
              onClick={async () => {
                const newName = text.trim();
                const id = await onCreateNew(newName);
                if (id) { onChange(id); setText(newName); setOpen(false); }
              }}
              style={{ padding: "6px 8px", cursor: "pointer", color: "#fa8c16",
                       background: "#fff7e6", borderTop: "1px solid #f0f0f0", fontWeight: 500 }}
            >
              + 新增「{text.trim()}」为费用项
            </div>
          )}
          {matched.length === 0 && !canCreate && (
            <div style={{ padding: 8, textAlign: "center", color: "#999" }}>无匹配</div>
          )}
        </div>
      )}
    </div>
  );
}

// DocsPanel — 单证管理面板（订单详情 → 凭证 tab）
// 列出可用单证，每个都用新 tab 打开方便对比和打印
function DocsPanel({ shipmentId, canPrint, blType }) {
  if (!canPrint) {
    return <div style={{ padding: 30, color: "#888", textAlign: "center" }}>请先保存订单后再生成单证</div>;
  }
  const isTelex = blType === "电放";
  const docs = [
    { key: "booking",  name: "订舱委托书",   en: "Booking Confirmation", desc: "发船公司/订舱代理，确认舱位",  ready: true },
    { key: "draft_bl", name: "提单确认件",   en: "Draft B/L",            desc: "发客户确认提单内容",            ready: true },
    { key: "bl_copy",  name: "提单 Copy",    en: "B/L Copy",             desc: "提单副本，签发后用",            ready: true },
    { key: "telex",    name: "电放件",       en: "Telex Release",        desc: "电放票专用，替代正本提单",      ready: true, highlight: isTelex },
    { key: "release",  name: "放舱信息",     en: "Release Notice",       desc: "舱位确认后通知发货方",          ready: true },
    { key: "stmt",     name: "对账单（单票）", en: "Statement (Single)", desc: "本票的费用对账",                ready: true },
  ];
  return (
    <div style={{ padding: 16 }}>
      <div style={{ marginBottom: 12, fontSize: 13, color: "#444" }}>
        点击下方按钮在新标签页打开单证，可直接打印或另存为 PDF。
        {isTelex && <span style={{ marginLeft: 12, color: "#fa541c", fontWeight: 600 }}>· 本票为电放票</span>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
        {docs.map(d => (
          <div key={d.key} style={{
            border: d.highlight ? "2px solid #fa541c" : "1px solid #e0e0e0",
            borderRadius: 5, padding: 14,
            background: d.ready ? (d.highlight ? "#fff7e6" : "#fff") : "#fafafa",
            opacity: d.ready ? 1 : 0.6,
          }}>
            <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 2 }}>
              {d.name}
              {!d.ready && <span style={{ marginLeft: 8, fontSize: 10, color: "#999", fontWeight: 400 }}>开发中</span>}
              {d.highlight && <span style={{ marginLeft: 8, fontSize: 10, color: "#fa541c", fontWeight: 700 }}>★</span>}
            </div>
            <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>{d.en}</div>
            <div style={{ fontSize: 11, color: "#666", marginBottom: 10 }}>{d.desc}</div>
            {d.ready ? (
              <a
                href={`#/docs/${d.key}/${shipmentId}`}
                target="_blank" rel="noreferrer"
                style={{
                  display: "inline-block", padding: "5px 14px",
                  background: d.highlight ? "#fa541c" : "#1990FF", color: "#fff",
                  textDecoration: "none", borderRadius: 3, fontSize: 12,
                }}
              >生成 / 打开 →</a>
            ) : (
              <button disabled style={{
                padding: "5px 14px", background: "#ccc", color: "#fff",
                border: "none", borderRadius: 3, fontSize: 12, cursor: "not-allowed",
              }}>开发中</button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function ChargesPanel({ order, role, user, isLocked }) {
  const [arRows, setArRows] = useState([]);   // 应收（含已存+草稿）
  const [apRows, setApRows] = useState([]);   // 应付（含已存+草稿）
  const [chargeItems, setChargeItems] = useState([]);
  const [partners, setPartners] = useState([]);
  const [rates, setRates] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [selectedAr, setSelectedAr] = useState(new Set());
  const [selectedAp, setSelectedAp] = useState(new Set());
  const [draggingId, setDraggingId] = useState(null);
  const [bills, setBills] = useState([]);   // 本票相关账单（用于显示账单号）

  const isAdmin = role === "admin" || role === "finance";
  const canEdit = !isLocked ? (isAdmin || role === "operator") : isAdmin;
  const canViewProfit = isAdmin || role === "sales";

  // bill_id → bill 字典，方便行内查
  const billMap = useMemo(() => {
    const m = {};
    bills.forEach(b => { m[b.id] = b; });
    return m;
  }, [bills]);

  // 判断某行是否被已开票/已结算账单锁定
  const isRowLockedByBill = (r) => {
    if (!r.bill_id) return false;
    const b = billMap[r.bill_id];
    return !!b && (b.status === "issued" || b.status === "paid");
  };

  const load = useCallback(async () => {
    if (!order?.id) {
      setArRows([]); setApRows([]); setBills([]); setLoading(false);
      return;
    }
    const [{ data: ch }, { data: ci }, { data: cu }, { data: er }, { data: bs }] = await Promise.all([
      supabase.from("charges").select("*").eq("shipment_id", order.id).order("sort_order").order("created_at"),
      supabase.from("charge_items").select("id, code, name_zh, name_en, sort").eq("active", true).order("sort"),
      supabase.from("customers").select("id, code, name, partner_type").eq("active", true),
      supabase.from("exchange_rates").select("*"),
      supabase.from("bills").select("*").eq("shipment_id", order.id),
    ]);
    setChargeItems(ci || []);
    setPartners(cu || []);
    setBills(bs || []);
    const rateMap = {};
    (er || []).sort((a, b) => (b.effective_from || "").localeCompare(a.effective_from || ""))
      .forEach(r => { if (!rateMap[r.currency]) rateMap[r.currency] = parseFloat(r.rate_to_cny); });
    rateMap["CNY"] = 1;
    setRates(rateMap);
    setArRows((ch || []).filter(c => c.direction === "应收"));
    setApRows((ch || []).filter(c => c.direction === "应付"));
    setLoading(false);
  }, [order?.id]);

  useEffect(() => { load(); }, [load]);

  // 添加空白行
  const addBlankRow = (direction) => {
    const blank = {
      _draft: true,                    // 标记是草稿（未保存）
      _id: "draft-" + Date.now() + "-" + Math.random(),
      direction,
      charge_item_id: "",
      partner_id: "",
      partner_name: "",
      unit: "票",
      quantity: 1,
      unit_price: "",
      tax_rate: 0,
      currency: "CNY",
      exchange_rate: 1,
      remark: "",
      status: "草稿",
    };
    if (direction === "应收") setArRows(p => [...p, blank]);
    else setApRows(p => [...p, blank]);
  };

  // 修改某行
  const updateRow = (direction, rowId, patch) => {
    const setter = direction === "应收" ? setArRows : setApRows;
    setter(prev => prev.map(r => {
      const id = r.id || r._id;
      if (id !== rowId) return r;
      const next = { ...r, ...patch };
      // 币种变化时自动填汇率
      if (patch.currency && patch.currency !== r.currency) {
        next.exchange_rate = rates[patch.currency] || 1;
      }
      return next;
    }));
  };

  // 复制行
  const copyRow = (direction, row) => {
    const blank = {
      ...row,
      _draft: true,
      _id: "draft-" + Date.now() + "-" + Math.random(),
      id: undefined,
    };
    if (direction === "应收") setArRows(p => [...p, blank]);
    else setApRows(p => [...p, blank]);
  };

  // 删除行
  const deleteRows = async (direction, ids) => {
    if (!ids.length) return;
    if (!confirm(`确定删除选中的 ${ids.length} 条费用？`)) return;
    const setter = direction === "应收" ? setArRows : setApRows;
    const setSelected = direction === "应收" ? setSelectedAr : setSelectedAp;
    // 已保存的删数据库
    const dbIds = [];
    setter(prev => prev.filter(r => {
      const id = r.id || r._id;
      if (!ids.includes(id)) return true;
      if (r.id) dbIds.push(r.id);
      return false;
    }));
    if (dbIds.length) {
      const { error } = await supabase.from("charges").delete().in("id", dbIds);
      if (error) { alert("删除失败：" + error.message); load(); return; }
    }
    setSelected(new Set());
  };

  // 切换勾选
  const toggleSelect = (direction, rowId) => {
    const setter = direction === "应收" ? setSelectedAr : setSelectedAp;
    setter(prev => {
      const n = new Set(prev);
      if (n.has(rowId)) n.delete(rowId);
      else n.add(rowId);
      return n;
    });
  };

  const toggleSelectAll = (direction) => {
    const rows = direction === "应收" ? arRows : apRows;
    const selected = direction === "应收" ? selectedAr : selectedAp;
    const setter = direction === "应收" ? setSelectedAr : setSelectedAp;
    if (selected.size === rows.length) {
      setter(new Set());
    } else {
      setter(new Set(rows.map(r => r.id || r._id)));
    }
  };

  // 拖拽排序
  const onDragStart = (rowId) => setDraggingId(rowId);
  const onDragOver = (e) => e.preventDefault();
  const onDrop = (direction, targetRowId) => {
    if (!draggingId || draggingId === targetRowId) { setDraggingId(null); return; }
    const setter = direction === "应收" ? setArRows : setApRows;
    setter(prev => {
      const arr = [...prev];
      const fromIdx = arr.findIndex(r => (r.id || r._id) === draggingId);
      const toIdx = arr.findIndex(r => (r.id || r._id) === targetRowId);
      if (fromIdx < 0 || toIdx < 0) return prev;
      const [moved] = arr.splice(fromIdx, 1);
      arr.splice(toIdx, 0, moved);
      return arr;
    });
    setDraggingId(null);
  };

  // 保存所有未保存行 + 排序变化
  const saveAll = async () => {
    setSaving(true);

    // 处理应收 + 应付
    for (const direction of ["应收", "应付"]) {
      const rows = direction === "应收" ? arRows : apRows;
      const inserts = [];
      const updates = [];

      rows.forEach((r, idx) => {
        // 校验
        if (r._draft && (!r.charge_item_id || !r.unit_price)) return;  // 跳过空草稿

        const partnerObj = partners.find(p => p.id === r.partner_id);
        const payload = {
          shipment_id: order.id,
          charge_item_id: r.charge_item_id,
          direction,
          partner_id: r.partner_id || null,
          partner_name: partnerObj?.name || r.partner_name || null,
          unit: r.unit || "票",
          quantity: parseFloat(r.quantity) || 0,
          unit_price: parseFloat(r.unit_price) || 0,
          tax_rate: parseFloat(r.tax_rate) || 0,
          currency: r.currency || "CNY",
          exchange_rate: parseFloat(r.exchange_rate) || 1,
          remark: r.remark || null,
          status: r.status || "草稿",
          sort_order: idx,
        };
        if (r._draft) {
          payload.created_by = user.id;
          inserts.push(payload);
        } else {
          updates.push({ id: r.id, ...payload });
        }
      });

      if (inserts.length) {
        const { error } = await supabase.from("charges").insert(inserts);
        if (error) { setSaving(false); alert("保存失败：" + error.message); return; }
      }
      // updates 用 upsert 一次性
      if (updates.length) {
        const { error } = await supabase.from("charges").upsert(updates, { onConflict: "id" });
        if (error) { setSaving(false); alert("保存失败：" + error.message); return; }
      }
    }

    setSaving(false);
    await load();
    alert("保存成功");
  };

  // 新建结算单位（PartnerCombo 触发）
  // partnerType: 中文枚举 "客户" | "供应商" | "海外代理" 等
  const handleCreatePartner = async (name, partnerType) => {
    const { data, error } = await supabase.rpc("ensure_partner_quick_create", {
      p_name: name,
      p_partner_type: partnerType,
    });
    if (error) { alert("新建结算单位失败：" + error.message); return null; }
    // 刷新 partners
    const { data: cu } = await supabase
      .from("customers").select("id, code, name, partner_type").eq("active", true);
    setPartners(cu || []);
    return data;
  };

  // 新建费用项（ChargeItemCombo 触发）
  const handleCreateChargeItem = async (name) => {
    const { data, error } = await supabase.rpc("ensure_charge_item_quick_create", {
      p_name: name,
    });
    if (error) { alert("新建费用项失败：" + error.message); return null; }
    // 刷新 chargeItems
    const { data: ci } = await supabase
      .from("charge_items").select("id, code, name_zh, name_en, sort").eq("active", true).order("sort");
    setChargeItems(ci || []);
    return data;
  };

  // 创建账单（基于已选行）
  const createBill = async (direction) => {
    const selected = direction === "应收" ? selectedAr : selectedAp;
    const rows = direction === "应收" ? arRows : apRows;
    const ids = [...selected].filter(id => !String(id).startsWith("draft-"));
    if (ids.length === 0) { alert("请先保存草稿后再勾选创建账单"); return; }

    const sel = rows.filter(r => ids.includes(r.id));
    const pids = new Set(sel.map(r => r.partner_id));
    const ccys = new Set(sel.map(r => r.currency || "CNY"));
    const bound = sel.filter(r => r.bill_id);

    if (bound.length > 0) { alert(`有 ${bound.length} 条已绑定账单，请先解绑`); return; }
    if (sel.some(r => !r.partner_id)) { alert("存在未填结算单位的费用"); return; }
    if (pids.size > 1) { alert("所选费用必须属于同一结算单位"); return; }
    if (ccys.size > 1) { alert("所选费用币种不一致，请分别开账单"); return; }

    if (!confirm(`确认创建账单？包含 ${sel.length} 条费用，币种 ${[...ccys][0]}`)) return;

    const { data, error } = await supabase.rpc("create_bill_from_charges", {
      p_charge_ids: ids,
    });
    if (error) { alert("创建账单失败：" + error.message); return; }
    const result = data?.[0];
    if (result) alert(`账单创建成功：${result.bill_no}`);
    if (direction === "应收") setSelectedAr(new Set()); else setSelectedAp(new Set());
    await load();
  };

  // 解绑账单
  const unbindBill = async (direction) => {
    const selected = direction === "应收" ? selectedAr : selectedAp;
    const rows = direction === "应收" ? arRows : apRows;
    const ids = [...selected].filter(id => !String(id).startsWith("draft-"));
    if (ids.length === 0) return;
    const sel = rows.filter(r => ids.includes(r.id) && r.bill_id);
    if (sel.length === 0) { alert("所选费用没有绑定账单"); return; }
    if (!confirm(`确认解绑 ${sel.length} 条费用与账单的关系？`)) return;
    const { error } = await supabase.rpc("unbind_charges_from_bill", { p_charge_ids: ids });
    if (error) { alert("解绑失败：" + error.message); return; }
    if (direction === "应收") setSelectedAr(new Set()); else setSelectedAp(new Set());
    await load();
  };

  // 利润分析
  const profit = useMemo(() => {
    const all = [...arRows, ...apRows];
    const byCurrency = {};
    const total = { ar: 0, ap: 0, gross: 0 };
    all.forEach(c => {
      if (c._draft) return;  // 草稿不计入
      const cur = c.currency || "CNY";
      if (!byCurrency[cur]) byCurrency[cur] = { ar: 0, ap: 0, gross: 0 };
      const total_orig = parseFloat(c.amount_total) || 0;
      const cny = parseFloat(c.amount_cny) || 0;
      if (c.direction === "应收") {
        byCurrency[cur].ar += total_orig;
        total.ar += cny;
      } else {
        byCurrency[cur].ap += total_orig;
        total.ap += cny;
      }
    });
    Object.keys(byCurrency).forEach(c => {
      byCurrency[c].gross = byCurrency[c].ar - byCurrency[c].ap;
    });
    total.gross = total.ar - total.ap;
    return { byCurrency, total };
  }, [arRows, apRows]);

  const hasUnsaved = useMemo(() => {
    return arRows.some(r => r._draft) || apRows.some(r => r._draft);
  }, [arRows, apRows]);

  if (!order?.id) {
    return <div style={{ padding: 30, color: "#888", textAlign: "center" }}>请先保存订单后再录入费用</div>;
  }
  if (loading) {
    return <div style={{ padding: 30, textAlign: "center", color: "#888" }}>加载中...</div>;
  }

  // 渲染单个区块
  const renderSection = (title, rows, direction, color) => {
    const selected = direction === "应收" ? selectedAr : selectedAp;
    // v3：列头统一叫"结算单位"
    const partnerLabel = "结算单位";
    // 应收过滤：客户 + 海外代理（部分应收来自代理）；应付过滤：供应商类
    const partnerFilter = direction === "应收"
      ? ["客户", "海外代理"]
      : ["供应商", "船东", "海外代理", "车队", "报关行", "仓库"];
    const partnerOptions = partners.filter(p => partnerFilter.includes(p.partner_type));
    // 默认新增的 partner_type
    const defaultPartnerType = direction === "应收" ? "客户" : "供应商";
    const totalCny = rows.reduce((s, c) => s + (parseFloat(c.amount_cny) || 0), 0);
    const selectedHasBound = [...selected].some(id => {
      const r = rows.find(x => (x.id || x._id) === id);
      return r && r.bill_id;
    });

    return (
      <div style={{ margin: "12px 12px 16px" }}>
        {/* 区块标题栏 */}
        <div style={{
          padding: "8px 14px",
          background: color.bg,
          border: `1px solid ${color.border}`,
          borderRadius: "5px 5px 0 0",
          borderBottom: "none",
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}>
          <span style={{ fontSize: 13, fontWeight: "bold", color: color.text }}>{title}</span>
          <span style={{ fontSize: 11, color: "#666" }}>({rows.length} 项 / 合计 {totalCny.toFixed(2)} CNY)</span>

          <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
            {canEdit && (
              <>
                <button onClick={() => addBlankRow(direction)} style={btnSmallPrimary(color.text)}>+ 费用名称</button>
                {selected.size > 0 && (
                  <>
                    <button onClick={() => createBill(direction)} style={btnSmallPrimary("#13c2c2")}>
                      创建账单 ({selected.size})
                    </button>
                    {selectedHasBound && (
                      <button onClick={() => unbindBill(direction)} style={btnSmallPrimary("#8c8c8c")}>
                        解绑账单
                      </button>
                    )}
                    <button onClick={() => deleteRows(direction, [...selected])} style={btnSmallDanger}>
                      删除 ({selected.size})
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        </div>

        {/* 表格 */}
        <table className="tms-tx-table" style={{ margin: 0, width: "100%", borderRadius: 0, fontSize: 11 }}>
          <thead>
            <tr>
              <th style={{ width: 30, textAlign: "center" }}>
                {canEdit && (
                  <input type="checkbox"
                    checked={rows.length > 0 && selected.size === rows.length}
                    onChange={() => toggleSelectAll(direction)} />
                )}
              </th>
              <th style={{ width: 30, textAlign: "center" }}>#</th>
              <th style={{ width: 130 }}>费用名称</th>
              <th style={{ width: 160 }}>{partnerLabel}</th>
              <th style={{ width: 70 }}>计费单位</th>
              <th style={{ width: 60, textAlign: "right" }}>数量</th>
              <th style={{ width: 60, textAlign: "center" }}>币种</th>
              <th style={{ width: 65, textAlign: "right" }}>汇率</th>
              <th style={{ width: 90, textAlign: "right" }}>单价</th>
              <th style={{ width: 100, textAlign: "right" }}>总价</th>
              <th style={{ width: 70, textAlign: "right" }}>税率%</th>
              <th style={{ width: 110, textAlign: "right" }}>折 CNY</th>
              <th style={{ width: 70, textAlign: "center" }}>状态</th>
              <th style={{ width: 110 }}>账单号</th>
              <th>备注</th>
              <th style={{ width: 70, textAlign: "center" }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={16} style={{ textAlign: "center", padding: 20, color: "#999" }}>
                暂无{direction}，点上方「+ 费用名称」添加
              </td></tr>
            ) : rows.map((r, idx) => {
              const rowId = r.id || r._id;
              const isSelected = selected.has(rowId);
              const isDraft = !!r._draft;
              const lockedByBill = isRowLockedByBill(r);    // 已开票/已结算账单锁定
              const rowEditable = canEdit && !lockedByBill;   // 整行是否可编辑
              const rowBill = r.bill_id ? billMap[r.bill_id] : null;
              return (
                <tr key={rowId}
                  draggable={rowEditable && !isDraft}
                  onDragStart={() => onDragStart(rowId)}
                  onDragOver={onDragOver}
                  onDrop={() => onDrop(direction, rowId)}
                  style={{
                    background: isDraft ? "#fff8e9"
                              : lockedByBill ? "#f5f5f5"
                              : isSelected ? "#e6f4ff" : undefined,
                    cursor: rowEditable && !isDraft ? "move" : undefined,
                    opacity: lockedByBill ? 0.85 : 1,
                  }}>
                  <td style={{ textAlign: "center" }}>
                    {canEdit && (
                      <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(direction, rowId)} />
                    )}
                  </td>
                  <td style={{ textAlign: "center", color: "#888", fontWeight: "bold" }}>{idx + 1}</td>
                  {/* 费用名称 */}
                  <td>
                    {rowEditable ? (
                      <ChargeItemCombo
                        value={r.charge_item_id || ""}
                        options={chargeItems}
                        onChange={cid => updateRow(direction, rowId, { charge_item_id: cid })}
                        onCreateNew={handleCreateChargeItem}
                      />
                    ) : (chargeItems.find(i => i.id === r.charge_item_id)?.name_zh || "—")}
                  </td>
                  {/* 结算单位（PartnerCombo） */}
                  <td>
                    {rowEditable ? (
                      <PartnerCombo
                        value={r.partner_id || ""}
                        options={partnerOptions}
                        defaultPartnerType={defaultPartnerType}
                        onChange={pid => updateRow(direction, rowId, { partner_id: pid })}
                        onCreateNew={handleCreatePartner}
                      />
                    ) : (r.partner_name || partners.find(p => p.id === r.partner_id)?.name || "—")}
                  </td>
                  {/* 单位 */}
                  <td>
                    {rowEditable ? (
                      <input list="unit-suggestions" value={r.unit || ""} onChange={e => updateRow(direction, rowId, { unit: e.target.value })} style={inlineInput} placeholder="票" />
                    ) : (r.unit || "—")}
                  </td>
                  {/* 数量 */}
                  <td>
                    {rowEditable ? (
                      <input type="number" step="0.01" value={r.quantity ?? ""} onChange={e => updateRow(direction, rowId, { quantity: e.target.value })} style={{ ...inlineInput, textAlign: "right" }} />
                    ) : <span style={{ display: "block", textAlign: "right" }}>{r.quantity || 0}</span>}
                  </td>
                  {/* 币种 */}
                  <td>
                    {rowEditable ? (
                      <select value={r.currency || "CNY"} onChange={e => updateRow(direction, rowId, { currency: e.target.value })} style={inlineInput}>
                        {CURRENCIES.map(c => <option key={c}>{c}</option>)}
                      </select>
                    ) : <span style={{ display: "block", textAlign: "center" }}>{r.currency}</span>}
                  </td>
                  {/* 汇率 */}
                  <td>
                    {rowEditable ? (
                      <input type="number" step="0.0001" value={r.exchange_rate ?? 1} onChange={e => updateRow(direction, rowId, { exchange_rate: e.target.value })} style={{ ...inlineInput, textAlign: "right" }} disabled={r.currency === "CNY"} />
                    ) : <span style={{ display: "block", textAlign: "right", color: "#666" }}>{parseFloat(r.exchange_rate || 1).toFixed(4)}</span>}
                  </td>
                  {/* 单价 */}
                  <td>
                    {rowEditable ? (
                      <input type="number" step="0.01" value={r.unit_price ?? ""} onChange={e => updateRow(direction, rowId, { unit_price: e.target.value })} style={{ ...inlineInput, textAlign: "right" }} />
                    ) : <span style={{ display: "block", textAlign: "right" }}>{parseFloat(r.unit_price || 0).toFixed(2)}</span>}
                  </td>
                  {/* 总价（自动算）*/}
                  <td style={{ textAlign: "right", fontWeight: "bold", color: "#333" }}>
                    {(() => {
                      const total = (parseFloat(r.quantity) || 0) * (parseFloat(r.unit_price) || 0) * (1 + (parseFloat(r.tax_rate) || 0) / 100);
                      return total.toFixed(2);
                    })()}
                  </td>
                  {/* 税率 */}
                  <td>
                    {rowEditable ? (
                      <input type="number" step="0.01" value={r.tax_rate ?? 0} onChange={e => updateRow(direction, rowId, { tax_rate: e.target.value })} style={{ ...inlineInput, textAlign: "right" }} />
                    ) : <span style={{ display: "block", textAlign: "right" }}>{parseFloat(r.tax_rate || 0).toFixed(2)}</span>}
                  </td>
                  {/* 折 CNY */}
                  <td style={{ textAlign: "right", fontWeight: "bold", color: color.text }}>
                    {(() => {
                      const total = (parseFloat(r.quantity) || 0) * (parseFloat(r.unit_price) || 0) * (1 + (parseFloat(r.tax_rate) || 0) / 100);
                      const cny = total * (parseFloat(r.exchange_rate) || 1);
                      return cny.toFixed(2);
                    })()}
                  </td>
                  {/* 状态 */}
                  <td style={{ textAlign: "center" }}>
                    {rowEditable ? (
                      <select value={r.status || "草稿"} onChange={e => updateRow(direction, rowId, { status: e.target.value })} style={inlineInput}>
                        <option>草稿</option><option>已确认</option><option>已开票</option><option>已结清</option>
                      </select>
                    ) : <span style={{ fontSize: 10, color: "#888" }}>{r.status}</span>}
                  </td>
                  {/* 账单号 */}
                  <td style={{ textAlign: "center" }}>
                    {rowBill ? (
                      <a
                        href={`#/bills/${rowBill.id}`}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: "#1890ff", textDecoration: "underline",
                                 fontFamily: "'Consolas',monospace", fontSize: 10 }}
                      >
                        {rowBill.bill_no}
                      </a>
                    ) : <span style={{ color: "#ccc" }}>—</span>}
                  </td>
                  {/* 备注 */}
                  <td>
                    {rowEditable ? (
                      <input value={r.remark || ""} onChange={e => updateRow(direction, rowId, { remark: e.target.value })} style={inlineInput} />
                    ) : (r.remark || "")}
                  </td>
                  {/* 操作 */}
                  <td style={{ textAlign: "center" }}>
                    {rowEditable && (
                      <>
                        <span className="lk" style={{ marginRight: 6 }} onClick={() => copyRow(direction, r)}>复制</span>
                        <span className="delete-btn" onClick={() => deleteRows(direction, [rowId])}>删</span>
                      </>
                    )}
                    {isDraft && <span style={{ marginLeft: 6, fontSize: 9, color: "#fa8c16", fontWeight: "bold" }}>未保存</span>}
                    {lockedByBill && <span style={{ fontSize: 12, color: "#1890ff", fontWeight: "bold" }} title="已开票/已结算账单锁定">🔒</span>}
                  </td>
                </tr>
              );
            })}
            {rows.length > 0 && (
              <tr style={{ background: color.bgLight, fontWeight: "bold" }}>
                <td colSpan={11} style={{ textAlign: "right", color: color.text }}>合计 (CNY):</td>
                <td style={{ textAlign: "right", color: color.text, fontSize: 13 }}>{totalCny.toFixed(2)}</td>
                <td colSpan={4}></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div>
      {/* 顶部全局保存按钮 */}
      {canEdit && (
        <div style={{
          margin: "12px 12px 0",
          padding: "8px 14px",
          background: hasUnsaved ? "#fff8e9" : "#f5f5f5",
          border: `1px solid ${hasUnsaved ? "#ffd28e" : "#ddd"}`,
          borderRadius: 5,
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}>
          {hasUnsaved
            ? <span style={{ fontSize: 12, color: "#c66800", fontWeight: "bold" }}>⚠ 有未保存的费用，请点击右侧保存</span>
            : <span style={{ fontSize: 12, color: "#888" }}>所有费用已保存</span>}
          <button
            onClick={saveAll}
            disabled={saving || !hasUnsaved}
            style={{
              marginLeft: "auto",
              padding: "5px 18px",
              background: saving || !hasUnsaved ? "#ccc" : "#1990FF",
              color: "#fff",
              border: "none",
              borderRadius: 3,
              cursor: saving || !hasUnsaved ? "not-allowed" : "pointer",
              fontSize: 12,
              fontWeight: "bold",
            }}>
            {saving ? "保存中..." : "保存所有费用"}
          </button>
        </div>
      )}

      {/* 单位建议 datalist */}
      <datalist id="unit-suggestions">
        {UNIT_SUGGESTIONS.map(u => <option key={u} value={u} />)}
      </datalist>

      {renderSection("应收（来自客户）", arRows, "应收", { bg: "#e6f4ff", bgLight: "#f0f7ff", border: "#91d5ff", text: "#0050b3" })}
      {renderSection("应付（给供应商）", apRows, "应付", { bg: "#fff7e6", bgLight: "#fffaf0", border: "#ffd591", text: "#ad4e00" })}

      {/* 利润分析 */}
      {canViewProfit && (arRows.filter(r => !r._draft).length + apRows.filter(r => !r._draft).length > 0) && (
        <div style={{ margin: "12px 12px 16px" }}>
          <div style={{ padding: "8px 14px", background: "#fff8e9", border: "1px solid #ffd28e", borderRadius: "5px 5px 0 0", borderBottom: "none" }}>
            <span style={{ fontSize: 13, fontWeight: "bold", color: "#c66800" }}>💰 利润分析</span>
            <span style={{ fontSize: 11, color: "#999", marginLeft: 8 }}>（仅管理员/财务/销售可见，仅含已保存费用）</span>
          </div>
          <div style={{ padding: 14, background: "#fffbe6", border: "1px solid #ffd28e", borderRadius: "0 0 5px 5px" }}>
            <div style={{ display: "flex", gap: 30, marginBottom: 12, paddingBottom: 12, borderBottom: "1px dashed #ffd28e" }}>
              <div>
                <div style={{ fontSize: 11, color: "#888" }}>应收合计 (CNY)</div>
                <div style={{ fontSize: 16, fontWeight: "bold", color: "#0050b3" }}>{profit.total.ar.toFixed(2)}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "#888" }}>应付合计 (CNY)</div>
                <div style={{ fontSize: 16, fontWeight: "bold", color: "#ad4e00" }}>{profit.total.ap.toFixed(2)}</div>
              </div>
              <div style={{ borderLeft: "1px solid #ffd28e", paddingLeft: 30 }}>
                <div style={{ fontSize: 11, color: "#888" }}>毛利 (CNY)</div>
                <div style={{ fontSize: 18, fontWeight: "bold", color: profit.total.gross >= 0 ? "#52c41a" : "#cf1322" }}>
                  {profit.total.gross >= 0 ? "+" : ""}{profit.total.gross.toFixed(2)}
                </div>
              </div>
              <div style={{ paddingLeft: 20 }}>
                <div style={{ fontSize: 11, color: "#888" }}>毛利率</div>
                <div style={{ fontSize: 16, fontWeight: "bold", color: profit.total.gross >= 0 ? "#52c41a" : "#cf1322" }}>
                  {profit.total.ar > 0 ? ((profit.total.gross / profit.total.ar) * 100).toFixed(1) + "%" : "—"}
                </div>
              </div>
            </div>
            <div style={{ fontSize: 11, color: "#888", marginBottom: 6 }}>分币种毛利：</div>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              {Object.entries(profit.byCurrency).map(([cur, p]) => (
                <div key={cur} style={{ padding: "6px 12px", background: "#fff", border: "1px solid #ffd28e", borderRadius: 4, fontSize: 12 }}>
                  <b style={{ color: "#666" }}>{cur}</b>:&nbsp;
                  <span style={{ color: "#0050b3" }}>+{p.ar.toFixed(2)}</span>&nbsp;-&nbsp;
                  <span style={{ color: "#ad4e00" }}>{p.ap.toFixed(2)}</span>&nbsp;=&nbsp;
                  <span style={{ color: p.gross >= 0 ? "#52c41a" : "#cf1322", fontWeight: "bold" }}>
                    {p.gross >= 0 ? "+" : ""}{p.gross.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {!canViewProfit && (
        <div style={{ margin: "12px 12px 16px", padding: 12, background: "#f5f5f5", border: "1px dashed #ddd", borderRadius: 5, fontSize: 11, color: "#999", textAlign: "center" }}>
          利润信息仅管理员、财务、销售可见
        </div>
      )}
    </div>
  );
}

const inlineInput = { width: "100%", height: 22, padding: "1px 4px", border: "1px solid #ddd", borderRadius: 2, fontSize: 11, background: "#fff" };
const btnSmallPrimary = (color) => ({ padding: "3px 10px", background: color, color: "#fff", border: "none", borderRadius: 3, cursor: "pointer", fontSize: 11 });
const btnSmallDanger = { padding: "3px 10px", background: "#ff4d4f", color: "#fff", border: "none", borderRadius: 3, cursor: "pointer", fontSize: 11 };


function NewOrderModal({ onClose, onSaved, defaultType = "FCL" }) {
  const [form, setForm] = useState({
    shipment_type: defaultType,
    customer: "", overseas_agent: "Keplin", solicit_type: "代理货",
    carrier: "", vessel: "", voyage: "", booking_no: "",
    etd: "", eta: "",
    pol: "", pod: "", destination: "",
    incoterms: "FOB",
    po: "", customer_po: "",
    qty_container: "", qty_packages: "", weight: "", volume: "",
    description: "",
  });
  const [refData, setRefData] = useState({ customers: [], agents: [], carriers: [], ports: [] });
  const [saving, setSaving] = useState(false);

  // 加载客商分类
  useEffect(() => {
    supabase.from("customers")
      .select("name, partner_type, active")
      .eq("active", true)
      .then(({ data }) => {
        const all = data || [];
        setRefData({
          customers: all.filter(c => c.partner_type === "客户").map(c => c.name),
          agents:    all.filter(c => c.partner_type === "海外代理").map(c => c.name),
          carriers:  all.filter(c => c.partner_type === "船东").map(c => c.name),
          ports: [],  // 港口暂时手输
        });
      });
  }, []);

  const set = (k, val) => setForm(p => ({ ...p, [k]: val }));

  const isConsole = form.shipment_type === "Console";

  const buildPayload = () => {
    const data = { ...form, lifecycle: "处理中", finance_status: "未创建" };
    // 自拼主拼空壳：清空票级字段
    if (isConsole) {
      data.customer = null;
      data.po = null;
      data.customer_po = null;
      data.qty_packages = null;
      data.weight = null;
      data.volume = null;
      data.description = null;
    }
    // 数字字段：空字符串 → null（avoid Postgres invalid input syntax）
    ["qty_packages", "weight", "volume"].forEach(k => {
      if (data[k] === "" || data[k] === undefined) data[k] = null;
    });
    // 其他空字符串也转 null
    Object.keys(data).forEach(k => {
      if (data[k] === "") data[k] = null;
    });
    return data;
  };

  const validate = () => {
    if (!form.shipment_type) { alert("请选择出运类型"); return false; }
    if (!isConsole && !form.customer?.trim()) { alert("委托单位 必填"); return false; }
    if (!form.booking_no?.trim()) { alert("MB/L No. 必填"); return false; }
    return true;
  };

  // 保存（关闭弹窗）
  const saveAndClose = async () => {
    if (!validate()) return;
    setSaving(true);
    const { error } = await supabase.from("shipments").insert(filterShipmentPayload(buildPayload()));
    setSaving(false);
    if (error) { alert("保存失败：" + error.message); return; }
    onSaved();  // 父组件会刷新列表
  };

  // 保存并继续编辑（保存后自动跳转到详情页）
  const saveAndEdit = async () => {
    if (!validate()) return;
    setSaving(true);
    const { data, error } = await supabase.from("shipments").insert(filterShipmentPayload(buildPayload())).select().single();
    setSaving(false);
    if (error) { alert("保存失败：" + error.message); return; }
    if (data?.id) {
      onSaved(data.id);  // 父组件会跳转到这条订单的详情
    } else {
      onSaved();
    }
  };

  const typeLabel = isConsole ? "自拼主拼" : form.shipment_type === "LCL" ? "拼箱" : "整柜";

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
    }}>
      <div style={{
        background: "#fff", borderRadius: 5, width: 720, maxHeight: "90vh", overflow: "auto",
        boxShadow: "0 10px 40px rgba(0,0,0,0.2)",
      }}>
        {/* 蓝色标题条 */}
        <div style={{
          padding: "10px 16px", background: "linear-gradient(#1990FF,#0e7fe6)", color: "#fff",
          fontSize: 14, fontWeight: "bold", display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <span>新建作业 — {typeLabel}</span>
          <span style={{ cursor: "pointer", fontSize: 18 }} onClick={onClose}>×</span>
        </div>

        {isConsole && (
          <div style={{ padding: "8px 16px", background: "#fff7e6", borderBottom: "1px solid #ffd28e", fontSize: 12, color: "#c66800" }}>
            ⓘ 自拼柜模式：当前新建主拼（整柜数据壳），保存后请进入主拼详情页的「小票」tab 添加各票分票。
          </div>
        )}

        <div style={{ padding: 16 }}>
          {/* ── 作业基本信息 ── */}
          <div style={sectionTitle}>作业基本信息</div>
          <div className="tms-detail-panel" style={{ margin: "4px 0 12px" }}>
            <div className="tms-detail-grid" style={{ gap: "8px 12px" }}>
              <div className="tms-df"><label>出运类型</label><div className="tms-df-blk">
                <select value={form.shipment_type} onChange={e => set("shipment_type", e.target.value)}>
                  <option value="FCL">整柜</option>
                  <option value="LCL">拼箱</option>
                  <option value="Console">自拼柜（主拼）</option>
                </select>
              </div></div>
              <div className="tms-df"><label>作业号</label><div className="tms-df-blk">
                <input value="（保存后自动生成）" disabled className="readonly" style={{ fontStyle: "italic", color: "#999" }} />
              </div></div>
              <div className="tms-df"><label>揽货类型</label><div className="tms-df-blk">
                <select value={form.solicit_type} onChange={e => set("solicit_type", e.target.value)}>
                  <option>代理货</option>
                  <option>自揽货</option>
                  <option>待订舱</option>
                </select>
              </div></div>

              {!isConsole && (
                <div className="tms-df full2"><label className="req">委托单位</label><div className="tms-df-blk">
                  <ComboBox value={form.customer} onChange={v => set("customer", v)} options={refData.customers} />
                </div></div>
              )}
              {isConsole && <div className="tms-df full2" style={{ visibility: "hidden" }}></div>}
              <div className="tms-df"><label>海外代理</label><div className="tms-df-blk">
                <ComboBox value={form.overseas_agent} onChange={v => set("overseas_agent", v)} options={refData.agents} />
              </div></div>
            </div>
          </div>

          {/* ── 船期信息 ── */}
          <div style={sectionTitle}>船期信息</div>
          <div className="tms-detail-panel-light" style={{ margin: "4px 0 12px" }}>
            <div className="tms-detail-grid" style={{ gap: "8px 12px" }}>
              <div className="tms-df"><label>船东</label><div className="tms-df-blk">
                <ComboBox value={form.carrier} onChange={v => set("carrier", v)} options={refData.carriers} />
              </div></div>
              <div className="tms-df full2"><label>船名</label><div className="tms-df-blk">
                <input value={form.vessel} onChange={e => set("vessel", e.target.value)} placeholder="例如 EMMA MAERSK" />
              </div></div>
              <div className="tms-df"><label>航次</label><div className="tms-df-blk">
                <input value={form.voyage} onChange={e => set("voyage", e.target.value)} placeholder="例如 619W" />
              </div></div>
              <div className="tms-df full2"><label className="req">MB/L No.</label><div className="tms-df-blk">
                <input value={form.booking_no} onChange={e => set("booking_no", e.target.value)} className="notnull" />
              </div></div>
              <div className="tms-df"><label>预计开航</label><div className="tms-df-blk">
                <input type="date" value={form.etd} onChange={e => set("etd", e.target.value)} />
              </div></div>
              <div className="tms-df"><label>预计到港</label><div className="tms-df-blk">
                <input type="date" value={form.eta} onChange={e => set("eta", e.target.value)} />
              </div></div>
            </div>
          </div>

          {/* ── 港口信息 ── */}
          <div style={sectionTitle}>港口信息</div>
          <div className="tms-detail-panel" style={{ margin: "4px 0 12px" }}>
            <div className="tms-detail-grid" style={{ gap: "8px 12px" }}>
              <div className="tms-df"><label>起运港</label><div className="tms-df-blk">
                <input value={form.pol} onChange={e => set("pol", e.target.value)} placeholder="例如 Ningbo" />
              </div></div>
              <div className="tms-df"><label>卸货港</label><div className="tms-df-blk">
                <input value={form.pod} onChange={e => set("pod", e.target.value)} placeholder="例如 London Gateway" />
              </div></div>
              <div className="tms-df"><label>目的地</label><div className="tms-df-blk">
                <input value={form.destination} onChange={e => set("destination", e.target.value)} />
              </div></div>
              <div className="tms-df"><label>贸易条款</label><div className="tms-df-blk">
                <select value={form.incoterms} onChange={e => set("incoterms", e.target.value)}>
                  <option value="">—</option>
                  {TRADE_TERMS.map(t => <option key={t}>{t}</option>)}
                </select>
              </div></div>
              <div className="tms-df full2"><label>箱型箱量</label><div className="tms-df-blk">
                <input value={form.qty_container} onChange={e => set("qty_container", e.target.value)} placeholder="例如 1*40HQ 或 2*20GP,1*40HQ" />
              </div></div>
            </div>
          </div>

          {/* ── 货物概要（自拼主拼隐藏） ── */}
          {!isConsole && (
            <>
              <div style={sectionTitle}>货物概要</div>
              <div className="tms-detail-panel-light" style={{ margin: "4px 0 12px" }}>
                <div className="tms-detail-grid" style={{ gap: "8px 12px" }}>
                  <div className="tms-df"><label>客户编号(PO)</label><div className="tms-df-blk">
                    <input value={form.po} onChange={e => set("po", e.target.value)} />
                  </div></div>
                  <div className="tms-df"><label>客户 PO#</label><div className="tms-df-blk">
                    <input value={form.customer_po} onChange={e => set("customer_po", e.target.value)} />
                  </div></div>
                  <div className="tms-df"><label>件数</label><div className="tms-df-blk">
                    <input type="number" value={form.qty_packages} onChange={e => set("qty_packages", e.target.value)} />
                  </div></div>
                  <div className="tms-df"><label>毛重 (KG)</label><div className="tms-df-blk">
                    <input type="number" value={form.weight} onChange={e => set("weight", e.target.value)} step="0.01" />
                  </div></div>
                  <div className="tms-df"><label>体积 (CBM)</label><div className="tms-df-blk">
                    <input type="number" value={form.volume} onChange={e => set("volume", e.target.value)} step="0.001" />
                  </div></div>
                  <div className="tms-df full3"><label>品名货描</label><div className="tms-df-blk">
                    <textarea value={form.description} onChange={e => set("description", e.target.value)} rows={2} />
                  </div></div>
                </div>
              </div>
            </>
          )}

          {/* 提示 */}
          <div style={{ padding: 8, background: "#f0f7ff", border: "1px solid #c8dfff", borderRadius: 3, fontSize: 11, color: "#666", marginBottom: 12 }}>
            <b>* 红色标记字段必填</b>。其他字段可在保存后进入详情页继续完善（如收发货人、HBL、装箱、SOP 等）。
          </div>

          {/* 保存按钮组 */}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button onClick={onClose} disabled={saving} style={btnGray}>取消</button>
            <button onClick={saveAndClose} disabled={saving} style={btnGhost}>
              {saving ? "保存中..." : "保存并关闭"}
            </button>
            <button onClick={saveAndEdit} disabled={saving} style={btnPrimary}>
              {saving ? "保存中..." : "保存并继续编辑 →"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const sectionTitle = {
  fontSize: 12, fontWeight: "bold", color: "#1990FF",
  padding: "4px 0", borderBottom: "1px solid #c8dfff", marginBottom: 4,
};
const btnPrimary = {
  padding: "6px 16px", background: "#1990FF", color: "#fff",
  border: "none", borderRadius: 3, cursor: "pointer", fontSize: 13,
};
const btnGhost = {
  padding: "6px 16px", background: "#fff", color: "#1990FF",
  border: "1px solid #1990FF", borderRadius: 3, cursor: "pointer", fontSize: 13,
};
const btnGray = {
  padding: "6px 16px", background: "#f5f5f5", color: "#666",
  border: "1px solid #ddd", borderRadius: 3, cursor: "pointer", fontSize: 13,
};

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

// V5：托单信息 V4 风格的样式集
// 参考 V4 真实 HTML 结构（class="label" / class="input innertext" / class="block"）
// 颜色与字号尽量贴近 V4：label 12px 普通灰色 / blue 蓝色 / 必填红星
const tmStyles = {
  // 整个托单信息 wrapper
  wrap: {
    fontSize: 12,
    fontFamily: "'Microsoft YaHei',Arial,sans-serif",
  },
  // 段（V4 中的 .group）
  section: {
    padding: "6px 0",
    borderBottom: "1px solid #d6e0f0",
    marginBottom: 4,
  },
  subSection: {
    marginBottom: 6,
  },
  // 一行
  row: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    flexWrap: "nowrap",
  },
  // 标签
  label: {
    fontSize: 12,
    color: "#444",
    minWidth: 75,
    textAlign: "right",
    paddingRight: 4,
    flexShrink: 0,
    lineHeight: "24px",
  },
  labelBlue: { color: "#1990ff" },
  labelRef: { color: "#0055aa" },        // V4 ref class（关联字段）
  labelNotnull: {
    fontWeight: 600,
    position: "relative",
  },
  labelReadonly: { color: "#666" },
  labelVertical: {
    minWidth: 75,
    textAlign: "right",
    alignSelf: "flex-start",
    paddingTop: 4,
  },
  // 输入框
  input: {
    boxSizing: "border-box",
    padding: "3px 6px",
    height: 24,
    border: "1px solid #c1c1c1",
    borderRadius: 2,
    fontSize: 12,
    background: "#fff",
    outline: "none",
    color: "#222",
  },
  // + 加箱按钮（V4 风格）
  btnPlus: {
    width: 28,
    height: 24,
    padding: 0,
    border: "1px solid #c1c1c1",
    borderRadius: 2,
    background: "#f5f5f5",
    cursor: "pointer",
    fontSize: 14,
    lineHeight: 1,
    color: "#1990ff",
    fontWeight: 600,
  },
  // 3 列大网格
  threeColWrap: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 405px) minmax(0, 405px) minmax(0, 380px)",
    gap: 12,
    paddingTop: 8,
    borderTop: "1px solid #d6e0f0",
  },
  col: {
    minWidth: 0,
  },
};

// V5：港口行（label + 双框）— V4 标准模式
// label 75px / code 60px / name flex 撑满（约 200px）
function PortRow({ label, required, value, onChange, disabled }) {
  return (
    <div style={{ ...tmStyles.subSection, ...tmStyles.row }}>
      <label style={{
        ...tmStyles.label,
        ...(required ? tmStyles.labelBlue : tmStyles.labelRef),
        ...(required ? tmStyles.labelNotnull : {}),
      }}>
        {required && <span style={{ color: "#ff4d4f", marginRight: 2 }}>*</span>}
        {label}
      </label>
      <div style={{ flex: 1, minWidth: 0, position: "relative" }}>
        <PortPicker value={value} onChange={onChange} disabled={disabled} />
      </div>
    </div>
  );
}
