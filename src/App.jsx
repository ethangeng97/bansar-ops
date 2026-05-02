import { useState, useEffect } from "react";
import { supabase } from "./supabase.js";
import { OrdersPage } from "./pages/Orders.jsx";
import { DashboardPage } from "./pages/Dashboard.jsx";
import { setLang } from "./lib/i18n.js";
import { Spinner } from "./components/ui.jsx";

// ── SVG Icon paths (stroke-based, 24x24 viewBox) ────────────────
const ICONS = {
  dashboard: "M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z M9 22V12h6v10",
  shipment: "M2 7h20v14H2z M6 7V4a2 2 0 012-2h8a2 2 0 012 2v3 M12 11v6",
  finance: "M12 1v22 M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6",
  partners: "M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2 M9 7a4 4 0 100-8 4 4 0 000 8 M23 21v-2a4 4 0 00-3-3.87 M16 3.13a4 4 0 010 7.75",
  master: "M4 6h16M4 12h16M4 18h10",
  settings: "M12 15a3 3 0 100-6 3 3 0 000 6z M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09a1.65 1.65 0 001.51-1 1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33h.09a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82v.09a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z",
  logout: "M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4 M16 17l5-5-5-5 M21 12H9",
};

function Icon({ name, size = 18, color = "currentColor" }) {
  const d = ICONS[name];
  if (!d) return null;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {d.split(" M").map((seg, i) => <path key={i} d={i === 0 ? seg : "M" + seg} />)}
    </svg>
  );
}

// ── Nav config ──────────────────────────────────────────────────
const NAV = [
  { key: "dashboard", label: "工作台", labelEn: "Dashboard", icon: "dashboard" },
  {
    key: "shipping", label: "集运订单", labelEn: "Shipments", icon: "shipment",
    items: [
      { key: "sea_export", label: "海运出口", labelEn: "Ocean Export" },
      { key: "sea_import", label: "海运进口", labelEn: "Ocean Import", disabled: true },
      { key: "air_export", label: "空运出口", labelEn: "Air Export", disabled: true },
      { key: "air_import", label: "空运进口", labelEn: "Air Import", disabled: true },
    ],
  },
  {
    key: "finance", label: "费用管理", labelEn: "Finance", icon: "finance",
    items: [
      { key: "billing", label: "账单管理", labelEn: "Billing" },
      { key: "invoices", label: "开票记录", labelEn: "Invoices" },
      { key: "payments", label: "收付记录", labelEn: "Payments" },
      { key: "settlement", label: "核销管理", labelEn: "Settlement" },
    ],
  },
  {
    key: "partners", label: "客商管理", labelEn: "Partners", icon: "partners",
    items: [
      { key: "clients", label: "客户", labelEn: "Clients" },
      { key: "agents_intl", label: "国外代理", labelEn: "Overseas Agents" },
      { key: "suppliers_m", label: "供应商", labelEn: "Suppliers" },
      { key: "agents_book", label: "订舱代理", labelEn: "Booking Agents" },
      { key: "truckers", label: "车队", labelEn: "Trucking" },
      { key: "brokers", label: "报关行", labelEn: "Customs Brokers" },
    ],
  },
  {
    key: "master", label: "基础数据", labelEn: "Master Data", icon: "master",
    items: [
      { key: "vessels", label: "船名", labelEn: "Vessels" },
      { key: "ports", label: "港口", labelEn: "Ports" },
      { key: "terminals", label: "码头", labelEn: "Terminals" },
      { key: "charge_types", label: "费用设置", labelEn: "Charge Types" },
      { key: "exchange", label: "汇率设置", labelEn: "Exchange Rates" },
      { key: "numbering", label: "编号设置", labelEn: "Numbering" },
    ],
  },
  {
    key: "system", label: "系统设置", labelEn: "Settings", icon: "settings",
    items: [
      { key: "user_new", label: "新建用户", labelEn: "New User" },
      { key: "users", label: "用户管理", labelEn: "Users" },
    ],
  },
];

