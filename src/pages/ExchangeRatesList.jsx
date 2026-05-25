// 汇率设置 #/exchange_rates — 重构为 shell.css 风格
import { useState, useEffect } from "react";
import { supabase } from "../supabase.js";

export default function ExchangeRatesList({ user, onBack }) {
  const role = user?.profile?.role || "operator";
  const canEdit = role === "admin" || role === "finance";

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [edId, setEdId] = useState(null);
  const [draft, setDraft] = useState({});

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
  const cellInput = { width: "100%", padding: "4px 6px", border: "1px solid var(--shell-primary)", borderRadius: 3, fontSize: 12, boxSizing: "border-box" };

  return (
    <>
      <h1 className="page-title">汇率设置</h1>

      <div className="page-section-bar">
        <span style={{ flex: 1, color: "var(--shell-text-2)", fontSize: 12 }}>
          汇率仅作 CNY 折算参考（amount_cny = amount × rate）。同币种多条按 effective_from 取最新。
          {!canEdit && <span style={{ marginLeft: 8, color: "#f59e0b" }}>(只读：仅 admin / finance 可编辑)</span>}
        </span>
        <button className="btn" onClick={load}>刷新</button>
        {canEdit && <button className="btn primary" onClick={startNew}>+ 新建汇率</button>}
      </div>

      <div className="page-card" style={{ padding: 0 }}>
        {loading ? <div className="empty-state empty-text">加载中…</div>
         : rows.length === 0 && edId !== "new" ? <div className="empty-state empty-text">暂无汇率记录</div>
         : (
          <table className="tms-table">
            <thead>
              <tr>
                <th>币种</th>
                <th style={{ textAlign: "right" }}>汇率 (1 外币 = X CNY)</th>
                <th>生效起</th>
                <th>失效至</th>
                <th>备注</th>
                {canEdit && <th style={{ width: 160 }}>操作</th>}
              </tr>
            </thead>
            <tbody>
              {edId === "new" && (
                <tr style={{ background: "var(--shell-primary-50)" }}>
                  <td><input style={cellInput} value={draft.currency || ""} onChange={e => setDraft(d => ({ ...d, currency: e.target.value.toUpperCase() }))} placeholder="如 USD" maxLength={6} /></td>
                  <td><input style={{ ...cellInput, fontFamily: "monospace", textAlign: "right" }} type="number" step="0.0001" value={draft.rate_to_cny || ""} onChange={e => setDraft(d => ({ ...d, rate_to_cny: e.target.value }))} /></td>
                  <td><input style={cellInput} type="date" value={draft.effective_from || ""} onChange={e => setDraft(d => ({ ...d, effective_from: e.target.value }))} /></td>
                  <td><input style={cellInput} type="date" value={draft.effective_to || ""} onChange={e => setDraft(d => ({ ...d, effective_to: e.target.value }))} /></td>
                  <td><input style={cellInput} value={draft.remark || ""} onChange={e => setDraft(d => ({ ...d, remark: e.target.value }))} /></td>
                  <td>
                    <button className="btn primary" onClick={save} style={{ padding: "3px 10px", fontSize: 12 }}>✓ 保存</button>
                    <button className="btn" onClick={cancelEdit} style={{ padding: "3px 10px", fontSize: 12, marginLeft: 4 }}>取消</button>
                  </td>
                </tr>
              )}
              {rows.map(r => edId === r.id ? (
                <tr key={r.id} style={{ background: "var(--shell-primary-50)" }}>
                  <td><input style={cellInput} value={draft.currency || ""} onChange={e => setDraft(d => ({ ...d, currency: e.target.value.toUpperCase() }))} maxLength={6} /></td>
                  <td><input style={{ ...cellInput, fontFamily: "monospace", textAlign: "right" }} type="number" step="0.0001" value={draft.rate_to_cny || ""} onChange={e => setDraft(d => ({ ...d, rate_to_cny: e.target.value }))} /></td>
                  <td><input style={cellInput} type="date" value={draft.effective_from || ""} onChange={e => setDraft(d => ({ ...d, effective_from: e.target.value }))} /></td>
                  <td><input style={cellInput} type="date" value={draft.effective_to || ""} onChange={e => setDraft(d => ({ ...d, effective_to: e.target.value }))} /></td>
                  <td><input style={cellInput} value={draft.remark || ""} onChange={e => setDraft(d => ({ ...d, remark: e.target.value }))} /></td>
                  <td>
                    <button className="btn primary" onClick={save} style={{ padding: "3px 10px", fontSize: 12 }}>✓ 保存</button>
                    <button className="btn" onClick={cancelEdit} style={{ padding: "3px 10px", fontSize: 12, marginLeft: 4 }}>取消</button>
                  </td>
                </tr>
              ) : (
                <tr key={r.id}>
                  <td style={{ fontWeight: 600, fontFamily: "monospace" }}>{r.currency}</td>
                  <td style={{ fontFamily: "monospace", textAlign: "right" }}>{Number(r.rate_to_cny).toFixed(4)}</td>
                  <td>{fmtDate(r.effective_from)}</td>
                  <td>{fmtDate(r.effective_to)}</td>
                  <td className="muted">{r.remark || ""}</td>
                  {canEdit && (
                    <td>
                      <button onClick={() => startEdit(r)} style={{ border: "none", background: "none", color: "var(--shell-primary)", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>编辑</button>
                      <span style={{ color: "var(--shell-border)", margin: "0 6px" }}>|</span>
                      <button onClick={() => remove(r)} style={{ border: "none", background: "none", color: "#ef4444", cursor: "pointer", fontSize: 12, fontWeight: 600 }}>删除</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
