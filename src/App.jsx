import { useState, useEffect, useCallback } from "react";
import { supabase } from "./supabase.js";
import { OrdersPage } from "./pages/Orders.jsx";
import { canAccessPage } from "./lib/permissions.js";
import { t, setLang } from "./lib/i18n.js";
import { Spinner } from "./components/ui.jsx";

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("orders");
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
  const nav = [
    { key: "orders",    icon: "📦", label: t("Orders") },
    { key: "charges",   icon: "💰", label: t("Charges") },
    { key: "billing",   icon: "📄", label: t("Billing") },
    { key: "payments",  icon: "💳", label: t("Payments") },
    { key: "documents", icon: "📑", label: t("Documents") },
    { key: "settings",  icon: "⚙", label: t("Settings") },
  ].filter(n => canAccessPage(role, n.key));

  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: "'Inter','DM Sans',sans-serif", background: "#f1f5f9" }}>
      {/* Sidebar */}
      <div style={{ width: 220, background: "#0f172a", color: "#e2e8f0", display: "flex", flexDirection: "column", flexShrink: 0 }}>
        <div style={{ padding: "20px 16px 12px" }}>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#fff", letterSpacing: -0.5 }}>Bansar OPS</div>
          <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>Operations Management</div>
        </div>

        <nav style={{ flex: 1, padding: "8px 8px" }}>
          {nav.map(n => (
            <button key={n.key} onClick={() => setView(n.key)}
              style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", padding: "9px 12px", borderRadius: 8, border: "none", background: view === n.key ? "#1e293b" : "transparent", color: view === n.key ? "#fff" : "#94a3b8", fontSize: 13, fontWeight: view === n.key ? 600 : 400, cursor: "pointer", textAlign: "left", marginBottom: 2 }}>
              <span style={{ fontSize: 15 }}>{n.icon}</span> {n.label}
            </button>
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
        {view === "orders" && <OrdersPage user={user} />}
        {view === "charges" && <PlaceholderPage title={t("Charges")} desc="费用录入 — Phase 2" />}
        {view === "billing" && <PlaceholderPage title={t("Billing")} desc="账单管理 — Phase 2" />}
        {view === "payments" && <PlaceholderPage title={t("Payments")} desc="收付款 — Phase 3" />}
        {view === "documents" && <PlaceholderPage title={t("Documents")} desc="文档生成 — Phase 3" />}
        {view === "settings" && <PlaceholderPage title={t("Settings")} desc="系统设置 — Phase 4" />}
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
