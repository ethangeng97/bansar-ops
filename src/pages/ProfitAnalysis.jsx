// ============================================================================
// ProfitAnalysis — 利润分析看板
// 路由：#/profit-analysis
// 数据：调 RPC profit_analysis(date_from, date_to, dimension, customer, sales_id, carrier)
// 维度：月份 / 客户 / 销售员 / 航线 / 船公司
// ============================================================================
import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase } from "../supabase.js";
import { TmsTitle } from "../components/tms.jsx";
import { getCachedRef } from "../lib/ref-cache.js";

const DIMS = [
  { key: "month",       label: "按月份" },
  { key: "customer",    label: "按客户" },
  { key: "salesperson", label: "按销售员" },
  { key: "route",       label: "按航线" },
  { key: "carrier",     label: "按船公司" },
];

function defaultDateFrom() {
  const d = new Date();
  d.setMonth(d.getMonth() - 5);
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}
function defaultDateTo() {
  return new Date().toISOString().slice(0, 10);
}

export default function ProfitAnalysis({ user, role, onBack }) {
  const [dim, setDim] = useState("month");
  const [dateFrom, setDateFrom] = useState(defaultDateFrom());
  const [dateTo, setDateTo] = useState(defaultDateTo());
  const [customer, setCustomer] = useState("");
  const [salesId, setSalesId] = useState("");
  const [carrier, setCarrier] = useState("");
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [customers, setCustomers] = useState([]);
  const [staff, setStaff] = useState([]);
  const [carriers, setCarriers] = useState([]);

  // 拉下拉字典
  useEffect(() => {
    let alive = true;
    getCachedRef("customers").then(d => alive && setCustomers(d || [])).catch(() => {});
    getCachedRef("staff").then(d => alive && setStaff(d || [])).catch(() => {});
    // carrier 字典直接从 shipments DISTINCT 拉（量级小）
    supabase.from("shipments").select("carrier").not("carrier", "is", null).limit(1000)
      .then(({ data }) => {
        if (!alive) return;
        const set = new Set();
        (data || []).forEach(r => r.carrier && set.add(r.carrier));
        setCarriers([...set].sort());
      });
    return () => { alive = false; };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("profit_analysis", {
      p_date_from:      dateFrom || null,
      p_date_to:        dateTo   || null,
      p_dimension:      dim,
      p_customer:       customer || null,
      p_salesperson_id: salesId  || null,
      p_carrier:        carrier  || null,
    });
    if (error) {
      alert("查询失败：" + error.message);
      setRows([]);
    } else {
      setRows(data || []);
    }
    setLoading(false);
  }, [dim, dateFrom, dateTo, customer, salesId, carrier]);

  useEffect(() => { load(); }, [load]);

  // 汇总
  const totals = useMemo(() => {
    const t = { n: 0, ar: 0, ap: 0 };
    rows.forEach(r => {
      t.n  += Number(r.shipments_count) || 0;
      t.ar += Number(r.ar_cny) || 0;
      t.ap += Number(r.ap_cny) || 0;
    });
    t.gross = t.ar - t.ap;
    t.pct = t.ar > 0 ? (t.gross / t.ar * 100) : null;
    return t;
  }, [rows]);

  return (
    <div style={{ background: "#f4f5f7", minHeight: "100vh" }}>
      <TmsTitle title="利润分析" user={user} role={role} onClose={onBack} />
      {/* 筛选 */}
      <div style={{ background: "#fff", padding: "12px 20px", borderBottom: "1px solid #e0e0e0",
                     display: "flex", flexWrap: "wrap", gap: 10, alignItems: "end" }}>
        <Fi label="维度">
          <select value={dim} onChange={e => setDim(e.target.value)} style={selStyle}>
            {DIMS.map(d => <option key={d.key} value={d.key}>{d.label}</option>)}
          </select>
        </Fi>
        <Fi label="ETD 从">
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={selStyle} />
        </Fi>
        <Fi label="到">
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={selStyle} />
        </Fi>
        <Fi label="客户（可选）">
          <select value={customer} onChange={e => setCustomer(e.target.value)} style={selStyle}>
            <option value="">全部</option>
            {customers.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </Fi>
        <Fi label="销售员（可选）">
          <select value={salesId} onChange={e => setSalesId(e.target.value)} style={selStyle}>
            <option value="">全部</option>
            {staff.filter(u => u.role === "sales" || u.role === "admin").map(u => (
              <option key={u.id} value={u.id}>{u.display_name || u.full_name || u.email}</option>
            ))}
          </select>
        </Fi>
        <Fi label="船公司（可选）">
          <select value={carrier} onChange={e => setCarrier(e.target.value)} style={selStyle}>
            <option value="">全部</option>
            {carriers.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </Fi>
      </div>

      {/* 汇总卡 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, padding: 20 }}>
        <KpiCard label="票数"   value={totals.n.toLocaleString()}     color="#1990ff" />
        <KpiCard label="应收 CNY" value={fmt(totals.ar)}              color="#0050b3" />
        <KpiCard label="应付 CNY" value={fmt(totals.ap)}              color="#ad4e00" />
        <KpiCard label="毛利 CNY" value={(totals.gross >= 0 ? "+" : "") + fmt(totals.gross)}
                 sub={totals.pct !== null ? `毛利率 ${totals.pct.toFixed(1)}%` : ""}
                 color={totals.gross >= 0 ? "#52c41a" : "#cf1322"} />
      </div>

      {/* 明细表 */}
      <div style={{ background: "#fff", margin: "0 20px 20px", border: "1px solid #e0e0e0", borderRadius: 4 }}>
        {loading ? (
          <div style={{ padding: 40, textAlign: "center", color: "#888" }}>加载中...</div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "#999" }}>该过滤条件下没有数据</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
            <thead style={{ background: "#fafafa" }}>
              <tr>
                <th style={th}>{DIMS.find(d => d.key === dim)?.label.replace("按", "") || "维度"}</th>
                <th style={{ ...th, textAlign: "right" }}>票数</th>
                <th style={{ ...th, textAlign: "right" }}>应收 CNY</th>
                <th style={{ ...th, textAlign: "right" }}>应付 CNY</th>
                <th style={{ ...th, textAlign: "right" }}>毛利 CNY</th>
                <th style={{ ...th, textAlign: "right" }}>毛利率</th>
                <th style={{ ...th, width: 100 }}>占毛利</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const gross = Number(r.gross_cny) || 0;
                const shareDenom = totals.gross !== 0 ? Math.abs(totals.gross) : 1;
                const sharePct = (gross / shareDenom) * 100;
                return (
                  <tr key={i} style={{ borderTop: "1px solid #f0f0f0" }}>
                    <td style={td}><b>{r.bucket}</b></td>
                    <td style={tdR}>{r.shipments_count}</td>
                    <td style={tdR}>{fmt(r.ar_cny)}</td>
                    <td style={tdR}>{fmt(r.ap_cny)}</td>
                    <td style={{ ...tdR, color: gross >= 0 ? "#52c41a" : "#cf1322", fontWeight: 600 }}>
                      {gross >= 0 ? "+" : ""}{fmt(gross)}
                    </td>
                    <td style={tdR}>{r.gross_pct !== null ? `${Number(r.gross_pct).toFixed(1)}%` : "—"}</td>
                    <td style={td}>
                      <div style={{ position: "relative", height: 14, background: "#f5f5f5", borderRadius: 2 }}>
                        <div style={{
                          position: "absolute", top: 0, left: 0, bottom: 0,
                          width: Math.min(100, Math.abs(sharePct)) + "%",
                          background: gross >= 0 ? "#b7eb8f" : "#ffa39e",
                          borderRadius: 2,
                        }} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: "2px solid #d9d9d9", background: "#fafafa" }}>
                <td style={{ ...td, fontWeight: 700 }}>合计</td>
                <td style={tdR}>{totals.n}</td>
                <td style={tdR}>{fmt(totals.ar)}</td>
                <td style={tdR}>{fmt(totals.ap)}</td>
                <td style={{ ...tdR, fontWeight: 700, color: totals.gross >= 0 ? "#52c41a" : "#cf1322" }}>
                  {totals.gross >= 0 ? "+" : ""}{fmt(totals.gross)}
                </td>
                <td style={tdR}>{totals.pct !== null ? totals.pct.toFixed(1) + "%" : "—"}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  );
}

function Fi({ label, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span style={{ fontSize: 11, color: "#64748b" }}>{label}</span>
      {children}
    </div>
  );
}

function KpiCard({ label, value, sub, color }) {
  return (
    <div style={{ background: "#fff", padding: 16, border: "1px solid #e0e0e0", borderRadius: 6 }}>
      <div style={{ fontSize: 11, color: "#888", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

const selStyle = { padding: "5px 8px", border: "1px solid #d9d9d9", borderRadius: 3, fontSize: 12, minWidth: 100 };
const th = { padding: "8px 12px", borderBottom: "1px solid #ddd", textAlign: "left", fontWeight: 600, color: "#555", fontSize: 11.5 };
const td = { padding: "6px 12px", color: "#333", verticalAlign: "middle" };
const tdR = { ...td, textAlign: "right", fontFamily: "'Consolas', monospace" };

function fmt(n) {
  const v = Number(n) || 0;
  return v.toLocaleString("zh-CN", { maximumFractionDigits: 0 });
}
