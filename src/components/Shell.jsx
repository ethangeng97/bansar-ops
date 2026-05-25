// Bansar OPS - 新版 Shell（试装 portal 同款皮肤）
// 顶部白条 + 左侧分组侧栏 + 中间内容区
// 不改路由：点侧栏 → 改 hash → App.jsx 现有的路由表识别后渲染
import { useState, useEffect, useMemo } from "react";

// ── 图标 ──
const ICONS = {
  menu:   <><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></>,
  home:   <><path d="M3 12 12 3l9 9"/><path d="M5 10v10h14V10"/></>,
  ship:   <><path d="M2 18a2.4 2.4 0 0 0 2 1 2.4 2.4 0 0 0 2-1 2.4 2.4 0 0 1 2-1 2.4 2.4 0 0 1 2 1 2.4 2.4 0 0 0 2 1 2.4 2.4 0 0 0 2-1 2.4 2.4 0 0 1 2-1 2.4 2.4 0 0 1 2 1 2.4 2.4 0 0 0 2 1 2.4 2.4 0 0 0 2-1"/><path d="M19.4 18A11.6 11.6 0 0 0 21 12l-9-4-9 4c0 2.9.9 5.3 2.8 7.8"/><path d="M19 11V5a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6"/></>,
  wallet: <><path d="M21 12V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-2"/><circle cx="17" cy="12" r="2"/></>,
  chart:  <><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></>,
  db:     <><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/></>,
  gear:   <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.65 1.65 0 0 0 15 19.4a1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></>,
  users:  <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></>,
  chev:   <polyline points="6 9 12 15 18 9"/>,
};
function Icon({ name, size = 16, className }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      {ICONS[name] || null}
    </svg>
  );
}

// ── Nav 配置 ──（对应现有 hash 路由）
const NAV = [
  { key: "",                  label: "工作台",        icon: "home" },
  {
    label: "业务",
    icon: "ship",
    children: [
      { key: "sea_export",      label: "海运出口订单" },
      { key: "spot_export",     label: "海运出口现舱" },
      { key: "partners",        label: "客商管理" },
    ],
  },
  {
    label: "费用 / 账单",
    icon: "wallet",
    children: [
      { key: "charges",         label: "费用录入" },
      { key: "bills",           label: "账单管理" },
      { key: "statements",      label: "对账单管理" },
      { key: "import-statement",label: "导入对账单" },
    ],
  },
  {
    label: "财务",
    icon: "wallet",
    children: [
      { key: "invoices",        label: "开票 / 收票" },
      { key: "payments",        label: "收付款记录" },
      { key: "settlements",     label: "核销管理" },
    ],
  },
  {
    label: "报表",
    icon: "chart",
    children: [
      { key: "profit-analysis", label: "利润分析" },
    ],
  },
  {
    label: "基础数据",
    icon: "db",
    children: [
      { key: "charge_types",    label: "费用项" },
      { key: "exchange_rates",  label: "汇率" },
    ],
  },
];

// ── Shell 主组件 ──
export default function Shell({ user, onLogout, children, currentRoute }) {
  const [collapsed, setCollapsed] = useState(false);
  const userName = user?.profile?.name || user?.email?.split("@")[0] || "用户";
  const role = user?.profile?.role || "operator";

  // 折叠状态
  const groupKey = `ops_nav_groups`;
  const [openGroups, setOpenGroups] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(groupKey) || "[]")); }
    catch { return new Set(); }
  });
  const toggleGroup = (label) => {
    setOpenGroups(prev => {
      const next = new Set(prev);
      next.has(label) ? next.delete(label) : next.add(label);
      try { localStorage.setItem(groupKey, JSON.stringify([...next])); } catch {}
      return next;
    });
  };
  // 默认全部展开
  useEffect(() => {
    if (openGroups.size > 0) return;
    const labels = NAV.filter(n => n.children).map(n => n.label);
    setOpenGroups(new Set(labels));
    try { localStorage.setItem(groupKey, JSON.stringify(labels)); } catch {}
    // eslint-disable-next-line
  }, []);

  const go = (key) => { window.location.hash = key ? `#/${key}` : ""; };

  return (
    <div className="shell">
      <header className="shell-top">
        <button className="hamburger" onClick={() => setCollapsed(c => !c)}>
          <Icon name="menu" size={18} />
        </button>
        <div className="brand">
          <span className="logo-mark">B</span>
          班萨货运 OPS
        </div>
        <div className="spacer" />
        <div className="top-right">
          <span className="user-info">{userName}</span>
          <span className="role-pill">{role}</span>
          <button className="logout" onClick={onLogout}>退出</button>
        </div>
      </header>

      <div className="shell-body">
        <aside className={"shell-side" + (collapsed ? " collapsed" : "")}>
          {NAV.map((item, i) => {
            if (item.children) {
              const isOpen = openGroups.has(item.label);
              return (
                <div key={i}>
                  <div className={"group-head " + (isOpen ? "" : "collapsed")} onClick={() => toggleGroup(item.label)}>
                    <span>{item.label}</span>
                    <Icon name="chev" size={12} className="chev" />
                  </div>
                  {isOpen && item.children.map(child => (
                    <NavItem key={child.key} item={child} isChild
                             active={currentRoute === child.key}
                             onClick={() => go(child.key)} />
                  ))}
                </div>
              );
            }
            return (
              <NavItem key={item.key || i} item={item}
                       active={currentRoute === item.key}
                       onClick={() => go(item.key)} />
            );
          })}
        </aside>

        <main className="shell-main">
          <div className="shell-content">
            <div className="shell-page">
              {children}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

function NavItem({ item, active, onClick, isChild }) {
  return (
    <div className={"nav-item" + (isChild ? " child" : "") + (active ? " active" : "")}
         onClick={onClick} title={item.label}>
      <Icon name={item.icon || (isChild ? "" : "ship")} className="icon" />
      <span className="label">{item.label}</span>
    </div>
  );
}
