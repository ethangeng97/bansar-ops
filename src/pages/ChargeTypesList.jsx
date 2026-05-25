// ============================================================================
// ChargeTypesList.jsx — 费用类型管理（CRUD）
// 路由：#/charge_types
// 数据源：charge_items 表（id, code, name_zh, name_en, category, sort, active）
// 操作：列表筛选 / 新增 / 编辑 / 启用-停用切换
// ============================================================================

import { useEffect, useState } from "react";
import { supabase } from "../supabase.js";

const BRAND = "#1f3864";

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
    <div style={{ padding: 16, background: "#f0f2f5", minHeight: "100vh" }}>
      <div style={{ background: "#fff", borderRadius: 4, padding: 16, boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, paddingBottom: 12, borderBottom: "1px solid #f0f0f0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {onBack && <button onClick={onBack} style={btn}>← 返回</button>}
            <span style={{ fontSize: 16, fontWeight: 700 }}>费用类型</span>
            <span style={{ marginLeft: 4, color: "#888", fontSize: 12 }}>共 {filtered.length} 项</span>
          </div>
          <button onClick={() => setEditing({ active: true, sort: items.length + 1 })}
                  style={{ ...btn, background: BRAND, color: "#fff", borderColor: BRAND }}>
            + 新增
          </button>
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center", fontSize: 12, flexWrap: "wrap" }}>
          <input placeholder="代码 / 中文名 / 英文名"
                 value={filters.keyword}
                 onChange={e => setFilters({ ...filters, keyword: e.target.value })}
                 style={{ flex: "0 0 240px", padding: "5px 8px", border: "1px solid #d9d9d9", borderRadius: 3, fontSize: 12 }} />
          <select value={filters.category} onChange={e => setFilters({ ...filters, category: e.target.value })} style={selStyle}>
            <option value="">全部分类</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={filters.status} onChange={e => setFilters({ ...filters, status: e.target.value })} style={selStyle}>
            <option value="active">仅启用</option>
            <option value="inactive">仅停用</option>
            <option value="">全部</option>
          </select>
        </div>

        {loading ? (
          <div style={{ padding: 30, textAlign: "center", color: "#888" }}>加载中...</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "#999" }}>无费用类型</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#fafafa", color: "#444" }}>
                <th style={{ ...th, width: 80 }}>代码</th>
                <th style={th}>中文名</th>
                <th style={th}>英文名</th>
                <th style={{ ...th, width: 90 }}>分类</th>
                <th style={{ ...th, textAlign: "center", width: 60 }}>排序</th>
                <th style={{ ...th, textAlign: "center", width: 70 }}>状态</th>
                <th style={{ ...th, textAlign: "center", width: 110 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(it => (
                <tr key={it.id} style={{ borderBottom: "1px solid #f0f0f0" }}>
                  <td style={{ ...td, fontFamily: "monospace", fontWeight: 600 }}>{it.code}</td>
                  <td style={td}>{it.name_zh}</td>
                  <td style={{ ...td, color: "#666" }}>{it.name_en || "—"}</td>
                  <td style={td}>{it.category || "—"}</td>
                  <td style={{ ...td, textAlign: "center" }}>{it.sort ?? 0}</td>
                  <td style={{ ...td, textAlign: "center" }}>
                    <span style={{
                      padding: "2px 8px", fontSize: 11, borderRadius: 2,
                      background: it.active ? "#f6ffed" : "#fafafa",
                      color: it.active ? "#52c41a" : "#888",
                      border: it.active ? "1px solid #b7eb8f" : "1px solid #e8e8e8",
                    }}>
                      {it.active ? "启用" : "停用"}
                    </span>
                  </td>
                  <td style={{ ...td, textAlign: "center" }}>
                    <button onClick={() => setEditing(it)} style={linkBtn}>编辑</button>
                    <span style={{ color: "#ddd", margin: "0 4px" }}>|</span>
                    <button onClick={() => onToggleActive(it)} style={linkBtn}>
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
    </div>
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
    <div style={modalBg} onClick={onClose}>
      <div style={modal} onClick={e => e.stopPropagation()}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 14 }}>
          {form.id ? "编辑费用类型" : "新增费用类型"}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "100px 1fr", gap: 10, alignItems: "center", fontSize: 12 }}>
          <span>代码 *</span>
          <input value={form.code} onChange={e => set("code", e.target.value.toUpperCase())} style={input} placeholder="如 OF / THC / DOC" maxLength={20} />
          <span>中文名 *</span>
          <input value={form.name_zh} onChange={e => set("name_zh", e.target.value)} style={input} placeholder="如 海运费" />
          <span>英文名</span>
          <input value={form.name_en} onChange={e => set("name_en", e.target.value)} style={input} placeholder="如 Ocean Freight" />
          <span>分类</span>
          <input value={form.category} onChange={e => set("category", e.target.value)} style={input} placeholder="如 海运 / 本地 / 文件" list="cat-suggest" />
          <span>排序</span>
          <input type="number" value={form.sort} onChange={e => set("sort", e.target.value)} style={input} />
          <span>启用</span>
          <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={form.active} onChange={e => set("active", e.target.checked)} />
            <span style={{ color: "#666", fontSize: 12 }}>启用此费用类型</span>
          </label>
        </div>
        <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onClose} style={btn}>取消</button>
          <button onClick={() => onSave(form)} style={{ ...btn, background: BRAND, color: "#fff", borderColor: BRAND }}>保存</button>
        </div>
      </div>
    </div>
  );
}

const th = { padding: "7px 6px", textAlign: "left", borderBottom: "1px solid #e8e8e8", fontWeight: 600 };
const td = { padding: 6 };
const btn = { padding: "5px 14px", background: "#fff", border: "1px solid #d9d9d9", borderRadius: 3, fontSize: 12, cursor: "pointer" };
const linkBtn = { background: "none", border: "none", color: "#1990ff", cursor: "pointer", fontSize: 12, padding: 0 };
const selStyle = { padding: "5px 8px", border: "1px solid #d9d9d9", borderRadius: 3, fontSize: 12 };
const input = { padding: "5px 8px", border: "1px solid #d9d9d9", borderRadius: 3, fontSize: 12 };
const modalBg = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" };
const modal = { background: "#fff", borderRadius: 4, padding: 20, width: 460, boxShadow: "0 4px 16px rgba(0,0,0,0.2)" };
