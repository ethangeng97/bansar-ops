import { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabase.js";
import { OrdersPage } from "./pages/Orders.jsx";
import { canAccessPage } from "./lib/permissions.js";
import { t, setLang } from "./lib/i18n.js";
import { Spinner } from "./components/ui.jsx";

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("sea_export");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");

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
      } catch (e) {
        console.error("Session init error:", e);
      }
      setLoading(false);
    })();
  }, []);

  const login = async () => {
    setAuthError("");
    const { data, error } = await supabase.auth.signIn(email, password);
    if (error) { setAuthError(error.message); return; }
    window.location.reload();
  };

  const logout = () => { supabase.auth.signOut(); setUser(null); window.location.reload(); };

  if (loading) return <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh" }}><Spinner /></div>;

  if (!user) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh", background: "#f8fafc", fontFamily: "'Inter','DM Sans',sans-serif" }}>
        <div style={{ background: "#fff", borderRadius: 16, padding: 32, width: 360, boxShadow: "0 4px 24px rgba(0,0,0,0.08)" }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, textAlign: "center", marginBottom: 4 }}>Bansar OPS</h1>
          <p style={{ fontSize: 12, color: "#94a3b8", textAlign: "center", marginBottom: 24 }}>Operations Management System</p>
          {authError && <div style={{ background: "#fef2f2", color: "#dc2626", padding: 8, borderRadius: 6, fontSize: 12, marginBottom: 12 }}>{authError}</div>}
          <input placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === "Enter" && login()}
            style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 13, marginBottom: 10, outline: "none", boxSizing: "border-box" }} />
          <input placeholder="Password" type="password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && login()}
            style={{ width: "100%", padding: "10px 12px", borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 13, marginBottom: 14, outline: "none", boxSizing: "border-box" }} />
          <button onClick={login} style={{ width: "100%", padding: "10px", borderRadius: 8, background: "#0ea5e9", color: "#fff", fontSize: 13, fontWeight: 600, border: "none", cursor: "pointer" }}>Sign In</button>
        </div>
      </div>
    );
  }

  const role = user.profile?.role || "operator";
  const navGroups = [
    { key: "shipping", label: "集运订单", icon: "🚢", defaultOpen: true, items: [
      { key: "sea_export", label: "海运出口", icon: "🚢" },
      { key: "sea_import", label: "海运进口", icon: "🚢", disabled: true },
      { key: "air_export", label: "空运出口", icon: "✈", disabled: true },
      { key: "air_import", label: "空运进口", icon: "✈", disabled: true },
    ]},
    { key: "finance", label: "费用管理", icon: "💰", items: [
      { key: "billing",    label: "账单管理", icon: "📄" },
      { key: "invoices",   label: "开票记录", icon: "🧾" },
      { key: "payments",   label: "收付记录", icon: "💳" },
      { key: "settlement", label: "核销管理", icon: "✅" },
    ]},
    { key: "partners", label: "客商管理", icon: "👥", items: [
      { key: "clients",     label: "客户", icon: "🏢" },
      { key: "agents_intl", label: "国外代理", icon: "🌍" },
      { key: "suppliers_m", label: "供应商", icon: "🏭" },
      { key: "agents_book", label: "订舱代理", icon: "📋" },
      { key: "truckers",    label: "车队", icon: "🚛" },
      { key: "brokers",     label: "报关行", icon: "📑" },
    ]},
    { key: "master", label: "基础数据", icon: "⚙", items: [
      { key: "vessels",      label: "船名", icon: "🚢" },
      { key: "ports",        label: "港口（代码）", icon: "🏗" },
      { key: "terminals",    label: "码头", icon: "⚓" },
      { key: "charge_types", label: "费用设置", icon: "💲" },
      { key: "exchange",     label: "汇率设置", icon: "💱" },
      { key: "numbering",    label: "编号设置", icon: "🔢" },
    ]},
    { key: "system", label: "系统设置", icon: "🔧", items: [
      { key: "user_new",  label: "新建用户", icon: "➕" },
      { key: "users",     label: "用户", icon: "👤" },
    ]},
  ];

  const [openGroups, setOpenGroups] = useState({ shipping: true });
  const toggleGroup = (key) => setOpenGroups(p => ({ ...p, [key]: !p[key] }));

  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: "'Inter','DM Sans',sans-serif", background: "#f1f5f9" }}>
      {/* Sidebar */}
      <div style={{ width: 220, background: "#0f172a", color: "#e2e8f0", display: "flex", flexDirection: "column", flexShrink: 0 }}>
        <div style={{ padding: "20px 16px 12px" }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#fff", letterSpacing: -0.5 }}>Bansar OPS</div>
          <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>Operations Management</div>
        </div>

        <nav style={{ flex: 1, padding: "8px 8px", overflowY: "auto" }}>
          {navGroups.map(g => (
            <div key={g.key} style={{ marginBottom: 4 }}>
              <button onClick={() => toggleGroup(g.key)}
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", padding: "9px 12px", borderRadius: 8, border: "none", background: openGroups[g.key] ? "#1e293b" : "transparent", color: openGroups[g.key] ? "#fff" : "#94a3b8", fontSize: 13, fontWeight: 600, cursor: "pointer", textAlign: "left" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={{ fontSize: 14 }}>{g.icon}</span> {g.label}</span>
                <span style={{ fontSize: 10, transition: "transform .2s", transform: openGroups[g.key] ? "rotate(90deg)" : "rotate(0)" }}>▶</span>
              </button>
              {openGroups[g.key] && (
                <div style={{ paddingLeft: 16, marginTop: 2 }}>
                  {g.items.map(item => (
                    <button key={item.key} onClick={() => !item.disabled && setView(item.key)}
                      style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "7px 12px", borderRadius: 6, border: "none", background: view === item.key ? "#0ea5e9" : "transparent", color: item.disabled ? "#475569" : view === item.key ? "#fff" : "#94a3b8", fontSize: 12, fontWeight: view === item.key ? 600 : 400, cursor: item.disabled ? "default" : "pointer", textAlign: "left", marginBottom: 1, opacity: item.disabled ? 0.5 : 1 }}>
                      {item.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
        </nav>

        <div style={{ padding: "12px 16px", borderTop: "1px solid #1e293b" }}>
          <div style={{ fontSize: 11, color: "#94a3b8", marginBottom: 4 }}>{user.email}</div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Badge value={role} />
            <button onClick={logout} style={{ border: "none", background: "none", color: "#64748b", fontSize: 11, cursor: "pointer" }}>Logout</button>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, overflowY: "auto", padding: "20px 24px" }}>
        {view === "sea_export" && <OrdersPage user={user} />}
        {view === "sea_import" && <PlaceholderPage title="海运进口" desc="开发中..." />}
        {view === "air_export" && <PlaceholderPage title="空运出口" desc="开发中..." />}
        {view === "air_import" && <PlaceholderPage title="空运进口" desc="开发中..." />}
        {view === "billing" && <PlaceholderPage title="账单管理" desc="Phase 2 开发中" />}
        {view === "invoices" && <PlaceholderPage title="开票记录" desc="Phase 2 开发中" />}
        {view === "payments" && <PlaceholderPage title="收付记录" desc="Phase 3 开发中" />}
        {view === "settlement" && <PlaceholderPage title="核销管理" desc="Phase 3 开发中" />}
        {view === "clients" && <PlaceholderPage title="客户" desc="客商管理" />}
        {view === "agents_intl" && <PlaceholderPage title="国外代理" desc="客商管理" />}
        {view === "suppliers_m" && <PlaceholderPage title="供应商" desc="客商管理" />}
        {view === "agents_book" && <PlaceholderPage title="订舱代理" desc="客商管理" />}
        {view === "truckers" && <PlaceholderPage title="车队" desc="客商管理" />}
        {view === "brokers" && <PlaceholderPage title="报关行" desc="客商管理" />}
        {view === "vessels" && <PlaceholderPage title="船名" desc="基础数据" />}
        {view === "ports" && <PlaceholderPage title="港口（代码）" desc="基础数据" />}
        {view === "terminals" && <PlaceholderPage title="码头" desc="基础数据" />}
        {view === "charge_types" && <PlaceholderPage title="费用设置" desc="基础数据" />}
        {view === "exchange" && <PlaceholderPage title="汇率设置" desc="基础数据" />}
        {view === "numbering" && <PlaceholderPage title="编号设置" desc="基础数据" />}
        {view === "user_new" && <PlaceholderPage title="新建用户" desc="系统设置" />}
        {view === "users" && <PlaceholderPage title="用户" desc="系统设置" />}
      </div>
    </div>
  );
}

function Badge({ value }) {
  const colors = { admin: "#0ea5e9", operator: "#10b981", finance: "#f59e0b", sales: "#8b5cf6" };
  return <span style={{ padding: "2px 8px", borderRadius: 99, fontSize: 10, fontWeight: 600, background: (colors[value] || "#64748b") + "22", color: colors[value] || "#64748b" }}>{value}</span>;
}

function PlaceholderPage({ title, desc }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "60vh", color: "#94a3b8" }}>
      <div style={{ fontSize: 40, marginBottom: 12 }}>🚧</div>
      <h2 style={{ fontSize: 20, fontWeight: 700, color: "#0f172a", margin: "0 0 6px" }}>{title}</h2>
      <p style={{ fontSize: 13 }}>{desc}</p>
    </div>
  );
}
