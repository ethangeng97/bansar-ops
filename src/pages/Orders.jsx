import { useState, useEffect, useCallback, useMemo, useRef, useImperativeHandle } from "react";
import { supabase } from "../supabase.js";
import { Spinner, ComboBox } from "../components/ui.jsx";
import { TmsTitle, Mi, MiDropdown, Tbl, Fi, TmsTabs, TmsInfoBar, TmsPagination, Df, DfCheckbox, LifecycleStamp, SopProgress } from "../components/tms.jsx";
import { COMMON_CARRIERS } from "../lib/carriers.js";
import PortPicker from "../components/PortPicker.jsx";
import ContainerEditor from "../components/ContainerEditor.jsx";
import BLImportModal from "../components/BLImportModal.jsx";
import Sino56ImportModal from "../components/Sino56ImportModal.jsx";
import SIDocImportModal from "../components/SIDocImportModal.jsx";
import PackingListImportModal from "../components/PackingListImportModal.jsx";
import { buildSino56Manifest, downloadArrayBufferAsXls } from "../lib/sino56-manifest.js";
import { exportDraftBLToXlsx } from "../lib/draft-bl-xlsx.js";
import Statement from "./docs/Statement.jsx";
import AttachmentsPanel from "../components/AttachmentsPanel.jsx";
import HistoryModal from "../components/HistoryModal.jsx";
import BookingTemplateModal from "../components/BookingTemplateModal.jsx";
import {
  ChargeImportModal,
  ChargeCopyFromShipmentModal,
  ChargeTemplateApplyModal,
  ChargeTemplateSaveModal,
} from "../components/ChargesToolbarModals.jsx";
import { JoinSubTicketModal, RemoveSubTicketModal, SplitCargoToSubsModal } from "../components/SubTicketModals.jsx";
import MergeOrdersModal from "../components/MergeOrdersModal.jsx";
import { exportToXlsx } from "../lib/excel-export.js";
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
  // 让 load() 内能读到最新的 filters（搜索按钮触发时），但不把它们塞进 useCallback deps，
  // 否则用户每敲一个字符就会触发后端查询。
  const filtersRef = useRef(filters);
  useEffect(() => { filtersRef.current = filters; });
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [maxRows, setMaxRows] = useState(500);
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
      // 没 type → null，由对话框引导用户选
    }
    return null;
  });
  // 类型选择对话框（点"新建作业"按钮显示，或 URL 有 action=new 但没 type）
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
        .limit(maxRows);

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

      // 服务端过滤：搜索关键字 + ETD 日期范围
      // PostgREST ilike 用 *  做通配符（裸 % 现在会被网关 500 掉，必须 URL-encode 或换成 *）
      // 转义 \(),*  避免破坏 .or() 表达式
      const escIlike = (s) => String(s).replace(/[\\(),*]/g, "\\$&");
      const q = (search || "").trim();
      if (q) {
        const esc = escIlike(q);
        // 6 个最常用列；其它字段（HBL/容器号等）依然由前端二次过滤兜底
        query = query.or(
          `order_no.ilike.*${esc}*,mbl_no.ilike.*${esc}*,booking_no.ilike.*${esc}*,` +
          `customer.ilike.*${esc}*,po.ilike.*${esc}*,vessel.ilike.*${esc}*`
        );
      }
      if (filters.etd_from) query = query.gte("etd", filters.etd_from);
      if (filters.etd_to)   query = query.lte("etd", filters.etd_to);

      // 标识类过滤字段推到服务端，避免"目标记录在最近 500 条之外就找不到"
      // 这些字段不放进 useCallback deps（见 filtersRef 注释），所以从 ref 读最新值
      const fNow = filtersRef.current || {};
      const ilikeArg = (s) => `*${escIlike(s)}*`;
      const mblQ = String(fNow.booking_no || "").trim();
      if (mblQ) {
        const e = escIlike(mblQ);
        query = query.or(`booking_no.ilike.*${e}*,mbl_no.ilike.*${e}*,e_booking_no.ilike.*${e}*`);
      }
      const hblQ = String(fNow.hbl_no || "").trim();
      if (hblQ) query = query.ilike("hbl_no", ilikeArg(hblQ));
      const cntQ = String(fNow.container_no || "").trim();
      if (cntQ) query = query.ilike("container_no", ilikeArg(cntQ));
      const ordQ = String(fNow.order_no || "").trim();
      if (ordQ) query = query.ilike("order_no", ilikeArg(ordQ));
      const poQ = String(fNow.po || "").trim();
      if (poQ) query = query.ilike("po", ilikeArg(poQ));

      const { data, error } = await query;
      if (error) console.error("load shipments error:", error);
      let result = data || [];

      // 自拼母单补齐：当前结果集里有 -N 分票但母单（去掉 -N）不在结果里时，
      // 按 order_no 二次拉取母单合并进来，保证列表能正确展示主拼父子层级。
      // （一票挂在某 booking 下时，limit/role 可能把母单截掉，导致分票被错误
      // 当成顶级行展示。）
      const loadedNos = new Set(result.map(s => s.order_no).filter(Boolean));
      const missingMasters = new Set();
      for (const s of result) {
        if (s.order_no && /-\d+$/.test(s.order_no)) {
          const master = s.order_no.replace(/-\d+$/, "");
          if (!loadedNos.has(master)) missingMasters.add(master);
        }
      }
      if (missingMasters.size > 0) {
        const { data: masters } = await supabase.from("shipments")
          .select(COLUMNS)
          .in("order_no", [...missingMasters]);
        if (masters && masters.length > 0) {
          const have = new Set(result.map(s => s.id));
          result = [...result, ...masters.filter(m => !have.has(m.id))];
        }
      }

      setShipments(result);
    } finally {
      setLoading(false);
    }
  }, [role, user?.id, user?.profile?.full_name, maxRows, search, filters.etd_from, filters.etd_to]);

  useEffect(() => { load(); }, [load]);

  // 缩写搜索用：拉 customers_full（含 name_short/name_en/code）建反查
  const [customersFull, setCustomersFull] = useState([]);
  useEffect(() => {
    let alive = true;
    getCachedRef("customers_full").then(list => { if (alive) setCustomersFull(list || []); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  // 给定搜索词 q，返回所有别名（name_short/name_en/code）命中 q 的 customer.name 集合
  const aliasMatchedNames = useCallback((q) => {
    if (!q) return null;
    const lq = q.toLowerCase();
    const set = new Set();
    for (const c of customersFull) {
      const aliases = [c.name_short, c.name_en, c.code].filter(Boolean);
      if (aliases.some(a => String(a).toLowerCase().includes(lq))) {
        if (c.name) set.add(c.name);
      }
    }
    return set;
  }, [customersFull]);

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
    if (f.qty_type && !(o.qty_container || "").toUpperCase().includes(String(f.qty_type).toUpperCase())) return false;
    if (f.destination && o.destination !== f.destination) return false;
    if (f.booking_no) {
      const q = String(f.booking_no).toLowerCase();
      const hit = (o.booking_no || "").toLowerCase().includes(q)
        || (o.mbl_no || "").toLowerCase().includes(q)
        || (o.e_booking_no || "").toLowerCase().includes(q);
      if (!hit) return false;
    }
    if (f.container_no && !(o.container_no || "").toLowerCase().includes(String(f.container_no).toLowerCase())) return false;
    if (f.order_no && !(o.order_no || "").toLowerCase().includes(String(f.order_no).toLowerCase())) return false;
    if (f.po && !(o.po || "").toLowerCase().includes(String(f.po).toLowerCase())) return false;
    if (f.hbl_no && !(o.hbl_no || "").toLowerCase().includes(String(f.hbl_no).toLowerCase())) return false;
    if (f.etd_from && o.etd && o.etd < f.etd_from) return false;
    if (f.etd_to && o.etd && o.etd > f.etd_to) return false;
    if (search) {
      const q = search.toLowerCase();
      const pool = [o.po, o.customer_po, o.booking_no, o.mbl_no, o.e_booking_no, o.container_no, o.vessel, o.voyage, o.supplier, o.order_no, o.customer, o.pol, o.pod, o.overseas_agent, o.end_customer];
      const directHit = pool.filter(Boolean).some(x => String(x).toLowerCase().includes(q));
      if (!directHit) {
        // 缩写匹配：q 命中某 customer 的 name_short/name_en/code 时，
        // 该 customer.name 等价匹配
        const aliasNames = aliasMatchedNames(search);
        const aliasHit = aliasNames && aliasNames.size > 0 && [
          o.customer, o.supplier, o.overseas_agent, o.end_customer,
        ].some(v => v && aliasNames.has(v));
        if (!aliasHit) return false;
      }
    }
    return true;
  }), [shipments, filters, search, sopNode, aliasMatchedNames]);

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
        const master = items.find(isMaster);
        // 真主单不在加载范围内（搜索/limit 截断 etc.）：分票各自独立成行，不缩进
        if (!master) {
          items
            .sort((a, b) => {
              const na = parseInt((a.order_no || "").match(/-(\d+)$/)?.[1] || "999");
              const nb = parseInt((b.order_no || "").match(/-(\d+)$/)?.[1] || "999");
              return na - nb;
            })
            .forEach(o => rows.push({ t: "s", d: o }));
          return;
        }
        const subs = items.filter(o => o !== master)
          .sort((a, b) => {
            // 分票按尾数排序（-1, -2, -3...）
            const na = parseInt((a.order_no || "").match(/-(\d+)$/)?.[1] || "999");
            const nb = parseInt((b.order_no || "").match(/-(\d+)$/)?.[1] || "999");
            return na - nb;
          });

        // 主拼行带 subCount，列表渲染时拿来做父行"委托单位"列的聚合显示
        rows.push({ t: "s", d: master, subCount: subs.length });
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

  // 合并订单弹窗
  const [showMergeModal, setShowMergeModal] = useState(false);
  // 勾选的订单（用于合并）— 从 shipments 里挑出来
  const checkedOrders = useMemo(
    () => shipments.filter(s => checkedIds.has(s.id)),
    [shipments, checkedIds]
  );
  // 合并资格：≥2 个 + 没有 Console（避免母拼/分票二次嵌套）
  const canMerge = checkedOrders.length >= 2
    && checkedOrders.every(s => s.shipment_type !== "Console");
  const openMerge = () => {
    if (checkedOrders.length < 2) { alert("请勾选至少 2 个订单"); return; }
    const consoleOnes = checkedOrders.filter(s => s.shipment_type === "Console");
    if (consoleOnes.length) {
      alert(`勾选中有自拼柜订单（${consoleOnes.map(s => s.order_no).join(", ")}），不能再合并。`);
      return;
    }
    setShowMergeModal(true);
  };

  const clearF = () => { setFilters({}); setSearch(""); };

  // 列表导出 Excel
  const exportOrdersList = async (rows) => {
    if (!rows || rows.length === 0) { alert("当前没有可导出的数据"); return; }
    const stampLocal = new Date().toISOString().slice(0, 10);
    await exportToXlsx({
      filename: `Bansar-海运出口-${stampLocal}.xlsx`,
      sheetName: "海运出口",
      columns: [
        { key: "order_no", label: "作业号", width: 18 },
        { key: "shipment_type", label: "类型", width: 8 },
        { key: "customer", label: "委托单位", width: 28 },
        { key: "supplier", label: "供应商", width: 16 },
        { key: "booking_no", label: "MB/L No.", width: 18 },
        { key: "hbl_no", label: "HBL", width: 18 },
        { key: "po", label: "PO#", width: 18 },
        { key: "customer_po", label: "客户 PO", width: 18 },
        { key: "vessel", label: "船名", width: 22 },
        { key: "voyage", label: "航次", width: 10 },
        { key: "pol", label: "起运港", width: 14 },
        { key: "pod", label: "卸货港", width: 14 },
        { key: "destination", label: "目的地", width: 14 },
        { key: "etd", label: "ETD", width: 12 },
        { key: "atd", label: "ATD", width: 12 },
        { key: "qty_container", label: "箱型箱量", width: 14 },
        { key: "container_no", label: "箱号", width: 14 },
        { key: "qty_packages", label: "件数", width: 8 },
        { key: "weight", label: "毛重(KG)", width: 12, format: v => v == null ? "" : Number(v).toFixed(2) },
        { key: "volume", label: "体积(CBM)", width: 12, format: v => v == null ? "" : Number(v).toFixed(4) },
        { key: "lifecycle", label: "状态", width: 8 },
        { key: "qc_status", label: "QC", width: 12 },
        { key: "space_status", label: "出运状态", width: 10 },
        { key: "carrier", label: "船东", width: 14 },
        { key: "overseas_agent", label: "海外代理", width: 18 },
      ],
      rows,
    });
  };

  // 保存成功后立即把 update returning 的行推回到本地状态，省去一次刷新
  // （supabase wrapper 默认带 Prefer: return=representation）
  const applyUpdated = useCallback((row) => {
    if (!row || !row.id) return;
    setFullOrder(prev => prev && prev.id === row.id ? { ...prev, ...row } : prev);
    setShipments(prev => prev.map(s => s.id === row.id ? { ...s, ...row } : s));
  }, []);

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
        onUpdated={applyUpdated}
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

  if (selOrder) {
    // 上行/下行导航：基于当前过滤后的列表
    const navIds = filtered.map(o => o.id);
    const curIdx = navIds.indexOf(selOrder.id);
    const prevId = curIdx > 0 ? navIds[curIdx - 1] : null;
    const nextId = curIdx >= 0 && curIdx < navIds.length - 1 ? navIds[curIdx + 1] : null;
    return (
    <OrderDetail
      order={selOrder}
      role={role}
      user={user}
      prevId={prevId}
      nextId={nextId}
      onNavigate={(id) => {
        setSelectedId(id);
        window.history.replaceState(null, "", `#/sea_export?id=${id}`);
      }}
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
      onUpdated={applyUpdated}
    />
    );
  }

  const cols = COLS_DEF.map(c => ({ ...c, w: colWidths[c.k] }));
  const totalW = cols.reduce((a, c) => a + c.w, 0);

  return (
    <div className="tms">

      {/* 合并订单弹窗 */}
      {showMergeModal && (
        <MergeOrdersModal
          selected={checkedOrders}
          onClose={() => setShowMergeModal(false)}
          onMerged={(master) => {
            setCheckedIds(new Set());
            load();
            if (master?.id) window.open(`#/sea_export?id=${master.id}`, "_blank");
          }}
        />
      )}

      {/* 类型选择对话框（点"新建作业"按钮触发） */}
      {showTypePicker && (() => {
        const pickType = (t) => {
          setShowTypePicker(false);
          window.open(`#/sea_export?action=new&type=${t}`, "_blank");
        };
        const types = [
          { v: "FCL", label: "整箱", desc: "Full Container Load" },
          { v: "LCL", label: "拼箱", desc: "Less than Container Load" },
          { v: "Console", label: "自拼柜", desc: "自营拼箱主单" },
        ];
        return (
          <div style={{
            position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)",
            display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
          }} onClick={() => setShowTypePicker(false)}>
            <div style={{
              background: "#fff", border: "1px solid #abadb3", borderRadius: 3,
              width: 380, boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
            }} onClick={e => e.stopPropagation()}>
              {/* 标题栏（同系统对话框风格） */}
              <div style={{
                background: "linear-gradient(to bottom, #f4f6f9, #e8ecf2)",
                borderBottom: "1px solid #abadb3", padding: "8px 14px",
                fontSize: 13, fontWeight: 600, color: "#222", display: "flex",
                justifyContent: "space-between", alignItems: "center",
              }}>
                <span>新建作业 - 请选择业务类型</span>
                <span onClick={() => setShowTypePicker(false)} style={{
                  cursor: "pointer", color: "#888", fontSize: 14, padding: "0 4px",
                }}>×</span>
              </div>
              {/* 内容区 */}
              <div style={{ padding: 12 }}>
                {types.map(t => (
                  <div key={t.v}
                    onClick={() => pickType(t.v)}
                    style={{
                      padding: "8px 12px", border: "1px solid #c1c1c1", borderRadius: 2,
                      cursor: "pointer", display: "flex", alignItems: "center", gap: 10,
                      marginBottom: 6, background: "#fff", fontSize: 13,
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.borderColor = "#1990FF";
                      e.currentTarget.style.background = "#e6f4ff";
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.borderColor = "#c1c1c1";
                      e.currentTarget.style.background = "#fff";
                    }}
                  >
                    <div style={{
                      width: 50, height: 26, border: "1px solid #1990FF", borderRadius: 2,
                      color: "#1990FF", fontWeight: 700, fontSize: 11, fontFamily: "Consolas,monospace",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      background: "#fff",
                    }}>{t.v}</div>
                    <div style={{ flex: 1 }}>
                      <span style={{ color: "#222", fontWeight: 600 }}>{t.label}</span>
                      <span style={{ color: "#888", fontSize: 11, marginLeft: 8 }}>{t.desc}</span>
                    </div>
                  </div>
                ))}
              </div>
              {/* 底部按钮区 */}
              <div style={{
                borderTop: "1px solid #e4d3a8", background: "#fff0e3",
                padding: "6px 12px", display: "flex", justifyContent: "flex-end",
              }}>
                <button onClick={() => setShowTypePicker(false)} style={{
                  padding: "3px 14px", fontSize: 12, background: "#fff",
                  border: "1px solid #c1c1c1", borderRadius: 2, cursor: "pointer", color: "#333",
                }}>取消</button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* 标题栏 + 顶部菜单（共享组件） */}
      <TmsTitle title={sopNode ? `海运出口 / ${sopNode.zh} 待办` : "作业 / 海运出口"} user={user} role={role} onClose={onBack} />

      {/* 工具栏 */}
      <div className="tms-mn">
        <Mi onClick={clearF}>清除</Mi>
        <Tbl/>
        <Mi checked={showFilter} onClick={() => setShowFilter(p => !p)}>显示明细</Mi>
        <Mi onClick={load} disabled={loading}>{loading ? "搜索中..." : "搜索"}</Mi>
        <Tbl/>
        <Mi onClick={() => setShowTypePicker(true)}>新建作业</Mi>
        <Mi onClick={openMerge} disabled={!canMerge}
          title={canMerge ? "把已勾选订单合并为自拼柜" : "先勾选 ≥2 个非自拼订单"}>
          合并订单{checkedOrders.length >= 2 ? ` (${checkedOrders.length})` : ""}
        </Mi>
        <Tbl/>
        <Mi disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))}>上页</Mi>
        <Mi disabled={page >= totalPages - 1} onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}>下页</Mi>
        <Tbl/>
        <Mi onClick={() => exportOrdersList(filtered)} title="把当前过滤后的列表导出 Excel">导出</Mi>
        <Mi disabled arrow title="敬请期待：跟船公司 EDI / 海关 56 平台对接">数据交换</Mi>
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
            <option>200</option><option>500</option><option>1000</option><option>2000</option><option>5000</option>
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
              <ComboBox value={filters.carrier || ""} onChange={v => sf("carrier", (v || "").toUpperCase())} options={COMMON_CARRIERS} />
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
            <Fi label="箱型" refLabel>
              <ComboBox value={filters.qty_type || ""} onChange={v => sf("qty_type", (v || "").toUpperCase())} options={CONTAINER_TYPES} />
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
                    aria-hidden="true"
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
                  <td><a href={`#/sea_export?id=${o.id}`} target="_blank" rel="noopener" className="lk">{o.mbl_no || o.booking_no || ""}</a></td>
                  <td><a href={`#/sea_export?id=${o.id}`} target="_blank" rel="noopener" className="lk">{o.vessel || ""}</a></td>
                  <td>{o.voyage || ""}</td>
                  <td>{o.etd || ""}</td>
                  <td>
                    {o.customer
                      ? o.customer
                      : r.subCount
                        ? <span style={{ color: "#888", fontStyle: "italic" }}>自拼 ({r.subCount} 票)</span>
                        : ""}
                  </td>
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
// Portal containers / container_items 同步
// ───────────────────────────────────────────────────────────────
// 设计：ops 把"自拼母单 + 分票"作为单一事实源，写入后顺手同步到
// portal 用的 containers / container_items 两张表。idempotent：
// containers 用 (booking_no + container_no) 当唯一键；container_items
// 用 shipment_id 当唯一键。
//
// 字段映射讨论留在 commit message 里，这里只放代码。
// ═══════════════════════════════════════════════════════════════
const _typeIdCache = {};
async function getContainerTypeId(name) {
  if (name in _typeIdCache) return _typeIdCache[name];
  const { data } = await supabase.from("container_types").select("id").eq("name", name).limit(1);
  _typeIdCache[name] = data?.[0]?.id || null;
  return _typeIdCache[name];
}
const getConsoleTypeId = () => getContainerTypeId("Console Box");

