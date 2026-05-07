// ═══════════════════════════════════════════════════════════════
// Bansar OPS - 门户首页
// - 顶部蓝条 + 左侧 模块/待办 切换 + 中间主区
// - "模块" tab：4 阶段流程图，点节点新 tab 打开页面
// - "待办" tab：SOP 节点列表 + 未完成数量（实时查 Supabase），点击 → 列表过滤页
// ═══════════════════════════════════════════════════════════════

import { useState, useEffect, useRef, Fragment } from "react";
import { supabase } from "../supabase.js";
import { SOP_NODES, isNodeDone } from "../lib/constants.js";

// ── 模块定义（左侧菜单） ──
const MODULES = [
  { key: "sea_export",  zh: "海运出口", icon: "ship",     active: true,  href: "#/sea_export" },
  { key: "sea_import",  zh: "海运进口", icon: "ship",     active: false },
  { key: "air_export",  zh: "空运出口", icon: "plane",    active: false },
  { key: "air_import",  zh: "空运进口", icon: "plane",    active: false },
  { key: "finance",     zh: "财务管理", icon: "dollar",   active: true  },
  { key: "partners",    zh: "客商管理", icon: "users",    active: true,  href: "#/partners" },
  { key: "master",      zh: "基础数据", icon: "database", active: false },
  { key: "system",      zh: "系统设置", icon: "gear",     active: false },
];

// ── 流程图四阶段定义（"模块" tab 用） ──
// 海运出口模块的流程图（4 阶段）
const STAGES_SEA = [
  { num: 1, name: "基础数据维护", active: false },
  { num: 2, name: "业务操作",     active: true  },
  { num: 3, name: "费用结算",     active: false },
  { num: 4, name: "统计报表",     active: false },
];

const NODES_SEA = {
  1: [
    { name: "客商录入维护", icon: "users",    href: "#/partners" },
    { name: "业务类型设置", icon: "tag",      href: null },
    { name: "费用项维护",   icon: "circle",   href: null },
    { name: "汇率设置",     icon: "refresh",  href: null },
  ],
  2: [
    { name: "新建作业", icon: "fileplus", submenu: [
      { name: "整箱", desc: "FCL", href: "#/sea_export?action=new&type=FCL" },
      { name: "拼箱", desc: "LCL", href: "#/sea_export?action=new&type=LCL" },
      { name: "自拼柜", desc: "Console", href: "#/sea_export?action=new&type=Console" },
    ] },
    { name: "作业列表",     icon: "filelist", href: "#/sea_export" },
    { name: "订舱确认",     icon: "check",    href: "#/sea_export" },
    { name: "装箱确认",     icon: "box",      href: "#/sea_export" },
    { name: "提单确认",     icon: "file",     href: "#/sea_export" },
  ],
  3: [
    { name: "费用录入",     icon: "dollar",   href: "#/charges" },
    { name: "账单管理",     icon: "fileline", href: "#/bills" },
    { name: "对账单管理",   icon: "filelist", href: "#/statements" },
    { name: "开票/收票",    icon: "ticket",   href: "#/invoices" },
    { name: "收款销账",     icon: "rotate",   href: "#/payments" },
  ],
  4: [
    { name: "业务综合查询", icon: "search",   href: null },
    { name: "箱量统计",     icon: "bar",      href: null },
    { name: "利润分析",     icon: "line",     href: null },
    { name: "对账明细",     icon: "filelist", href: null },
  ],
};

// 财务管理模块的流程图（2 阶段）
const STAGES_FINANCE = [
  { num: 1, name: "日常作业", active: true  },
  { num: 2, name: "结算核销", active: false },
];

const NODES_FINANCE = {
  1: [
    { name: "费用记录",     icon: "dollar",   href: "#/charges" },
    { name: "账单管理",     icon: "fileline", href: "#/bills" },
    { name: "对账单管理",   icon: "filelist", href: "#/statements" },
  ],
  2: [
    { name: "开票记录",     icon: "ticket",   href: "#/invoices" },
    { name: "收付款记录",   icon: "dollar",   href: "#/payments" },
    { name: "核销管理",     icon: "rotate",   href: "#/settlements" },
  ],
};

