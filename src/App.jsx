// ═══════════════════════════════════════════════════════════════
// Bansar OPS - 应用入口
// 路由策略：hash 路由（/#/sea_export, /#/billing 等）
// 顶层结构：登录 → 门户首页 → 点模块开新 tab → 全屏页面
// ═══════════════════════════════════════════════════════════════

import { useState, useEffect } from "react";
import { supabase } from "./supabase.js";
import { OrdersPage } from "./pages/Orders.jsx";
import { PartnersPage } from "./pages/Partners.jsx";
import Portal from "./pages/Portal.jsx";
import BillDetail from "./pages/BillDetail.jsx";
import BillsList from "./pages/BillsList.jsx";
import BookingConfirmation from "./pages/docs/BookingConfirmation.jsx";
import DraftBL from "./pages/docs/DraftBL.jsx";
import BLCopy from "./pages/docs/BLCopy.jsx";
import BLOriginal from "./pages/docs/BLOriginal.jsx";
import TelexRelease from "./pages/docs/TelexRelease.jsx";
import ReleaseNotice from "./pages/docs/ReleaseNotice.jsx";
import Statement from "./pages/docs/Statement.jsx";
import StatementsList from "./pages/StatementsList.jsx";
import StatementNew from "./pages/StatementNew.jsx";
import StatementDetail from "./pages/StatementDetail.jsx";
import StatementImport from "./pages/StatementImport.jsx";
import InvoicesList from "./pages/InvoicesList.jsx";
import PaymentsList from "./pages/PaymentsList.jsx";
import ChargesList from "./pages/ChargesList.jsx";
import ChargesPrint from "./pages/ChargesPrint.jsx";
import ProfitAnalysis from "./pages/ProfitAnalysis.jsx";
import SettlementsList from "./pages/SettlementsList.jsx";
import ChargeTypesList from "./pages/ChargeTypesList.jsx";
import ExchangeRatesList from "./pages/ExchangeRatesList.jsx";
import { SpotBookingsPage } from "./pages/SpotBookings.jsx";
import { setLang } from "./lib/i18n.js";
import { Spinner } from "./components/ui.jsx";
import { TmsPlaceholder } from "./components/tms.jsx";
import "./styles/tms.css";

// ── 路由表（hash → 页面组件） ──
const ROUTES = {
  "sea_export":  { title: "海运出口", component: OrdersPage },
  "spot_export": { title: "海运出口现舱", component: SpotBookingsPage },
  "partners":    { title: "客商管理", component: PartnersPage },
};