// 把母单同步成 portal containers 行（idempotent）。返回 container_id 或 null
// 容忍 master.container_no 为 NULL（母单一开始往往还不知道箱号）：
//   - 先从分票的 cargo_items.container_no 反查真实箱号
//   - 找/建 portal containers 行用 booking_no（+ container_no 当二维 key）
async function syncContainerFromMaster(master) {
  if (!master?.booking_no) return null;

  // 反查实际箱号 / 封号：先看 master.container_no，再看分票 cargo_items 的第一个非空
  let containerNo = master.container_no || null;
  let sealNo = master.seal_no || null;
  if (!containerNo && master.order_no) {
    const { data: subs } = await supabase.from("shipments")
      .select("id").like("order_no", master.order_no + "-%");
    const subIds = (subs || []).map(s => s.id);
    if (subIds.length) {
      const { data: ci } = await supabase.from("cargo_items")
        .select("container_no, seal_no")
        .in("shipment_id", subIds)
        .not("container_no", "is", null)
        .limit(1);
      if (ci?.[0]) {
        containerNo = ci[0].container_no;
        if (!sealNo) sealNo = ci[0].seal_no || null;
      }
    }
  }

  const typeId = await getConsoleTypeId();
  const payload = {
    container_no: containerNo,
    seal_no: sealNo,
    booking_no: master.booking_no,
    e_booking_no: master.e_booking_no || null,
    vessel: master.vessel || null,
    carrier: master.carrier || null,
    carrier_agent: master.overseas_agent || null,
    pol: master.pol || null,
    pod: master.pod || null,
    etd: master.etd || null,
    qty_container: master.qty_container || null,
    type_id: typeId,
    customer: master.overseas_agent || master.end_customer || null,
  };

  // 找已有行：按 booking_no 找；如果有 container_no 优先用 (booking_no, container_no)；
  // 否则用第一条同 booking_no 的（兼容历史上 container_no 为 NULL 的行）
  let q = supabase.from("containers").select("id, container_no").eq("booking_no", master.booking_no);
  if (containerNo) q = q.or(`container_no.eq.${containerNo},container_no.is.null`);
  const { data: existing } = await q;
  if (existing?.[0]) {
    await supabase.from("containers").update(payload).eq("id", existing[0].id);
    return existing[0].id;
  }
  const { data: created } = await supabase.from("containers").insert(payload).select().single();
  return created?.id || null;
}

// 把单个分票同步成 portal container_items 行（idempotent，按 shipment_id 唯一）
//
// 策略：
//  - 若该分票有 cargo_items 明细 → 删旧 container_items + 按每条 cargo_items 插入一行
//    （portal 那边能看到品名级明细 + 按 supplier 聚合）
//  - 若分票无 cargo_items → fallback：按分票合计写一条 container_item（老逻辑）
async function syncContainerItemFromSub(containerId, sub) {
  if (!containerId || !sub?.id) return;
  const tail = parseInt((sub.order_no || "").match(/-(\d+)$/)?.[1] || "0");

  // 看分票有没有 cargo_items 明细
  const { data: lines } = await supabase.from("cargo_items")
    .select("*").eq("shipment_id", sub.id).order("sort_order", { ascending: true });

  if (lines && lines.length > 0) {
    // 明细级同步：先清掉该分票现有 container_items，再批量 insert
    await supabase.from("container_items").delete().eq("shipment_id", sub.id);
    const rows = lines.map((l, i) => ({
      container_id: containerId,
      shipment_id: sub.id,
      supplier: sub.supplier || null,
      po: sub.po || null,
      customer_po: sub.customer_po || null,
      tuc: l.product_name_en || null,
      sku: l.hs_code || null,
      qty: l.qty != null ? parseInt(l.qty) : null,
      weight: l.gross_weight != null ? Number(l.gross_weight) : null,
      volume: l.volume != null ? Number(l.volume) : null,
      hbl: l.hbl_no || sub.hbl_no || null,
      notes: l.marks || null,
      sort_order: (tail * 100) + (l.sort_order || i),
    }));
    if (rows.length) await supabase.from("container_items").insert(rows);
    return;
  }

  // 兜底：分票合计模式
  const payload = {
    container_id: containerId,
    shipment_id: sub.id,
    supplier: sub.supplier || null,
    po: sub.po || null,
    customer_po: sub.customer_po || null,
    qty: sub.qty_packages != null && sub.qty_packages !== "" ? parseInt(sub.qty_packages) : null,
    weight: sub.weight != null && sub.weight !== "" ? parseFloat(sub.weight) : null,
    volume: sub.volume != null && sub.volume !== "" ? parseFloat(sub.volume) : null,
    hbl: sub.hbl_no || null,
    sort_order: tail || 0,
  };
  const { data: existing } = await supabase.from("container_items")
    .select("id").eq("shipment_id", sub.id).limit(1);
  if (existing?.[0]) {
    await supabase.from("container_items").update(payload).eq("id", existing[0].id);
  } else {
    await supabase.from("container_items").insert(payload);
  }
}

async function deleteContainerItemForSub(subId) {
  if (!subId) return;
  await supabase.from("container_items").delete().eq("shipment_id", subId);
}

// 校验 qty_container 字符串格式：数量x箱型，多段逗号分隔
// 合法：1x40HQ / 2x20GP,1x40HQ / 1*40HQ（兼容 * 分隔）
// 非法：1x1x40HQ / 40HQ / abc
function isValidQtyContainer(s) {
  if (!s || !s.trim()) return true;  // 空字符串视为合法（不强填）
  const seg = /^\d+\s*[x*]\s*(20|40|45|53)(GP|HQ|HC|RF|OT|FR|TK|BU)$/i;
  return s.split(/[,，]/).map(p => p.trim()).every(p => seg.test(p));
}

// ───────────────────────────────────────────────────────────────
// cargo_items（货物明细，品名级）helpers
// ───────────────────────────────────────────────────────────────
// cargo_items 是单一事实源：分票件毛体 = cargo_items 合计；母单件毛体 = 分票合计。
// 若分票还没有 cargo_items 行，分票件毛体作为兜底（用户手填），portal 也用兜底。

async function loadCargoLines(shipmentId) {
  if (!shipmentId) return [];
  const { data } = await supabase.from("cargo_items")
    .select("*").eq("shipment_id", shipmentId).order("sort_order", { ascending: true });
  return data || [];
}

// diff 保存：把 next 跟 prev 对比，分别 insert / update / delete
async function saveCargoLines(shipmentId, prev, next) {
  if (!shipmentId) return;
  const prevById = new Map(prev.filter(r => r.id).map(r => [r.id, r]));
  const nextIds = new Set(next.filter(r => r.id).map(r => r.id));

  // 删除：prev 里有但 next 没了的
  const toDelete = [...prevById.keys()].filter(id => !nextIds.has(id));
  if (toDelete.length) {
    await supabase.from("cargo_items").delete().in("id", toDelete);
  }

  // insert / update
  for (const row of next) {
    const payload = {
      shipment_id: shipmentId,
      warehouse_in_no: row.warehouse_in_no || null,
      hbl_no: row.hbl_no || null,
      container_no: row.container_no || null,
      seal_no: row.seal_no || null,
      container_type: row.container_type || null,
      product_name_en: row.product_name_en || null,
      hs_code: row.hs_code || null,
      qty: row.qty !== "" && row.qty != null ? parseInt(row.qty) : null,
      package_unit: row.package_unit || "CARTONS",
      gross_weight: row.gross_weight !== "" && row.gross_weight != null ? parseFloat(row.gross_weight) : null,
      volume: row.volume !== "" && row.volume != null ? parseFloat(row.volume) : null,
      marks: row.marks || null,
      un: row.un || null,
      cl: row.cl || null,
      sort_order: row.sort_order || 0,
    };
    if (row.id && prevById.has(row.id)) {
      // 简单粗暴：每行都 update（之后可优化只更新有变化的）
      await supabase.from("cargo_items").update(payload).eq("id", row.id);
    } else {
      await supabase.from("cargo_items").insert(payload);
    }
  }
}

// 按 cargo_items 重算分票件毛体（cargo_items 是单一事实源）
// 注意：分票若无 cargo_items 行，保持现状不动（让用户手填的值有效）
async function recomputeShipmentTotalsFromCargo(shipmentId) {
  if (!shipmentId) return;
  const { data: lines } = await supabase.from("cargo_items")
    .select("qty, gross_weight, volume").eq("shipment_id", shipmentId);
  if (!lines || lines.length === 0) return;  // 无明细 → 不覆盖手填
  let pkg = 0, wt = 0, vol = 0;
  lines.forEach(l => {
    pkg += parseInt(l.qty) || 0;
    wt += parseFloat(l.gross_weight) || 0;
    vol += parseFloat(l.volume) || 0;
  });
  await supabase.from("shipments").update({
    qty_packages: pkg || null,
    weight: wt ? Number(wt.toFixed(3)) : null,
    volume: vol ? Number(vol.toFixed(4)) : null,
  }).eq("id", shipmentId);
}

// 重算现舱状态 = 根据关联 shipments 的 qty_container 之和算出"可售/部分已售/全部已售"
// 用于：现舱"划给客户"后 / 订单删除后 / 订单 spot_booking_id 改了后 同步状态
async function recalcSpotStatus(spotId) {
  if (!spotId) return;
  const [{ data: spot }, { data: ships }] = await Promise.all([
    supabase.from("spot_bookings").select("total_qty, status").eq("id", spotId).single(),
    supabase.from("shipments").select("qty_container").eq("spot_booking_id", spotId),
  ]);
  if (!spot) return;
  const sold = (ships || []).reduce((a, s) => a + (s.qty_container || 1), 0);
  const total = spot.total_qty || 0;
  let next = "可售";
  if (sold >= total && total > 0) next = "全部已售";
  else if (sold > 0) next = "部分已售";
  // 用户手动改的"已截单/已取消"不覆盖
  if (["已截单", "已取消"].includes(spot.status)) return;
  if (next !== spot.status) {
    await supabase.from("spot_bookings").update({ status: next }).eq("id", spotId);
  }
}

// 重算母单 qty_packages/weight/volume（= 所有分票之和），写回 DB
// 让列表/单证/portal 报表都能直接读母单字段拿到合计，无需各自聚合
async function recomputeMasterTotals(masterOrderNo) {
  if (!masterOrderNo) return;
  const { data: subs } = await supabase.from("shipments")
    .select("qty_packages, weight, volume")
    .like("order_no", masterOrderNo + "-%");
  let pkg = 0, wt = 0, vol = 0;
  (subs || []).forEach(s => {
    pkg += parseInt(s.qty_packages) || 0;
    wt += parseFloat(s.weight) || 0;
    vol += parseFloat(s.volume) || 0;
  });
  await supabase.from("shipments").update({
    qty_packages: pkg || null,
    weight: wt ? Number(wt.toFixed(3)) : null,
    volume: vol ? Number(vol.toFixed(4)) : null,
  }).eq("order_no", masterOrderNo);
}

// 全量同步：母单 + 它当前的所有分票（用于 createMaster / 编辑母单后）
async function syncContainerFull(master) {
  const containerId = await syncContainerFromMaster(master);
  if (!containerId) return null;
  // 清掉 shipment_id 为 NULL 的孤儿（早期手工录的、跟分票不对应的），避免和 syncContainerItemFromSub
  // 新插入的行重复显示
  await supabase.from("container_items").delete().eq("container_id", containerId).is("shipment_id", null);
  const { data: subs } = await supabase.from("shipments")
    .select("id, order_no, supplier, po, customer_po, qty_packages, weight, volume, hbl_no")
    .eq("booking_no", master.booking_no)
    .like("order_no", master.order_no + "-%");
  for (const s of (subs || [])) await syncContainerItemFromSub(containerId, s);
  return containerId;
}

// FCL/LCL 单票同步：每票自己就是一个 container（不分母子单）
// 流程：建/更新 portal containers 行（按 booking_no+container_no） + 按 cargo_items 重建 container_items
async function syncContainerFromShipment(shipment) {
  if (!shipment?.booking_no || !shipment?.id) return null;
  const isFCL = shipment.shipment_type === "FCL";
  const isLCL = shipment.shipment_type === "LCL";
  if (!isFCL && !isLCL) return null;

  const typeId = await getContainerTypeId(isFCL ? "FCL" : "LCL");
  const payload = {
    container_no: shipment.container_no || null,
    seal_no: shipment.seal_no || null,
    booking_no: shipment.booking_no,
    e_booking_no: shipment.e_booking_no || null,
    vessel: shipment.vessel || null,
    carrier: shipment.carrier || null,
    carrier_agent: shipment.overseas_agent || null,
    pol: shipment.pol || null,
    pod: shipment.pod || null,
    etd: shipment.etd || null,
    qty_container: shipment.qty_container || null,
    type_id: typeId,
    // portal containers.customer 业务上是"海外货主"（如 KEPLIN），不是 ops 端的 customer
    // 委托方/工厂中文名（如"温州永立箱包"）。跟 syncContainerFromMaster 对齐。
    customer: shipment.overseas_agent || shipment.end_customer || shipment.customer || null,
  };

  // 找已有 container 行（按 booking_no + container_no；兼容历史 container_no=NULL 行）
  let q = supabase.from("containers").select("id, container_no").eq("booking_no", shipment.booking_no);
  if (shipment.container_no) q = q.or(`container_no.eq.${shipment.container_no},container_no.is.null`);
  const { data: existing } = await q;
  let containerId;
  if (existing?.[0]) {
    await supabase.from("containers").update(payload).eq("id", existing[0].id);
    containerId = existing[0].id;
  } else {
    const { data: created } = await supabase.from("containers").insert(payload).select().single();
    containerId = created?.id || null;
  }
  if (!containerId) return null;

  // 同步 container_items：先清掉本票自己的，再按 cargo_items 重插
  await supabase.from("container_items").delete().eq("shipment_id", shipment.id);
  const { data: lines } = await supabase.from("cargo_items")
    .select("*").eq("shipment_id", shipment.id).order("sort_order", { ascending: true });

  if (lines && lines.length > 0) {
    const rows = lines.map((l, i) => ({
      container_id: containerId,
      shipment_id: shipment.id,
      supplier: shipment.supplier || null,
      po: shipment.po || null,
      customer_po: shipment.customer_po || null,
      tuc: l.product_name_en || null,
      sku: l.hs_code || null,
      qty: l.qty != null ? parseInt(l.qty) : null,
      weight: l.gross_weight != null ? Number(l.gross_weight) : null,
      volume: l.volume != null ? Number(l.volume) : null,
      hbl: l.hbl_no || shipment.hbl_no || null,
      notes: l.marks || null,
      sort_order: l.sort_order || i,
    }));
    await supabase.from("container_items").insert(rows);
  } else if (shipment.qty_packages || shipment.weight || shipment.volume) {
    // 兜底：没 cargo_items 时用主表合计写一条
    await supabase.from("container_items").insert({
      container_id: containerId,
      shipment_id: shipment.id,
      supplier: shipment.supplier || null,
      po: shipment.po || null,
      customer_po: shipment.customer_po || null,
      qty: shipment.qty_packages != null && shipment.qty_packages !== "" ? parseInt(shipment.qty_packages) : null,
      weight: shipment.weight != null && shipment.weight !== "" ? parseFloat(shipment.weight) : null,
      volume: shipment.volume != null && shipment.volume !== "" ? parseFloat(shipment.volume) : null,
      hbl: shipment.hbl_no || null,
      sort_order: 0,
    });
  }
  return containerId;
}

// 给一个分票找 container_id（用于编辑分票后的同步）：
// 优先看已有 container_items；没有就按 master order_no 反查 master 然后 sync 整套
async function findOrCreateContainerIdForSub(sub) {
  if (!sub?.id) return null;
  const { data: item } = await supabase.from("container_items")
    .select("container_id").eq("shipment_id", sub.id).limit(1);
  if (item?.[0]?.container_id) return item[0].container_id;
  // 反查 master
  if (!sub.order_no || !/-\d+$/.test(sub.order_no)) return null;
  const masterNo = sub.order_no.replace(/-\d+$/, "");
  const { data: masters } = await supabase.from("shipments")
    .select("*").eq("order_no", masterNo).limit(1);
  const master = masters?.[0];
  if (!master) return null;
  return await syncContainerFromMaster(master);
}

// 解析 qty_container 字串（如 "1x40HQ" / "2x40HQ,1x20GP"）→ 箱型数组（按数量展开）
function parseQtyContainerStr(str) {
  if (!str) return [];
  return String(str).split(/[,;]/).map(s => s.trim()).filter(Boolean).flatMap(part => {
    const m = part.match(/^(\d+)\s*x\s*([A-Z0-9]+)$/i);
    if (!m) return [];
    return Array.from({ length: parseInt(m[1]) }, () => m[2].toUpperCase());
  });
}
function parseFirstContainerType(str) {
  return parseQtyContainerStr(str)[0] || "";
}

// 自拼分票：这些字段统一在主单维护，分票自动继承（编辑器只读 + 主单保存时同步到所有分票）
const SUB_INHERIT_FROM_MASTER = new Set([
  "vessel", "voyage",
  "pol", "pol_code",
  "pod", "pod_code",
  "destination", "destination_code",
  "etd", "atd",
]);

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