// 模块 → 流程图数据映射
const FLOW_BY_MODULE = {
  sea_export: { stages: STAGES_SEA,     nodes: NODES_SEA     },
  finance:    { stages: STAGES_FINANCE, nodes: NODES_FINANCE },
};

// ── Lucide-style SVG icons ──
const ICONS = {
  logo: <><path d="M3 16l9-13 9 13"/><path d="M3 16l9 5 9-5"/><path d="M3 16v3l9 5 9-5v-3"/></>,
  ship: <><path d="M2 20a2.4 2.4 0 0 0 2 1 2.4 2.4 0 0 0 2-1 2.4 2.4 0 0 1 2-1 2.4 2.4 0 0 1 2 1 2.4 2.4 0 0 0 2 1 2.4 2.4 0 0 0 2-1 2.4 2.4 0 0 1 2-1 2.4 2.4 0 0 1 2 1 2.4 2.4 0 0 0 2 1 2.4 2.4 0 0 0 2-1"/><path d="M19.38 20A11.6 11.6 0 0 0 21 14l-9-4-9 4c0 2.9.94 5.34 2.81 7.76"/><path d="M19 13V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6"/><path d="M12 10v4"/></>,
  plane: <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>,
  dollar: <><line x1="12" y1="2" x2="12" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></>,
  users: <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></>,
  database: <><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/></>,
  gear: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></>,
  fileplus: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></>,
  check: <><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></>,
  box: <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>,
  filelist: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></>,
  file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></>,
  fileline: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="9" y1="13" x2="15" y2="13"/></>,
  ticket: <><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/></>,
  rotate: <><polyline points="9 14 4 9 9 4"/><path d="M20 20v-7a4 4 0 0 0-4-4H4"/></>,
  search: <><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></>,
  bar: <><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></>,
  line: <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>,
  tag: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>,
  circle: <><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></>,
  refresh: <><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></>,
  chevron: <polyline points="6 9 12 15 18 9"/>,
};

function Icon({ name, ...rest }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...rest}>
      {ICONS[name] || null}
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════════
// 主组件
// ═══════════════════════════════════════════════════════════════