// 解析当前 hash → 路由 key
function getRouteFromHash() {
  const hash = window.location.hash.replace(/^#\/?/, "");
  const [key] = hash.split("?");
  return key || "";
}

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [route, setRoute] = useState(getRouteFromHash());
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [sessionExpired, setSessionExpired] = useState(false);

  // 会话失效：supabase.js 在 401 + refresh 失败时 dispatch 'bansar:session-expired'
  // 这里弹横幅，点"重新登录"清 session 回登录页
  useEffect(() => {
    const onExpired = () => setSessionExpired(true);
    window.addEventListener("bansar:session-expired", onExpired);
    return () => window.removeEventListener("bansar:session-expired", onExpired);
  }, []);

  // ── 加载会话 ──
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

  // ── 监听 hash 变化（浏览器前进/后退） ──
  useEffect(() => {
    const onHashChange = () => setRoute(getRouteFromHash());
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  // ── 登录 ──
  const login = async () => {
    setAuthError("");
    try {
      await supabase.auth.signIn(email, password);
      window.location.reload();
    } catch (e) {
      setAuthError(e.message);
    }
  };
  const logout = () => {
    supabase.auth.signOut();
    setUser(null);
    window.location.hash = "";
    window.location.reload();
  };

  // ── 加载中 ──
  if (loading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100vh" }}>
        <Spinner />
      </div>
    );
  }

  // ── 未登录：显示登录页 ──
  if (!user) {
    return (
      <div className="tms-login">
        <div className="tms-login-box">
          <div className="ttl">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 16l9-13 9 13"/>
              <path d="M3 16l9 5 9-5"/>
              <path d="M3 16v3l9 5 9-5v-3"/>
            </svg>
            Bansar OPS
          </div>
          <div className="sub">班萨（宁波）国际货运代理有限公司</div>
          {authError && <div className="err">{authError}</div>}
          <input
            placeholder="邮箱 / Email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            onKeyDown={e => e.key === "Enter" && login()}
          />
          <input
            placeholder="密码 / Password"
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === "Enter" && login()}
          />
          <button onClick={login}>登 录</button>
        </div>
      </div>
    );
  }

  // ── 已登录 ──

  // 会话失效横幅：点"重新登录"清 session 回登录页
  const expiredBanner = sessionExpired ? (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, zIndex: 9999,
      padding: "10px 20px", background: "#fff1f0", borderBottom: "1px solid #ffa39e",
      color: "#a8071a", fontSize: 13, display: "flex", alignItems: "center", gap: 12,
    }}>
      <span style={{ fontSize: 16 }}>⚠</span>
      <span>登录已过期，部分数据可能加载失败。</span>
      <button
        onClick={logout}
        style={{ marginLeft: "auto", padding: "4px 14px", background: "#cf1322", color: "#fff",
                  border: "none", borderRadius: 3, cursor: "pointer", fontSize: 12 }}
      >重新登录</button>
      <button
        onClick={() => setSessionExpired(false)}
        style={{ padding: "4px 12px", background: "transparent", color: "#a8071a",
                  border: "1px solid #ffa39e", borderRadius: 3, cursor: "pointer", fontSize: 12 }}
      >关闭</button>
    </div>
  ) : null;

  // 内部分发逻辑保持不变，套一层 Fragment 让横幅在所有子页面都能浮出来
  const page = renderRoute();
  return <>{expiredBanner}{page}</>;

  function renderRoute() {

  // 没有 hash 路由 → 显示门户首页
  if (!route) {
    return <Portal user={user} onLogout={logout} />;
  }

  // 静态路由：账单管理列表 #/bills
  if (route === "bills") {
    return <BillsList onBack={() => { window.location.hash = ""; }} />;
  }

  // 导入对账单 #/import-statement
  if (route === "import-statement") {
    return <StatementImport user={user} onBack={() => { window.location.hash = ""; }} />;
  }

  // ── V5 财务模块路由 ──
  // #/invoices 开票/收票记录
  if (route === "invoices") {
    return <InvoicesList user={user} onBack={() => { window.location.hash = ""; }} />;
  }

  // #/payments 收付款记录
  if (route === "payments") {
    return <PaymentsList onBack={() => { window.location.hash = ""; }} />;
  }

  // #/charges 费用记录(全局只读视图)
  if (route === "charges") {
    return <ChargesList onBack={() => { window.location.hash = ""; }} />;
  }

  // #/settlements 核销管理(以账单为视角的反向视图)
  if (route === "settlements") {
    return <SettlementsList onBack={() => { window.location.hash = ""; }} />;
  }

  // #/exchange_rates 汇率设置 CRUD
  if (route === "exchange_rates") {
    return <ExchangeRatesList user={user} onBack={() => { window.location.hash = ""; }} />;
  }

  // #/charge_types 费用类型 CRUD
  if (route === "charge_types") {
    return <ChargeTypesList onBack={() => { window.location.hash = ""; }} />;
  }

  // 动态路由：账单详情 #/bills/:id
  if (route.startsWith("bills/")) {
    const billId = route.slice("bills/".length);
    return (
      <BillDetail
        billId={billId}
        onBack={() => { window.history.back(); }}
      />
    );
  }

  // 动态路由：费用清单打印 #/print/charges/:shipmentId
  if (route.startsWith("print/charges/")) {
    const shipmentId = route.slice("print/charges/".length);
    return <ChargesPrint shipmentId={shipmentId} onBack={() => window.close()} />;
  }

  // 利润分析看板 #/profit-analysis
  if (route === "profit-analysis") {
    return <ProfitAnalysis user={user} role={user.profile?.role} onBack={() => { window.location.hash = ""; }} />;
  }

  // 动态路由：单证 - 委托书 #/docs/booking/:id
  if (route.startsWith("docs/booking/")) {
    const shipmentId = route.slice("docs/booking/".length);
    return (
      <BookingConfirmation
        shipmentId={shipmentId}
        onBack={() => { window.history.back(); }}
      />
    );
  }

  // 动态路由：单证 - 提单确认件 #/docs/draft_bl/:id
  if (route.startsWith("docs/draft_bl/")) {
    const shipmentId = route.slice("docs/draft_bl/".length);
    return (
      <DraftBL
        shipmentId={shipmentId}
        onBack={() => { window.history.back(); }}
      />
    );
  }

  // 动态路由：单证 - 提单副本 #/docs/bl_copy/:id
  if (route.startsWith("docs/bl_copy/")) {
    const shipmentId = route.slice("docs/bl_copy/".length);
    return (
      <BLCopy
        shipmentId={shipmentId}
        onBack={() => { window.history.back(); }}
      />
    );
  }

  // 动态路由：单证 - 提单正本 #/docs/bl_original/:id
  if (route.startsWith("docs/bl_original/")) {
    const shipmentId = route.slice("docs/bl_original/".length);
    return (
      <BLOriginal
        shipmentId={shipmentId}
        onBack={() => { window.history.back(); }}
      />
    );
  }

  // 动态路由：单证 - 电放件 #/docs/telex/:id
  if (route.startsWith("docs/telex/")) {
    const shipmentId = route.slice("docs/telex/".length);
    return (
      <TelexRelease
        shipmentId={shipmentId}
        onBack={() => { window.history.back(); }}
      />
    );
  }

  // 动态路由：单证 - 放舱信息 #/docs/release/:id
  if (route.startsWith("docs/release/")) {
    const shipmentId = route.slice("docs/release/".length);
    return (
      <ReleaseNotice
        shipmentId={shipmentId}
        onBack={() => { window.history.back(); }}
      />
    );
  }

  // 动态路由：单票对账单 #/docs/stmt/:shipmentId
  if (route.startsWith("docs/stmt/")) {
    const shipmentId = route.slice("docs/stmt/".length);
    return (
      <Statement
        shipmentId={shipmentId}
        mode="single"
        onBack={() => { window.history.back(); }}
      />
    );
  }

  // 动态路由：多票合并对账单 PDF #/docs/stmt_batch/:id
  if (route.startsWith("docs/stmt_batch/")) {
    const statementId = route.slice("docs/stmt_batch/".length);
    return (
      <Statement
        statementId={statementId}
        mode="batch"
        onBack={() => { window.history.back(); }}
      />
    );
  }

  // 动态路由：新建对账单 #/statements/new
  if (route === "statements/new" || route.startsWith("statements/new?")) {
    return (
      <StatementNew
        onBack={() => { window.location.hash = "#/statements"; }}
      />
    );
  }

  // 动态路由：对账单列表 #/statements
  if (route === "statements") {
    return (
      <StatementsList
        onBack={() => { window.location.hash = ""; }}
      />
    );
  }

  // 动态路由：对账单详情（明细列表）#/statements/:id
  if (route.startsWith("statements/")) {
    const statementId = route.slice("statements/".length);
    return (
      <StatementDetail
        statementId={statementId}
        onBack={() => { window.location.hash = "#/statements"; }}
      />
    );
  }

  // 有 hash 路由 → 加载对应页面
  const matched = ROUTES[route];
  if (matched) {
    const PageComponent = matched.component;
    return (
      <PageComponent
        user={user}
        onBack={() => { window.location.hash = ""; }}
      />
    );
  }

  // 路由未匹配 → 占位页
  return (
    <TmsPlaceholder
      title={route}
      onBack={() => { window.location.hash = ""; }}
    />
  );
  }
}
