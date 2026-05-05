// ============================================================================
// StatementsList.jsx — 对账单管理列表
// 路由：#/statements
// 功能：
//   - Tab 切换：应收 (AR) / 应付 (AP)
//   - 搜索：对账单号 / 客户名 / 状态 / 期间
//   - 操作：查看 / 解绑（删 statement_id 让 bills 重回未关联）
// ============================================================================

import { useEffect, useState } from "react";
import { supabase } from "../supabase.js";

const BRAND = "#1f3864";

const STATUS_LABELS = {
  unsettled: { label: "未核销",   color: "#666",    bg: "#f5f5f5" },
  partial:   { label: "部分核销", color: "#fa8c16", bg: "#fff7e6" },
  settled:   { label: "已收款",   color: "#52c41a", bg: "#f6ffed" },
  void:      { label: "作废",     color: "#888",    bg: "#fafafa" },
};
const STATUS_LABELS_AP = {
  unsettled: { label: "未核销",   color: "#666",    bg: "#f5f5f5" },
  partial:   { label: "部分核销", color: "#fa8c16", bg: "#fff7e6" },
  settled:   { label: "已付款",   color: "#52c41a", bg: "#f6ffed" },
  void:      { label: "作废",     color: "#888",    bg: "#fafafa" },
};

export default function StatementsList({ onBack }) {
  const [direction, setDirection] = useState("AR"); // AR / AP
  const [statements, setStatements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    keyword: "", status: "", date_from: "", date_to: "",
  });

  const load = async () => {
    setLoading(true);
    let q = supabase.from("statements").select("*")
      .eq("direction", direction)
      .order("created_at", { ascending: false });

    if (filters.status) q = q.eq("status", filters.status);
    if (filters.date_from) q = q.gte("period_from", filters.date_from);
    if (filters.date_to)   q = q.lte("period_to", filters.date_to);

    const { data, error } = await q;
    if (error) { alert("加载失败: " + error.message); setLoading(false); return; }

    let rows = data || [];
    // 客户端过滤关键字
    if (filters.keyword) {
      const k = filters.keyword.toLowerCase();
      rows = rows.filter(r =>
        (r.statement_no || "").toLowerCase().includes(k) ||
        (r.partner_name || "").toLowerCase().includes(k)
      );
    }
    setStatements(rows);
    setLoading(false);
  };

  useEffect(() => { load(); }, [direction]);

  const labels = direction === "AP" ? STATUS_LABELS_AP : STATUS_LABELS;

  const updateStatus = async (id, newStatus) => {
    if (!confirm(`确认将状态改为「${labels[newStatus].label}」?`)) return;
    const { error } = await supabase.rpc("update_statement_status", {
      p_stmt_id: id, p_status: newStatus
    });
    if (error) { alert("更新失败: " + error.message); return; }
    await load();
  };

  const unbindAll = async (stmt) => {
    if (!confirm(`确认解绑对账单「${stmt.statement_no}」?\n所有关联账单将重新回到未对账状态，对账单本身保留为草稿。`)) return;
    const { error: e1 } = await supabase.rpc("unbind_bills_from_statement", { p_stmt_id: stmt.id });
    if (e1) { alert("解绑失败: " + e1.message); return; }
    // 状态改为 void
    await supabase.rpc("update_statement_status", { p_stmt_id: stmt.id, p_status: "void" });
    await load();
  };

  return (
    <div style={{ padding: 16, background: "#f0f2f5", minHeight: "100vh" }}>
      <div style={{ background: "#fff", borderRadius: 4, padding: 16,
                    boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
        <div style={{ display: "flex", justifyContent: "space-between",
                      alignItems: "center", marginBottom: 12, paddingBottom: 12,
                      borderBottom: "1px solid #f0f0f0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {onBack && <button onClick={onBack} style={btn}>← 返回</button>}
            <span style={{ fontSize: 16, fontWeight: 700 }}>对账单管理</span>
            <span style={{ marginLeft: 4, color: "#888", fontSize: 12 }}>共 {statements.length} 个</span>
          </div>
          <a href={`#/statements/new?direction=${direction}`}
             style={{ padding: "6px 16px", background: "#1990ff", color: "#fff",
                      textDecoration: "none", borderRadius: 3, fontWeight: 600,
                      fontSize: 13 }}>
            + 新建{direction === "AR" ? "应收" : "应付"}对账单
          </a>
        </div>

        {/* Tab */}
        <div style={{ display: "flex", gap: 0, marginBottom: 14, borderBottom: "1px solid #e8e8e8" }}>
          {[["AR", "应收对账单"], ["AP", "应付对账单"]].map(([key, label]) => (
            <div key={key}
                 onClick={() => setDirection(key)}
                 style={{
                   padding: "10px 24px", cursor: "pointer",
                   color: direction === key ? BRAND : "#666",
                   fontWeight: direction === key ? 700 : 500,
                   borderBottom: direction === key ? `2px solid ${BRAND}` : "2px solid transparent",
                   marginBottom: -1,
                   fontSize: 13,
                 }}>
              {label}
            </div>
          ))}
        </div>

        {/* 筛选 */}
        <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center", fontSize: 12 }}>
          <input placeholder="对账单号 / 客户名"
                 value={filters.keyword}
                 onChange={e => setFilters({...filters, keyword: e.target.value})}
                 onKeyDown={e => e.key === "Enter" && load()}
                 style={{ flex: "0 0 220px", padding: "5px 8px", border: "1px solid #d9d9d9",
                          borderRadius: 3, fontSize: 12 }} />
          <select value={filters.status}
                  onChange={e => setFilters({...filters, status: e.target.value})}
                  style={{ padding: "5px 8px", border: "1px solid #d9d9d9", borderRadius: 3, fontSize: 12 }}>
            <option value="">全部状态</option>
            <option value="unsettled">未核销</option>
            <option value="partial">部分核销</option>
            <option value="settled">{direction === "AP" ? "已付款" : "已收款"}</option>
            <option value="void">作废</option>
          </select>
          <input type="date" value={filters.date_from}
                 onChange={e => setFilters({...filters, date_from: e.target.value})}
                 style={{ padding: "5px 8px", border: "1px solid #d9d9d9", borderRadius: 3, fontSize: 12 }} />
          <span>~</span>
          <input type="date" value={filters.date_to}
                 onChange={e => setFilters({...filters, date_to: e.target.value})}
                 style={{ padding: "5px 8px", border: "1px solid #d9d9d9", borderRadius: 3, fontSize: 12 }} />
          <button onClick={load} style={btn}>查询</button>
          <button onClick={() => { setFilters({keyword: "", status: "", date_from: "", date_to: ""}); setTimeout(load, 0); }}
                  style={btn}>重置</button>
        </div>

        {/* 列表 */}
        {loading ? (
          <div style={{ padding: 30, textAlign: "center", color: "#888" }}>加载中...</div>
        ) : statements.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "#999" }}>
            暂无{direction === "AR" ? "应收" : "应付"}对账单
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#fafafa", color: "#444" }}>
                <th style={th}>对账单号</th>
                <th style={th}>{direction === "AR" ? "客户" : "供应商"}</th>
                <th style={th}>账期</th>
                <th style={{ ...th, textAlign: "right" }}>币别 / 金额</th>
                <th style={{ ...th, textAlign: "left" }}>到期日</th>
                <th style={{ ...th, textAlign: "center" }}>状态</th>
                <th style={{ ...th, textAlign: "center" }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {statements.map(s => {
                const st = labels[s.status] || labels.unsettled;
                return (
                  <tr key={s.id} style={{ borderBottom: "1px solid #f5f5f5" }}>
                    <td style={td}>
                      <a href={`#/statements/${s.id}`} target="_blank" rel="noreferrer"
                         style={{ color: BRAND, fontWeight: 600, fontFamily: "Consolas,monospace",
                                  textDecoration: "none" }}>
                        {s.statement_no}
                      </a>
                    </td>
                    <td style={td}>{s.partner_name}</td>
                    <td style={td}>
                      {s.period_from ? formatDate(s.period_from) : "—"} ~ {s.period_to ? formatDate(s.period_to) : "—"}
                    </td>
                    <td style={{ ...td, textAlign: "right", fontFamily: "Consolas,monospace", fontWeight: 700 }}>
                      {s.currency} {Number(s.amount_total).toFixed(2)}
                    </td>
                    <td style={td}>{s.due_date ? formatDate(s.due_date) : "—"}</td>
                    <td style={{ ...td, textAlign: "center" }}>
                      <span style={{ display: "inline-block", padding: "2px 8px",
                                      background: st.bg, color: st.color, borderRadius: 3, fontSize: 11 }}>
                        {st.label}
                      </span>
                    </td>
                    <td style={{ ...td, textAlign: "center" }}>
                      <a href={`#/statements/${s.id}`} target="_blank" rel="noreferrer"
                         style={{ color: "#1990ff", textDecoration: "none", marginRight: 8 }}>查看</a>
                      {s.status !== "settled" && s.status !== "void" && (
                        <a onClick={() => updateStatus(s.id, "settled")}
                           style={{ color: "#52c41a", cursor: "pointer", marginRight: 8 }}>
                          标{direction === "AP" ? "已付" : "已收"}
                        </a>
                      )}
                      {s.status !== "void" && (
                        <a onClick={() => unbindAll(s)}
                           style={{ color: "#ff4d4f", cursor: "pointer" }}>解绑</a>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function formatDate(d) {
  if (!d) return "—";
  const date = new Date(d);
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const th = { padding: 8, textAlign: "left", borderBottom: "1px solid #e8e8e8", fontWeight: 600 };
const td = { padding: 8 };
const btn = { padding: "5px 14px", background: "#fff", border: "1px solid #d9d9d9",
               borderRadius: 3, fontSize: 12, cursor: "pointer" };
