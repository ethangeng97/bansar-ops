import { useState, useEffect, useMemo } from "react";
import { supabase } from "../supabase.js";
import { t } from "../lib/i18n.js";
import { STATUS_COLORS } from "../lib/constants.js";
import { Spinner } from "../components/ui.jsx";

// ── Helpers ──────────────────────────────────────────────────────────
const fmt = (n) => (n ?? 0).toLocaleString();
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function monthLabel(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}月`;
}

function weekLabel(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// ── Main Component ──────────────────────────────────────────────────
export function DashboardPage({ user, onNavigate }) {
  const [shipments, setShipments] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("shipments")
        .select("*")
        .order("created_at", { ascending: false });
      setShipments(data || []);
      setLoading(false);
    })();
  }, []);

  const stats = useMemo(() => {
    if (!shipments.length) return null;
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const thisMonth = now.toISOString().slice(0, 7);
    const last30 = daysAgo(30);

    // Core KPIs
    const total = shipments.length;
    const thisMonthOrders = shipments.filter(s => (s.created_at || "").slice(0, 7) === thisMonth);
    const last30Orders = shipments.filter(s => (s.created_at || "") >= last30);

    // Status breakdowns
    const qcCounts = {};
    const spaceCounts = {};
    const blCounts = {};
    shipments.forEach(s => {
      qcCounts[s.qc_status || "未设置"] = (qcCounts[s.qc_status || "未设置"] || 0) + 1;
      spaceCounts[s.space_status || "未设置"] = (spaceCounts[s.space_status || "未设置"] || 0) + 1;
      blCounts[s.bl_status || "未设置"] = (blCounts[s.bl_status || "未设置"] || 0) + 1;
    });

    // Top customers
    const custCounts = {};
    shipments.forEach(s => {
      const c = s.customer || s.supplier || "Unknown";
      custCounts[c] = (custCounts[c] || 0) + 1;
    });
    const topCustomers = Object.entries(custCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);

    // Top carriers
    const carrierCounts = {};
    shipments.forEach(s => {
      if (s.carrier) carrierCounts[s.carrier] = (carrierCounts[s.carrier] || 0) + 1;
    });
    const topCarriers = Object.entries(carrierCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6);

    // Monthly trend (last 6 months)
    const monthCounts = {};
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = d.toISOString().slice(0, 7);
      monthCounts[key] = 0;
    }
    shipments.forEach(s => {
      const m = (s.created_at || "").slice(0, 7);
      if (m in monthCounts) monthCounts[m]++;
    });
    const monthlyTrend = Object.entries(monthCounts).map(([k, v]) => ({
      month: k,
      label: monthLabel(k + "-01"),
      count: v,
    }));

    // Weekly trend (last 8 weeks)
    const weekCounts = [];
    for (let i = 7; i >= 0; i--) {
      const start = daysAgo(i * 7 + 6);
      const end = daysAgo(i * 7);
      const count = shipments.filter(s => {
        const c = (s.created_at || "").slice(0, 10);
        return c >= start && c <= end;
      }).length;
      weekCounts.push({ label: weekLabel(end), count });
    }

    // Upcoming ETDs (next 14 days)
    const future14 = daysAgo(-14);
    const upcoming = shipments
      .filter(s => s.etd && s.etd >= today && s.etd <= future14)
      .sort((a, b) => (a.etd > b.etd ? 1 : -1))
      .slice(0, 8);

    // Recent orders
    const recent = shipments.slice(0, 8);

    // Container type distribution
    const ctypeCounts = {};
    shipments.forEach(s => {
      const ct = s.container_type || "N/A";
      ctypeCounts[ct] = (ctypeCounts[ct] || 0) + 1;
    });

    // Trade terms distribution
    const tradeCounts = {};
    shipments.forEach(s => {
      if (s.trade_terms) tradeCounts[s.trade_terms] = (tradeCounts[s.trade_terms] || 0) + 1;
    });

    // Ports
    const polCounts = {};
    const podCounts = {};
    shipments.forEach(s => {
      if (s.pol) polCounts[s.pol] = (polCounts[s.pol] || 0) + 1;
      if (s.pod) podCounts[s.pod] = (podCounts[s.pod] || 0) + 1;
    });
    const topPOL = Object.entries(polCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const topPOD = Object.entries(podCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);

    return {
      total, thisMonthOrders: thisMonthOrders.length, last30Orders: last30Orders.length,
      qcCounts, spaceCounts, blCounts,
      topCustomers, topCarriers,
      monthlyTrend, weekCounts,
      upcoming, recent,
      ctypeCounts, tradeCounts,
      topPOL, topPOD,
    };
  }, [shipments]);

  if (loading) return <Spinner />;
  if (!stats) return <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>暂无数据</div>;

  const S = styles;

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, margin: 0, color: "#0f172a" }}>
          {t("Dashboard")}
        </h1>
        <p style={{ fontSize: 12, color: "#94a3b8", margin: "3px 0 0" }}>
          运营数据总览 · {new Date().toLocaleDateString("zh-CN")}
        </p>
      </div>

      {/* KPI Cards */}
      <div style={S.kpiRow}>
        <KPICard label="总订单" value={stats.total} icon="📦" color="#0ea5e9" />
        <KPICard label="本月新增" value={stats.thisMonthOrders} icon="📈" color="#10b981" />
        <KPICard label="近30天" value={stats.last30Orders} icon="📊" color="#8b5cf6" />
        <KPICard label="即将开船" value={stats.upcoming.length} icon="🚢" color="#f59e0b" sub="14天内" />
      </div>

      {/* Row 2: Monthly trend + Status breakdown */}
      <div style={S.row2}>
        <div style={{ ...S.card, flex: 2 }}>
          <div style={S.cardHeader}>
            <span style={S.cardTitle}>📊 月度趋势</span>
            <span style={S.cardSub}>近6个月</span>
          </div>
          <BarChart data={stats.monthlyTrend} labelKey="label" valueKey="count" color="#0ea5e9" height={160} />
        </div>
        <div style={{ ...S.card, flex: 1 }}>
          <div style={S.cardHeader}>
            <span style={S.cardTitle}>🔖 舱位状态</span>
          </div>
          <StatusList counts={stats.spaceCounts} total={stats.total} />
        </div>
      </div>

      {/* Row 3: QC + BL + Top customers */}
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

      {/* Row 4: Recent + Upcoming */}
      <div style={S.row2}>
        <div style={{ ...S.card, flex: 1 }}>
          <div style={S.cardHeader}>
            <span style={S.cardTitle}>🕐 最新订单</span>
            <button onClick={() => onNavigate?.("sea_export")} style={S.viewAll}>查看全部 →</button>
          </div>
          <RecentTable rows={stats.recent} onNavigate={onNavigate} />
        </div>
        <div style={{ ...S.card, flex: 1 }}>
          <div style={S.cardHeader}>
            <span style={S.cardTitle}>🚢 即将开船</span>
            <span style={S.cardSub}>14天内 ETD</span>
          </div>
          <UpcomingTable rows={stats.upcoming} />
        </div>
      </div>

      {/* Row 5: Carriers + Ports + Container Types */}
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

// ── Sub-components ──────────────────────────────────────────────────

function KPICard({ label, value, icon, color, sub }) {
  return (
    <div style={{
      flex: 1, background: "#fff", borderRadius: 12, padding: "18px 20px",
      border: "1px solid #e2e8f0", position: "relative", overflow: "hidden",
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
  const max = Math.max(...data.map(d => d[valueKey]), 1);
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
              <div style={{ width: `${ratio}%`, height: "100%", background: color, borderRadius: 3, transition: "width 0.5s" }} />
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
            background: i < 3 ? color + "18" : "#f1f5f9",
            color: i < 3 ? color : "#94a3b8",
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
            {["单号", "客户", "船公司", "ETD", "状态"].map(h => (
              <th key={h} style={{ padding: "6px 6px", textAlign: "left", fontWeight: 600, color: "#94a3b8", fontSize: 10 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id} style={{ borderBottom: "1px solid #f8fafc", cursor: "pointer" }}
              onClick={() => onNavigate?.("sea_export")}>
              <td style={{ padding: "7px 6px", fontWeight: 600, color: "#0369a1", fontFamily: "'DM Mono', monospace", fontSize: 11 }}>
                {r.order_no || r.po || "—"}
              </td>
              <td style={{ padding: "7px 6px", color: "#475569", maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {r.customer || r.supplier || "—"}
              </td>
              <td style={{ padding: "7px 6px", color: "#475569" }}>{r.carrier || "—"}</td>
              <td style={{ padding: "7px 6px", color: "#475569", fontFamily: "'DM Mono', monospace", fontSize: 11 }}>{r.etd || "—"}</td>
              <td style={{ padding: "7px 6px" }}>
                {r.space_status ? <MiniTag value={r.space_status} /> : <span style={{ color: "#cbd5e1" }}>—</span>}
              </td>
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
            {["单号", "船名", "POL → POD", "ETD", "倒计时"].map(h => (
              <th key={h} style={{ padding: "6px 6px", textAlign: "left", fontWeight: 600, color: "#94a3b8", fontSize: 10 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const daysLeft = Math.ceil((new Date(r.etd) - new Date()) / 86400000);
            return (
              <tr key={r.id} style={{ borderBottom: "1px solid #f8fafc" }}>
                <td style={{ padding: "7px 6px", fontWeight: 600, color: "#0369a1", fontFamily: "'DM Mono', monospace", fontSize: 11 }}>
                  {r.order_no || r.po || "—"}
                </td>
                <td style={{ padding: "7px 6px", color: "#475569" }}>{r.vessel || "—"}</td>
                <td style={{ padding: "7px 6px", color: "#475569", fontSize: 11 }}>
                  {r.pol || "?"} → {r.pod || "?"}
                </td>
                <td style={{ padding: "7px 6px", color: "#475569", fontFamily: "'DM Mono', monospace", fontSize: 11 }}>{r.etd}</td>
                <td style={{ padding: "7px 6px" }}>
                  <span style={{
                    padding: "2px 8px", borderRadius: 4, fontSize: 10, fontWeight: 700,
                    background: daysLeft <= 3 ? "#fef2f2" : daysLeft <= 7 ? "#fffbeb" : "#f0fdf4",
                    color: daysLeft <= 3 ? "#dc2626" : daysLeft <= 7 ? "#d97706" : "#16a34a",
                  }}>
                    {daysLeft}天
                  </span>
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
  kpiRow: {
    display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 16,
  },
  row2: {
    display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 16,
  },
  row3: {
    display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 14, marginBottom: 16,
  },
  card: {
    background: "#fff", borderRadius: 12, padding: 18,
    border: "1px solid #e2e8f0",
  },
  cardHeader: {
    display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14,
  },
  cardTitle: {
    fontSize: 13, fontWeight: 700, color: "#0f172a",
  },
  cardSub: {
    fontSize: 10, color: "#94a3b8",
  },
  viewAll: {
    fontSize: 11, color: "#0ea5e9", fontWeight: 600,
    border: "none", background: "none", cursor: "pointer", padding: 0,
  },
};
