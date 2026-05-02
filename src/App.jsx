import { useState, useEffect } from "react";
import { supabase } from "./supabase.js";
import { OrdersPage } from "./pages/Orders.jsx";
import { DashboardPage } from "./pages/Dashboard.jsx";
import { setLang } from "./lib/i18n.js";
import { Spinner } from "./components/ui.jsx";

/* ── Inline SVG icons (stroke, 20x20) ──────────────────────────── */
const I = {
  home: <path d="M3 10l7-7 7 7v8a1 1 0 01-1 1H4a1 1 0 01-1-1z"/>,
  ship: <><rect x="2" y="8" width="16" height="9" rx="1"/><path d="M5 8V5a1 1 0 011-1h8a1 1 0 011 1v3"/><path d="M10 12v3"/></>,
  dollar: <path d="M10 1v18M14 5H8a3 3 0 000 6h4a3 3 0 010 6H5"/>,
  users: <><circle cx="7" cy="6" r="3"/><path d="M1 18v-1a4 4 0 014-4h4a4 4 0 014 4v1"/><path d="M14 4a3 3 0 010 6M19 18v-1a4 4 0 00-3-4"/></>,
  list: <path d="M3 5h14M3 10h14M3 15h8"/>,
  gear: <><circle cx="10" cy="10" r="2.5"/><path d="M10 1v2M10 17v2M1 10h2M17 10h2M3.5 3.5l1.4 1.4M15.1 15.1l1.4 1.4M3.5 16.5l1.4-1.4M15.1 4.9l1.4-1.4"/></>,
  out: <><path d="M7 17H4a1 1 0 01-1-1V4a1 1 0 011-1h3"/><path d="M13 14l4-4-4-4"/><path d="M17 10H7"/></>,
};
function Ic({ k, s = 16, c = "#64748b" }) {
  return <svg width={s} height={s} viewBox="0 0 20 20" fill="none" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">{I[k]}</svg>;
}

/* ── Nav structure ─────────────────────────────────────────────── */
const NAV = [
  { key: "dashboard", zh: "工作台", en: "Dashboard", icon: "home" },
  { key: "shipping", zh: "集运订单", en: "Shipments", icon: "ship", items: [
    { key: "sea_export", zh: "海运出口", en: "Ocean Export" },
    { key: "sea_import", zh: "海运进口", en: "Ocean Import", off: true },
    { key: "air_export", zh: "空运出口", en: "Air Export", off: true },
    { key: "air_import", zh: "空运进口", en: "Air Import", off: true },
  ]},
  { key: "finance", zh: "费用管理", en: "Finance", icon: "dollar", items: [
    { key: "billing", zh: "账单管理", en: "Billing" },
    { key: "invoices", zh: "开票记录", en: "Invoices" },
    { key: "payments", zh: "收付记录", en: "Payments" },
    { key: "settlement", zh: "核销管理", en: "Settlement" },
  ]},
  { key: "partners", zh: "客商管理", en: "Partners", icon: "users", items: [
    { key: "clients", zh: "客户", en: "Clients" },
    { key: "agents_intl", zh: "国外代理", en: "Overseas Agents" },
    { key: "suppliers_m", zh: "供应商", en: "Suppliers" },
    { key: "agents_book", zh: "订舱代理", en: "Booking Agents" },
    { key: "truckers", zh: "车队", en: "Trucking" },
    { key: "brokers", zh: "报关行", en: "Customs Brokers" },
  ]},
  { key: "master", zh: "基础数据", en: "Master Data", icon: "list", items: [
    { key: "vessels", zh: "船名", en: "Vessels" },
    { key: "ports", zh: "港口", en: "Ports" },
    { key: "terminals", zh: "码头", en: "Terminals" },
    { key: "charge_types", zh: "费用设置", en: "Charge Types" },
    { key: "exchange", zh: "汇率设置", en: "Exchange Rates" },
    { key: "numbering", zh: "编号设置", en: "Numbering" },
  ]},
  { key: "system", zh: "系统设置", en: "Settings", icon: "gear", items: [
    { key: "user_new", zh: "新建用户", en: "New User" },
    { key: "users", zh: "用户管理", en: "Users" },
  ]},
];