// ═══════════════════════════════════════════════════════════════════
export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("dashboard");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [openGroups, setOpenGroups] = useState({ shipping: true });

  useEffect(() => {
    (async () => {
      try {
        const s = supabase.getSession();
        if (s?.access_token && s?.user?.id) {
          const { data } = await supabase.from("user_profiles_view").select("*").eq("id", s.user.id).single();
          const u = { ...s.user, profile: data || { role: "operator" } };
          setUser(u);
          if (u.profile.role === "operator" || u.profile.role === "sales") setLang("zh");
        }
      } catch (e) { console.error("Session init:", e); }
      setLoading(false);
    })();
  }, []);

  const login = async () => {
    setAuthError("");
    const { error } = await supabase.auth.signIn(email, password);
    if (error) { setAuthError(error.message); return; }
    window.location.reload();
  };

  const logout = () => { supabase.auth.signOut(); setUser(null); window.location.reload(); };

  if (loading) return <div style={S.center}><Spinner /></div>;

  // ── Login ──
  if (!user) {
    return (
      <div style={S.loginWrap}>
        <div style={S.loginCard}>
          <div style={S.loginLogo}>Bansar OPS</div>
          <div style={S.loginSub}>Operations Management System</div>
          {authError && <div style={S.loginErr}>{authError}</div>}
          <input placeholder="Email" value={email} onChange={e => setEmail(e.target.value)}
            onKeyDown={e => e.key === "Enter" && login()} style={S.loginInput} />
          <input placeholder="Password" type="password" value={password} onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === "Enter" && login()} style={S.loginInput} />
          <button onClick={login} style={S.loginBtn}>Sign In</button>
        </div>
      </div>
    );
  }

  const role = user.profile?.role || "operator";
  const toggleGroup = (key) => setOpenGroups(p => ({ ...p, [key]: !p[key] }));

  // Check if a group contains the active view
  const isGroupActive = (group) => group.items?.some(i => i.key === view);

  return (
    <div style={S.root}>
      {/* ── Sidebar ── */}
      <div style={S.sidebar}>
        {/* Logo */}
        <div style={S.logoArea}>
          <div style={S.logoIcon}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round">
              <circle cx="12" cy="12" r="10" /><path d="M8 12h8M12 8v8" />
            </svg>
          </div>
          <div>
            <div style={S.logoText}>Bansar OPS</div>
          </div>
        </div>

        {/* Nav */}
        <nav style={S.nav}>
          {NAV.map((item) => {
            // Top-level item (no sub-items)
            if (!item.items) {
              const active = view === item.key;
              return (
                <button key={item.key} onClick={() => setView(item.key)}
                  style={{ ...S.navItem, ...(active ? S.navItemActive : {}) }}>
                  <Icon name={item.icon} size={18} color={active ? "#fff" : "#64748b"} />
                  <div style={S.navLabel}>
                    <span style={{ color: active ? "#fff" : "#cbd5e1", fontWeight: 500 }}>{item.label}</span>
                    <span style={{ ...S.navLabelEn, color: active ? "rgba(255,255,255,.6)" : "#475569" }}>{item.labelEn}</span>
                  </div>
                </button>
              );
            }

            // Group with sub-items
            const isOpen = openGroups[item.key];
            const groupActive = isGroupActive(item);
            return (
              <div key={item.key} style={{ marginBottom: 2 }}>
                <button onClick={() => toggleGroup(item.key)}
                  style={{ ...S.navItem, ...(groupActive && !isOpen ? { background: "rgba(14,165,233,.08)" } : {}) }}>
                  <Icon name={item.icon} size={18} color={groupActive ? "#0ea5e9" : "#64748b"} />
                  <div style={{ ...S.navLabel, flex: 1 }}>
                    <span style={{ color: groupActive ? "#e0f2fe" : "#cbd5e1", fontWeight: 500 }}>{item.label}</span>
                    <span style={{ ...S.navLabelEn, color: groupActive ? "#0ea5e9" : "#475569" }}>{item.labelEn}</span>
                  </div>
                  <span style={{ fontSize: 10, color: "#475569", transition: "transform .2s", transform: isOpen ? "rotate(90deg)" : "none" }}>▶</span>
                </button>
                {isOpen && (
                  <div style={S.subGroup}>
                    {item.items.map(sub => {
                      const active = view === sub.key;
                      return (
                        <button key={sub.key} onClick={() => !sub.disabled && setView(sub.key)}
                          style={{
                            ...S.subItem,
                            ...(active ? S.subItemActive : {}),
                            ...(sub.disabled ? { opacity: 0.35, cursor: "default" } : {}),
                          }}>
                          <span style={{ color: active ? "#fff" : "#94a3b8" }}>{sub.label}</span>
                          <span style={{ fontSize: 10, color: active ? "rgba(255,255,255,.5)" : "#475569" }}>{sub.labelEn}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* User footer */}
        <div style={S.userArea}>
          <div style={S.userAvatar}>{(user.email?.[0] || "U").toUpperCase()}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={S.userEmail}>{user.email}</div>
            <div style={S.userName}>{user.profile?.name || role}</div>
          </div>
          <button onClick={logout} style={S.logoutBtn} title="Logout">
            <Icon name="logout" size={16} color="#64748b" />
          </button>
        </div>
      </div>

      {/* ── Main Content ── */}
      <div style={S.main}>
        {view === "dashboard" && <DashboardPage user={user} onNavigate={setView} />}
        {view === "sea_export" && <OrdersPage user={user} />}
        {!["dashboard", "sea_export"].includes(view) && <PlaceholderPage title={getPageTitle(view)} />}
      </div>
    </div>
  );
}

function getPageTitle(view) {
  for (const g of NAV) {
    if (g.key === view) return g.label;
    if (g.items) for (const i of g.items) if (i.key === view) return i.label;
  }
  return view;
}

function PlaceholderPage({ title }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "60vh", color: "#94a3b8" }}>
      <div style={{ fontSize: 32, marginBottom: 12, opacity: 0.3 }}>⚙</div>
      <h2 style={{ fontSize: 18, fontWeight: 600, color: "#334155", margin: "0 0 4px" }}>{title}</h2>
      <p style={{ fontSize: 12, color: "#94a3b8" }}>功能开发中</p>
    </div>
  );
}

// ── Styles ──────────────────────────────────────────────────────────
const S = {
  root: {
    display: "flex", height: "100vh",
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif",
    background: "#f5f5f5",
  },
  center: { display: "flex", justifyContent: "center", alignItems: "center", height: "100vh" },

  // ── Sidebar ──
  sidebar: {
    width: 220, background: "#0c1527", color: "#e2e8f0",
    display: "flex", flexDirection: "column", flexShrink: 0,
    borderRight: "1px solid #1e293b",
  },
  logoArea: {
    display: "flex", alignItems: "center", gap: 10,
    padding: "18px 16px 16px", borderBottom: "1px solid #1e293b",
  },
  logoIcon: {
    width: 32, height: 32, borderRadius: 8, background: "#0ea5e9",
    display: "flex", alignItems: "center", justifyContent: "center",
  },
  logoText: { fontSize: 15, fontWeight: 700, color: "#fff", letterSpacing: -0.3 },
  nav: { flex: 1, padding: "8px 8px", overflowY: "auto" },
  navItem: {
    display: "flex", alignItems: "center", gap: 10, width: "100%",
    padding: "8px 10px", borderRadius: 6, border: "none",
    background: "transparent", cursor: "pointer", textAlign: "left",
    marginBottom: 1, transition: "background .15s",
  },
  navItemActive: {
    background: "#0ea5e9",
  },
  navLabel: {
    display: "flex", flexDirection: "column", lineHeight: 1.2, fontSize: 13,
  },
  navLabelEn: {
    fontSize: 10, marginTop: 1,
  },
  subGroup: {
    marginLeft: 28, paddingLeft: 10, borderLeft: "1px solid #1e293b",
    marginBottom: 4,
  },
  subItem: {
    display: "flex", flexDirection: "column", width: "100%",
    padding: "6px 10px", borderRadius: 4, border: "none",
    background: "transparent", cursor: "pointer", textAlign: "left",
    fontSize: 12, lineHeight: 1.3, marginBottom: 1,
  },
  subItemActive: {
    background: "#0ea5e9", borderRadius: 4,
  },

  // ── User footer ──
  userArea: {
    display: "flex", alignItems: "center", gap: 10,
    padding: "12px 14px", borderTop: "1px solid #1e293b",
  },
  userAvatar: {
    width: 30, height: 30, borderRadius: 6, background: "#1e293b",
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: 12, fontWeight: 600, color: "#94a3b8", flexShrink: 0,
  },
  userEmail: { fontSize: 11, color: "#94a3b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  userName: { fontSize: 10, color: "#475569", marginTop: 1 },
  logoutBtn: {
    border: "none", background: "none", cursor: "pointer", padding: 4,
    borderRadius: 4, display: "flex", alignItems: "center",
  },

  // ── Main ──
  main: {
    flex: 1, overflowY: "auto", padding: "20px 24px", background: "#f5f5f5",
  },

  // ── Login ──
  loginWrap: {
    display: "flex", justifyContent: "center", alignItems: "center", height: "100vh",
    background: "#0c1527", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', sans-serif",
  },
  loginCard: {
    background: "#fff", borderRadius: 12, padding: 32, width: 380,
    boxShadow: "0 8px 40px rgba(0,0,0,0.3)",
  },
  loginLogo: {
    fontSize: 24, fontWeight: 700, textAlign: "center", marginBottom: 4, color: "#0c1527",
  },
  loginSub: {
    fontSize: 12, color: "#94a3b8", textAlign: "center", marginBottom: 28,
  },
  loginErr: {
    background: "#fef2f2", color: "#dc2626", padding: 8, borderRadius: 6,
    fontSize: 12, marginBottom: 12,
  },
  loginInput: {
    width: "100%", padding: "10px 12px", borderRadius: 6,
    border: "1px solid #e2e8f0", fontSize: 13, marginBottom: 10,
    outline: "none", boxSizing: "border-box",
  },
  loginBtn: {
    width: "100%", padding: "10px", borderRadius: 6,
    background: "#0ea5e9", color: "#fff", fontSize: 13, fontWeight: 600,
    border: "none", cursor: "pointer", marginTop: 4,
  },
};
