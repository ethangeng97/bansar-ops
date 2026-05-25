// ═══════════════════════════════════════════════════════════════
// 汇率设置 #/exchange_rates
// CRUD exchange_rates 表，给 ChargesPanel / payments 做 CNY 折算用
// ═══════════════════════════════════════════════════════════════
import { useState, useEffect } from "react";
import { supabase } from "../supabase.js";
import { TmsTitle, Mi, Tbl } from "../components/tms.jsx";

export default function ExchangeRatesList({ user, onBack }) {
  const role = user?.profile?.role || "operator";
  const canEdit = role === "admin" || role === "finance";

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [edId, setEdId] = useState(null);    // 正在编辑的行 id
  const [draft, setDraft] = useState({});    // 编辑草稿

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from("exchange_rates").select("*")
      .order("currency").order("effective_from", { ascending: false });
    setRows(data || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const startEdit = (r) => { setEdId(r.id); setDraft({ ...r }); };
  const cancelEdit = () => { setEdId(null); setDraft({}); };
  const startNew = () => {
    const today = new Date().toISOString().slice(0, 10);
    setEdId("new");
    setDraft({ currency: "", rate_to_cny: "", effective_from: today, remark: "" });
  };
  const save = async () => {
    if (!draft.currency?.trim()) { alert("币种必填"); return; }
    const rate = parseFloat(draft.rate_to_cny);
    if (!rate || rate <= 0) { alert("汇率必须是大于 0 的数字"); return; }
    const payload = {
      currency: draft.currency.trim().toUpperCase(),
      rate_to_cny: rate,
      effective_from: draft.effective_from || null,
      effective_to: draft.effective_to || null,
      remark: draft.remark || null,
    };
    if (edId === "new") {
      const { error } = await supabase.from("exchange_rates").insert(payload);
      if (error) { alert("新建失败：" + error.message); return; }
    } else {
      const { error } = await supabase.from("exchange_rates").update(payload).eq("id", edId);
      if (error) { alert("保存失败：" + error.message); return; }
    }
    cancelEdit();
    load();
  };
  const remove = async (r) => {
    if (!confirm(`删除汇率 ${r.currency} = ${r.rate_to_cny}？此操作不可恢复。`)) return;
    await supabase.from("exchange_rates").delete().eq("id", r.id);
    load();
  };

  const fmtDate = (s) => s ? new Date(s).toISOString().slice(0, 10) : "—";

  return (
    <div className="tms">
      <TmsTitle title="汇率设置" user={user} role={role} onClose={onBack} />
      <div className="tms-dtb1">
        <Mi onClick={onBack}>返回</Mi>
        <Tbl/>
        <Mi onClick={load}>刷新</Mi>
        {canEdit && <Mi onClick={startNew}>新建汇率</Mi>}
        <Tbl/>
        <Mi onClick={onBack}>关闭</Mi>
      </div>

      <div style={{ padding: 20 }}>
        <div style={{ marginBottom: 12, fontSize: 12, color: "#666" }}>
          汇率仅作 CNY 折算参考（amount_cny = amount × rate）。如同币种有多条，按 effective_from 取最新生效。
          {!canEdit && <span style={{ marginLeft: 8, color: "#fa8c16" }}>(只读：仅 admin / finance 可编辑)</span>}
        </div>
        {loading ? (
          <div style={{ padding: 24, textAlign: "center", color: "#888" }}>加载中…</div>
        ) : rows.length === 0 && edId !== "new" ? (
          <div style={{ padding: 24, textAlign: "center", color: "#888" }}>暂无汇率记录</div>
        ) : (
          <table style={tableStyle}>
            <thead><tr>
              <th style={th}>币种</th>
              <th style={th}>汇率 (1 外币 = X CNY)</th>
              <th style={th}>生效起</th>
              <th style={th}>失效至</th>
              <th style={th}>备注</th>
              {canEdit && <th style={{ ...th, width: 160 }}>操作</th>}
            </tr></thead>
            <tbody>
              {edId === "new" && (
                <tr style={{ background: "#e6f4ff" }}>
                  <td style={td}><input style={input} value={draft.currency || ""} onChange={e => setDraft(d => ({ ...d, currency: e.target.value.toUpperCase() }))} placeholder="如 USD" maxLength={6} /></td>
                  <td style={td}><input style={inputNum} type="number" step="0.0001" value={draft.rate_to_cny || ""} onChange={e => setDraft(d => ({ ...d, rate_to_cny: e.target.value }))} /></td>
                  <td style={td}><input style={input} type="date" value={draft.effective_from || ""} onChange={e => setDraft(d => ({ ...d, effective_from: e.target.value }))} /></td>
                  <td style={td}><input style={input} type="date" value={draft.effective_to || ""} onChange={e => setDraft(d => ({ ...d, effective_to: e.target.value }))} /></td>
                  <td style={td}><input style={input} value={draft.remark || ""} onChange={e => setDraft(d => ({ ...d, remark: e.target.value }))} /></td>
                  <td style={td}>
                    <button onClick={save} style={btnPrimary}>✓ 保存</button>
                    <button onClick={cancelEdit} style={{ ...btn, marginLeft: 6 }}>取消</button>
                  </td>
                </tr>
              )}
              {rows.map(r => edId === r.id ? (
                <tr key={r.id} style={{ background: "#e6f4ff" }}>
                  <td style={td}><input style={input} value={draft.currency || ""} onChange={e => setDraft(d => ({ ...d, currency: e.target.value.toUpperCase() }))} maxLength={6} /></td>
                  <td style={td}><input style={inputNum} type="number" step="0.0001" value={draft.rate_to_cny || ""} onChange={e => setDraft(d => ({ ...d, rate_to_cny: e.target.value }))} /></td>
                  <td style={td}><input style={input} type="date" value={draft.effective_from || ""} onChange={e => setDraft(d => ({ ...d, effective_from: e.target.value }))} /></td>
                  <td style={td}><input style={input} type="date" value={draft.effective_to || ""} onChange={e => setDraft(d => ({ ...d, effective_to: e.target.value }))} /></td>
                  <td style={td}><input style={input} value={draft.remark || ""} onChange={e => setDraft(d => ({ ...d, remark: e.target.value }))} /></td>
                  <td style={td}>
                    <button onClick={save} style={btnPrimary}>✓ 保存</button>
                    <button onClick={cancelEdit} style={{ ...btn, marginLeft: 6 }}>取消</button>
                  </td>
                </tr>
              ) : (
                <tr key={r.id}>
                  <td style={{ ...td, fontWeight: 600, fontFamily: "Consolas,monospace" }}>{r.currency}</td>
                  <td style={{ ...td, fontFamily: "Consolas,monospace", textAlign: "right" }}>{Number(r.rate_to_cny).toFixed(4)}</td>
                  <td style={td}>{fmtDate(r.effective_from)}</td>
                  <td style={td}>{fmtDate(r.effective_to)}</td>
                  <td style={{ ...td, color: "#666", fontSize: 11 }}>{r.remark || ""}</td>
                  {canEdit && (
                    <td style={td}>
                      <button onClick={() => startEdit(r)} style={btn}>编辑</button>
                      <button onClick={() => remove(r)} style={{ ...btn, marginLeft: 6, color: "#c00" }}>删除</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

const tableStyle = { width: "100%", maxWidth: 900, borderCollapse: "collapse", fontSize: 12, border: "1px solid #eee" };
const th = { padding: 6, background: "#f5f5f5", border: "1px solid #ddd", textAlign: "left", fontWeight: 600 };
const td = { padding: 6, border: "1px solid #f0f0f0", verticalAlign: "middle" };
const btn = { padding: "3px 10px", cursor: "pointer", border: "1px solid #d9d9d9", background: "#fff", borderRadius: 3, fontSize: 11 };
const btnPrimary = { ...btn, background: "#1990ff", color: "#fff", border: "1px solid #1990ff", fontWeight: 600 };
const input = { width: "100%", padding: "4px 6px", fontSize: 12, border: "1px solid #ddd", borderRadius: 3, boxSizing: "border-box" };
const inputNum = { ...input, fontFamily: "Consolas,monospace", textAlign: "right" };
