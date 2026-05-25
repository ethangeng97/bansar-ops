// ChargeTypesList — 费用类型管理（CRUD）
// 重构：用 shell.css 类
import { useEffect, useState } from "react";
import { supabase } from "../supabase.js";

export default function ChargeTypesList({ onBack }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ keyword: "", category: "", status: "active" });
  const [editing, setEditing] = useState(null);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase.from("charge_items").select("*").order("sort").order("code");
    if (error) { alert("加载失败: " + error.message); setLoading(false); return; }
    setItems(data || []);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const filtered = items.filter(it => {
    if (filters.status === "active" && !it.active) return false;
    if (filters.status === "inactive" && it.active) return false;
    if (filters.category && it.category !== filters.category) return false;
    if (filters.keyword) {
      const k = filters.keyword.toLowerCase().trim();
      if (!(
        (it.code || "").toLowerCase().includes(k) ||
        (it.name_zh || "").toLowerCase().includes(k) ||
        (it.name_en || "").toLowerCase().includes(k)
      )) return false;
    }
    return true;
  });

  const categories = [...new Set(items.map(i => i.category).filter(Boolean))].sort();

  const onSave = async (form) => {
    if (!form.code?.trim() || !form.name_zh?.trim()) { alert("代码和中文名必填"); return; }
    const payload = {
      code: form.code.trim().toUpperCase(),
      name_zh: form.name_zh.trim(),
      name_en: (form.name_en || "").trim() || null,
      category: (form.category || "").trim() || null,
      sort: Number(form.sort) || 0,
      active: !!form.active,
    };
    const { error } = form.id
      ? await supabase.from("charge_items").update(payload).eq("id", form.id)
      : await supabase.from("charge_items").insert(payload);
    if (error) { alert("保存失败: " + error.message); return; }
    setEditing(null);
    await load();
  };

  const onToggleActive = async (it) => {
    if (!confirm(`确认${it.active ? "停用" : "启用"}「${it.name_zh}」？`)) return;
    const { error } = await supabase.from("charge_items").update({ active: !it.active }).eq("id", it.id);
    if (error) { alert("失败: " + error.message); return; }
    await load();
  };

  return (
    <>
      <h1 className="page-title">费用类型</h1>

      <div className="page-section-bar">
        <input className="field-input" placeholder="代码 / 中文名 / 英文名"
               value={filters.keyword} onChange={e => setFilters({ ...filters, keyword: e.target.value })}
               style={{ width: 240 }} />
        <select className="field-select" value={filters.category}
                onChange={e => setFilters({ ...filters, category: e.target.value })} style={{ width: 130 }}>
          <option value="">全部分类</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="field-select" value={filters.status}
                onChange={e => setFilters({ ...filters, status: e.target.value })} style={{ width: 110 }}>
          <option value="active">仅启用</option>
          <option value="inactive">仅停用</option>
          <option value="">全部</option>
        </select>
        <div style={{ flex: 1 }} />
        <span style={{ color: "var(--shell-text-3)", fontSize: 12 }}>{filtered.length} 项</span>
        <button className="btn primary" onClick={() => setEditing({ active: true, sort: items.length + 1 })}>
          + 新增
        </button>
      </div>

      <div className="page-card" style={{ padding: 0 }}>
        {loading ? <div className="empty-state empty-text">加载中...</div>
         : filtered.length === 0 ? <div className="empty-state empty-text">无费用类型</div>
         : (
          <table className="tms-table">
            <thead>
              <tr>
                <th style={{ width: 80 }}>代码</th>
                <th>中文名</th>
                <th>英文名</th>
                <th style={{ width: 100 }}>分类</th>
                <th style={{ width: 70, textAlign: "center" }}>排序</th>
                <th style={{ width: 70, textAlign: "center" }}>状态</th>
                <th style={{ width: 120, textAlign: "center" }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(it => (
                <tr key={it.id}>
                  <td style={{ fontFamily: "monospace", fontWeight: 600 }}>{it.code}</td>
                  <td>{it.name_zh}</td>
                  <td className="muted">{it.name_en || "—"}</td>
                  <td>{it.category || "—"}</td>
                  <td style={{ textAlign: "center" }}>{it.sort ?? 0}</td>
                  <td style={{ textAlign: "center" }}>
                    <span className={"badge " + (it.active ? "approved" : "")}>{it.active ? "启用" : "停用"}</span>
                  </td>
                  <td style={{ textAlign: "center" }}>
                    <button onClick={() => setEditing(it)}
                            style={{ border: "none", background: "none", color: "var(--shell-primary)", fontSize: 12, cursor: "pointer", fontWeight: 600 }}>
                      编辑
                    </button>
                    <span style={{ color: "var(--shell-border)", margin: "0 6px" }}>|</span>
                    <button onClick={() => onToggleActive(it)}
                            style={{ border: "none", background: "none", color: it.active ? "#ef4444" : "#10b981", fontSize: 12, cursor: "pointer", fontWeight: 600 }}>
                      {it.active ? "停用" : "启用"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editing && <Editor item={editing} onClose={() => setEditing(null)} onSave={onSave} />}
    </>
  );
}

function Editor({ item, onClose, onSave }) {
  const [form, setForm] = useState({
    id: item.id || null,
    code: item.code || "",
    name_zh: item.name_zh || "",
    name_en: item.name_en || "",
    category: item.category || "",
    sort: item.sort ?? 0,
    active: item.active ?? true,
  });
  const set = (k, v) => setForm(p => ({ ...p, [k]: v }));

  return (
    <Modal title={form.id ? "编辑费用类型" : "新增费用类型"} onClose={onClose} footer={
      <>
        <button className="btn" onClick={onClose}>取消</button>
        <button className="btn primary" onClick={() => onSave(form)}>保存</button>
      </>
    }>
      <Field label="代码" req>
        <input className="field-input" value={form.code} onChange={e => set("code", e.target.value.toUpperCase())}
               placeholder="如 OF / THC / DOC" maxLength={20} />
      </Field>
      <Field label="中文名" req>
        <input className="field-input" value={form.name_zh} onChange={e => set("name_zh", e.target.value)} placeholder="如 海运费" />
      </Field>
      <Field label="英文名">
        <input className="field-input" value={form.name_en} onChange={e => set("name_en", e.target.value)} placeholder="如 Ocean Freight" />
      </Field>
      <Field label="分类">
        <input className="field-input" value={form.category} onChange={e => set("category", e.target.value)} placeholder="如 海运 / 本地 / 文件" />
      </Field>
      <Field label="排序">
        <input className="field-input" type="number" value={form.sort} onChange={e => set("sort", e.target.value)} />
      </Field>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
        <input type="checkbox" checked={form.active} onChange={e => set("active", e.target.checked)} />
        启用此费用类型
      </label>
    </Modal>
  );
}

function Field({ label, req, children }) {
  return (
    <div className="field">
      <label className="field-label">{label}{req && <span className="req">*</span>}</label>
      {children}
    </div>
  );
}

function Modal({ title, children, footer, onClose }) {
  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,.35)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: 500, maxWidth: "90vw", background: "#fff", borderRadius: 6,
        boxShadow: "0 10px 30px rgba(0,0,0,.2)",
      }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--shell-border)", fontSize: 14, fontWeight: 600 }}>{title}</div>
        <div style={{ padding: 16 }}>{children}</div>
        <div style={{ padding: "10px 16px", borderTop: "1px solid var(--shell-border)", display: "flex", justifyContent: "flex-end", gap: 8 }}>{footer}</div>
      </div>
    </div>
  );
}