/* ═══════════════════════════════════════════════════════════════ */
export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("dashboard");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [open, setOpen] = useState({ shipping: true });

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
      } catch (e) { console.error(e); }
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

  if (loading) return <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh" }}><Spinner /></div>;

  /* ── Login ── */
  if (!user) return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh", background: "#0c1321", fontFamily: F }}>
      <div style={{ background: "#fff", borderRadius: 8, padding: "28px 28px 24px", width: 340 }}>
        <div style={{ fontSize: 18, fontWeight: 700, textAlign: "center", marginBottom: 2, color: "#0c1321" }}>Bansar OPS</div>
        <div style={{ fontSize: 11, color: "#94a3b8", textAlign: "center", marginBottom: 22 }}>Operations Management System</div>
        {authError && <div style={{ background: "#fef2f2", color: "#dc2626", padding: 6, borderRadius: 4, fontSize: 11, marginBottom: 10 }}>{authError}</div>}
        <input placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && login()} style={inp} />
        <input placeholder="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && login()} style={{ ...inp, marginBottom: 14 }} />
        <button onClick={login} style={{ width: "100%", padding: 9, borderRadius: 4, background: "#2563eb", color: "#fff", fontSize: 12, fontWeight: 600, border: "none", cursor: "pointer" }}>Sign In</button>
      </div>
    </div>
  );

  const role = user.profile?.role || "operator";
  const tog = (k) => setOpen(p => ({ ...p, [k]: !p[k] }));
  const childActive = (g) => g.items?.some(i => i.key === view);

  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: F, background: "#f0f0f0" }}>
      {/* ── Sidebar ── */}
      <aside style={{ width: 195, background: "#0c1321", display: "flex", flexDirection: "column", flexShrink: 0 }}>
        {/* Logo — small, stable */}
        <div style={{ padding: "14px 14px 12px", borderBottom: "1px solid #1a2332", display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 24, height: 24, borderRadius: 4, background: "#1e3a5f", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="#4d9be6" strokeWidth="2"><circle cx="10" cy="10" r="7"/></svg>
          </div>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#e2e8f0", letterSpacing: -0.3 }}>Bansar OPS</span>
        </div>

        <nav style={{ flex: 1, padding: "6px 6px", overflowY: "auto" }}>
          {NAV.map(g => {
            if (!g.items) {
              /* Top-level link */
              const a = view === g.key;
              return (
                <button key={g.key} onClick={() => setView(g.key)} style={{
                  ...nb, background: a ? "#141e2e" : "transparent",
                  borderLeft: a ? "2px solid #2563eb" : "2px solid transparent",
                }}>
                  <Ic k={g.icon} s={15} c={a ? "#93b4e8" : "#4b5c6f"} />
                  <div style={{ lineHeight: 1.2 }}>
                    <div style={{ fontSize: 12, color: a ? "#e2e8f0" : "#9ca7b4", fontWeight: 500 }}>{g.zh}</div>
                    <div style={{ fontSize: 9, color: a ? "#5a7da8" : "#3b4a5a", marginTop: 1 }}>{g.en}</div>
                  </div>
                </button>
              );
            }

            /* Group */
            const isOpen = open[g.key];
            const ga = childActive(g);
            return (
              <div key={g.key} style={{ marginBottom: 1 }}>
                <button onClick={() => tog(g.key)} style={{
                  ...nb, borderLeft: ga && !isOpen ? "2px solid #2563eb" : "2px solid transparent",
                }}>
                  <Ic k={g.icon} s={15} c={ga ? "#6b8db5" : "#4b5c6f"} />
                  <div style={{ flex: 1, lineHeight: 1.2 }}>
                    <div style={{ fontSize: 12, color: ga ? "#d4dde8" : "#9ca7b4", fontWeight: 500 }}>{g.zh}</div>
                    <div style={{ fontSize: 9, color: ga ? "#5a7da8" : "#3b4a5a", marginTop: 1 }}>{g.en}</div>
                  </div>
                  <span style={{ fontSize: 8, color: "#3b4a5a", transform: isOpen ? "rotate(90deg)" : "none", transition: "transform .15s" }}>▶</span>
                </button>
                {isOpen && (
                  <div style={{ marginLeft: 22, paddingLeft: 8, borderLeft: "1px solid #1a2332" }}>
                    {g.items.map(sub => {
                      const a = view === sub.key;
                      return (
                        <button key={sub.key} onClick={() => !sub.off && setView(sub.key)} style={{
                          display: "block", width: "100%", textAlign: "left", border: "none", cursor: sub.off ? "default" : "pointer",
                          padding: "5px 8px", borderRadius: 3, marginBottom: 0,
                          background: a ? "#141e2e" : "transparent",
                          borderLeft: a ? "2px solid #2563eb" : "2px solid transparent",
                          opacity: sub.off ? 0.3 : 1,
                        }}>
                          <div style={{ fontSize: 12, color: a ? "#e2e8f0" : "#8896a4", fontWeight: a ? 500 : 400 }}>{sub.zh}</div>
                          <div style={{ fontSize: 9, color: a ? "#5a7da8" : "#3b4a5a" }}>{sub.en}</div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* User */}
        <div style={{ padding: "10px 12px", borderTop: "1px solid #1a2332", display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 26, height: 26, borderRadius: 4, background: "#1a2332", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 600, color: "#6b8db5", flexShrink: 0 }}>
            {(user.email?.[0] || "U").toUpperCase()}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10, color: "#8896a4", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user.email}</div>
            <div style={{ fontSize: 9, color: "#4b5c6f" }}>{user.profile?.name || role}</div>
          </div>
          <button onClick={logout} title="Logout" style={{ border: "none", background: "none", cursor: "pointer", padding: 2 }}>
            <Ic k="out" s={14} c="#4b5c6f" />
          </button>
        </div>
      </aside>

      {/* ── Main ── */}
      <main style={{ flex: 1, overflowY: "auto", background: "#f5f5f5" }}>
        <div style={{ padding: "16px 20px" }}>
          {view === "dashboard" && <DashboardPage user={user} onNavigate={setView} />}
          {view === "sea_export" && <OrdersPage user={user} />}
          {!["dashboard", "sea_export"].includes(view) && <Placeholder view={view} />}
        </div>
      </main>
    </div>
  );
}

const F = "-apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif";
const inp = { width: "100%", padding: "8px 10px", borderRadius: 4, border: "1px solid #dde1e6", fontSize: 12, marginBottom: 8, outline: "none", boxSizing: "border-box" };
const nb = { display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "7px 8px", borderRadius: 3, border: "none", cursor: "pointer", textAlign: "left", background: "transparent", marginBottom: 1 };

function Placeholder({ view }) {
  const label = (() => { for (const g of NAV) { if (g.key === view) return g.zh; if (g.items) for (const i of g.items) if (i.key === view) return i.zh; } return view; })();
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "50vh", color: "#94a3b8" }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: "#475569", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 11 }}>功能开发中</div>
    </div>
  );
}