function OrderDetail({ order, role, user, onBack, onReload, onUpdated = null, createMode = null, onCreated = null, prevId = null, nextId = null, onNavigate = null }) {
  const isCreating = !!createMode;
  // 创建模式：editing 默认 true，初始 ed 已填默认值
  const [editing, setEditing] = useState(isCreating);
  const [ed, setEd] = useState(isCreating ? { ...order } : {});
  const [tab, setTab] = useState("作业");
  const [subtab, setSubtab] = useState("托单信息");
  const [refData, setRefData] = useState({ suppliers: [], customers: [], ports: [], staff: [] });
  const [cargoItems, setCargoItems] = useState([]);  // 旧"货物"tab 用（已弃用，留着兼容）
  // 新货物明细（cargo_items 表）：分票视图，集装箱 tab 编辑
  const [cargoLines, setCargoLines] = useState([]);          // 当前已加载的明细
  const [cargoLinesDraft, setCargoLinesDraft] = useState([]); // editing 时的草稿（保存时 diff）
  // 自拼母单聚合视图：从所有分票聚合而来，只读
  const [masterAggContainers, setMasterAggContainers] = useState([]);
  const [masterAggCargoLines, setMasterAggCargoLines] = useState([]);
  // 解析提单 modal 开关
  const [blImportOpen, setBlImportOpen] = useState(false);
  // 解析 56 舱单 modal 开关
  const [sino56ImportOpen, setSino56ImportOpen] = useState(false);
  const [siDocImportOpen, setSiDocImportOpen] = useState(false);
  const [packingListImportOpen, setPackingListImportOpen] = useState(false);
  // 内部利润分析 modal 开关
  const [profitOpen, setProfitOpen] = useState(false);
  // 历史 modal 开关
  const [historyOpen, setHistoryOpen] = useState(false);
  // 订舱模板 modal 开关
  const [templateOpen, setTemplateOpen] = useState(false);
  // ETA 船司查询（Maersk Track & Trace）状态
  const [etaSyncing, setEtaSyncing] = useState(false);
  // ChargesPanel 操作句柄（用于费用 tab 下工具栏按钮调用）
  const chargesRef = useRef(null);
  // 加入/移除分票 modal 开关（仅主拼场景）
  const [joinSubOpen, setJoinSubOpen] = useState(false);
  const [removeSubOpen, setRemoveSubOpen] = useState(false);
  const [splitCargoOpen, setSplitCargoOpen] = useState(false);  // 拆分母单货物到小票 modal
  const [subTickets, setSubTickets] = useState([]);  // 主拼下面的所有分票
  const [spotBooking, setSpotBooking] = useState(null);  // 关联的现舱（若有 spot_booking_id）
  const [copyPartiesOpen, setCopyPartiesOpen] = useState(false);  // 抄录历史 modal 开关

  // 加载关联的现舱信息（用于顶部 banner 显示）
  useEffect(() => {
    if (!order?.spot_booking_id) { setSpotBooking(null); return; }
    supabase.from("spot_bookings")
      .select("id, booking_no, carrier, vessel, voyage, pol, pod, etd, total_qty, status")
      .eq("id", order.spot_booking_id).single()
      .then(({ data }) => setSpotBooking(data || null));
  }, [order?.spot_booking_id]);
  // V5 字典：计件单位 + 货物种类（走全局缓存）
  const [pkgUnits, setPkgUnits] = useState([]);
  const [cargoTypes, setCargoTypes] = useState([]);
  // 集装箱汇总（由 ContainerEditor onChange 回调更新，托单信息 tab 单行汇总用）
  const [containerSummary, setContainerSummary] = useState("");

  // OrderDetail mount / order.id 变化时预拉 shipment_containers 计算汇总（托单信息 tab 单行用）
  // 顺带自愈：DB 上 shipments.qty_container 字段和算出来的汇总不一致就改 DB（修脏数据）
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
        // 自愈：算出来非空 + 跟 DB 字段不一致 → 静默 sync DB
        // 仅在 text 非空时修；text 为空（这票真没 shipment_containers 行）时
        // 保留 DB 上原有的 qty_container 不动（可能是旧数据手填的）
        if (text && text !== (order.qty_container || "")) {
          supabase.from("shipments")
            .update({ qty_container: text })
            .eq("id", order.id)
            .select()
            .single()
            .then(({ data: updated }) => {
              if (updated && onUpdated) onUpdated(updated);
            })
            .catch(e => console.error("qty_container self-heal error:", e));
        }
      });
  }, [order?.id, order?.qty_container, onUpdated]);
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
    // customers_full 含 name_short / name_en / code，给 ComboBox 做别名搜索 + 排序用
    // customer_party_map: 每个委托人最常用的 shipper/consignee/notify_party（自动带出）
    Promise.all([
      getCachedRef("suppliers"),
      getCachedRef("customers_full"),
      getCachedRef("staff"),
      getCachedRef("customer_party_map"),
    ]).then(([suppliers, customersFull, staff, customerPartyMap]) => {
      // 防御：任何字段为 undefined 时回退到 []
      // 按 name 去重，把多条同名的 aliases 合并（一条客户可能同时是客户 + 海外代理两条记录）
      const byName = new Map();
      for (const c of (customersFull || [])) {
        const key = (c.name || "").trim();
        if (!key) continue;
        if (!byName.has(key)) byName.set(key, { value: key, aliases: new Set() });
        const e = byName.get(key);
        for (const a of [c.name_short, c.name_en, c.code]) if (a) e.aliases.add(a);
      }
      const customersDeduped = [...byName.values()].map(e => ({ value: e.value, aliases: [...e.aliases] }));
      setRefData({
        suppliers: suppliers || [],
        customers: customersDeduped,
        ports: [],
        staff: staff || [],
        customerPartyMap: customerPartyMap || {},
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

    // 加载货物明细 cargo_items（新表）
    if (order.id) {
      loadCargoLines(order.id).then(rows => {
        setCargoLines(rows);
        setCargoLinesDraft(rows);
      });
    }

    // 主拼：加载所有分票 + 聚合分票的 shipment_containers / cargo_items（母单视图只读用）
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
          // 聚合：母单 + 分票 的箱信息 / 货物明细
          // 容器通常归母单（拼箱共用一只箱），所以查询要包含 order.id；
          // 货物明细按设计走分票（每个货主一条）。
          const subIds = sorted.map(s => s.id);
          const ctnIds = [order.id, ...subIds];
          Promise.all([
            supabase.from("shipment_containers").select("*").in("shipment_id", ctnIds).order("sort_order", { ascending: true }),
            subIds.length > 0
              ? supabase.from("cargo_items").select("*").in("shipment_id", subIds).order("sort_order", { ascending: true })
              : Promise.resolve({ data: [] }),
          ]).then(([ctnRes, cargoRes]) => {
            setMasterAggContainers(ctnRes.data || []);
            setMasterAggCargoLines(cargoRes.data || []);
          });
        });
    }
  }, [order.id]);

  const startEdit = () => { setEd({ ...order }); setCargoLinesDraft(cargoLines); setEditing(true); };
  const cancel = () => { setCargoLinesDraft(cargoLines); setEditing(false); };

  // 从解析提单 modal 应用字段：合并到 ed（主字段）+ cargoLinesDraft（货物明细）
  // 集装箱信息走另一条路：直接写 shipment_containers（带用户上下文，trigger 不拦）
  const applyBLImport = async (fields, extras) => {
    if (!editing) {
      // 自动进编辑态再合并
      setEd(prev => ({ ...order, ...prev, ...fields }));
      setEditing(true);
    } else {
      setEd(prev => ({ ...prev, ...fields }));
    }
    // 货物明细：追加一行（用户可在集装箱 tab 进一步编辑）
    if (extras?.cargoItem) {
      setCargoLinesDraft(prev => [
        ...prev,
        { _tmp: Date.now() + Math.random(), sort_order: prev.length + 1, ...extras.cargoItem },
      ]);
    }
    // 集装箱：直接写 DB（ContainerEditor 自己拉数据，用户编辑保存后会持久化；
    // 这里如果没有现成行则插一条新的）
    if (extras?.container && order?.id) {
      try {
        await supabase.from("shipment_containers").insert({
          shipment_id: order.id,
          ...extras.container,
          sort_order: 0,
        });
      } catch (e) {
        console.error("BL import: insert shipment_containers error:", e);
      }
    }
  };

  // 从 Sino56 舱单 modal 应用字段：N 个集装箱 + N 条货物明细
  // 主字段合并到 ed；集装箱直接写 shipment_containers；货物明细追加到 cargoLinesDraft
  const applySino56Import = async (fields, extras) => {
    // shipper/consignee/notify_party 强制大写：编辑框的 onChange 已经这么干，
    // 程序化导入也走同样规则，避免出现"Keplin Group Limited" 之类的小写漏网鱼
    const normalizedFields = { ...fields };
    for (const k of ["shipper", "consignee", "notify_party"]) {
      if (typeof normalizedFields[k] === "string") {
        normalizedFields[k] = normalizedFields[k].toUpperCase();
      }
    }
    if (!editing) {
      setEd(prev => ({ ...order, ...prev, ...normalizedFields }));
      setEditing(true);
    } else {
      setEd(prev => ({ ...prev, ...normalizedFields }));
    }
    // 货物明细：按 mappings 分流。映射到分票的直接写 DB（按 hbl_no 替换），
    // 没映射 / 映射到"母单"的走旧路径（追加到 cargoLinesDraft，保存时落到本票）。
    let mappings = extras?.mappings || {};
    const allCargo = Array.isArray(extras?.cargoLines) ? extras.cargoLines : [];

    // 自拼母单还没分票 → 按舱单里的 HBL 自动建分票
    // （HBL 字母后缀 A/B/C... 对应 -1/-2/-3...，跟模态框默认映射逻辑一致）
    if (isMaster && subTickets.length === 0 && allCargo.length > 0 && order?.id) {
      const uniqueHbls = [...new Set(allCargo.map(c => c.hbl_no).filter(Boolean))].sort();
      if (uniqueHbls.length > 0 && window.confirm(`这单还没分票。要不要按舱单里的 ${uniqueHbls.length} 个 HBL 自动建分票？\n\n${uniqueHbls.map((h, i) => `  ${h} → ${order.order_no}-${i + 1}`).join("\n")}`)) {
        const suffixOf = (hbl) => {
          const m = String(hbl || "").match(/([A-Z])$/i);
          return m ? m[1].toUpperCase().charCodeAt(0) - 64 : 0;
        };
        const tailOf = (hbl, idx) => suffixOf(hbl) || (idx + 1);
        const newRows = uniqueHbls.map((hbl, idx) => filterShipmentPayload({
          order_no: `${order.order_no}-${tailOf(hbl, idx)}`,
          shipment_type: "Console",
          booking_no: order.booking_no,
          vessel: order.vessel || fields.vessel || null,
          voyage: order.voyage || fields.voyage || null,
          pol: order.pol,
          pol_code: order.pol_code,
          pod: order.pod || fields.pod || null,
          pod_code: order.pod_code,
          destination: order.destination,
          destination_code: order.destination_code,
          etd: order.etd,
          carrier: order.carrier,
          overseas_agent: order.overseas_agent,
          solicit_type: order.solicit_type,
          hbl_no: hbl,
          lifecycle: "处理中",
        }));
        try {
          const { data: created, error } = await supabase.from("shipments").insert(newRows).select();
          if (error) throw error;
          const sorted = (created || []).sort((a, b) => {
            const na = parseInt((a.order_no || "").match(/-(\d+)$/)?.[1] || "999");
            const nb = parseInt((b.order_no || "").match(/-(\d+)$/)?.[1] || "999");
            return na - nb;
          });
          setSubTickets(sorted);
          const newMap = { ...mappings };
          for (const sub of sorted) {
            if (sub.hbl_no) newMap[sub.hbl_no] = sub.id;
          }
          mappings = newMap;
        } catch (e) {
          console.error("Sino56 import: auto-create sub-shipments error:", e);
          alert("自动创建分票失败：" + (e?.message || e));
        }
      }
    }

    const toMaster = [];
    const bySubId = {};
    for (const cl of allCargo) {
      const target = mappings[cl.hbl_no];
      if (target) {
        if (!bySubId[target]) bySubId[target] = [];
        bySubId[target].push(cl);
      } else {
        toMaster.push(cl);
      }
    }
    if (toMaster.length > 0) {
      setCargoLinesDraft(prev => [
        ...prev,
        ...toMaster.map((cl, i) => ({
          _tmp: Date.now() + Math.random() + i,
          sort_order: prev.length + i + 1,
          hbl_no: cl.hbl_no || fields.mbl_no || null,
          container_no: cl.container_no || null,
          seal_no: cl.seal_no || null,
          container_type: cl.container_type || null,
          product_name_en: cl.product_name_en || null,
          hs_code: cl.hs_code || null,
          qty: cl.qty || null,
          package_unit: cl.package_unit || "CARTONS",
          gross_weight: cl.gross_weight || null,
          volume: cl.volume || null,
          marks: cl.marks || null,
          un: cl.un || null,
          cl: cl.cl || null,
        })),
      ]);
    }
    // 写到分票：按 (sub_id, hbl_no) 替换，重导入幂等
    for (const [subId, lines] of Object.entries(bySubId)) {
      try {
        const hbls = [...new Set(lines.map(l => l.hbl_no).filter(Boolean))];
        if (hbls.length > 0) {
          await supabase.from("cargo_items").delete()
            .eq("shipment_id", subId).in("hbl_no", hbls);
        }
        const rows = lines.map((cl, i) => ({
          shipment_id: subId,
          sort_order: i + 1,
          hbl_no: cl.hbl_no || fields.mbl_no || null,
          container_no: cl.container_no || null,
          seal_no: cl.seal_no || null,
          container_type: cl.container_type || null,
          product_name_en: cl.product_name_en || null,
          hs_code: cl.hs_code || null,
          qty: cl.qty || null,
          package_unit: cl.package_unit || "CARTONS",
          gross_weight: cl.gross_weight || null,
          volume: cl.volume || null,
          marks: cl.marks || null,
          un: cl.un || null,
          cl: cl.cl || null,
        }));
        if (rows.length) await supabase.from("cargo_items").insert(rows);
      } catch (e) {
        console.error("Sino56 import: write cargo to sub", subId, "error:", e);
      }
    }
    // 集装箱：每箱写一条 shipment_containers 行
    if (Array.isArray(extras?.containers) && extras.containers.length > 0 && order?.id) {
      try {
        const parseSize = (t) => {
          const m = String(t || "").match(/^(\d{2})(.*)$/);
          return m ? { container_size: m[1], container_type: m[2] || "GP" } : { container_size: null, container_type: t || null };
        };
        const rows = extras.containers.map((c, i) => {
          const { container_size, container_type } = parseSize(c.container_type);
          return {
            shipment_id: order.id,
            container_size,
            container_type,
            qty: 1,
            container_no: c.container_no || null,
            seal_no: c.seal_no || null,
            cargo_qty: c.qty || null,
            cargo_weight: c.weight || null,
            cargo_volume: c.volume || null,
            sort_order: i,
          };
        });
        // 按 (shipment_id, container_no) 去重：重复导入同一份舱单时，已有的箱号 update，
        // 没见过的箱号才 insert。container_no 为空的行直接 insert（无法判定是否同一箱）。
        const { data: existing } = await supabase.from("shipment_containers")
          .select("id, container_no").eq("shipment_id", order.id);
        const idByNo = new Map();
        for (const r of (existing || [])) {
          if (r.container_no) idByNo.set(r.container_no, r.id);
        }
        const toInsert = [];
        const toUpdate = [];
        for (const r of rows) {
          if (r.container_no && idByNo.has(r.container_no)) {
            toUpdate.push({ id: idByNo.get(r.container_no), row: r });
          } else {
            toInsert.push(r);
          }
        }
        if (toInsert.length) await supabase.from("shipment_containers").insert(toInsert);
        for (const u of toUpdate) {
          const { shipment_id: _ignore, ...patch } = u.row;
          await supabase.from("shipment_containers").update(patch).eq("id", u.id);
        }

        // 同步 shipments.qty_container 汇总字段（对账单 / 列表页等老代码读这个）
        // 把刚插的 + DB 已有的全部 shipment_containers 行 group by 箱型 → 拼成 "1x40HC,2x20GP"
        const { data: allCtns } = await supabase.from("shipment_containers")
          .select("container_size, container_type, qty").eq("shipment_id", order.id);
        const map = {};
        for (const r of (allCtns || [])) {
          const key = `${r.container_size || ""}${r.container_type || ""}`;
          if (!key) continue;
          map[key] = (map[key] || 0) + (parseInt(r.qty) || 0);
        }
        const summary = Object.entries(map)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, q]) => `${q}x${k}`)
          .join(",");
        if (summary) {
          await supabase.from("shipments").update({ qty_container: summary }).eq("id", order.id);
          setEd(prev => ({ ...prev, qty_container: summary }));
        }
      } catch (e) {
        console.error("Sino56 import: insert shipment_containers error:", e);
      }
    }
  };

  // 导出当前作业为 Sino56 舱单 .xls
  // 数据聚合策略：
  //   - 自拼母单 → 把所有分票的 cargo_items 全拢起来；container 信息走 portal containers 兜底
  //   - 普通整柜/拼箱 → 用本票的 shipment_containers + cargo_items；空则用主表字段拼一行
  //   - shipper/consignee/notify_party → 先看主单，再轮分票取第一个非空
  const exportSino56Manifest = async () => {
    if (!order?.id) { alert("请先保存作业再导出"); return; }
    try {
      // 收集所有相关 shipment id（母单 + 所有分票）
      const shipmentIds = [order.id];
      let subShipments = [];
      if (isMaster && order.order_no) {
        const { data: subs } = await supabase.from("shipments")
          .select("*")
          .like("order_no", order.order_no + "-%");
        subShipments = subs || [];
        shipmentIds.push(...subShipments.map(s => s.id));
      }

      // 自拼场景下，集装箱常常只在 portal 端
      const portalContainersP = (isMaster && order.booking_no)
        ? supabase.from("containers").select("*").eq("booking_no", order.booking_no)
        : Promise.resolve({ data: [] });

      const [scRes, ciRes, pcRes] = await Promise.all([
        supabase.from("shipment_containers").select("*").in("shipment_id", shipmentIds).order("sort_order"),
        supabase.from("cargo_items").select("*").in("shipment_id", shipmentIds).order("sort_order"),
        portalContainersP,
      ]);

      const sc = scRes.data || [];
      const ci = ciRes.data || [];
      const pc = pcRes.data || [];

      // 子票 hbl 映射，用来兜底 cargo_items.hbl_no
      const subById = new Map(subShipments.map(s => [s.id, s]));

      // 1) cargoLines：优先 cargo_items
      let cargoLines = ci.map(l => {
        const sub = subById.get(l.shipment_id);
        return {
          hbl_no: l.hbl_no || sub?.hbl_no || order.hbl_no || order.mbl_no || order.booking_no || "",
          container_no: l.container_no || "",
          seal_no: l.seal_no || "",
          container_type: l.container_type || "",
          product_name_en: l.product_name_en || "",
          hs_code: l.hs_code || "",
          qty: l.qty,
          package_unit: l.package_unit || "CARTONS",
          gross_weight: l.gross_weight,
          volume: l.volume,
          marks: l.marks || "",
          un: l.un || "",
          cl: l.cl || "",
        };
      });

      // 兜底：完全没 cargo_items 时，用主表/子票主表字段各拼一行
      if (cargoLines.length === 0) {
        const sourceTickets = subShipments.length > 0 ? subShipments : [order];
        for (const t of sourceTickets) {
          if (t.qty_packages || t.weight || t.volume || t.description) {
            cargoLines.push({
              hbl_no: t.hbl_no || order.mbl_no || order.booking_no || "",
              container_no: t.container_no || order.container_no || "",
              seal_no: t.seal_no || order.seal_no || "",
              container_type: parseFirstContainerType(t.qty_container || order.qty_container),
              product_name_en: t.description || t.desc_en || "",
              hs_code: t.hs_code || "",
              qty: t.qty_packages,
              package_unit: t.pkg_unit || "CARTONS",
              gross_weight: t.weight,
              volume: t.volume,
              marks: t.marks || "N/M",
            });
          }
        }
      }

      // 2) containers：先 shipment_containers，再按 cargo_items 里的 container_no 聚合，再 portal containers，最后 qty_container 解析
      let containers = sc.map(c => ({
        container_no: c.container_no || "",
        seal_no: c.seal_no || "",
        container_type: [c.container_size, c.container_type].filter(Boolean).join(""),
        qty: c.cargo_qty,
        weight: c.cargo_weight,
        volume: c.cargo_volume,
      }));

      if (containers.length === 0 && cargoLines.length > 0) {
        // 按 container_no 聚合 cargo_items 自动出箱列表
        const byBox = new Map();
        for (const l of cargoLines) {
          if (!l.container_no) continue;
          const k = l.container_no;
          if (!byBox.has(k)) byBox.set(k, {
            container_no: l.container_no, seal_no: l.seal_no, container_type: l.container_type,
            qty: 0, weight: 0, volume: 0,
          });
          const g = byBox.get(k);
          g.qty    += Number(l.qty || 0);
          g.weight += Number(l.gross_weight || 0);
          g.volume += Number(l.volume || 0);
        }
        containers = Array.from(byBox.values());
      }

      if (containers.length === 0 && pc.length > 0) {
        // portal containers 兜底（拆 qty_container）
        for (const p of pc) {
          const parsed = parseQtyContainerStr(p.qty_container);
          if (parsed.length === 0) {
            containers.push({ container_no: p.container_no || "", seal_no: p.seal_no || "", container_type: "" });
          } else {
            for (const t of parsed) {
              containers.push({ container_no: p.container_no || "", seal_no: p.seal_no || "", container_type: t });
            }
          }
        }
      }

      if (containers.length === 0 && order.qty_container) {
        // 最后一招：主单 qty_container（如 "1x40HQ"）
        const parsed = parseQtyContainerStr(order.qty_container);
        for (const t of parsed) {
          containers.push({ container_no: order.container_no || "", seal_no: order.seal_no || "", container_type: t });
        }
      }

      // 3) shipper / consignee / notify_party：先看母单，再轮分票
      const pickFirst = (field) => {
        if (order[field]) return order[field];
        for (const s of subShipments) if (s[field]) return s[field];
        return null;
      };
      const shipper = pickFirst("shipper");
      const consignee = pickFirst("consignee");
      const notifyParty = pickFirst("notify_party");

      const data = {
        vessel: order.vessel || "",
        voyage: order.voyage || "",
        pod: order.pod || order.destination || "",
        mbl_no: order.mbl_no || order.booking_no || "",
        booking_no: order.booking_no || "",
        containers,
        cargoLines,
        shipper: shipper ? { name: shipper } : null,
        consignee: consignee ? { name: consignee } : null,
        notifier: notifyParty ? { name: notifyParty } : null,
      };
      const buf = await buildSino56Manifest(data);
      const fname = `Sino56-${order.mbl_no || order.booking_no || order.order_no || "manifest"}.xls`;
      downloadArrayBufferAsXls(buf, fname);
    } catch (e) {
      console.error(e);
      alert("导出失败：" + (e?.message || e));
    }
  };
  const save = async () => {
    // ── 创建模式：INSERT 新订单 ──
    if (isCreating) {
      const isConsole = createMode === "Console";
      // 校验
      if (!isConsole && !ed.customer?.trim()) { alert("委托单位 必填"); return; }
      if (!ed.booking_no?.trim()) { alert("MB/L No. 必填"); return; }

      // 同 booking_no + 同 shipment_type 已有作业时引导打开原单，避免重复建壳
      // （Console 分票天然共享母单的 booking_no，靠 order_no 的 -N 后缀过滤掉）
      {
        const bookingNo = ed.booking_no.trim();
        const { data: dups } = await supabase.from("shipments")
          .select("id, order_no, vessel, voyage")
          .eq("booking_no", bookingNo)
          .eq("shipment_type", createMode);
        const existing = (dups || []).find(d => d.order_no && !/-\d+$/.test(d.order_no));
        if (existing) {
          const tail = [existing.vessel, existing.voyage].filter(Boolean).join(" / ");
          const typeLabel = createMode === "Console" ? "自拼母单"
            : createMode === "LCL" ? "拼箱作业"
            : "整柜作业";
          const goOpen = window.confirm(
            `订舱号 ${bookingNo} 下已有${typeLabel} ${existing.order_no}` +
            (tail ? `（${tail}）` : "") + "。\n\n" +
            `确定 → 打开已有作业（推荐，避免重复）\n` +
            `取消 → 留在当前页（请改订舱号或退出新建）`
          );
          if (goOpen) {
            window.location.hash = `#/sea_export?id=${existing.id}`;
          }
          return;
        }
        // 现舱互斥：该 booking_no 不能同时是"待售现舱"
        const { data: spotHit } = await supabase.from("spot_bookings")
          .select("id, booking_no, carrier, status").eq("booking_no", bookingNo).limit(1);
        if (spotHit && spotHit.length > 0) {
          const s = spotHit[0];
          const ok = window.confirm(
            `订舱号 ${bookingNo} 在「现舱」里已经存在（${s.carrier}，状态: ${s.status}）。\n\n` +
            `建议从现舱「划给客户」走流程，避免数据脱节。\n\n` +
            `确定 → 仍要直接创建订单（不推荐）\n` +
            `取消 → 返回检查`
          );
          if (!ok) return;
        }
      }

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
      // 同步到 portal containers
      if (data) {
        if (isConsole) {
          // 自拼母单：此时还没有分票，只建 containers 行
          syncContainerFromMaster(data).catch(e => console.error("sync containers error:", e));
        } else if (data.shipment_type === "FCL" || data.shipment_type === "LCL") {
          // FCL/LCL 单票：自己就是一个 portal container（新建时 cargo_items 通常还没填）
          syncContainerFromShipment(data).catch(e => console.error("sync FCL/LCL containers error:", e));
        }
      }
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
      const { data, error } = await supabase.from("shipments").update(cleanChanges).eq("id", order.id).select().single();
      if (error) { alert(error.message); return; }
      if (data && onUpdated) onUpdated(data);
      // 主单：船名/航次/起运港/卸货港/目的港 5+ 字段无条件同步到所有分票
      // 之所以无条件而不只看 changes：早期建的分票当时主单这些字段可能是 NULL，
      // 后来才填上但 propagate 没触发，导致分票一直缺。每次 save 都 push 一次，开销可忽略。
      if (isMaster && order.order_no) {
        const inheritedSnap = {};
        for (const k of SUB_INHERIT_FROM_MASTER) {
          inheritedSnap[k] = (data && data[k] !== undefined ? data[k] : order[k]) ?? null;
        }
        try {
          await supabase.from("shipments")
            .update(inheritedSnap)
            .like("order_no", order.order_no + "-%");
        } catch (e) {
          console.error("propagate inherited fields to sub-tickets error:", e);
        }
      }
      // 同步到 portal containers / container_items
      if (data) {
        if (isMaster) {
          // 母单：booking 级字段可能变了 → 全量同步（containers + 所有 container_items）
          syncContainerFull(data).catch(e => console.error("sync containers error:", e));
        } else if (isSubTicket) {
          // 分票：单条 container_items 同步
          findOrCreateContainerIdForSub(data)
            .then(cid => cid && syncContainerItemFromSub(cid, data))
            .catch(e => console.error("sync container_items error:", e));
          // 件数/重量/体积有变 → 重算母单合计
          if ("qty_packages" in changes || "weight" in changes || "volume" in changes) {
            recomputeMasterTotals(masterOrderNo).catch(e => console.error("recompute totals error:", e));
          }
        } else if (data.shipment_type === "FCL" || data.shipment_type === "LCL") {
          // FCL / LCL 单票：本票自己就是一个 portal container
          syncContainerFromShipment(data).catch(e => console.error("sync FCL/LCL containers error:", e));
        }
      }
    }

    // 货物明细 cargo_items 差异保存 + 级联重算
    const cargoChanged = JSON.stringify(cargoLines) !== JSON.stringify(cargoLinesDraft);
    if (cargoChanged && order.id) {
      try {
        await saveCargoLines(order.id, cargoLines, cargoLinesDraft);
        // 重新拉一次最新的（拿到 DB 生成的 id），同步两个 state
        const fresh = await loadCargoLines(order.id);
        setCargoLines(fresh);
        setCargoLinesDraft(fresh);
        // cargo_items 变了 → 重算分票件毛体（覆盖手填）→ 现有同步链跟着触发
        await recomputeShipmentTotalsFromCargo(order.id);
        // 若是分票，重算母单合计
        if (isSubTicket && masterOrderNo) {
          recomputeMasterTotals(masterOrderNo).catch(e => console.error("recompute master totals error:", e));
        }
        // 重推 portal sync（升级版会按 cargo_items 优先）
        if (isSubTicket) {
          findOrCreateContainerIdForSub(order)
            .then(cid => cid && syncContainerItemFromSub(cid, order))
            .catch(e => console.error("sync container_items error:", e));
        } else if (isMaster) {
          syncContainerFull(order).catch(e => console.error("sync containers error:", e));
        } else if (order.shipment_type === "FCL" || order.shipment_type === "LCL") {
          syncContainerFromShipment(order).catch(e => console.error("sync FCL/LCL containers error:", e));
        }
      } catch (e) {
        console.error("save cargo_items error:", e);
        alert("货物明细保存失败：" + (e?.message || e));
      }
    }

    setEditing(false);
  };

  // 单字段直接保存（SOP 节点状态变更、has_hbl 切换、生命周期变更等）
  const updateField = async (field, value) => {
    const { data, error } = await supabase.from("shipments").update({ [field]: value }).eq("id", order.id).select().single();
    if (error) { alert(error.message); return; }
    if (data && onUpdated) onUpdated(data); else onReload();
  };

  // 调 Maersk Track & Trace 查 ETA → 后端回写 → 刷新本票
  const syncEta = async () => {
    if (etaSyncing) return;
    setEtaSyncing(true);
    try {
      const r = await supabase.api("/functions/v1/track-eta", {
        method: "POST",
        body: JSON.stringify({ shipment_id: order.id }),
      });
      if (r?.status === "unsupported_carrier") alert(`暂不支持该船司（${order.carrier || "—"}），Phase 1 仅 Maersk`);
      else if (r?.status === "not_found") alert("Maersk 未查到该 booking 的船期（可能尚未排载或号码不符）");
      else if (r?.status === "error") alert("查询失败：" + (r.message || "未知错误"));
      else if (!r?.eta_carrier) alert("已查询，但返回里没有到港时间");
      else if (r.mismatch) alert(`船司 ETA 为 ${r.eta_carrier}，与现有 ETA(${r.eta_existing}) 不一致，已记录但未覆盖`);
    } catch (e) {
      alert("查询失败：" + (e?.message || e));
    } finally {
      setEtaSyncing(false);
      onReload();
    }
  };

  const setLifecycle = async (lc) => {
    const updates = { lifecycle: lc };
    if (lc === "已完结") {
      updates.completed_at = new Date().toISOString();
      updates.completed_by = user?.id || null;
    }
    const { data, error } = await supabase.from("shipments").update(updates).eq("id", order.id).select().single();
    if (error) { alert(error.message); return; }
    if (data && onUpdated) onUpdated(data); else onReload();
  };

  const v = (f) => editing ? (ed[f] ?? "") : (order[f] ?? "");
  const ch = (f, val) => setEd(p => ({ ...p, [f]: val }));

  // 自拼分票：船名/航次/起运港/卸货港/目的港 字段从主单继承，分票编辑器不可改
  const isInheritedFromMaster = (f) =>
    order.shipment_type === "Console"
    && order.order_no && /-\d+$/.test(order.order_no)
    && SUB_INHERIT_FROM_MASTER.has(f);
  const inheritTitle = "随主单填写，分票自动继承（主单保存后同步）";

  const titlePrefix = order.shipment_type === "LCL" ? "拼箱" : order.shipment_type === "Console" ? "自拼" : "整箱";
  const isLocked = order.lifecycle === "已完结" || order.lifecycle === "已关闭";

  // 主拼判定：自拼柜 且 order_no 不含 -N 后缀
  // 注：现舱划走的单子也可能是合法自拼母单(用整条现舱做自拼)，所以不再用
  //     spot_booking_id 排除 master。若某条单纯是"现舱划给单一客户"被误标 Console
  //     导致委托单位锁死，正确修法是把它的出运类型改回 FCL（数据层），而不是隐藏母单功能。
  const isMaster = order.shipment_type === "Console"
    && order.order_no
    && !/-\d+$/.test(order.order_no);

  // 分票判定：自拼柜 且 order_no 含 -N 后缀
  const isSubTicket = order.shipment_type === "Console"
    && order.order_no
    && /-\d+$/.test(order.order_no);
  const masterOrderNo = isSubTicket ? order.order_no.replace(/-\d+$/, "") : null;

  // 创建模式下的主拼判定（订单还没保存，order_no 为空）
  const isCreatingMaster = isCreating && createMode === "Console";

  // 当前分票对应的母单是否存在（null=未查 / true=有 / false=无 → 显示"补建母单"）
  const [masterExists, setMasterExists] = useState(null);
  useEffect(() => {
    if (!masterOrderNo) { setMasterExists(null); return; }
    let alive = true;
    supabase.from("shipments").select("id").eq("order_no", masterOrderNo).limit(1)
      .then(({ data }) => { if (alive) setMasterExists((data || []).length > 0); });
    return () => { alive = false; };
  }, [masterOrderNo]);

  // 复制订单：基于当前订单创建新订单，但 MBL/HBL/Booking 等单号 + 系统字段不复制
  const cloneOrder = async () => {
    if (!order?.id) return;
    if (!window.confirm(`确认复制本订单？\n\n复制内容：除单号（MBL/HBL/Booking）外的所有字段。\n创建后会在新标签页打开。`)) return;

    // 拉完整数据（fullOrder 可能是 prop 也可能没拉）
    const { data: src, error: e1 } = await supabase.from("shipments")
      .select("*").eq("id", order.id).single();
    if (e1) { alert("加载源订单失败：" + e1.message); return; }

    // 排除字段（系统生成 / 单号 / 状态 / 关联键 / 备份）
    const EXCLUDE = new Set([
      "id", "order_no",
      "mbl_no", "hbl_no", "booking_no", "e_booking_no", "supplier_order_no",
      "created_at", "updated_at", "completed_at",
      "created_by", "completed_by",
      "entry_done", "entry_number",
      "qc_status", "space_status", "mbl_status", "hbl_status", "finance_status",
      "parent_id",
      "_customer_backup", "_supplier_backup", "_order_no_backup",
      "lifecycle",  // 让新订单从"处理中"开始
    ]);
    const newRow = {};
    for (const [k, v] of Object.entries(src)) {
      if (!EXCLUDE.has(k) && v !== null) newRow[k] = v;
    }
    newRow.lifecycle = "处理中";

    const cleaned = filterShipmentPayload(newRow);
    const { data: created, error: e2 } = await supabase.from("shipments")
      .insert(cleaned).select().single();
    if (e2) { alert("复制失败：" + e2.message); return; }

    // 同时复制集装箱关联表
    const { data: ctnSrc } = await supabase.from("shipment_containers")
      .select("container_size, container_type, qty, container_no, seal_no, notes, sort_order")
      .eq("shipment_id", order.id);
    if (ctnSrc && ctnSrc.length > 0) {
      const newContainers = ctnSrc.map(c => ({
        ...c,
        shipment_id: created.id,
        container_no: null,  // 箱号不复制（每个订单独立）
        seal_no: null,       // 封号不复制
      }));
      await supabase.from("shipment_containers").insert(newContainers);
    }

    // 同步 qty_container 字段（V4 兼容）
    if (ctnSrc && ctnSrc.length > 0) {
      const map = {};
      for (const c of ctnSrc) {
        const key = `${c.container_size}${c.container_type}`;
        map[key] = (map[key] || 0) + (parseInt(c.qty) || 0);
      }
      const text = Object.entries(map).sort(([a], [b]) => a.localeCompare(b))
        .map(([k, q]) => `${q}x${k}`).join(",");
      await supabase.from("shipments").update({ qty_container: text }).eq("id", created.id);
    }

    // 新标签页打开新订单
    window.open(`#/sea_export?id=${created.id}`, "_blank");
  };

  // 补建母单：当前分票发现没有母单时调用，从分票数据复制 booking 级字段建一条 Console 壳行
  const createMaster = async () => {
    if (!isSubTicket || !masterOrderNo) return;
    if (masterExists) { alert("母单已存在"); return; }
    if (!window.confirm(`确认补建母单 ${masterOrderNo} ？\n\n会从当前分票复制 booking 级字段（船名/航次/箱号/POL/POD 等），票级字段（PO/客户/件数等）保持空。`)) return;
    const newRow = {
      order_no: masterOrderNo,
      shipment_type: "Console",
      booking_no: order.booking_no,
      e_booking_no: order.e_booking_no,
      mbl_no: order.mbl_no,
      vessel: order.vessel,
      voyage: order.voyage,
      etd: order.etd,
      pol: order.pol,
      pod: order.pod,
      destination: order.destination,
      carrier: order.carrier,
      container_no: order.container_no,
      qty_container: order.qty_container,
      overseas_agent: order.overseas_agent,
      solicit_type: order.solicit_type,
      lifecycle: "处理中",
    };
    const cleaned = filterShipmentPayload(newRow);
    const { data, error } = await supabase.from("shipments").insert(cleaned).select().single();
    if (error) { alert("补建失败：" + error.message); return; }
    setMasterExists(true);
    // 母单 + 当前所有分票 全量同步到 portal containers/container_items
    if (data) {
      syncContainerFull(data).catch(e => console.error("sync containers error:", e));
      // 重算合计写回母单（已有分票时立刻汇总）
      recomputeMasterTotals(masterOrderNo).catch(e => console.error("recompute totals error:", e));
    }
    if (data?.id) {
      // 新标签打开补建好的母单详情
      window.open(`#/sea_export?id=${data.id}`, "_blank");
    }
    onReload();
  };

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
    // 复制主拼的关键字段创建分票（船名/航次/POL/POD/目的港 + 各自 _code 都要带，否则分票就 NULL）
    const newRow = {
      order_no: newOrderNo,
      shipment_type: "Console",
      booking_no: order.booking_no,
      vessel: order.vessel,
      voyage: order.voyage,
      pol: order.pol,
      pol_code: order.pol_code,
      pod: order.pod,
      pod_code: order.pod_code,
      destination: order.destination,
      destination_code: order.destination_code,
      etd: order.etd,
      carrier: order.carrier,
      overseas_agent: order.overseas_agent,
      solicit_type: order.solicit_type,
      lifecycle: '处理中',
    };
    const { data: created, error } = await supabase.from("shipments").insert(filterShipmentPayload(newRow)).select().single();
    if (error) { alert("新建失败：" + error.message); return; }
    // 同步到 portal container_items（containers 行已存在，这里只插一条 item）
    if (created) {
      syncContainerFromMaster(order)
        .then(cid => cid && syncContainerItemFromSub(cid, created))
        .catch(e => console.error("sync container_items error:", e));
      // 新分票件毛体一般是 0/null，但保险起见重算母单合计（不是 no-op：
      // 用户后续在分票里填件数后会再触发一次）
      recomputeMasterTotals(order.order_no).catch(e => console.error("recompute totals error:", e));
    }
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

  // 拆分货物到小票后刷新：重算母单合计 + 重新加载母单自己的货(应已挪空)/分票/聚合视图
  const refreshAfterSplit = async () => {
    try { await recomputeMasterTotals(order.order_no); } catch (e) { console.error("recompute after split:", e); }
    try {
      const own = await loadCargoLines(order.id);
      setCargoLines(own); setCargoLinesDraft(own);
    } catch (e) { console.error("reload own cargo:", e); }
    const { data: subs } = await supabase.from("shipments").select("*")
      .eq("booking_no", order.booking_no).like("order_no", order.order_no + "-%");
    const sorted = (subs || []).sort((a, b) => {
      const na = parseInt((a.order_no || "").match(/-(\d+)$/)?.[1] || "999");
      const nb = parseInt((b.order_no || "").match(/-(\d+)$/)?.[1] || "999");
      return na - nb;
    });
    setSubTickets(sorted);
    const subIds = sorted.map(s => s.id);
    const [ctnRes, cargoRes] = await Promise.all([
      supabase.from("shipment_containers").select("*").in("shipment_id", [order.id, ...subIds]).order("sort_order", { ascending: true }),
      subIds.length > 0
        ? supabase.from("cargo_items").select("*").in("shipment_id", subIds).order("sort_order", { ascending: true })
        : Promise.resolve({ data: [] }),
    ]);
    setMasterAggContainers(ctnRes.data || []);
    setMasterAggCargoLines(cargoRes.data || []);
  };

  // 删除分票
  // 删除当前作业（工具栏"删除"按钮）
  const deleteOrder = async () => {
    if (!order?.id) return;
    if (isLocked) { alert("已关闭/完结的作业不能删除"); return; }
    // 自拼母单：先看下面有没有分票，有就劝退
    if (isMaster && subTickets.length > 0) {
      alert(`这是自拼母单，下面还挂着 ${subTickets.length} 个分票，请先逐个删掉分票再删母单`);
      return;
    }
    const ref = order.order_no || order.id.slice(0, 8);
    if (!window.confirm(`确定删除作业 ${ref}？\n\n会一并清理：\n  - 货物明细（cargo_items）\n  - 集装箱（shipment_containers）\n  - portal 装箱明细（container_items）\n\n此操作不可恢复。`)) return;

    try {
      // 关联的现舱（删完后要重算状态 = 退柜）
      const linkedSpotId = order.spot_booking_id;
      // 显式删 portal container_items（即便 FK on delete set null 也建议清掉）
      await supabase.from("container_items").delete().eq("shipment_id", order.id);
      // shipments 主表删（cargo_items / shipment_containers 有 CASCADE）
      const { error } = await supabase.from("shipments").delete().eq("id", order.id);
      if (error) { alert("删除失败：" + error.message); return; }
      // 自拼分票被删 → 重算母单合计
      if (isSubTicket && masterOrderNo) {
        recomputeMasterTotals(masterOrderNo).catch(e => console.error("recompute master totals error:", e));
      }
      // 退柜：删除从现舱划走的订单后, 重算现舱状态
      if (linkedSpotId) {
        recalcSpotStatus(linkedSpotId).catch(e => console.error("recalc spot status error:", e));
      }
      onBack();
    } catch (e) {
      alert("删除失败：" + (e?.message || e));
    }
  };

  const deleteSubTicket = async (subTicket) => {
    if (!confirm(`确定删除分票 ${subTicket.order_no} ？此操作不可恢复。`)) return;
    const { error } = await supabase.from("shipments").delete().eq("id", subTicket.id);
    if (error) { alert("删除失败：" + error.message); return; }
    // 同步：删 portal 对应 container_item（FK on delete set null 也能兜底，但显式删更干净）
    deleteContainerItemForSub(subTicket.id).catch(e => console.error("delete container_item error:", e));
    // 重算母单合计（少了一条分票）
    recomputeMasterTotals(order.order_no).catch(e => console.error("recompute totals error:", e));
    setSubTickets(prev => prev.filter(s => s.id !== subTicket.id));
  };

  // 主拼汇总数据（仅自拼主拼有意义）
  // 本票 cargo_items 实时合计（托单信息那段件/毛/体/件数从这里取）
  // 母单视图用 masterAggCargoLines（聚合自分票），分票/单票视图用 cargoLines（自己的）
  const cargoTotals = useMemo(() => {
    const src = (isMaster && order.shipment_type === "Console") ? masterAggCargoLines : cargoLines;
    if (!src || src.length === 0) return null;
    let qty = 0, wt = 0, vol = 0;
    let pkgUnit = null;
    src.forEach(l => {
      qty += parseInt(l.qty) || 0;
      wt  += parseFloat(l.gross_weight) || 0;
      vol += parseFloat(l.volume) || 0;
      if (!pkgUnit && l.package_unit) pkgUnit = l.package_unit;
    });
    return {
      qty: qty || null,
      weight: wt ? Number(wt.toFixed(3)) : null,
      volume: vol ? Number(vol.toFixed(4)) : null,
      package_unit: pkgUnit || "CARTONS",
    };
  }, [cargoLines, masterAggCargoLines, isMaster, order.shipment_type]);

  // shipment_id → 委托方名（货物明细"委托方"列只读显示）
  // 母单视图：覆盖所有分票；分票/单票视图：就本票一条
  const customerByShipmentId = useMemo(() => {
    const m = {};
    if (isMaster && order.shipment_type === "Console") {
      (subTickets || []).forEach(s => { if (s.id) m[s.id] = s.customer || ""; });
    } else if (order?.id) {
      m[order.id] = order.customer || "";
    }
    return m;
  }, [isMaster, order.shipment_type, order.id, order.customer, subTickets]);

  // 按箱合计：cargo_items.qty group by container_no
  // 给 ContainerEditor 的"件数"列只读用
  const cargoQtyByContainerNo = useMemo(() => {
    const src = (isMaster && order.shipment_type === "Console") ? masterAggCargoLines : cargoLines;
    const map = {};
    (src || []).forEach(l => {
      if (!l.container_no) return;
      map[l.container_no] = (map[l.container_no] || 0) + (parseInt(l.qty) || 0);
    });
    return map;
  }, [cargoLines, masterAggCargoLines, isMaster, order.shipment_type]);

  // 集装箱字段实时合计（托单信息顶上那行 "1x40HQ + N件" 从这里取）
  // 母单视图用 masterAggContainers，单票视图用空（containerSummary 已经够用）
  const containerLineSummary = useMemo(() => {
    // 件数：cargoTotals.qty
    const text = containerSummary || order.qty_container || "";
    if (!text) return "";
    if (cargoTotals?.qty) {
      return `${text}  共 ${cargoTotals.qty} ${cargoTotals.package_unit || "件"}`;
    }
    return text;
  }, [containerSummary, order.qty_container, cargoTotals]);

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
      volume: totalVol ? totalVol.toFixed(4) : null,
      description: descriptions.join("\n") || null,
    };
  }, [isMaster, subTickets]);

  const cargoFromContainerItems = cargoItems;

  return (
    <div className="tms">
      <BLImportModal
        open={blImportOpen}
        onClose={() => setBlImportOpen(false)}
        onApply={applyBLImport}
      />
      <Sino56ImportModal
        open={sino56ImportOpen}
        onClose={() => setSino56ImportOpen(false)}
        onApply={applySino56Import}
        subShipments={isMaster && order?.shipment_type === "Console" ? subTickets : []}
        currentOrderNo={order?.order_no || ""}
      />
      <SIDocImportModal
        open={siDocImportOpen}
        onClose={() => setSiDocImportOpen(false)}
        onApply={applySino56Import}
      />
      <PackingListImportModal
        open={packingListImportOpen}
        onClose={() => setPackingListImportOpen(false)}
        onApply={applySino56Import}
      />
      <ProfitModal
        open={profitOpen}
        onClose={() => setProfitOpen(false)}
        shipment={order}
        isMaster={isMaster}
        subTickets={subTickets}
      />
      <HistoryModal
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        shipmentId={order.id}
      />
      <CopyPartiesModal
        open={copyPartiesOpen}
        onClose={() => setCopyPartiesOpen(false)}
        currentShipmentId={order.id}
        customer={v("customer")}
        overseasAgent={v("overseas_agent")}
        onPick={(picked) => {
          if (picked.shipper) ch("shipper", picked.shipper);
          if (picked.consignee) ch("consignee", picked.consignee);
          if (picked.notify_party) ch("notify_party", picked.notify_party);
          setCopyPartiesOpen(false);
        }}
      />
      <BookingTemplateModal
        open={templateOpen}
        onClose={() => setTemplateOpen(false)}
        shipment={editing ? ed : order}
        onApply={(snap) => {
          // 模板字段合并到当前 ed；自动进 editing 态
          if (!editing) {
            setEd(prev => ({ ...order, ...prev, ...snap }));
            setEditing(true);
          } else {
            setEd(prev => ({ ...prev, ...snap }));
          }
        }}
      />
      {joinSubOpen && isMaster && (
        <JoinSubTicketModal
          master={order}
          existingSubTickets={subTickets}
          onClose={() => setJoinSubOpen(false)}
          onJoined={onReload}
        />
      )}
      {removeSubOpen && isMaster && (
        <RemoveSubTicketModal
          master={order}
          existingSubTickets={subTickets}
          onClose={() => setRemoveSubOpen(false)}
          onRemoved={onReload}
        />
      )}
      {splitCargoOpen && isMaster && (
        <SplitCargoToSubsModal
          master={order}
          existingSubTickets={subTickets}
          customers={refData.customers}
          onClose={() => setSplitCargoOpen(false)}
          onDone={refreshAfterSplit}
        />
      )}
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
            <Mi disabled={isLocked} onClick={() => { window.location.hash = "#/sea_export?action=new"; }}>新建</Mi>
            <Mi disabled={isLocked} onClick={cloneOrder}>复制</Mi>
            {isMaster && <Mi disabled={isLocked} onClick={createSubTicket}>+ 分票</Mi>}
            {isMaster && cargoLines.length > 0 && <Mi disabled={isLocked} onClick={() => setSplitCargoOpen(true)}>拆分货物到小票</Mi>}
            {isSubTicket && masterExists === false && <Mi disabled={isLocked} onClick={createMaster}>补建母单</Mi>}
            <Mi disabled={isLocked} onClick={deleteOrder}>删除</Mi>
            <Tbl/>
            <ConfirmStep field="manifest_confirmed_at" label="舱单" order={order} updateField={updateField} isLocked={isLocked} />
            <ConfirmStep field="route_confirmed_at"     label="航线" order={order} updateField={updateField} isLocked={isLocked} />
            <ConfirmStep field="booking_confirmed_at"   label="订舱" order={order} updateField={updateField} isLocked={isLocked} />
            <ConfirmStep field="space_released_at"      label="放舱" order={order} updateField={updateField} isLocked={isLocked} />
            <ConfirmStep field="container_released_at"  label="放箱" order={order} updateField={updateField} isLocked={isLocked} />
            <ConfirmStep field="atd" label="开船" type="date" defaultFrom="etd" order={order} updateField={updateField} isLocked={isLocked} />
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
            <Mi disabled={!order.id} onClick={() => setProfitOpen(true)}>内部利润分析</Mi>
            <MiDropdown disabled={!order.id} options={[
              { label: "委托书",           onClick: () => window.open(`#/docs/booking/${order.id}`, "_blank") },
              { label: "提单确认件 (Draft)", onClick: () => window.open(`#/docs/draft_bl/${order.id}`, "_blank") },
              { label: "📤 提单确认件 (Excel, 一代版)", onClick: () => exportDraftBLToXlsx(order.id) },
              { label: "提单副本 (Copy)",    onClick: () => window.open(`#/docs/bl_copy/${order.id}`, "_blank") },
              { label: "提单正本 (Original)", onClick: () => window.open(`#/docs/bl_original/${order.id}`, "_blank") },
              { label: "电放件",             onClick: () => window.open(`#/docs/telex/${order.id}`, "_blank") },
              { label: "放舱信息",           onClick: () => window.open(`#/docs/release/${order.id}`, "_blank") },
              { label: "单票对账单",         onClick: () => window.open(`#/docs/stmt/${order.id}`, "_blank") },
              { label: "📤 56 舱单 (.xls)",   onClick: exportSino56Manifest, disabled: isCreating },
            ]}>打印</MiDropdown>
            <Mi disabled={!prevId || !onNavigate} onClick={() => prevId && onNavigate?.(prevId)}>上行</Mi>
            <Mi disabled={!nextId || !onNavigate} onClick={() => nextId && onNavigate?.(nextId)}>下行</Mi>
            <Tbl/>
            <Mi onClick={onBack}>关闭</Mi>
          </>
        )}
      </div>

      {/* 来自现舱 banner */}
      {!isCreating && spotBooking && (
        <div style={{
          padding: "8px 16px",
          background: "#f6ffed",
          borderBottom: "1px solid #b7eb8f",
          color: "#166534",
          fontSize: 12,
          display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
        }}>
          <span>🔗 <b>来自现舱</b></span>
          <span style={{ fontFamily: "Consolas,monospace" }}>{spotBooking.booking_no}</span>
          <span>· {spotBooking.carrier} {spotBooking.vessel || ""}{spotBooking.voyage ? ` / ${spotBooking.voyage}` : ""}</span>
          <span>· {spotBooking.pol} → {spotBooking.pod}</span>
          <span>· 总 {spotBooking.total_qty} 柜</span>
          <span>· 状态 {spotBooking.status}</span>
          <a href={`#/spot_export`} target="_blank" rel="noopener"
             style={{ marginLeft: "auto", color: "#1990FF", textDecoration: "underline", cursor: "pointer" }}>
            打开现舱 ↗
          </a>
        </div>
      )}

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

      {/* 第二行工具栏：按 tab 切换 ─ 作业/装箱/小票 → 作业操作；费用 → 费用操作；其他 tab 隐藏 */}
      {(tab === "作业" || tab === "装箱" || tab === "小票") && (
        <div className="tms-dtb2">
          {!editing ? (
            <Mi disabled={isLocked} onClick={startEdit}>编辑</Mi>
          ) : (
            <>
              <Mi onClick={save}>保存</Mi>
              <Mi onClick={cancel}>取消</Mi>
            </>
          )}
          <Mi disabled={isLocked} onClick={() => setBlImportOpen(true)}>📋 导入提单</Mi>
          <Mi disabled={isLocked} onClick={() => setSino56ImportOpen(true)}>📋 导入舱单 (56/兴港)</Mi>
          <Mi disabled={isLocked} onClick={() => setSiDocImportOpen(true)}>📄 导入 SI (Word/Excel)</Mi>
          <Mi disabled={isLocked} onClick={() => setPackingListImportOpen(true)}>📦 导入装箱单</Mi>
          <Mi disabled={isLocked || isCreating} onClick={exportSino56Manifest}>📤 导出56舱单</Mi>
          <Mi arrow onClick={() => setTemplateOpen(true)} title="从模板创建 / 把当前作业存为模板">订舱模板</Mi>
          <Mi onClick={onReload}>刷新</Mi>
          <Mi disabled arrow title="敬请期待：跟船公司 EDI / 海关 56 平台对接入口">数据交换</Mi>
          <Mi disabled arrow title="敬请期待：自动发邮件/短信给客户（开船/到港/提单可取）">通知</Mi>
          <Mi disabled={!order.id} onClick={() => setHistoryOpen(true)} title="本票修改历史 audit log">历史</Mi>
        </div>
      )}
      {tab === "费用" && (
        <div className="tms-dtb2">
          <Mi disabled={isLocked || !order.id} onClick={() => chargesRef.current?.openImport()} title="从 Excel 导入费用行">📥 导入费用</Mi>
          <Mi disabled={!order.id} onClick={() => chargesRef.current?.exportExcel()} title="把当前 AR/AP 导成 Excel">📤 导出费用</Mi>
          <Mi disabled={isLocked || !order.id} onClick={() => chargesRef.current?.openCopyFromShipment()} title="从历史作业整批拷贝费用过来">📋 复制其他作业的费用</Mi>
          <Mi disabled={isLocked || !order.id} onClick={() => chargesRef.current?.openApplyTemplate()} arrow title="按客户挑模板一键套用">应用费用模板</Mi>
          <Mi disabled={isLocked || !order.id} onClick={() => chargesRef.current?.openSaveAsTemplate()} title="把当前 AR 或 AP 存为该客户的费用模板">💾 存为模板</Mi>
          <Mi disabled={!order.id} onClick={() => chargesRef.current?.print()} title="新标签页打开可打印的费用清单">🖨️ 打印费用清单</Mi>
          <Mi onClick={onReload}>刷新</Mi>
          <Mi disabled={!order.id} onClick={() => setHistoryOpen(true)} title="本票修改历史 audit log">历史</Mi>
        </div>
      )}

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
                  {isCreatingMaster ? (
                    <input value="（自拼主拼，无委托单位）" disabled className="placeholder-italic" />
                  ) : editing
                    ? <ComboBox value={v("customer")} onChange={val => {
                        ch("customer", val);
                        // 委托人变更 → 自动带出该客户常用的 shipper / consignee / notify_party
                        // 仅在对应字段当前为空时填入，已填的不覆盖
                        if (val) {
                          const remembered = refData.customerPartyMap?.[val] || {};
                          for (const f of ["shipper", "consignee", "notify_party"]) {
                            if (remembered[f] && !v(f)) ch(f, remembered[f]);
                          }
                        }
                      }} options={refData.customers} />
                    : isMaster
                      ? <input value={order.customer || "（多客户拼柜，详见小票）"} disabled className="placeholder-italic" />
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
                    ? <ComboBox value={v("carrier")} onChange={val => ch("carrier", (val || "").toUpperCase())} options={COMMON_CARRIERS} />
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
                  {editing && !isInheritedFromMaster("vessel")
                    ? <ComboBox value={v("vessel")} onChange={val => ch("vessel", val ? liveUpper(val) : val)} options={[]} />
                    : <input value={v("vessel")} disabled className="notnull" title={isInheritedFromMaster("vessel") ? inheritTitle : undefined} />}
                </Df>
                <Df label="状态"><input value={v("status") || "处理中"} disabled className="readonly" /></Df>
                <Df label="贸易条款">
                  <select value={v("trade_term") || ""} onChange={e => ch("trade_term", e.target.value)} disabled={!editing}>
                    <option value=""></option>
                    {TRADE_TERMS.map(t => <option key={t}>{t}</option>)}
                  </select>
                </Df>
                <Df label="航线"><input value={v("route")} onChange={e => ch("route", e.target.value)} disabled={!editing} /></Df>

                <Df label="MB/L No." required>
                  <input value={v("booking_no")}
                         onChange={e => ch("booking_no", e.target.value)}
                         onBlur={async (e) => {
                           // 反向关联：booking_no 在 spot_bookings 里有，且当前 shipment 还没 spot_booking_id → 提示绑定
                           if (!editing) return;
                           const bn = (e.target.value || "").trim();
                           if (!bn || v("spot_booking_id")) return;
                           const { data } = await supabase.from("spot_bookings")
                             .select("id, carrier, vessel, voyage, status").eq("booking_no", bn).limit(1);
                           if (data && data.length > 0) {
                             const s = data[0];
                             if (confirm(`订舱号 ${bn} 在「现舱」表里已有（${s.carrier} ${s.vessel || ""}/${s.voyage || ""}, ${s.status}）。\n\n要不要把本订单关联到那条现舱？\n\n（关联后, 订单详情顶部会显示「来自现舱」, 也会被算进现舱「已售」数）`)) {
                               ch("spot_booking_id", s.id);
                             }
                           }
                         }}
                         disabled={!editing} className="notnull" />
                </Df>
                <Df label="委托人手机"><input value={v("contact_phone")} onChange={e => ch("contact_phone", e.target.value)} disabled={!editing} /></Df>
                <Df label="航次" refLabel><input value={v("voyage")} onChange={e => ch("voyage", liveUpper(e.target.value))} disabled={!editing || isInheritedFromMaster("voyage")} className="notnull" title={isInheritedFromMaster("voyage") ? inheritTitle : undefined} /></Df>
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
                <Df label="预计到港时间">
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <input type="date" value={v("eta")} onChange={e => ch("eta", e.target.value)} disabled={!editing} />
                    {!editing && (
                      <button
                        type="button"
                        onClick={syncEta}
                        disabled={etaSyncing}
                        title="向 Maersk 查询最新到港时间（仅 Maersk）"
                        style={{ padding: "2px 8px", fontSize: 12, cursor: etaSyncing ? "wait" : "pointer", whiteSpace: "nowrap" }}
                      >
                        {etaSyncing ? "查询中…" : "🔄 查ETA"}
                      </button>
                    )}
                    {order.eta_carrier && (
                      <span
                        style={{ fontSize: 11, color: order.eta && order.eta_carrier !== order.eta ? "#d4380d" : "#888" }}
                        title={order.eta_synced_at ? "更新于 " + new Date(order.eta_synced_at).toLocaleString() : undefined}
                      >
                        船司:{order.eta_carrier}{order.eta && order.eta_carrier !== order.eta ? "（不符）" : ""}
                      </span>
                    )}
                  </div>
                </Df>
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

            {/* ─── 子 tab：托单信息 / 船东舱单 / 集装箱 / MB/L / HB/L / 其它信息 / 目的港信息 ─── */}
            {/* "货物"tab 已并入"集装箱" */}
            <div className="tms-subtabs">
              {["托单信息", "船东舱单", "集装箱", "MB/L", "HB/L", "其它信息", "目的港信息"].filter(t => t !== "HB/L" || order.has_hbl).map(t => (
                <div key={t} className={"st " + (subtab === t ? "act" : "")} onClick={() => setSubtab(t)}>{t}</div>
              ))}
            </div>

            <div className="tms-detail-panel-light">
              {subtab === "托单信息" && (
                <div style={tmStyles.wrap}>

                  {/* ━━━━━━━━━━━ 段 1：集装箱提示（按箱合计；附 cargo_items 总件数）━━━━━━━━━━━ */}
                  <div style={tmStyles.section}>
                    <div style={tmStyles.row}>
                      <label style={{ ...tmStyles.label, ...tmStyles.labelReadonly, ...tmStyles.labelNotnull }}>集装箱</label>
                      <input
                        value={containerLineSummary}
                        readOnly
                        placeholder="点右侧 + 跳到集装箱子 tab 编辑"
                        style={{ ...tmStyles.input, width: 320, fontFamily: "Consolas,monospace", color: "#666" }}
                      />
                      <button onClick={() => setSubtab("集装箱")} style={tmStyles.btnPlus} disabled={!order?.id}>+</button>
                    </div>
                  </div>

                  {/* ━━━━━━━━━━━ 段 2：件数 / 单位 / 毛重 / 体积
                      有 cargo_items 明细时取按提单合计（只读、灰底），无明细时手填 ━━━━━━━━━━━ */}
                  <div style={tmStyles.section}>
                    <div style={tmStyles.row}>
                      <label style={tmStyles.label}>货物件数</label>
                      <input type="number"
                             value={cargoTotals?.qty ?? v("qty_packages") ?? ""}
                             onChange={e => ch("qty_packages", e.target.value === "" ? null : Number(e.target.value))}
                             disabled={!editing || !!cargoTotals}
                             title={cargoTotals ? "由货物明细自动汇总（cargo_items）" : ""}
                             style={{ ...tmStyles.input, width: 114, background: cargoTotals ? "#f5f5f5" : undefined }} />

                      <label style={{ ...tmStyles.label, marginLeft: 16 }}>包装</label>
                      <span style={{ display: "inline-block", width: 114 }}>
                        <ComboBox
                          value={cargoTotals?.package_unit ?? v("pkg_unit") ?? ""}
                          onChange={val => ch("pkg_unit", val ? liveUpper(val) : null)}
                          options={(pkgUnits || []).map(u => u.code)}
                          placeholder="CARTONS"
                          disabled={!editing || !!cargoTotals}
                        />
                      </span>

                      <label style={{ ...tmStyles.label, marginLeft: 16 }}>毛重</label>
                      <input type="number" step="0.001"
                             value={cargoTotals?.weight ?? v("weight") ?? ""}
                             onChange={e => ch("weight", e.target.value === "" ? null : Number(e.target.value))}
                             disabled={!editing || !!cargoTotals}
                             title={cargoTotals ? "由货物明细自动汇总（cargo_items）" : ""}
                             style={{ ...tmStyles.input, width: 114, fontFamily: "Consolas,monospace", textAlign: "right", background: cargoTotals ? "#f5f5f5" : undefined }} />

                      <label style={{ ...tmStyles.label, marginLeft: 16 }}>体积</label>
                      <input type="number" step="0.0001"
                             value={cargoTotals?.volume ?? v("volume") ?? ""}
                             onChange={e => ch("volume", e.target.value === "" ? null : Number(e.target.value))}
                             disabled={!editing || !!cargoTotals}
                             title={cargoTotals ? "由货物明细自动汇总（cargo_items）" : ""}
                             style={{ ...tmStyles.input, width: 114, fontFamily: "Consolas,monospace", textAlign: "right", background: cargoTotals ? "#f5f5f5" : undefined }} />
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
                      {editing && v("customer") && (
                        <button
                          onClick={() => setCopyPartiesOpen(true)}
                          style={{
                            marginBottom: 6, padding: "4px 12px", fontSize: 11,
                            border: "1px dashed #1990FF", background: "#e6f4ff",
                            color: "#1990FF", borderRadius: 4, cursor: "pointer",
                          }}
                          title="抄录同委托单位/同海外代理 历史订单的 shipper/consignee/notify_party"
                        >
                          📋 抄录历史（同委托/同代理）
                        </button>
                      )}
                      {/* 发货人 */}
                      <div style={tmStyles.subSection}>
                        <div style={tmStyles.row}>
                          <label style={{ ...tmStyles.label, ...tmStyles.labelBlue, ...tmStyles.labelRef }}>发货人</label>
                          <input
                            value={v("shipper")}
                            onChange={e => ch("shipper", e.target.value.toUpperCase())}
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
                            onChange={e => ch("shipper", e.target.value.toUpperCase())}
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
                            onChange={e => ch("consignee", e.target.value.toUpperCase())}
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
                            onChange={e => ch("consignee", e.target.value.toUpperCase())}
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
                            onChange={e => ch("notify_party", e.target.value.toUpperCase())}
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
                            onChange={e => ch("notify_party", e.target.value.toUpperCase())}
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
                            onChange={e => ch("desc_en", e.target.value.toUpperCase())}
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
                               disabled={!editing || isInheritedFromMaster("pol")}
                               title={isInheritedFromMaster("pol") ? inheritTitle : undefined} />

                      {/* 中转港 */}
                      <PortRow label="中转港"
                               value={{ code: v("transit_port_code"), name: v("transit_port_name") }}
                               onChange={({code, name}) => { ch("transit_port_code", code); ch("transit_port_name", name); }}
                               disabled={!editing} />

                      {/* 卸货港 - 必填 */}
                      <PortRow label="卸货港" required
                               value={{ code: v("pod_code"), name: v("pod") }}
                               onChange={({code, name}) => { ch("pod_code", code); ch("pod", name); }}
                               disabled={!editing || isInheritedFromMaster("pod")}
                               title={isInheritedFromMaster("pod") ? inheritTitle : undefined} />

                      {/* 目的港 - 必填 */}
                      <PortRow label="目的港" required
                               value={{ code: v("destination_code"), name: v("destination") }}
                               onChange={({code, name}) => { ch("destination_code", code); ch("destination", name); }}
                               disabled={!editing || isInheritedFromMaster("destination")}
                               title={isInheritedFromMaster("destination") ? inheritTitle : undefined} />

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
                          disabled={!editing || isInheritedFromMaster("vessel")}
                          title={isInheritedFromMaster("vessel") ? inheritTitle : undefined}
                          style={{ ...tmStyles.input, width: 269, fontFamily: "Consolas,monospace" }}
                        />
                      </div>
                      <div style={{ ...tmStyles.subSection, ...tmStyles.row }}>
                        <label style={tmStyles.label}>航次</label>
                        <input
                          value={v("voyage")}
                          onChange={e => ch("voyage", liveUpper(e.target.value))}
                          disabled={!editing || isInheritedFromMaster("voyage")}
                          title={isInheritedFromMaster("voyage") ? inheritTitle : undefined}
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

              {subtab === "集装箱" && (
                <div style={{ overflow: "auto" }}>
                  {/* 三种场景分支：
                      A. 自拼母单（isMaster && Console）→ 聚合显示所有分票的箱+货物，只读
                      B. 自拼分票（isSubTicket）→ 只货物明细 editable，箱信息归母单
                      C. 整箱/拼箱单票 → ContainerEditor + CargoLinesEditor 都在本票 */}
                  {isMaster && order.shipment_type === "Console" ? (
                    <ConsoleMasterContainerView
                      containers={masterAggContainers}
                      cargoLines={masterAggCargoLines}
                      subTickets={subTickets}
                      blLabel={order.has_hbl ? "HBL" : "MBL"}
                      customerByShipmentId={customerByShipmentId}
                      onReload={onReload}
                      isLocked={isLocked}
                    />
                  ) : (
                    <>
                      {/* 集装箱编辑（仅非自拼分票） */}
                      {!isSubTicket && (
                        <div style={{ marginBottom: 16 }}>
                          <div style={{ fontSize: 12, fontWeight: "bold", color: "#444", marginBottom: 6 }}>集装箱</div>
                          <ContainerEditor
                            shipmentId={order?.id}
                            readOnly={!editing && !isCreating}
                            cargoQtyByContainerNo={cargoQtyByContainerNo}
                            onChange={(rows) => {
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

                      {/* 货物明细 editable */}
                      <CargoLinesEditor
                        shipmentId={order?.id}
                        defaultHbl={order.has_hbl ? order.hbl_no : order.booking_no}
                        blLabel={order.has_hbl ? "HBL" : "MBL"}
                        editing={editing && !isCreating}
                        lines={cargoLinesDraft}
                        onChange={setCargoLinesDraft}
                        customerByShipmentId={customerByShipmentId}
                      />
                    </>
                  )}
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
              <button disabled={isLocked} onClick={() => setJoinSubOpen(true)} title="把一个独立作业并入当前母拼">加入分票</button>
              <button disabled={isLocked || subTickets.length === 0} onClick={() => setRemoveSubOpen(true)} title="把分票从母拼解绑成独立作业">移除分票</button>
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
                        aria-hidden="true"
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
          <ChargesPanel ref={chargesRef} order={order} role={role} user={user} isLocked={isLocked} />
        )}

        {tab === "凭证" && (
          <DocsPanel shipmentId={order.id} canPrint={!!order.id} blType={order.bl_type} />
        )}

        {tab === "代理对账单" && (
          order.id
            ? <Statement shipmentId={order.id} mode="single" onBack={() => setTab("作业")} />
            : <div style={{ padding: 30, color: "#888", textAlign: "center" }}>请先保存订单</div>
        )}

        {tab === "附件" && (
          <AttachmentsPanel shipmentId={order.id} user={user} />
        )}

        {tab === "SOP 进度" && (
          <SopProgress shipment={order} onUpdate={updateField} disabled={isLocked} />
        )}
      </div>
    </div>
  );
}

const cellHead = { padding: "5px 8px", border: "1px solid #ddd", fontSize: 12, fontWeight: "bold", color: "#444", textAlign: "left", whiteSpace: "nowrap" };
const cellBody = { padding: "5px 8px", border: "1px solid #ddd", fontSize: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };

// ═══════════════════════════════════════════════════════════════
// CargoLinesEditor — 货物明细（cargo_items）编辑器
// 行级 editable + 按箱合计 + 按 HBL 合计
// 保存逻辑由父组件的 save() 调 saveCargoLines(shipmentId, prev, next)
// ═══════════════════════════════════════════════════════════════
// 常用箱型供 datalist 提示，仍允许手输自定义
const CONTAINER_TYPE_OPTIONS = ["20GP", "40GP", "40HQ", "40HC", "45HQ", "20RF", "40RF", "20OT", "40OT", "20FR", "40FR", "20TK", "40TK"];

// 通用列宽 hook：宽度存 localStorage，鼠标拖动改、双击 reset
function useColResize(storageKey, defaults) {
  const [widths, setWidths] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || "{}");
      return { ...defaults, ...saved };
    } catch { return defaults; }
  });
  const startResize = (key) => (e) => {
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX;
    const startW = widths[key] ?? defaults[key] ?? 100;
    const onMove = (ev) => {
      const newW = Math.max(40, startW + (ev.clientX - startX));
      setWidths(p => ({ ...p, [key]: newW }));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      setWidths(latest => {
        try { localStorage.setItem(storageKey, JSON.stringify(latest)); } catch { /* ignore */ }
        return latest;
      });
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };
  const resetCol = (key) => () => {
    setWidths(p => {
      const next = { ...p, [key]: defaults[key] };
      try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };
  return { widths, startResize, resetCol };
}

// 可拖拽 th
function ResizableTh({ widths, startResize, resetCol, k, children, extraStyle }) {
  return (
    <th style={{ ...cellHead, width: widths[k], position: "relative", ...(extraStyle || {}) }}>
      {children}
      <span className="col-resize" onMouseDown={startResize(k)} onDoubleClick={resetCol(k)} aria-hidden="true" />
    </th>
  );
}

const CARGO_DETAIL_DEFAULTS = { seq: 40, customer: 140, wh_in: 120, bl: 140, cont_no: 110, seal: 100, type: 80, name: 220, hs: 110, qty: 80, pkg: 90, wt: 110, vol: 100, marks: 100, un: 60, cl: 60, del: 48 };
const CARGO_BYBOX_DEFAULTS = { cont_no: 130, seal: 110, type: 80, names: 320, qty: 100, wt: 120, vol: 110 };
const CARGO_BYHBL_DEFAULTS = { hbl: 160, names: 360, qty: 100, pkg: 90, wt: 120, vol: 110 };

function CargoLinesEditor({ shipmentId, defaultHbl, blLabel = "HBL", editing, lines, onChange, customerByShipmentId = {} }) {
  const cellInput = { width: "100%", padding: "2px 4px", fontSize: 12, border: "1px solid #ccc", boxSizing: "border-box", background: editing ? "#fff" : "#f5f5f5" };
  const cellInputNum = { ...cellInput, textAlign: "right", fontFamily: "Consolas,monospace" };

  const detail = useColResize("cargoLines.cols.detail.v1", CARGO_DETAIL_DEFAULTS);
  const byBox  = useColResize("cargoLines.cols.byBox.v1",  CARGO_BYBOX_DEFAULTS);
  const byHblC = useColResize("cargoLines.cols.byHbl.v1",  CARGO_BYHBL_DEFAULTS);

  // 只读视图按提单号字母序排（A/B/C...），编辑时保持用户输入顺序避免行跳
  const displayLines = useMemo(() => {
    if (editing) return lines;
    return [...lines].sort((a, b) => (a.hbl_no || "").localeCompare(b.hbl_no || ""));
  }, [lines, editing]);

  const updateRow = (idx, field, value) => {
    const next = lines.map((r, i) => i === idx ? { ...r, [field]: value } : r);
    onChange(next);
  };
  const addRow = () => {
    onChange([...lines, {
      _tmp: Date.now() + Math.random(),  // 临时 key（无 id）
      warehouse_in_no: "",
      hbl_no: defaultHbl || "",
      container_no: "", seal_no: "", container_type: "",
      product_name_en: "", hs_code: "",
      qty: "", package_unit: "CARTONS",
      gross_weight: "", volume: "",
      marks: "", un: "", cl: "",
      sort_order: lines.length + 1,
    }]);
  };
  const delRow = (idx) => {
    onChange(lines.filter((_, i) => i !== idx));
  };

  // 按箱合计（group by container_no）
  const byContainer = {};
  lines.forEach(l => {
    const k = l.container_no || "(未指定)";
    if (!byContainer[k]) byContainer[k] = { container_no: l.container_no, seal_no: l.seal_no, container_type: l.container_type, names: [], qty: 0, wt: 0, vol: 0 };
    if (l.product_name_en && !byContainer[k].names.includes(l.product_name_en)) byContainer[k].names.push(l.product_name_en);
    byContainer[k].qty += parseInt(l.qty) || 0;
    byContainer[k].wt  += parseFloat(l.gross_weight) || 0;
    byContainer[k].vol += parseFloat(l.volume) || 0;
  });

  // 按 HBL 合计（group by hbl_no）
  const byHbl = {};
  lines.forEach(l => {
    const k = l.hbl_no || "(未指定)";
    if (!byHbl[k]) byHbl[k] = { hbl_no: l.hbl_no, names: [], qty: 0, wt: 0, vol: 0, pkg_unit: l.package_unit };
    if (l.product_name_en && !byHbl[k].names.includes(l.product_name_en)) byHbl[k].names.push(l.product_name_en);
    byHbl[k].qty += parseInt(l.qty) || 0;
    byHbl[k].wt  += parseFloat(l.gross_weight) || 0;
    byHbl[k].vol += parseFloat(l.volume) || 0;
  });

  if (!shipmentId) {
    return <div style={{ padding: 12, color: "#999", fontSize: 12 }}>请先保存订单，再录货物明细</div>;
  }

  return (
    <div>
      {/* 箱型下拉提示（input list 引用，仍允许手输自定义） */}
      <datalist id="cargo-container-types">
        {CONTAINER_TYPE_OPTIONS.map(t => <option key={t} value={t} />)}
      </datalist>
      <div style={{ fontSize: 12, fontWeight: "bold", color: "#444", marginBottom: 6, marginTop: 12 }}>
        货物明细（品名级）
      </div>
      <div style={{ overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, tableLayout: "fixed" }}>
          <thead>
            <tr style={{ background: "linear-gradient(#f9f9f9,#f0f0f0)" }}>
              <ResizableTh {...detail} k="seq">#</ResizableTh>
              <ResizableTh {...detail} k="customer">委托方</ResizableTh>
              <ResizableTh {...detail} k="wh_in">进仓号</ResizableTh>
              <ResizableTh {...detail} k="bl">{blLabel}</ResizableTh>
              <ResizableTh {...detail} k="cont_no">箱号</ResizableTh>
              <ResizableTh {...detail} k="seal">封号</ResizableTh>
              <ResizableTh {...detail} k="type">箱型</ResizableTh>
              <ResizableTh {...detail} k="name">英文品名</ResizableTh>
              <ResizableTh {...detail} k="hs">HSCode</ResizableTh>
              <ResizableTh {...detail} k="qty">件数</ResizableTh>
              <ResizableTh {...detail} k="pkg">包装</ResizableTh>
              <ResizableTh {...detail} k="wt">毛重 (KGS)</ResizableTh>
              <ResizableTh {...detail} k="vol">体积 (CBM)</ResizableTh>
              <ResizableTh {...detail} k="marks">唛头</ResizableTh>
              <ResizableTh {...detail} k="un">UN</ResizableTh>
              <ResizableTh {...detail} k="cl">CL</ResizableTh>
              {editing && <ResizableTh {...detail} k="del"></ResizableTh>}
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 ? (
              <tr><td colSpan={editing ? 17 : 16} style={{ padding: 16, textAlign: "center", color: "#999" }}>
                {editing ? "暂无货物明细，点下面 + 添加" : "暂无货物明细"}
              </td></tr>
            ) : displayLines.map((r, dispI) => {
              // 当 editing=false 时 displayLines 是排序后的，但 updateRow 操作的是 lines 原数组的索引
              const i = editing ? dispI : lines.indexOf(r);
              const customerName = customerByShipmentId[r.shipment_id] || "";
              return (
              <tr key={r.id || r._tmp || dispI} style={{ background: dispI % 2 ? "#fafafa" : "#fff" }}>
                <td style={cellBody}>{(dispI + 1) * 10}</td>
                <td style={{ ...cellBody, color: "#666" }} title="对应分票的委托方（不可编辑）">{customerName}</td>
                <td style={cellBody}><input style={cellInput} value={r.warehouse_in_no || ""} onChange={e => updateRow(i, "warehouse_in_no", e.target.value)} disabled={!editing} /></td>
                <td style={{ ...cellBody, position: "relative" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
                    <input style={{ ...cellInput, flex: 1 }} value={r.hbl_no || ""} onChange={e => updateRow(i, "hbl_no", e.target.value)} disabled={!editing} />
                    {r.shipment_id && (
                      <button
                        type="button"
                        title="跳到对应分票详情页"
                        onClick={() => window.open(`#/sea_export?id=${r.shipment_id}`, "_blank")}
                        style={{ flexShrink: 0, padding: "0 4px", fontSize: 11, lineHeight: "16px", border: "1px solid #d9d9d9", background: "#fafafa", cursor: "pointer", color: "#1990ff" }}
                      >↗</button>
                    )}
                  </div>
                </td>
                <td style={cellBody}><input style={cellInput} value={r.container_no || ""} onChange={e => updateRow(i, "container_no", e.target.value)} disabled={!editing} /></td>
                <td style={cellBody}><input style={cellInput} value={r.seal_no || ""} onChange={e => updateRow(i, "seal_no", e.target.value)} disabled={!editing} /></td>
                <td style={cellBody}><input list="cargo-container-types" style={cellInput} value={r.container_type || ""} onChange={e => updateRow(i, "container_type", e.target.value)} disabled={!editing} /></td>
                <td style={cellBody}><input style={cellInput} value={r.product_name_en || ""} onChange={e => updateRow(i, "product_name_en", e.target.value.toUpperCase())} disabled={!editing} /></td>
                <td style={cellBody}><input style={cellInput} value={r.hs_code || ""} onChange={e => updateRow(i, "hs_code", e.target.value)} disabled={!editing} /></td>
                <td style={cellBody}><input style={cellInputNum} value={r.qty ?? ""} onChange={e => updateRow(i, "qty", e.target.value)} disabled={!editing} /></td>
                <td style={cellBody}><input style={cellInput} value={r.package_unit || "CARTONS"} onChange={e => updateRow(i, "package_unit", e.target.value)} disabled={!editing} /></td>
                <td style={cellBody}><input style={cellInputNum} value={r.gross_weight ?? ""} onChange={e => updateRow(i, "gross_weight", e.target.value)} disabled={!editing} /></td>
                <td style={cellBody}><input style={cellInputNum} value={r.volume ?? ""} onChange={e => updateRow(i, "volume", e.target.value)} disabled={!editing} /></td>
                <td style={{ ...cellBody, whiteSpace: "normal" }}><textarea style={{ ...cellInput, minHeight: 24, resize: "vertical", fontFamily: "Consolas,monospace", whiteSpace: "pre" }} value={r.marks || ""} onChange={e => updateRow(i, "marks", e.target.value)} disabled={!editing} placeholder="可换行" /></td>
                <td style={cellBody}><input style={cellInput} value={r.un || ""} onChange={e => updateRow(i, "un", e.target.value)} disabled={!editing} /></td>
                <td style={cellBody}><input style={cellInput} value={r.cl || ""} onChange={e => updateRow(i, "cl", e.target.value)} disabled={!editing} /></td>
                {editing && <td style={cellBody}><button onClick={() => delRow(i)} style={{ padding: "2px 8px", fontSize: 11, cursor: "pointer" }}>删</button></td>}
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {editing && (
        <div style={{ marginTop: 6 }}>
          <button onClick={addRow} style={{ padding: "4px 12px", fontSize: 12, cursor: "pointer" }}>+ 添加一行</button>
        </div>
      )}

      {/* 按箱合计 */}
      {Object.keys(byContainer).length > 0 && (
        <>
          <div style={{ fontSize: 12, fontWeight: "bold", color: "#444", margin: "16px 0 6px" }}>按箱合计（自动）</div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, tableLayout: "fixed" }}>
            <thead>
              <tr style={{ background: "linear-gradient(#f9f9f9,#f0f0f0)" }}>
                <ResizableTh {...byBox} k="cont_no">箱号</ResizableTh>
                <ResizableTh {...byBox} k="seal">封号</ResizableTh>
                <ResizableTh {...byBox} k="type">箱型</ResizableTh>
                <ResizableTh {...byBox} k="names">品名（合并）</ResizableTh>
                <ResizableTh {...byBox} k="qty">件数合计</ResizableTh>
                <ResizableTh {...byBox} k="wt">毛重合计</ResizableTh>
                <ResizableTh {...byBox} k="vol">体积合计</ResizableTh>
              </tr>
            </thead>
            <tbody>
              {Object.values(byContainer)
                .sort((a, b) => (a.container_no || "").localeCompare(b.container_no || ""))
                .map((g, i) => (
                <tr key={i} style={{ background: i % 2 ? "#fafafa" : "#fff" }}>
                  <td style={cellBody}>{g.container_no || "—"}</td>
                  <td style={cellBody}>{g.seal_no || "—"}</td>
                  <td style={cellBody}>{g.container_type || "—"}</td>
                  <td style={cellBody} title={g.names.join(" / ")}>{g.names.join(" / ")}</td>
                  <td style={{ ...cellBody, textAlign: "right", fontFamily: "Consolas,monospace" }}>{g.qty || "—"}</td>
                  <td style={{ ...cellBody, textAlign: "right", fontFamily: "Consolas,monospace" }}>{g.wt ? g.wt.toFixed(3) : "—"}</td>
                  <td style={{ ...cellBody, textAlign: "right", fontFamily: "Consolas,monospace" }}>{g.vol ? g.vol.toFixed(4) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* 按提单(HBL/MBL)合计 */}
      {Object.keys(byHbl).length > 0 && (
        <>
          <div style={{ fontSize: 12, fontWeight: "bold", color: "#444", margin: "16px 0 6px" }}>按提单({blLabel})合计（自动）</div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, tableLayout: "fixed" }}>
            <thead>
              <tr style={{ background: "linear-gradient(#f9f9f9,#f0f0f0)" }}>
                <ResizableTh {...byHblC} k="hbl">{blLabel}</ResizableTh>
                <ResizableTh {...byHblC} k="names">品名（合并）</ResizableTh>
                <ResizableTh {...byHblC} k="qty">件数合计</ResizableTh>
                <ResizableTh {...byHblC} k="pkg">包装</ResizableTh>
                <ResizableTh {...byHblC} k="wt">毛重合计</ResizableTh>
                <ResizableTh {...byHblC} k="vol">体积合计</ResizableTh>
              </tr>
            </thead>
            <tbody>
              {Object.values(byHbl)
                .sort((a, b) => (a.hbl_no || "").localeCompare(b.hbl_no || ""))
                .map((g, i) => (
                <tr key={i} style={{ background: i % 2 ? "#fafafa" : "#fff" }}>
                  <td style={cellBody}>{g.hbl_no || "—"}</td>
                  <td style={cellBody} title={g.names.join(" / ")}>{g.names.join(" / ")}</td>
                  <td style={{ ...cellBody, textAlign: "right", fontFamily: "Consolas,monospace" }}>{g.qty || "—"}</td>
                  <td style={cellBody}>{g.pkg_unit || "CARTONS"}</td>
                  <td style={{ ...cellBody, textAlign: "right", fontFamily: "Consolas,monospace" }}>{g.wt ? g.wt.toFixed(3) : "—"}</td>
                  <td style={{ ...cellBody, textAlign: "right", fontFamily: "Consolas,monospace" }}>{g.vol ? g.vol.toFixed(4) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// ConsoleMasterContainerView — 自拼母单只读聚合视图
// 把所有分票的 shipment_containers + cargo_items 合并展示。
// 编辑入口在分票详情页，母单不在此处编辑。
// ═══════════════════════════════════════════════════════════════
function ConsoleMasterContainerView({ containers, cargoLines, subTickets, blLabel, customerByShipmentId, onReload, isLocked }) {
  // 分票 id → 分票尾数 / HBL（用于"来源"列）
  const subTailById = {};
  const hblBySubId = {};
  for (const s of subTickets) {
    const tail = (s.order_no || "").match(/-(\d+)$/)?.[1];
    if (s.id && tail) subTailById[s.id] = tail;
    if (s.id && s.hbl_no) hblBySubId[s.id] = s.hbl_no;
  }
  // 显示用：优先 HBL，没填回退到 "-1" 分票尾数
  const sourceLabel = (shipment_id) =>
    hblBySubId[shipment_id] || (subTailById[shipment_id] ? `-${subTailById[shipment_id]}` : "母单");

  // 「从分票货物明细同步集装箱」按钮 ——
  // 扫所有分票 cargo_items，按 (shipment_id, container_no) distinct 出箱号，
  // 自动建 shipment_containers 行（解析 40HC→size+type，汇总件数/重量/体积）。
  // 已存在的（按 shipment_id + container_no 去重）跳过。
  const syncContainersFromCargo = async () => {
    if (isLocked) { alert("作业已锁定，不能同步"); return; }
    const groups = new Map(); // key: shipment_id|container_no
    for (const cl of cargoLines) {
      if (!cl.container_no || !cl.shipment_id) continue;
      const key = `${cl.shipment_id}|${cl.container_no}`;
      if (!groups.has(key)) {
        const m = (cl.container_type || "").match(/^(\d+)(\D+)$/);
        groups.set(key, {
          shipment_id: cl.shipment_id,
          container_no: cl.container_no,
          seal_no: cl.seal_no || null,
          container_size: m ? m[1] : null,
          container_type: m ? m[2] : (cl.container_type || null),
          qty: 1,
          cargo_qty: 0,
          cargo_weight: 0,
          cargo_volume: 0,
        });
      }
      const g = groups.get(key);
      g.cargo_qty    += Number(cl.qty)          || 0;
      g.cargo_weight += Number(cl.gross_weight) || 0;
      g.cargo_volume += Number(cl.volume)       || 0;
    }
    if (groups.size === 0) {
      alert("分票货物明细里没有填箱号，无法同步");
      return;
    }
    const existingKeys = new Set(
      containers.map(c => `${c.shipment_id}|${c.container_no}`)
    );
    const toInsert = [...groups.values()].filter(
      g => !existingKeys.has(`${g.shipment_id}|${g.container_no}`)
    );
    if (toInsert.length === 0) {
      alert("所有箱号都已在集装箱表里，无新增");
      return;
    }
    const preview = toInsert.map(r => {
      return `  ${sourceLabel(r.shipment_id)}  ${r.container_no}  ${r.container_size || ""}${r.container_type || ""}  ${r.cargo_qty}件  ${r.cargo_weight}KG`;
    }).join("\n");
    if (!confirm(`将向「集装箱」表新增 ${toInsert.length} 行：\n\n${preview}\n\n继续？`)) return;
    const { error } = await supabase.from("shipment_containers").insert(toInsert);
    if (error) { alert("同步失败：" + error.message); return; }
    alert(`✓ 已同步 ${toInsert.length} 行集装箱`);
    onReload?.();
  };

  return (
    <div>
      {/* 集装箱聚合（只读） */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <span style={{ fontSize: 12, fontWeight: "bold", color: "#444" }}>
          集装箱（汇总自分票，只读 — 编辑请到对应分票）
        </span>
        <button
          onClick={syncContainersFromCargo}
          disabled={isLocked || cargoLines.length === 0}
          style={{
            padding: "4px 12px",
            fontSize: 12,
            border: "1px solid #1989ff",
            background: (isLocked || cargoLines.length === 0) ? "#f5f5f5" : "#e6f4ff",
            color: (isLocked || cargoLines.length === 0) ? "#999" : "#1989ff",
            borderRadius: 4,
            cursor: (isLocked || cargoLines.length === 0) ? "not-allowed" : "pointer",
          }}
          title="把货物明细里出现过但还没在集装箱表里的箱号，自动建到对应分票"
        >
          📥 从分票货物明细同步集装箱
        </button>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, tableLayout: "fixed" }}>
        <thead>
          <tr style={{ background: "linear-gradient(#f9f9f9,#f0f0f0)" }}>
            <th style={cellHead}>HBL</th>
            <th style={cellHead}>箱型</th>
            <th style={cellHead}>类型</th>
            <th style={cellHead}>数量</th>
            <th style={cellHead}>箱号</th>
            <th style={cellHead}>封号</th>
            <th style={cellHead}>备注</th>
          </tr>
        </thead>
        <tbody>
          {containers.length === 0 ? (
            <tr><td colSpan={7} style={{ padding: 16, textAlign: "center", color: "#999" }}>分票未录入集装箱</td></tr>
          ) : containers.map((c, i) => (
            <tr key={c.id || i} style={{ background: i % 2 ? "#fafafa" : "#fff" }}>
              <td style={cellBody}>{sourceLabel(c.shipment_id)}</td>
              <td style={cellBody}>{c.container_size || "—"}</td>
              <td style={cellBody}>{c.container_type || "—"}</td>
              <td style={{ ...cellBody, textAlign: "right" }}>{c.qty || "—"}</td>
              <td style={cellBody}>{c.container_no || "—"}</td>
              <td style={cellBody}>{c.seal_no || "—"}</td>
              <td style={cellBody}>{c.notes || ""}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* 货物明细聚合（只读，复用 CargoLinesEditor 但 editing=false） */}
      <div style={{ marginTop: 16 }}>
        <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>
          货物明细（汇总自分票，只读 — 编辑请到对应分票）
        </div>
        <CargoLinesEditor
          shipmentId="master-readonly"
          defaultHbl=""
          blLabel={blLabel}
          editing={false}
          lines={cargoLines}
          onChange={() => {}}
          customerByShipmentId={customerByShipmentId}
        />
      </div>
    </div>
  );
}


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
    { key: "draft_bl_xlsx", name: "提单确认件 Excel", en: "Draft B/L (xlsx)", desc: "一代版，关键字段平铺表格",     ready: true,
      action: () => exportDraftBLToXlsx(shipmentId) },
    { key: "bl_copy",  name: "提单 Copy",    en: "B/L Copy",             desc: "提单副本，签发后用",            ready: true },
    { key: "bl_original", name: "提单正本",  en: "Original B/L",         desc: "正本提单，签发后打印",          ready: true },
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
              d.action ? (
                <button
                  onClick={d.action}
                  style={{
                    padding: "5px 14px", border: "none",
                    background: d.highlight ? "#fa541c" : "#1990FF", color: "#fff",
                    borderRadius: 3, fontSize: 12, cursor: "pointer",
                  }}
                >下载 Excel →</button>
              ) : (
                <a
                  href={`#/docs/${d.key}/${shipmentId}`}
                  target="_blank" rel="noreferrer"
                  style={{
                    display: "inline-block", padding: "5px 14px",
                    background: d.highlight ? "#fa541c" : "#1990FF", color: "#fff",
                    textDecoration: "none", borderRadius: 3, fontSize: 12,
                  }}
                >生成 / 打开 →</a>
              )
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

function ChargesPanel({ ref, order, role, user, isLocked }) {
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
  const [batchMenuOpen, setBatchMenuOpen] = useState(null);   // 'AR' | 'AP' | null
  const [batchModal, setBatchModal] = useState(null);         // {direction, action, rowIds} | null
  // 工具栏触发的 modal 开关
  const [importOpen, setImportOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [applyTplOpen, setApplyTplOpen] = useState(false);
  const [saveTplOpen, setSaveTplOpen] = useState(false);

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
      const next = { ...r, ...patch, _dirty: true };
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
  // 注意：dbIds 必须在 setter 之外同步算出来。
  // React 的 setState(fn) 回调要等下一次渲染才执行，把 dbIds.push 放进去
  // 会让下面的 supabase.delete 在 dbIds 还空的时候就跑掉 → DB 没删,刷新行就回来。
  const deleteRows = async (direction, ids) => {
    if (!ids.length) return;
    if (!confirm(`确定删除选中的 ${ids.length} 条费用？`)) return;
    const setter = direction === "应收" ? setArRows : setApRows;
    const setSelected = direction === "应收" ? setSelectedAr : setSelectedAp;
    const currentRows = direction === "应收" ? arRows : apRows;
    // 同步算出要落 DB 的 id（行里 r.id 存在 = 已落库；只有 _id 的是本地草稿）
    const dbIds = currentRows
      .filter(r => ids.includes(r.id || r._id) && r.id)
      .map(r => r.id);
    // 先 DB 删；DB 失败就保留行让用户重试
    if (dbIds.length) {
      const { error } = await supabase.from("charges").delete().in("id", dbIds);
      if (error) { alert("删除失败：" + error.message); return; }
    }
    setter(prev => prev.filter(r => !ids.includes(r.id || r._id)));
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
      arr.splice(toIdx, 0, { ...moved, _dirty: true });
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

  // 把若干行镜像到对侧（结算单位/账单/状态清空，留待用户编辑）
  const mirrorRowsToOther = (srcRows, targetDirection) => {
    if (!srcRows.length) return [];
    return srcRows.map((r, i) => ({
      _draft: true,
      _id: "draft-" + Date.now() + "-" + Math.random().toString(36).slice(2) + "-" + i,
      direction: targetDirection,
      charge_item_id: r.charge_item_id,
      partner_id: "",
      partner_name: "",
      unit: r.unit || "票",
      quantity: r.quantity,
      unit_price: r.unit_price,
      tax_rate: r.tax_rate,
      currency: r.currency || "CNY",
      exchange_rate: r.exchange_rate || 1,
      remark: r.remark || "",
      status: "草稿",
    }));
  };

  // 复制成应付：把选中的应收行镜像到应付
  const copyArToAp = (rowIds) => {
    const ids = new Set(rowIds);
    const src = arRows.filter(r => ids.has(r.id || r._id));
    const drafts = mirrorRowsToOther(src, "应付");
    if (drafts.length === 0) return;
    setApRows(p => [...p, ...drafts]);
    setSelectedAr(new Set());
  };

  // 复制成应收：把选中的应付行镜像到应收
  const copyApToAr = (rowIds) => {
    const ids = new Set(rowIds);
    const src = apRows.filter(r => ids.has(r.id || r._id));
    const drafts = mirrorRowsToOther(src, "应收");
    if (drafts.length === 0) return;
    setArRows(p => [...p, ...drafts]);
    setSelectedAp(new Set());
  };

  // 复制对侧全部费用到本侧（不要求勾选，过滤掉空草稿）
  const copyOtherSide = (targetDirection) => {
    const sourceRows = targetDirection === "应收" ? apRows : arRows;
    const usable = sourceRows.filter(r => r.charge_item_id && !r._draft || (r.charge_item_id && r.unit_price));
    if (usable.length === 0) {
      alert(`没有${targetDirection === "应收" ? "应付" : "应收"}费用可以复制`);
      return;
    }
    if (!confirm(`将 ${usable.length} 条${targetDirection === "应收" ? "应付" : "应收"}费用复制到${targetDirection}？\n（结算单位会清空，需要重新选择）`)) return;
    const drafts = mirrorRowsToOther(usable, targetDirection);
    if (targetDirection === "应收") setArRows(p => [...p, ...drafts]);
    else setApRows(p => [...p, ...drafts]);
  };

  // 批量改字段（仅本地状态；保存按钮统一持久化）
  const batchUpdateField = (direction, rowIds, patch) => {
    const ids = new Set(rowIds);
    const setter = direction === "应收" ? setArRows : setApRows;
    setter(prev => prev.map(r => {
      const id = r.id || r._id;
      if (!ids.has(id)) return r;
      const next = { ...r, ...patch, _dirty: true };
      // 币种变化时同步默认汇率（除非 patch 同时给了 exchange_rate）
      if (patch.currency && patch.currency !== r.currency && patch.exchange_rate === undefined) {
        next.exchange_rate = rates[patch.currency] || 1;
      }
      return next;
    }));
  };

  // ─── 工具栏功能 ──────────────────────────────────────────────────
  // 把一组源行（已存 charge 或模板 item 等）转成本票 AR/AP 的草稿行
  // 仅取展示/计算字段，不带 id/shipment_id/bill_id 等本票相关 ID
  function rowsToDrafts(srcRows, direction) {
    return srcRows.map((r, i) => ({
      _draft: true,
      _id: "draft-" + Date.now() + "-" + Math.random().toString(36).slice(2) + "-" + i,
      direction,
      charge_item_id: r.charge_item_id || "",
      partner_id: r.partner_id || "",
      partner_name: r.partner_name || "",
      unit: r.unit || "票",
      quantity: r.quantity ?? 1,
      unit_price: r.unit_price ?? "",
      tax_rate: r.tax_rate ?? 0,
      currency: r.currency || "CNY",
      exchange_rate: r.exchange_rate || rates[r.currency || "CNY"] || 1,
      remark: r.remark || "",
      status: "草稿",
    }));
  }

  // 导出当前 AR/AP 为 Excel（两个 sheet）
  const exportExcel = async () => {
    const XLSX = await import("xlsx");
    const ciMap = Object.fromEntries(chargeItems.map(c => [c.id, c]));
    const pMap = Object.fromEntries(partners.map(p => [p.id, p]));
    const toAoa = (rows) => {
      const header = ["费用名称", "结算单位", "计费单位", "数量", "单价", "币种", "汇率", "税率%", "原币合计", "折 CNY", "备注", "状态", "账单号"];
      const body = rows.filter(r => !r._draft || (r.charge_item_id && r.unit_price)).map(r => [
        ciMap[r.charge_item_id]?.name_zh || "",
        pMap[r.partner_id]?.name || r.partner_name || "",
        r.unit || "",
        Number(r.quantity) || 0,
        Number(r.unit_price) || 0,
        r.currency || "CNY",
        Number(r.exchange_rate) || 1,
        Number(r.tax_rate) || 0,
        Number(r.amount_total) || (Number(r.quantity) || 0) * (Number(r.unit_price) || 0),
        Number(r.amount_cny) || 0,
        r.remark || "",
        r.status || "草稿",
        billMap[r.bill_id]?.bill_no || "",
      ]);
      return [header, ...body];
    };
    const wb = XLSX.utils.book_new();
    const wsAr = XLSX.utils.aoa_to_sheet(toAoa(arRows));
    const wsAp = XLSX.utils.aoa_to_sheet(toAoa(apRows));
    wsAr["!cols"] = wsAp["!cols"] = [18, 24, 10, 8, 10, 8, 8, 8, 12, 12, 18, 8, 14].map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, wsAr, "应收");
    XLSX.utils.book_append_sheet(wb, wsAp, "应付");
    const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
    const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `费用_${order.order_no || order.id}.xlsx`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // 打印费用清单：新标签页打开 print 路由
  const printCharges = () => {
    window.open(`#/print/charges/${order.id}`, "_blank");
  };

  // 应用导入/复制/模板 → 推入草稿
  const appendDrafts = (drafts) => {
    const ar = drafts.filter(d => d.direction === "应收");
    const ap = drafts.filter(d => d.direction === "应付");
    if (ar.length) setArRows(p => [...p, ...ar]);
    if (ap.length) setApRows(p => [...p, ...ap]);
  };

  // 暴露给父组件工具栏调用
  useImperativeHandle(ref, () => ({
    exportExcel,
    print: printCharges,
    openImport: () => setImportOpen(true),
    openCopyFromShipment: () => setCopyOpen(true),
    openApplyTemplate: () => setApplyTplOpen(true),
    openSaveAsTemplate: () => setSaveTplOpen(true),
  }), [arRows, apRows, chargeItems, partners, billMap, order?.id, order?.order_no]);

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
    return arRows.some(r => r._draft || r._dirty) || apRows.some(r => r._draft || r._dirty);
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

          <div style={{ marginLeft: "auto", display: "flex", gap: 6, position: "relative" }}>
            {canEdit && (
              <>
                <button onClick={() => addBlankRow(direction)} style={btnSmallPrimary(color.text)}>+ 费用名称</button>
                <button
                  onClick={() => copyOtherSide(direction)}
                  style={btnSmallPrimary("#722ed1")}
                  title={`将所有${direction === "应收" ? "应付" : "应收"}费用复制到此处（结算单位需重选）`}
                >
                  ⎘ 复制{direction === "应收" ? "应付" : "应收"}
                </button>
                {selected.size > 0 && (
                  <>
                    <button onClick={() => createBill(direction)} style={btnSmallPrimary("#13c2c2")}>
                      创建账单 ({selected.size})
                    </button>
                    <BatchOpsMenu
                      direction={direction}
                      open={batchMenuOpen === direction}
                      onToggle={() => setBatchMenuOpen(prev => prev === direction ? null : direction)}
                      onClose={() => setBatchMenuOpen(null)}
                      selectedCount={selected.size}
                      selectedHasBound={selectedHasBound}
                      onDelete={() => deleteRows(direction, [...selected])}
                      onUnbind={() => unbindBill(direction)}
                      onCopyToOther={() => direction === "应收" ? copyArToAp([...selected]) : copyApToAr([...selected])}
                      onModifyPartner={() => setBatchModal({ direction, action: "partner", rowIds: [...selected] })}
                      onModifyCurrency={() => setBatchModal({ direction, action: "currency", rowIds: [...selected] })}
                      onModifyRate={() => setBatchModal({ direction, action: "rate", rowIds: [...selected] })}
                    />
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
              <th style={{ width: 22, textAlign: "center" }} title="拖动排序"></th>
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
              <tr><td colSpan={17} style={{ textAlign: "center", padding: 20, color: "#999" }}>
                暂无{direction}，点上方「+ 费用名称」添加
              </td></tr>
            ) : rows.map((r, idx) => {
              const rowId = r.id || r._id;
              const isSelected = selected.has(rowId);
              const isDraft = !!r._draft;
              const lockedByBill = isRowLockedByBill(r);    // 已开票/已结算账单锁定
              const rowEditable = canEdit && !lockedByBill;   // 整行是否可编辑
              const rowBill = r.bill_id ? billMap[r.bill_id] : null;
              const dragEnabled = rowEditable;
              return (
                <tr key={rowId}
                  onDragOver={onDragOver}
                  onDrop={() => onDrop(direction, rowId)}
                  style={{
                    background: isDraft ? "#fff8e9"
                              : lockedByBill ? "#f5f5f5"
                              : isSelected ? "#e6f4ff" : undefined,
                    opacity: lockedByBill ? 0.85 : 1,
                  }}>
                  <td
                    draggable={dragEnabled}
                    onDragStart={dragEnabled ? () => onDragStart(rowId) : undefined}
                    onDragEnd={() => setDraggingId(null)}
                    style={{
                      textAlign: "center",
                      cursor: dragEnabled ? "grab" : "not-allowed",
                      color: "#bbb",
                      userSelect: "none",
                      fontSize: 13,
                    }}
                    title={dragEnabled ? "拖动排序" : (lockedByBill ? "已绑定账单，不能排序" : "")}
                  >⋮⋮</td>
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
                <td colSpan={12} style={{ textAlign: "right", color: color.text }}>合计 (CNY):</td>
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

      {/* 批量编辑模态：修改结算单位 / 币种 / 汇率 */}
      {batchModal && (
        <BatchEditModal
          {...batchModal}
          partners={partners}
          rates={rates}
          onCreatePartner={handleCreatePartner}
          onApply={(patch) => { batchUpdateField(batchModal.direction, batchModal.rowIds, patch); setBatchModal(null); }}
          onClose={() => setBatchModal(null)}
        />
      )}

      {/* 工具栏调起的 modal */}
      {importOpen && (
        <ChargeImportModal
          chargeItems={chargeItems}
          partners={partners}
          rates={rates}
          onClose={() => setImportOpen(false)}
          onConfirm={(drafts) => { appendDrafts(drafts); setImportOpen(false); }}
          onChargeItemsRefresh={async () => {
            const { data: ci } = await supabase
              .from("charge_items").select("id, code, name_zh, name_en, sort").eq("active", true).order("sort");
            setChargeItems(ci || []);
          }}
        />
      )}
      {copyOpen && (
        <ChargeCopyFromShipmentModal
          currentShipmentId={order.id}
          chargeItems={chargeItems}
          partners={partners}
          rowsToDrafts={rowsToDrafts}
          onClose={() => setCopyOpen(false)}
          onConfirm={(drafts) => { appendDrafts(drafts); setCopyOpen(false); }}
        />
      )}
      {applyTplOpen && (
        <ChargeTemplateApplyModal
          defaultPartnerId={partners.find(p => p.name === order?.customer)?.id || ""}
          chargeItems={chargeItems}
          partners={partners}
          rates={rates}
          rowsToDrafts={rowsToDrafts}
          onClose={() => setApplyTplOpen(false)}
          onConfirm={(drafts) => { appendDrafts(drafts); setApplyTplOpen(false); }}
        />
      )}
      {saveTplOpen && (
        <ChargeTemplateSaveModal
          arRows={arRows.filter(r => !r._draft || (r.charge_item_id && r.unit_price))}
          apRows={apRows.filter(r => !r._draft || (r.charge_item_id && r.unit_price))}
          chargeItems={chargeItems}
          partners={partners}
          defaultPartnerId={partners.find(p => p.name === order?.customer)?.id || ""}
          userId={user.id}
          onClose={() => setSaveTplOpen(false)}
        />
      )}
    </div>
  );
}

// 批量操作下拉菜单
function BatchOpsMenu({ direction, open, onToggle, onClose, selectedCount, selectedHasBound,
                       onDelete, onUnbind, onCopyToOther, onModifyPartner, onModifyCurrency, onModifyRate }) {
  const wrapRef = useRef(null);
  useEffect(() => {
    if (!open) return;
    const fn = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) onClose(); };
    document.addEventListener("mousedown", fn);
    return () => document.removeEventListener("mousedown", fn);
  }, [open, onClose]);

  const item = (label, onClick, opts = {}) => (
    <div
      key={label}
      onClick={() => { if (opts.disabled) return; onClick(); onClose(); }}
      style={{
        padding: "7px 14px", fontSize: 12, cursor: opts.disabled ? "not-allowed" : "pointer",
        color: opts.disabled ? "#ccc" : (opts.danger ? "#cf1322" : "#333"),
        whiteSpace: "nowrap",
      }}
      onMouseEnter={e => { if (!opts.disabled) e.currentTarget.style.background = "#f5f5f5"; }}
      onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
    >
      {label}
    </div>
  );

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <button onClick={onToggle} style={btnSmallPrimary("#1990ff")}>
        批量操作 ({selectedCount}) ▾
      </button>
      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", right: 0, zIndex: 200,
          background: "#fff", border: "1px solid #d9d9d9", borderRadius: 4,
          boxShadow: "0 2px 8px rgba(0,0,0,.12)", minWidth: 160,
        }}>
          {item("修改结算单位", onModifyPartner)}
          {item("修改币种", onModifyCurrency)}
          {item("修改汇率", onModifyRate)}
          {item(direction === "应收" ? "复制成应付" : "复制成应收", onCopyToOther)}
          {item("解绑账单", onUnbind, { disabled: !selectedHasBound })}
          <div style={{ height: 1, background: "#f0f0f0", margin: "4px 0" }} />
          {item("删除", onDelete, { danger: true })}
        </div>
      )}
    </div>
  );
}

// 批量编辑模态（修改结算单位/币种/汇率）
function BatchEditModal({ direction, action, rowIds, partners, rates, onCreatePartner, onApply, onClose }) {
  const [partnerId, setPartnerId] = useState("");
  const [currency, setCurrency] = useState("CNY");
  const [rate, setRate] = useState("1");

  const partnerFilter = direction === "应收"
    ? ["客户", "海外代理"]
    : ["供应商", "船东", "海外代理", "车队", "报关行", "仓库"];
  const partnerOptions = partners.filter(p => partnerFilter.includes(p.partner_type));
  const defaultPartnerType = direction === "应收" ? "客户" : "供应商";

  const titleMap = { partner: "修改结算单位", currency: "修改币种", rate: "修改汇率" };
  const apply = () => {
    if (action === "partner") {
      if (!partnerId) { alert("请选择结算单位"); return; }
      const p = partners.find(x => x.id === partnerId);
      onApply({ partner_id: partnerId, partner_name: p?.name || "" });
    } else if (action === "currency") {
      onApply({ currency });
    } else if (action === "rate") {
      const v = parseFloat(rate);
      if (!Number.isFinite(v) || v <= 0) { alert("汇率需为正数"); return; }
      onApply({ exchange_rate: v });
    }
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", zIndex: 1000,
      display: "flex", alignItems: "center", justifyContent: "center",
    }} onClick={onClose}>
      <div style={{
        background: "#fff", borderRadius: 6, minWidth: 360, padding: 18,
        boxShadow: "0 4px 24px rgba(0,0,0,.2)",
      }} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 14, color: "#1f3864" }}>
          {titleMap[action]}（应用到 {rowIds.length} 条）
        </div>

        {action === "partner" && (
          <PartnerCombo
            value={partnerId}
            options={partnerOptions}
            defaultPartnerType={defaultPartnerType}
            onChange={setPartnerId}
            onCreateNew={onCreatePartner}
          />
        )}
        {action === "currency" && (
          <select value={currency} onChange={e => setCurrency(e.target.value)}
            style={{ width: "100%", padding: "6px 8px", fontSize: 12, border: "1px solid #d9d9d9", borderRadius: 3 }}>
            {CURRENCIES.map(c => <option key={c}>{c}</option>)}
          </select>
        )}
        {action === "rate" && (
          <input type="number" step="0.0001" value={rate} onChange={e => setRate(e.target.value)}
            placeholder="例如 7.20"
            style={{ width: "100%", padding: "6px 8px", fontSize: 12, border: "1px solid #d9d9d9", borderRadius: 3 }} />
        )}

        <div style={{ marginTop: 8, fontSize: 10, color: "#999" }}>
          {action === "currency" && (rates[currency] ? `当前默认汇率：${rates[currency]} → CNY` : "（无默认汇率，将设为 1）")}
          {action === "partner" && "应用后保存按钮才会持久化到数据库。"}
        </div>

        <div style={{ marginTop: 18, display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onClose} style={{ padding: "5px 14px", border: "1px solid #d9d9d9", background: "#fff", borderRadius: 3, fontSize: 12, cursor: "pointer" }}>取消</button>
          <button onClick={apply} style={{ ...btnSmallPrimary("#1990ff"), padding: "5px 14px" }}>应用</button>
        </div>
      </div>
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
      .select("name, name_short, name_en, code, partner_type, active")
      .eq("active", true)
      .then(({ data }) => {
        const all = data || [];
        // 客户的 ComboBox 用富对象（带 name_short/name_en/code 做别名搜索）
        const toRich = (c) => ({
          value: c.name,
          aliases: [c.name_short, c.name_en, c.code].filter(Boolean),
        });
        setRefData({
          customers: all.filter(c => c.partner_type === "客户").map(toRich),
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
    if (form.qty_container?.trim() && !isValidQtyContainer(form.qty_container)) {
      alert("箱型箱量 格式不对，应为 数量x箱型 例如 1x40HQ 或 2x20GP,1x40HQ");
      return false;
    }
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
                <input value={form.vessel} onChange={e => set("vessel", liveUpper(e.target.value))} placeholder="例如 EMMA MAERSK" />
              </div></div>
              <div className="tms-df"><label>航次</label><div className="tms-df-blk">
                <input value={form.voyage} onChange={e => set("voyage", liveUpper(e.target.value))} placeholder="例如 619W" />
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
// ═══════════════════════════════════════════════════════════════
// ConfirmStep — 工具栏流程确认按钮
// 字段未填时显示"XX确认"，点击 confirm → 写时间戳 / 日期；
// 字段已填时显示"✓ 已XX (date)" 不可点
// type="date" 时弹日期选择（开船用，写 atd 字段——BL 用作 Loading on Board Date）
// type 默认是 timestamp，stamp now()
// ═══════════════════════════════════════════════════════════════
function ConfirmStep({ field, label, type = "timestamp", defaultFrom, order, updateField, isLocked }) {
  const v = order?.[field];
  const fmtDate = (s) => {
    if (!s) return "";
    const d = new Date(s);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  if (v) {
    return <Mi disabled>✓ 已{label} {fmtDate(v)}</Mi>;
  }
  const onClick = () => {
    if (type === "date") {
      const today = new Date().toISOString().slice(0, 10);
      const def = order?.[defaultFrom] || today;
      const date = prompt(`${label}日期 (YYYY-MM-DD)：`, def);
      if (!date) return;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { alert("日期格式错误，必须是 YYYY-MM-DD"); return; }
      updateField(field, date);
    } else {
      if (!confirm(`确认${label}？\n\n会记录当前时间。`)) return;
      updateField(field, new Date().toISOString());
    }
  };
  return <Mi disabled={isLocked} onClick={onClick}>{label}确认</Mi>;
}

// ═══════════════════════════════════════════════════════════════
// ProfitModal — 内部利润分析
// 拉本票（如果是自拼母单，包含所有分票）的 charges 行
// 按 direction (AR/AP) × currency 分组合计，AR-AP = 利润
// ═══════════════════════════════════════════════════════════════
function ProfitModal({ open, onClose, shipment, isMaster, subTickets }) {
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);

  useEffect(() => {
    if (!open || !shipment?.id) return;
    setLoading(true);
    const ids = [shipment.id, ...(isMaster ? subTickets.map(s => s.id) : [])];
    supabase.from("charges").select("direction, currency, amount_total, amount_cny, partner_name")
      .in("shipment_id", ids)
      .then(({ data }) => {
        setRows(data || []);
        setLoading(false);
      });
  }, [open, shipment?.id, isMaster, subTickets]);

  if (!open) return null;

  // 按 direction × currency 分组
  const groups = {};   // { 'AR': { CNY: 0, USD: 0 }, 'AP': { ... } }
  let arCny = 0, apCny = 0;
  for (const c of rows) {
    const dir = c.direction || "?";
    const cur = c.currency || "?";
    if (!groups[dir]) groups[dir] = {};
    groups[dir][cur] = (groups[dir][cur] || 0) + (Number(c.amount_total) || 0);
    const cny = Number(c.amount_cny) || 0;
    if (dir === "AR") arCny += cny;
    else if (dir === "AP") apCny += cny;
  }
  const profit = arCny - apCny;
  const allCurrencies = new Set();
  Object.values(groups).forEach(g => Object.keys(g).forEach(c => allCurrencies.add(c)));

  const numFmt = (n) => Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.4)", display: "flex",
                  alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={onClose}>
      <div style={{ width: "min(640px, 95vw)", maxHeight: "90vh", background: "#fff", borderRadius: 6,
                    boxShadow: "0 6px 30px rgba(0,0,0,.2)", display: "flex", flexDirection: "column" }}
           onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", padding: "10px 16px", borderBottom: "1px solid #eee" }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>📊 内部利润分析</div>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ padding: "4px 12px" }}>关闭</button>
        </div>
        <div style={{ padding: 16, overflow: "auto", flex: 1 }}>
          {loading ? (
            <div style={{ padding: 24, textAlign: "center", color: "#888" }}>加载中…</div>
          ) : rows.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", color: "#888" }}>本票暂无费用</div>
          ) : (
            <>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "#f5f5f5" }}>
                    <th style={{ padding: 6, border: "1px solid #ddd", textAlign: "left" }}>方向</th>
                    {[...allCurrencies].sort().map(cur => (
                      <th key={cur} style={{ padding: 6, border: "1px solid #ddd", textAlign: "right", fontFamily: "Consolas,monospace" }}>{cur}</th>
                    ))}
                    <th style={{ padding: 6, border: "1px solid #ddd", textAlign: "right", background: "#e6f4ff" }}>CNY 合计</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={{ padding: 6, border: "1px solid #ddd", fontWeight: 600, color: "#1990ff" }}>应收 (AR)</td>
                    {[...allCurrencies].sort().map(cur => (
                      <td key={cur} style={{ padding: 6, border: "1px solid #ddd", textAlign: "right", fontFamily: "Consolas,monospace" }}>
                        {groups.AR?.[cur] ? numFmt(groups.AR[cur]) : "—"}
                      </td>
                    ))}
                    <td style={{ padding: 6, border: "1px solid #ddd", textAlign: "right", fontFamily: "Consolas,monospace", background: "#e6f4ff", fontWeight: 600 }}>
                      {numFmt(arCny)}
                    </td>
                  </tr>
                  <tr>
                    <td style={{ padding: 6, border: "1px solid #ddd", fontWeight: 600, color: "#c00" }}>应付 (AP)</td>
                    {[...allCurrencies].sort().map(cur => (
                      <td key={cur} style={{ padding: 6, border: "1px solid #ddd", textAlign: "right", fontFamily: "Consolas,monospace" }}>
                        {groups.AP?.[cur] ? numFmt(groups.AP[cur]) : "—"}
                      </td>
                    ))}
                    <td style={{ padding: 6, border: "1px solid #ddd", textAlign: "right", fontFamily: "Consolas,monospace", background: "#fff3e6", fontWeight: 600 }}>
                      {numFmt(apCny)}
                    </td>
                  </tr>
                  <tr style={{ background: profit >= 0 ? "#f6ffed" : "#fff1f0" }}>
                    <td style={{ padding: 8, border: "1px solid #ddd", fontWeight: 700 }}>利润 (AR − AP)</td>
                    <td colSpan={allCurrencies.size} style={{ padding: 8, border: "1px solid #ddd", color: "#888", fontSize: 11 }}>
                      按 amount_cny（已折算 CNY）计算
                    </td>
                    <td style={{ padding: 8, border: "1px solid #ddd", textAlign: "right",
                                 fontFamily: "Consolas,monospace", fontWeight: 700, fontSize: 14,
                                 color: profit >= 0 ? "#52c41a" : "#c00" }}>
                      {profit >= 0 ? "+" : ""}{numFmt(profit)}
                    </td>
                  </tr>
                </tbody>
              </table>
              <div style={{ marginTop: 10, fontSize: 11, color: "#888" }}>
                {isMaster
                  ? `已聚合母单 + ${subTickets.length} 个分票的全部费用（共 ${rows.length} 条）`
                  : `本票共 ${rows.length} 条费用`}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function PortRow({ label, required, value, onChange, disabled, title }) {
  return (
    <div style={{ ...tmStyles.subSection, ...tmStyles.row }} title={title}>
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

// ═══════════════════════════════════════════════════════════════
// CopyPartiesModal — 抄录历史 shipper/consignee/notify_party
// 查询：同 customer (+ 同 overseas_agent 优先)的最近订单，按 etd/created_at 倒序
// ═══════════════════════════════════════════════════════════════
function CopyPartiesModal({ open, onClose, currentShipmentId, customer, overseasAgent, onPick }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [scope, setScope] = useState("strict");  // strict = 同客户+同代理；loose = 仅同客户

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    (async () => {
      let q = supabase.from("shipments")
        .select("id, order_no, etd, created_at, customer, overseas_agent, shipper, consignee, notify_party")
        .eq("customer", customer || "")
        .not("shipper", "is", null)
        .neq("id", currentShipmentId || "00000000-0000-0000-0000-000000000000")
        .order("created_at", { ascending: false })
        .limit(20);
      if (scope === "strict" && overseasAgent) {
        q = q.eq("overseas_agent", overseasAgent);
      }
      const { data } = await q;
      setRows(data || []);
      setLoading(false);
    })();
  }, [open, scope, customer, overseasAgent, currentShipmentId]);

  if (!open) return null;

  const overlay = {
    position: "fixed", inset: 0, background: "rgba(0,0,0,.35)", zIndex: 200,
    display: "flex", alignItems: "center", justifyContent: "center",
  };
  const box = {
    background: "#fff", borderRadius: 6, width: "min(900px, 95vw)",
    maxHeight: "85vh", display: "flex", flexDirection: "column",
    boxShadow: "0 10px 40px rgba(0,0,0,.2)",
  };
  const head = {
    padding: "12px 18px", borderBottom: "1px solid #e8e8e8",
    display: "flex", justifyContent: "space-between", alignItems: "center",
    background: "linear-gradient(#fafafa,#f0f0f0)",
  };

  const truncate = (s, n = 60) => {
    if (!s) return "—";
    const oneLine = s.replace(/\s+/g, " ").trim();
    return oneLine.length > n ? oneLine.slice(0, n) + "..." : oneLine;
  };

  return (
    <div onClick={onClose} style={overlay}>
      <div onClick={e => e.stopPropagation()} style={box}>
        <div style={head}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>📋 抄录 shipper / consignee / notify</span>
          <button onClick={onClose} style={{ border: "none", background: "transparent", fontSize: 18, cursor: "pointer", color: "#999" }}>×</button>
        </div>

        <div style={{ padding: "10px 18px", borderBottom: "1px solid #f0f0f0", fontSize: 12, color: "#666", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <span>委托单位：<b>{customer || "—"}</b></span>
          {overseasAgent && <span>· 海外代理：<b>{overseasAgent}</b></span>}
          <label style={{ marginLeft: "auto" }}>
            <input type="radio" checked={scope === "strict"} onChange={() => setScope("strict")} />
            <span style={{ marginLeft: 4 }}>同委托+同代理</span>
          </label>
          <label>
            <input type="radio" checked={scope === "loose"} onChange={() => setScope("loose")} />
            <span style={{ marginLeft: 4 }}>仅同委托</span>
          </label>
        </div>

        <div style={{ overflowY: "auto", flex: 1 }}>
          {loading ? (
            <div style={{ padding: 30, textAlign: "center", color: "#888" }}>加载中...</div>
          ) : rows.length === 0 ? (
            <div style={{ padding: 30, textAlign: "center", color: "#888" }}>
              没找到同{scope === "strict" ? "委托+代理" : "委托"}的历史订单
              {scope === "strict" && overseasAgent && <div style={{ fontSize: 11, marginTop: 4 }}>试试切换到"仅同委托"</div>}
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <thead style={{ background: "#fafafa", position: "sticky", top: 0 }}>
                <tr>
                  <th style={{ padding: "8px 10px", textAlign: "left", borderBottom: "1px solid #e8e8e8", width: 140 }}>订单号</th>
                  <th style={{ padding: "8px 10px", textAlign: "left", borderBottom: "1px solid #e8e8e8", width: 90 }}>ETD</th>
                  <th style={{ padding: "8px 10px", textAlign: "left", borderBottom: "1px solid #e8e8e8" }}>SHIPPER</th>
                  <th style={{ padding: "8px 10px", textAlign: "left", borderBottom: "1px solid #e8e8e8" }}>CONSIGNEE</th>
                  <th style={{ padding: "8px 10px", borderBottom: "1px solid #e8e8e8", width: 70 }}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                    <td style={{ padding: "8px 10px", fontFamily: "Consolas,monospace" }}>
                      <a href={`#/sea_export?id=${r.id}`} target="_blank" rel="noopener" className="lk" style={{ color: "#1990FF" }}>
                        {r.order_no}
                      </a>
                    </td>
                    <td style={{ padding: "8px 10px", color: "#666" }}>{r.etd ? r.etd.slice(0, 10) : "—"}</td>
                    <td style={{ padding: "8px 10px", fontFamily: "Consolas,monospace", color: "#333" }} title={r.shipper}>
                      {truncate(r.shipper)}
                    </td>
                    <td style={{ padding: "8px 10px", fontFamily: "Consolas,monospace", color: "#333" }} title={r.consignee}>
                      {truncate(r.consignee)}
                    </td>
                    <td style={{ padding: "8px 10px", textAlign: "center" }}>
                      <button onClick={() => onPick(r)}
                              style={{
                                padding: "4px 10px", fontSize: 11, fontWeight: 600,
                                border: "1px solid #1990FF", background: "#e6f4ff",
                                color: "#1990FF", borderRadius: 3, cursor: "pointer",
                              }}>抄录 ↓</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div style={{ padding: "10px 18px", borderTop: "1px solid #e8e8e8", fontSize: 11, color: "#888", textAlign: "center" }}>
          点「抄录」会把该订单的 shipper / consignee / notify_party 三个字段一起复制到当前订单。点订单号可在新 tab 打开原单。
        </div>
      </div>
    </div>
  );
}
