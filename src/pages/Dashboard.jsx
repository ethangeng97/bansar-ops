import { useState, useEffect, useMemo } from "react";
import { supabase } from "../supabase.js";
import { t } from "../lib/i18n.js";
import { STATUS_COLORS } from "../lib/constants.js";
import { Spinner } from "../components/ui.jsx";

// ── Helpers ──────────────────────────────────────────────────────────
const fmt = (n) => (n ?? 0).toLocaleString();
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const relTime = (iso) => {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "刚刚";
  if (m < 60) return `${m}分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}小时前`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}天前`;
  return new Date(iso).toLocaleDateString("zh-CN");
};
const daysUntil = (d) => d ? Math.ceil((new Date(d) - new Date()) / 86400000) : null;
const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};
const monthLabel = (s) => s ? `${new Date(s).getMonth() + 1}月` : "";

// ── SOP Steps Config ────────────────────────────────────────────────
const SOP_STEPS = [
  { key: "booking", label: "接单录入", icon: "📝", desc: "录入订单基本信息、运输信息" },
  { key: "space", label: "订舱确认", icon: "🚢", desc: "向船公司/代理订舱，确认舱位" },
  { key: "docs", label: "单证制作", icon: "📄", desc: "SI截单、提单确认、报关资料" },
  { key: "qc", label: "质检放行", icon: "✅", desc: "QC验货、审批放行" },
  { key: "loading", label: "装柜出运", icon: "📦", desc: "装柜、封柜、拖车至码头" },
  { key: "sailing", label: "在途跟踪", icon: "🌊", desc: "船舶跟踪、ETA更新" },
  { key: "billing", label: "费用结算", icon: "💰", desc: "费用录入、对账、开票" },
  { key: "release", label: "放单交付", icon: "🎯", desc: "电放/正本提单、客户签收" },
];

// ── Knowledge Base Config ──────────────────────────────────────────
const KB_SECTIONS = [
  {
    title: "操作指南",
    icon: "📖",
    color: "#0ea5e9",
    items: [
      { title: "海运出口订单录入流程", tag: "必读", tagColor: "#ef4444" },
      { title: "自拼柜(Console Box)操作规范", tag: "重要" },
      { title: "提单类型选择指南 (Original/Telex/SWB)" },
      { title: "FOB/CIF/DDP 各贸易条款操作差异" },
    ],
  },
  {
    title: "费用 & 账单",
    icon: "💰",
    color: "#10b981",
    items: [
      { title: "费用模板配置与使用", tag: "新" },
      { title: "应收(AR)/应付(AP)录入规范" },
      { title: "月账单生成与发送流程" },
      { title: "核销(销账)操作说明" },
    ],
  },
  {
    title: "系统操作",
    icon: "⚙️",
    color: "#8b5cf6",
    items: [
      { title: "OPS系统快速入门", tag: "必读", tagColor: "#ef4444" },
      { title: "Portal ↔ OPS 数据同步机制" },
      { title: "订单编号规则自定义" },
      { title: "用户角色与权限说明" },
    ],
  },
];

// ═══════════════════════════════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════════════════════════════
export function DashboardPage({ user, onNavigate }) {
  const [shipments, setShipments] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("workspace");

  useEffect(() => {
    (async () => {
      const [shipRes, logRes] = await Promise.all([
        supabase.from("shipments").select("*").order("created_at", { ascending: false }),
        supabase.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(30),
      ]);
      setShipments(shipRes.data || []);
      setAuditLogs(logRes.data || []);
      setLoading(false);
    })();
  }, []);

  // ── Derive todos from shipment statuses ──────────────────────────
  const todos = useMemo(() => {
    if (!shipments.length) return [];
    const items = [];

    shipments.forEach((s) => {
      const ref = s.order_no || s.po || s.id?.slice(0, 8);

      if (s.si_cutoff) {
        const d = daysUntil(s.si_cutoff);
        if (d !== null && d >= 0 && d <= 3)
          items.push({ id: `si-${s.id}`, type: "urgent", icon: "⏰", text: `${ref} 截单时间还剩 ${d} 天`, sub: `SI Cutoff: ${s.si_cutoff}`, shipmentId: s.id });
      }

      if (s.cy_cutoff) {
        const d = daysUntil(s.cy_cutoff);
        if (d !== null && d >= 0 && d <= 3)
          items.push({ id: `cy-${s.id}`, type: "urgent", icon: "🚛", text: `${ref} 截关时间还剩 ${d} 天`, sub: `CY Cutoff: ${s.cy_cutoff}`, shipmentId: s.id });
      }

      if (s.etd && s.space_status !== "Booked") {
        const d = daysUntil(s.etd);
        if (d !== null && d >= 0 && d <= 7)
          items.push({ id: `space-${s.id}`, type: "warning", icon: "🚢", text: `${ref} 即将开船但舱位未确认`, sub: `ETD: ${s.etd} · 状态: ${s.space_status || "未设置"}`, shipmentId: s.id });
      }

      if (s.qc_status === "Waiting QC Report" || s.qc_status === "Under Review")
        items.push({ id: `qc-${s.id}`, type: "info", icon: "✅", text: `${ref} 等待QC结果`, sub: `QC: ${s.qc_status}`, shipmentId: s.id });

      if (s.bl_status === "Draft" || s.bl_status === "Amendment")
        items.push({ id: `bl-${s.id}`, type: "info", icon: "📄", text: `${ref} 提单待处理`, sub: `B/L: ${s.bl_status}`, shipmentId: s.id });

      if (s.telex_release === "Pending")
        items.push({ id: `telex-${s.id}`, type: "info", icon: "📨", text: `${ref} 电放待确认`, sub: "Telex Release: Pending", shipmentId: s.id });

      if (s.local_payment === "Waiting")
        items.push({ id: `pay-${s.id}`, type: "warning", icon: "💳", text: `${ref} 待收款`, sub: `Payment: ${s.local_payment}`, shipmentId: s.id });
    });

    const priority = { urgent: 0, warning: 1, info: 2 };
    items.sort((a, b) => (priority[a.type] ?? 3) - (priority[b.type] ?? 3));
    return items;
  }, [shipments]);

  // ── Analytics stats ──────────────────────────────────────────────
  const stats = useMemo(() => {
    if (!shipments.length) return null;
    const now = new Date();
    const thisMonth = now.toISOString().slice(0, 7);
    const last30 = daysAgo(30);
    const today = now.toISOString().slice(0, 10);
    const future14 = daysAgo(-14);

    const total = shipments.length;
    const thisMonthOrders = shipments.filter((s) => (s.created_at || "").slice(0, 7) === thisMonth).length;
    const last30Orders = shipments.filter((s) => (s.created_at || "") >= last30).length;

    const qcCounts = {}, spaceCounts = {}, blCounts = {};
    const custCounts = {}, carrierCounts = {};
    const polCounts = {}, podCounts = {};

    shipments.forEach((s) => {
      qcCounts[s.qc_status || "未设置"] = (qcCounts[s.qc_status || "未设置"] || 0) + 1;
      spaceCounts[s.space_status || "未设置"] = (spaceCounts[s.space_status || "未设置"] || 0) + 1;
      blCounts[s.bl_status || "未设置"] = (blCounts[s.bl_status || "未设置"] || 0) + 1;
      const c = s.customer || s.supplier || "Unknown";
      custCounts[c] = (custCounts[c] || 0) + 1;
      if (s.carrier) carrierCounts[s.carrier] = (carrierCounts[s.carrier] || 0) + 1;
      if (s.pol) polCounts[s.pol] = (polCounts[s.pol] || 0) + 1;
      if (s.pod) podCounts[s.pod] = (podCounts[s.pod] || 0) + 1;
    });

    const sortTop = (obj, n = 8) => Object.entries(obj).sort((a, b) => b[1] - a[1]).slice(0, n);

    const monthCounts = {};
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      monthCounts[d.toISOString().slice(0, 7)] = 0;
    }
    shipments.forEach((s) => { const m = (s.created_at || "").slice(0, 7); if (m in monthCounts) monthCounts[m]++; });
    const monthlyTrend = Object.entries(monthCounts).map(([k, v]) => ({ month: k, label: monthLabel(k + "-01"), count: v }));

    const upcoming = shipments.filter((s) => s.etd && s.etd >= today && s.etd <= future14).sort((a, b) => (a.etd > b.etd ? 1 : -1)).slice(0, 8);
    const recent = shipments.slice(0, 8);

    return {
      total, thisMonthOrders, last30Orders,
      qcCounts, spaceCounts, blCounts,
      topCustomers: sortTop(custCounts), topCarriers: sortTop(carrierCounts, 6),
      monthlyTrend, upcoming, recent,
      topPOL: sortTop(polCounts, 5), topPOD: sortTop(podCounts, 5),
    };
  }, [shipments]);

  if (loading) return <Spinner />;

  const S = styles;
  const role = user?.profile?.role || "operator";

  return (
    <div>
      {/* Header */}
      <div style={S.header}>
        <div>
          <h1 style={S.title}>{getGreeting()}，{user?.profile?.name || user?.email?.split("@")[0] || "操作员"}</h1>
          <p style={S.subtitle}>
            {new Date().toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long" })}
            {todos.filter(t => t.type === "urgent").length > 0 && (
              <span style={{ marginLeft: 8, color: "#f59e0b", fontWeight: 600 }}>· {todos.filter(t => t.type === "urgent").length} 个紧急待办</span>
            )}
          </p>
        </div>
        <div style={S.tabBar}>
          {[{ key: "workspace", label: "工作台", icon: "🏠" }, { key: "analytics", label: "数据看板", icon: "📊" }].map((item) => (
            <button key={item.key} onClick={() => setTab(item.key)}
              style={{ ...S.tabBtn, ...(tab === item.key ? S.tabActive : {}) }}>
              <span style={{ fontSize: 13 }}>{item.icon}</span> {item.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "workspace" ? (
        <WorkspaceView shipments={shipments} todos={todos} auditLogs={auditLogs} stats={stats} onNavigate={onNavigate} role={role} />
      ) : (
        <AnalyticsView stats={stats} onNavigate={onNavigate} />
      )}
    </div>
  );
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 6) return "夜深了";
  if (h < 12) return "早上好";
  if (h < 14) return "中午好";
  if (h < 18) return "下午好";
  return "晚上好";
}

// ═══════════════════════════════════════════════════════════════════
// Workspace View
// ═══════════════════════════════════════════════════════════════════
function WorkspaceView({ shipments, todos, auditLogs, stats, onNavigate }) {
  const S = styles;
  const urgentCount = todos.filter((t) => t.type === "urgent").length;

  return (
    <div>
      {/* Quick KPIs */}
      <div style={S.kpiRow}>
        <KPICard label="总订单" value={stats?.total || 0} icon="📦" color="#0ea5e9" />
        <KPICard label="本月新增" value={stats?.thisMonthOrders || 0} icon="📈" color="#10b981" />
        <KPICard label="紧急待办" value={urgentCount} icon="🔴" color="#ef4444"
          onClick={() => document.getElementById("todo-section")?.scrollIntoView({ behavior: "smooth" })} />
        <KPICard label="即将开船" value={stats?.upcoming?.length || 0} icon="🚢" color="#f59e0b" sub="14天内" />
      </div>

      {/* SOP Process Flow */}
      <div style={{ ...S.card, marginBottom: 16 }}>
        <div style={S.cardHeader}>
          <span style={S.cardTitle}>📋 SOP 操作流程 — 海运出口</span>
          <span style={S.cardSub}>标准操作流程总览</span>
        </div>
        <SOPFlow shipments={shipments} />
      </div>

      {/* Todos + Activity Log */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 16 }}>
        <div id="todo-section" style={{ ...S.card, maxHeight: 480, display: "flex", flexDirection: "column" }}>
          <div style={S.cardHeader}>
            <span style={S.cardTitle}>
              📌 待办事项
              {todos.length > 0 && (
                <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 99, background: "#fef2f2", color: "#dc2626" }}>{todos.length}</span>
              )}
            </span>
            <button onClick={() => onNavigate?.("sea_export")} style={S.viewAll}>查看全部订单 →</button>
          </div>
          <div style={{ flex: 1, overflowY: "auto" }}>
            <TodoList todos={todos} onNavigate={onNavigate} />
          </div>
        </div>

        <div style={{ ...S.card, maxHeight: 480, display: "flex", flexDirection: "column" }}>
          <div style={S.cardHeader}>
            <span style={S.cardTitle}>🕐 操作记录</span>
            <span style={S.cardSub}>最近操作</span>
          </div>
          <div style={{ flex: 1, overflowY: "auto" }}>
            <ActivityLog logs={auditLogs} shipments={shipments} />
          </div>
        </div>
      </div>

      {/* Knowledge Base */}
      <div style={{ ...S.card, marginBottom: 16 }}>
        <div style={S.cardHeader}>
          <span style={S.cardTitle}>📚 知识库</span>
          <span style={S.cardSub}>操作规范 & 常见问题</span>
        </div>
        <KnowledgeBase />
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SOP Flow
// ═══════════════════════════════════════════════════════════════════
function SOPFlow({ shipments }) {
  const [expanded, setExpanded] = useState(null);

  const stageCounts = useMemo(() => {
    const c = { booking: 0, space: 0, docs: 0, qc: 0, loading: 0, sailing: 0, billing: 0, release: 0 };
    shipments.forEach((s) => {
      if (s.telex_release === "Done" || s.bl_status === "Done") { c.release++; return; }
      if (s.local_payment === "Paid") { c.billing++; return; }
      if (s.etd && new Date(s.etd) < new Date()) { c.sailing++; return; }
      if (s.qc_status === "QC Approved" || s.qc_status === "Loading First") { c.loading++; return; }
      if (s.qc_status === "Waiting QC Report" || s.qc_status === "Under Review") { c.qc++; return; }
      if (s.bl_status === "Draft" || s.bl_status === "Amendment") { c.docs++; return; }
      if (s.space_status === "Booked" || s.space_status === "Wait Confirm") { c.space++; return; }
      c.booking++;
    });
    return c;
  }, [shipments]);

  const stageColors = {
    booking: "#94a3b8", space: "#6366f1", docs: "#0ea5e9", qc: "#f59e0b",
    loading: "#f97316", sailing: "#3b82f6", billing: "#10b981", release: "#22c55e",
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 0, position: "relative" }}>
        {SOP_STEPS.map((step, i) => {
          const count = stageCounts[step.key] || 0;
          const isLast = i === SOP_STEPS.length - 1;
          const isActive = count > 0;
          const isExpanded = expanded === step.key;

          return (
            <div key={step.key} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", position: "relative" }}>
              {!isLast && (
                <div style={{
                  position: "absolute", top: 22, left: "50%", right: "-50%", height: 2,
                  background: isActive ? `linear-gradient(90deg, ${stageColors[step.key]}, ${stageColors[step.key]}44)` : "#e2e8f0",
                  zIndex: 0,
                }} />
              )}
              <button onClick={() => setExpanded(isExpanded ? null : step.key)}
                style={{
                  width: 44, height: 44, borderRadius: 12,
                  border: `2px solid ${isActive ? stageColors[step.key] : "#e2e8f0"}`,
                  background: isActive ? stageColors[step.key] + "10" : "#fff",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 20, cursor: "pointer", position: "relative", zIndex: 1,
                  transition: "all .2s",
                  boxShadow: isExpanded ? `0 0 0 3px ${stageColors[step.key]}33` : "none",
                }}>
                {step.icon}
                {count > 0 && (
                  <span style={{
                    position: "absolute", top: -6, right: -6, minWidth: 18, height: 18,
                    borderRadius: 99, background: stageColors[step.key], color: "#fff",
                    fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center",
                    padding: "0 4px", border: "2px solid #fff",
                  }}>{count}</span>
                )}
              </button>
              <div style={{ marginTop: 8, fontSize: 11, fontWeight: 600, color: isActive ? "#0f172a" : "#94a3b8", textAlign: "center" }}>
                {step.label}
              </div>
              {isExpanded && (
                <div style={{
                  marginTop: 8, padding: "8px 10px", background: "#f8fafc",
                  borderRadius: 8, border: "1px solid #e2e8f0",
                  fontSize: 11, color: "#64748b", lineHeight: 1.5, textAlign: "center", maxWidth: 120,
                }}>
                  {step.desc}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Progress bar */}
      <div style={{ marginTop: 16, display: "flex", gap: 2, height: 6, borderRadius: 3, overflow: "hidden", background: "#f1f5f9" }}>
        {SOP_STEPS.map((step) => {
          const count = stageCounts[step.key] || 0;
          const ratio = pct(count, shipments.length || 1);
          if (ratio === 0) return null;
          return <div key={step.key} title={`${step.label}: ${count}`} style={{ width: `${ratio}%`, background: stageColors[step.key], borderRadius: 2, minWidth: 4 }} />;
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Todo List
// ═══════════════════════════════════════════════════════════════════
function TodoList({ todos, onNavigate }) {
  if (!todos.length) {
    return (
      <div style={{ padding: "32px 16px", textAlign: "center", color: "#94a3b8" }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>✨</div>
        <div style={{ fontSize: 13, fontWeight: 600 }}>全部完成！暂无待办事项</div>
      </div>
    );
  }

  const typeStyle = {
    urgent:  { bg: "#fef2f2", border: "#fecaca", dot: "#dc2626" },
    warning: { bg: "#fffbeb", border: "#fde68a", dot: "#d97706" },
    info:    { bg: "#f0f9ff", border: "#bae6fd", dot: "#0284c7" },
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {todos.slice(0, 15).map((item) => {
        const ts = typeStyle[item.type] || typeStyle.info;
        return (
          <div key={item.id} onClick={() => onNavigate?.("sea_export")}
            style={{
              display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px",
              borderRadius: 8, background: ts.bg, border: `1px solid ${ts.border}`,
              cursor: "pointer", transition: "transform .1s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.transform = "translateX(2px)")}
            onMouseLeave={(e) => (e.currentTarget.style.transform = "none")}>
            <span style={{ fontSize: 16, flexShrink: 0, marginTop: 1 }}>{item.icon}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: "#0f172a" }}>{item.text}</div>
              <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>{item.sub}</div>
            </div>
            <div style={{ width: 8, height: 8, borderRadius: 99, background: ts.dot, flexShrink: 0, marginTop: 4 }} />
          </div>
        );
      })}
      {todos.length > 15 && <div style={{ fontSize: 11, color: "#94a3b8", textAlign: "center", padding: 8 }}>还有 {todos.length - 15} 条待办...</div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Activity Log
// ═══════════════════════════════════════════════════════════════════
function ActivityLog({ logs, shipments }) {
  const entries = useMemo(() => {
    if (logs.length > 0) {
      return logs.slice(0, 20).map((l) => ({
        id: l.id,
        action: l.action || l.event_type || "操作",
        detail: l.details || l.description || l.metadata || "",
        user: l.user_email || l.actor || "",
        time: l.created_at,
        table: l.table_name || l.entity_type || "",
      }));
    }
    return shipments.slice(0, 20).map((s) => ({
      id: s.id,
      action: "订单更新",
      detail: `${s.order_no || s.po || "—"} · ${s.customer || s.supplier || "—"}`,
      user: "",
      time: s.updated_at || s.created_at,
      table: "shipments",
    }));
  }, [logs, shipments]);

  const actionIcons = { INSERT: "➕", UPDATE: "✏️", DELETE: "🗑️", "订单更新": "📝", create: "➕", update: "✏️", delete: "🗑️" };

  if (!entries.length) {
    return (
      <div style={{ padding: "32px 16px", textAlign: "center", color: "#94a3b8" }}>
        <div style={{ fontSize: 32, marginBottom: 8 }}>📋</div>
        <div style={{ fontSize: 13 }}>暂无操作记录</div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {entries.map((e, i) => (
        <div key={e.id || i} style={{
          display: "flex", alignItems: "flex-start", gap: 10,
          padding: "10px 8px", borderBottom: i < entries.length - 1 ? "1px solid #f1f5f9" : "none",
        }}>
          <span style={{
            width: 28, height: 28, borderRadius: 8, background: "#f1f5f9",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, flexShrink: 0,
          }}>{actionIcons[e.action] || "📝"}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#0f172a" }}>{formatAction(e.action, e.table)}</div>
            <div style={{ fontSize: 11, color: "#64748b", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {typeof e.detail === "string" ? e.detail : JSON.stringify(e.detail).slice(0, 80)}
            </div>
            {e.user && <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>{e.user}</div>}
          </div>
          <span style={{ fontSize: 10, color: "#94a3b8", whiteSpace: "nowrap", flexShrink: 0 }}>{relTime(e.time)}</span>
        </div>
      ))}
    </div>
  );
}

function formatAction(action, table) {
  const labels = { INSERT: "新建", UPDATE: "更新", DELETE: "删除", create: "新建", update: "更新", delete: "删除" };
  const tables = { shipments: "订单", containers: "柜信息", container_items: "货物", charges: "费用", invoices: "账单", payments: "收付款" };
  return (tables[table] ? `${labels[action] || action} ${tables[table]}` : labels[action] || action);
}

// ═══════════════════════════════════════════════════════════════════
// Knowledge Base
// ═══════════════════════════════════════════════════════════════════
function KnowledgeBase() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
      {KB_SECTIONS.map((section, si) => (
        <div key={si} style={{ borderRadius: 10, border: "1px solid #e2e8f0", overflow: "hidden", background: "#fff" }}>
          <div style={{
            padding: "14px 16px", display: "flex", alignItems: "center", gap: 8,
            borderBottom: "1px solid #f1f5f9", background: section.color + "06",
          }}>
            <span style={{ fontSize: 16 }}>{section.icon}</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", flex: 1 }}>{section.title}</span>
            <span style={{
              fontSize: 10, fontWeight: 600, padding: "2px 6px", borderRadius: 4,
              background: section.color + "14", color: section.color,
            }}>{section.items.length} 篇</span>
          </div>
          <div style={{ padding: "4px 0" }}>
            {section.items.map((item, ii) => (
              <div key={ii}
                style={{
                  padding: "10px 16px", display: "flex", alignItems: "center", gap: 8,
                  cursor: "pointer", transition: "background .15s",
                  borderBottom: ii < section.items.length - 1 ? "1px solid #f8fafc" : "none",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#f8fafc")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}>
                <span style={{ fontSize: 11, color: "#94a3b8" }}>•</span>
                <span style={{ fontSize: 12, color: "#334155", flex: 1 }}>{item.title}</span>
                {item.tag && (
                  <span style={{
                    fontSize: 9, fontWeight: 700, padding: "1px 6px", borderRadius: 4,
                    background: (item.tagColor || section.color) + "14", color: item.tagColor || section.color,
                  }}>{item.tag}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Analytics View
// ═══════════════════════════════════════════════════════════════════
function AnalyticsView({ stats, onNavigate }) {
  const S = styles;
  if (!stats) return <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>暂无数据</div>;

  return (
    <div>
      <div style={S.kpiRow}>
        <KPICard label="总订单" value={stats.total} icon="📦" color="#0ea5e9" />
        <KPICard label="本月新增" value={stats.thisMonthOrders} icon="📈" color="#10b981" />
        <KPICard label="近30天" value={stats.last30Orders} icon="📊" color="#8b5cf6" />
        <KPICard label="即将开船" value={stats.upcoming.length} icon="🚢" color="#f59e0b" sub="14天内" />
      </div>

      <div style={S.row2}>
        <div style={{ ...S.card, flex: 2 }}>
          <div style={S.cardHeader}><span style={S.cardTitle}>📊 月度趋势</span><span style={S.cardSub}>近6个月</span></div>
          <BarChart data={stats.monthlyTrend} labelKey="label" valueKey="count" color="#0ea5e9" height={160} />
        </div>
        <div style={{ ...S.card, flex: 1 }}>
          <div style={S.cardHeader}><span style={S.cardTitle}>🔖 舱位状态</span></div>
          <StatusList counts={stats.spaceCounts} total={stats.total} />
        </div>
      </div>

      <div style={S.row3}>
        <div style={S.card}>
          <div style={S.cardHeader}><span style={S.cardTitle}>✅ QC 状态</span></div>
          <StatusList counts={stats.qcCounts} total={stats.total} />
        </div>
        <div style={S.card}>
          <div style={S.cardHeader}><span style={S.cardTitle}>📄 提单状态</span></div>
          <StatusList counts={stats.blCounts} total={stats.total} />
        </div>
        <div style={S.card}>
          <div style={S.cardHeader}><span style={S.cardTitle}>🏢 客户排名</span></div>
          <RankList data={stats.topCustomers} total={stats.total} color="#0ea5e9" />
        </div>
      </div>

      <div style={S.row2}>
        <div style={{ ...S.card, flex: 1 }}>
          <div style={S.cardHeader}>
            <span style={S.cardTitle}>🕐 最新订单</span>
            <button onClick={() => onNavigate?.("sea_export")} style={S.viewAll}>查看全部 →</button>
          </div>
          <RecentTable rows={stats.recent} onNavigate={onNavigate} />
        </div>
        <div style={{ ...S.card, flex: 1 }}>
          <div style={S.cardHeader}><span style={S.cardTitle}>🚢 即将开船</span><span style={S.cardSub}>14天内 ETD</span></div>
          <UpcomingTable rows={stats.upcoming} />
        </div>
      </div>

      <div style={S.row3}>
        <div style={S.card}>
          <div style={S.cardHeader}><span style={S.cardTitle}>⚓ 船公司</span></div>
          <RankList data={stats.topCarriers} total={stats.total} color="#8b5cf6" />
        </div>
        <div style={S.card}>
          <div style={S.cardHeader}><span style={S.cardTitle}>🏗 起运港 TOP</span></div>
          <RankList data={stats.topPOL} total={stats.total} color="#f59e0b" />
        </div>
        <div style={S.card}>
          <div style={S.cardHeader}><span style={S.cardTitle}>🏗 目的港 TOP</span></div>
          <RankList data={stats.topPOD} total={stats.total} color="#10b981" />
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Shared Sub-components
// ═══════════════════════════════════════════════════════════════════
function KPICard({ label, value, icon, color, sub, onClick }) {
  return (
    <div onClick={onClick} style={{
      flex: 1, background: "#fff", borderRadius: 12, padding: "18px 20px",
      border: "1px solid #e2e8f0", position: "relative", overflow: "hidden",
      cursor: onClick ? "pointer" : "default",
    }}>
      <div style={{ position: "absolute", top: -8, right: -4, fontSize: 48, opacity: 0.06 }}>{icon}</div>
      <div style={{ fontSize: 11, fontWeight: 600, color: "#64748b", marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 800, color: "#0f172a", letterSpacing: -1, lineHeight: 1 }}>{fmt(value)}</div>
      {sub && <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 4 }}>{sub}</div>}
      <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 3, background: color }} />
    </div>
  );
}

function BarChart({ data, labelKey, valueKey, color, height = 140 }) {
  const max = Math.max(...data.map((d) => d[valueKey]), 1);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height, paddingTop: 10 }}>
      {data.map((d, i) => {
        const h = pct(d[valueKey], max);
        return (
          <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#0f172a" }}>{d[valueKey]}</span>
            <div style={{
              width: "100%", maxWidth: 48, height: `${Math.max(h, 4)}%`, minHeight: 4,
              background: `linear-gradient(180deg, ${color}, ${color}88)`,
              borderRadius: "6px 6px 2px 2px", transition: "height 0.6s ease",
            }} />
            <span style={{ fontSize: 10, color: "#94a3b8", fontWeight: 500 }}>{d[labelKey]}</span>
          </div>
        );
      })}
    </div>
  );
}

function StatusList({ counts, total }) {
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {sorted.map(([status, count]) => {
        const color = STATUS_COLORS[status] || "#94a3b8";
        const ratio = pct(count, total);
        return (
          <div key={status} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 }} />
            <span style={{ fontSize: 12, color: "#475569", flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{status}</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: "#0f172a", minWidth: 28, textAlign: "right" }}>{count}</span>
            <div style={{ width: 60, height: 6, background: "#f1f5f9", borderRadius: 3, overflow: "hidden", flexShrink: 0 }}>
              <div style={{ width: `${ratio}%`, height: "100%", background: color, borderRadius: 3 }} />
            </div>
            <span style={{ fontSize: 10, color: "#94a3b8", minWidth: 30, textAlign: "right" }}>{ratio}%</span>
          </div>
        );
      })}
    </div>
  );
}

function RankList({ data, total, color }) {
  if (!data.length) return <div style={{ fontSize: 12, color: "#94a3b8", padding: 10 }}>暂无数据</div>;
  const maxVal = data[0]?.[1] || 1;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      {data.map(([name, count], i) => (
        <div key={name} style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{
            width: 18, height: 18, borderRadius: 4, display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 10, fontWeight: 700, flexShrink: 0,
            background: i < 3 ? color + "18" : "#f1f5f9", color: i < 3 ? color : "#94a3b8",
          }}>{i + 1}</span>
          <span style={{ fontSize: 12, color: "#475569", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: "#0f172a" }}>{count}</span>
          <div style={{ width: 50, height: 5, background: "#f1f5f9", borderRadius: 3, overflow: "hidden", flexShrink: 0 }}>
            <div style={{ width: `${pct(count, maxVal)}%`, height: "100%", background: color, borderRadius: 3 }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function RecentTable({ rows, onNavigate }) {
  if (!rows.length) return <div style={{ fontSize: 12, color: "#94a3b8", padding: 16 }}>暂无数据</div>;
  return (
    <div style={{ overflow: "hidden" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: "1px solid #f1f5f9" }}>
            {["单号", "客户", "船公司", "ETD", "状态"].map((h) => (
              <th key={h} style={{ padding: "6px 6px", textAlign: "left", fontWeight: 600, color: "#94a3b8", fontSize: 10 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} style={{ borderBottom: "1px solid #f8fafc", cursor: "pointer" }} onClick={() => onNavigate?.("sea_export")}>
              <td style={{ padding: "7px 6px", fontWeight: 600, color: "#0369a1", fontFamily: "'DM Mono', monospace", fontSize: 11 }}>{r.order_no || r.po || "—"}</td>
              <td style={{ padding: "7px 6px", color: "#475569", maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.customer || r.supplier || "—"}</td>
              <td style={{ padding: "7px 6px", color: "#475569" }}>{r.carrier || "—"}</td>
              <td style={{ padding: "7px 6px", color: "#475569", fontFamily: "'DM Mono', monospace", fontSize: 11 }}>{r.etd || "—"}</td>
              <td style={{ padding: "7px 6px" }}>{r.space_status ? <MiniTag value={r.space_status} /> : <span style={{ color: "#cbd5e1" }}>—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function UpcomingTable({ rows }) {
  if (!rows.length) return <div style={{ fontSize: 12, color: "#94a3b8", padding: 16 }}>暂无即将开船的订单</div>;
  return (
    <div style={{ overflow: "hidden" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: "1px solid #f1f5f9" }}>
            {["单号", "船名", "POL → POD", "ETD", "倒计时"].map((h) => (
              <th key={h} style={{ padding: "6px 6px", textAlign: "left", fontWeight: 600, color: "#94a3b8", fontSize: 10 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const dl = Math.ceil((new Date(r.etd) - new Date()) / 86400000);
            return (
              <tr key={r.id} style={{ borderBottom: "1px solid #f8fafc" }}>
                <td style={{ padding: "7px 6px", fontWeight: 600, color: "#0369a1", fontFamily: "'DM Mono', monospace", fontSize: 11 }}>{r.order_no || r.po || "—"}</td>
                <td style={{ padding: "7px 6px", color: "#475569" }}>{r.vessel || "—"}</td>
                <td style={{ padding: "7px 6px", color: "#475569", fontSize: 11 }}>{r.pol || "?"} → {r.pod || "?"}</td>
                <td style={{ padding: "7px 6px", color: "#475569", fontFamily: "'DM Mono', monospace", fontSize: 11 }}>{r.etd}</td>
                <td style={{ padding: "7px 6px" }}>
                  <span style={{
                    padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 700,
                    background: dl <= 3 ? "#fef2f2" : dl <= 7 ? "#fffbeb" : "#f0fdf4",
                    color: dl <= 3 ? "#dc2626" : dl <= 7 ? "#d97706" : "#16a34a",
                  }}>{dl}天</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MiniTag({ value }) {
  const color = STATUS_COLORS[value] || "#94a3b8";
  return (
    <span style={{
      display: "inline-block", padding: "1px 7px", borderRadius: 4,
      fontSize: 10, fontWeight: 600, background: color + "14", color,
      border: `1px solid ${color}33`,
    }}>{value}</span>
  );
}

// ── Styles ──────────────────────────────────────────────────────────
const styles = {
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 },
  title: { fontSize: 22, fontWeight: 800, margin: 0, color: "#0f172a" },
  subtitle: { fontSize: 12, color: "#94a3b8", margin: "3px 0 0" },
  tabBar: { display: "flex", gap: 4, background: "#f1f5f9", borderRadius: 10, padding: 3 },
  tabBtn: {
    padding: "7px 16px", borderRadius: 8, border: "none", fontSize: 12, fontWeight: 600,
    cursor: "pointer", background: "transparent", color: "#64748b",
    display: "flex", alignItems: "center", gap: 6, transition: "all .15s",
  },
  tabActive: { background: "#fff", color: "#0f172a", boxShadow: "0 1px 3px rgba(0,0,0,0.08)" },
  kpiRow: { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 16 },
  row2: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 16 },
  row3: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginBottom: 16 },
  card: { background: "#fff", borderRadius: 12, padding: 18, border: "1px solid #e2e8f0" },
  cardHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 },
  cardTitle: { fontSize: 13, fontWeight: 700, color: "#0f172a" },
  cardSub: { fontSize: 10, color: "#94a3b8" },
  viewAll: { fontSize: 11, color: "#0ea5e9", fontWeight: 600, border: "none", background: "none", cursor: "pointer", padding: 0 },
};