export default function Portal({ user, onLogout }) {
  const [activeModule, setActiveModule] = useState("sea_export");
  const [tab, setTab] = useState("模块");
  const [todoCounts, setTodoCounts] = useState({});
  const [sopCollapsed, setSopCollapsed] = useState(false);

  const role = user?.profile?.role || "operator";
  const userName = user?.profile?.name || user?.email?.split("@")[0] || "用户";

  // ── 加载待办数量（每次进入"待办" tab 时刷新） ──
  useEffect(() => {
    if (tab !== "待办") return;
    let cancelled = false;

    (async () => {
      const { data, error } = await supabase
        .from("shipments")
        .select("id, has_hbl, lifecycle, qc_status, space_status, hbl_status, mbl_status, finance_status");

      if (error || cancelled) return;

      const all = (data || []).filter(o => o.lifecycle !== "已关闭" && o.lifecycle !== "已完结");
      const counts = {};
      for (const node of SOP_NODES) {
        if (node.requiresHbl) {
          counts[node.code] = all.filter(o => o.has_hbl && !isNodeDone(node, o[node.field])).length;
        } else {
          counts[node.code] = all.filter(o => !isNodeDone(node, o[node.field])).length;
        }
      }
      setTodoCounts(counts);
    })();

    return () => { cancelled = true; };
  }, [tab]);

  const openModule = (mod) => {
    if (!mod.active) return;
    if (!mod.href) return;
    window.open(mod.href, "_blank");
  };

  // 子菜单浮层：当前展开节点（带 submenu 的节点点击时显示），及其按钮的位置
  const [submenuFor, setSubmenuFor] = useState(null);  // { stage, idx, rect }
  const submenuRef = useRef(null);

  const openNode = (node, stage, idx, ev) => {
    if (node.submenu) {
      // 切换浮层（点同一个再关闭）
      if (submenuFor && submenuFor.stage === stage && submenuFor.idx === idx) {
        setSubmenuFor(null);
      } else {
        const rect = ev.currentTarget.getBoundingClientRect();
        setSubmenuFor({ stage, idx, rect: { left: rect.left, top: rect.bottom + 4, width: rect.width } });
      }
      return;
    }
    if (!node.href) return;
    window.open(node.href, "_blank");
  };

  // 点浮层外关闭
  useEffect(() => {
    if (!submenuFor) return;
    const onDocClick = (e) => {
      if (submenuRef.current && !submenuRef.current.contains(e.target)) {
        setSubmenuFor(null);
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [submenuFor]);

  const openSopNode = (nodeCode) => {
    window.open(`#/sea_export?sop=${nodeCode}`, "_blank");
  };

  return (
    <div className="tms-portal">

      <div className="tms-portal-tb">
        <div className="logo">
          <Icon name="logo" />
          班萨（宁波）国际货运代理有限公司
        </div>
        <div className="ri">
          <span className="mi">{userName}<span className="ar"></span></span>
          <span className="mi">BS（NB）GJ<span className="ar"></span></span>
          <span className="mi">{role === "admin" ? "管理部" : "操作部"}<span className="ar"></span></span>
          <span className="mi">简体中文<span className="ar"></span></span>
          <span className="mi" onClick={onLogout}>退出<span className="ar"></span></span>
        </div>
      </div>

      <div className="tms-portal-body">

        <div className="tms-portal-side">
          <div className="tabs">
            {["模块", "待办"].map(t => (
              <div key={t} className={"tb2 " + (tab === t ? "act" : "")} onClick={() => setTab(t)}>
                {t}
              </div>
            ))}
          </div>
          <div className="list">
            {tab === "模块" && MODULES.map(m => (
              <div
                key={m.key}
                className={"it " + (activeModule === m.key ? "act" : "") + (!m.active ? " disabled" : "")}
                onClick={() => m.active && setActiveModule(m.key)}
                style={!m.active ? { opacity: .5, cursor: "not-allowed" } : {}}
                title={!m.active ? "该模块开发中" : ""}
              >
                <Icon name={m.icon} />
                {m.zh}
              </div>
            ))}

            {tab === "待办" && (
              <div className="tms-portal-todo">
                <div className={"group-head " + (sopCollapsed ? "collapsed" : "")} onClick={() => setSopCollapsed(c => !c)}>
                  <Icon name="chevron" />
                  SOP
                </div>
                {!sopCollapsed && SOP_NODES.map(n => {
                  const cnt = todoCounts[n.code] ?? 0;
                  return (
                    <div key={n.code} className="it-todo" onClick={() => openSopNode(n.code)}>
                      <span>{n.zh}</span>
                      <span className={"badge-num " + (cnt === 0 ? "zero" : "")}>{cnt}</span>
                    </div>
                  );
                })}
                <div className="add-btn" onClick={() => alert("自定义 SOP 节点功能开发中")}>
                  + 添加节点
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="tms-portal-main">
          <div className="tms-portal-bar">
            <div className="tt">
              <Icon name="filelist" />
              {tab === "待办" ? "待办事项" : "操作导航"}
            </div>
            <div className="crumb">
              {tab === "待办"
                ? <>SOP / <span>待处理订单</span></>
                : <>{MODULES.find(m => m.key === activeModule)?.zh || "海运出口"} / <span>{activeModule === "finance" ? "财务流程" : "业务流程"}</span></>}
            </div>
          </div>

          {tab === "模块" && (() => {
            const flow = FLOW_BY_MODULE[activeModule];
            // 当前模块没有流程图（如 partners / 待开发模块）→ 显示提示
            if (!flow) {
              const m = MODULES.find(x => x.key === activeModule);
              return (
                <div style={{ padding: 30, color: "#666", lineHeight: 1.8 }}>
                  <h3 style={{ fontSize: 16, color: "#222", marginBottom: 12 }}>
                    {m?.zh || activeModule}
                  </h3>
                  <p>{m?.active
                    ? <>该模块入口在左侧菜单，<a href={m.href} target="_blank" rel="noreferrer" style={{ color: "#1990FF" }}>点此打开</a>。</>
                    : "该模块开发中。"
                  }</p>
                </div>
              );
            }
            const { stages: STAGES, nodes: NODES } = flow;
            return (
            <div className="tms-portal-flow">
              <div className="tms-stages">
                {STAGES.map((s, i) => (
                  <Fragment key={s.num}>
                    <div className={"tms-stage " + (s.active ? "act" : "")}>
                      <span className="num">{s.num}</span>
                      <span>{s.name}</span>
                    </div>
                    {i < STAGES.length - 1 && <div className="tms-arr">→</div>}
                  </Fragment>
                ))}
              </div>

              <div className="tms-cols">
                {STAGES.map((s, i) => (
                  <Fragment key={s.num}>
                    <div className="tms-col">
                      {NODES[s.num].map((n, ni) => {
                        const clickable = !!n.href || !!n.submenu;
                        const isOpen = submenuFor && submenuFor.stage === s.num && submenuFor.idx === ni;
                        return (
                          <button
                            key={ni}
                            className={"tms-node " + (!clickable ? "dim" : "")}
                            onClick={(ev) => openNode(n, s.num, ni, ev)}
                            disabled={!clickable}
                            style={isOpen ? { background: "#e6f4ff", borderColor: "#1990FF" } : undefined}
                          >
                            <Icon name={n.icon} />
                            {n.name}
                            {n.submenu && <span style={{ marginLeft: 6, fontSize: 10, color: "#999" }}>▾</span>}
                          </button>
                        );
                      })}
                    </div>
                    {i < STAGES.length - 1 && <div className="tms-colarr">→</div>}
                  </Fragment>
                ))}
              </div>
            </div>
            );
          })()}

          {tab === "待办" && (
            <div style={{ padding: 30, color: "#666", lineHeight: 1.8 }}>
              <h3 style={{ fontSize: 16, color: "#222", marginBottom: 12 }}>SOP 节点待办</h3>
              <p style={{ marginBottom: 8 }}>左侧 SOP 列表显示每个节点下"未完成的订单数量"。点击任一节点（如 <b style={{ color: "#1990FF" }}>验货</b>），将在新标签页打开海运出口列表，自动筛选出所有该节点未完成的订单。</p>
              <p style={{ marginBottom: 8, color: "#888", fontSize: 12 }}>· HB 提单节点只统计已勾选「签 HBL」的订单。</p>
              <p style={{ marginBottom: 8, color: "#888", fontSize: 12 }}>· 已完结、已关闭的订单不计入待办。</p>
              <p style={{ marginTop: 24, fontSize: 12, color: "#999" }}>配置入口（添加/编辑 SOP 节点）：开发中。</p>
            </div>
          )}
        </div>

      </div>

      {/* 节点子菜单浮层（如"新建作业"展开整箱/拼箱/自拼柜） */}
      {submenuFor && (() => {
        const flow = FLOW_BY_MODULE[activeModule];
        if (!flow) return null;
        const node = flow.nodes[submenuFor.stage]?.[submenuFor.idx];
        if (!node?.submenu) return null;
        return (
          <div
            ref={submenuRef}
            style={{
              position: "fixed",
              left: submenuFor.rect.left,
              top: submenuFor.rect.top,
              minWidth: Math.max(submenuFor.rect.width, 200),
              background: "#fff",
              border: "1px solid #d9d9d9",
              borderRadius: 4,
              boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
              zIndex: 1000,
              padding: 4,
            }}
          >
            {node.submenu.map((sub, si) => (
              <div
                key={si}
                onClick={() => {
                  setSubmenuFor(null);
                  if (sub.href) window.open(sub.href, "_blank");
                }}
                style={{
                  padding: "8px 12px",
                  cursor: "pointer",
                  borderRadius: 3,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  fontSize: 13,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "#f0f7ff"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                <span style={{ color: "#222" }}>{sub.name}</span>
                {sub.desc && <span style={{ color: "#999", fontSize: 11, marginLeft: 12 }}>{sub.desc}</span>}
              </div>
            ))}
          </div>
        );
      })()}
    </div>
  );
}
