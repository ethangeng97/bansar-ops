// ============================================================================
// UserRolesList.jsx — 用户角色管理（仅 admin）
// 路由：#/user-admin
//   Tab1 用户：列出账号、下拉改角色、新建账号、重置密码
//   Tab2 角色：增删改角色目录（data_scope 财务范围 + page_access 页面权限）
// 角色目录存 roles 表；账号创建/改密走 edge function admin-user-management。
// ============================================================================

import { useEffect, useState } from "react";
import { supabase } from "../supabase.js";

const BRAND = "#1f3864";

const ALL_PAGES = [
  ["dashboard", "工作台"], ["orders", "订单"], ["charges", "费用"], ["billing", "账单/对账单"],
  ["payments", "收付款"], ["invoices", "开票记录"], ["invoice_requests", "开票申请"],
  ["documents", "单证"], ["settings", "设置"], ["manage", "数据管理"], ["user_admin", "用户角色管理"],
];
const SCOPES = [["all", "全部(应收+应付)"], ["ar", "仅应收"], ["ap", "仅应付"], ["none", "无财务数据"]];
const SCOPE_LABEL = Object.fromEntries(SCOPES);

export default function UserRolesList({ onBack }) {
  const [tab, setTab] = useState("users");
  const [roles, setRoles] = useState([]);
  const [users, setUsers] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAccount, setShowAccount] = useState(false);
  const [resetUser, setResetUser] = useState(null);
  const [editRole, setEditRole] = useState(null); // role row or {} for new

  const load = async () => {
    setLoading(true);
    const [{ data: r }, { data: u }, { data: c }] = await Promise.all([
      supabase.from("roles").select("*").order("sort"),
      supabase.from("user_profiles_view").select("*"),
      supabase.from("customers").select("id, name").order("name"),
    ]);
    setRoles(r || []);
    setUsers(u || []);
    setCustomers(c || []);
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const roleLabel = (key) => roles.find(x => x.key === key)?.label || key || "—";

  const changeRole = async (u, newRole) => {
    if (newRole === u.role) return;
    if (!confirm(`将「${u.display_name || u.full_name || u.id}」的角色改为「${roleLabel(newRole)}」？`)) return;
    const { error } = await supabase.from("user_profiles").update({ role: newRole }).eq("id", u.id);
    if (error) { alert("修改失败：" + error.message); return; }
    await load();
  };

  const delRole = async (r) => {
    if (r.is_system) { alert("系统角色不可删除"); return; }
    if (!confirm(`确认删除角色「${r.label}」(${r.key})？\n若仍有用户使用该角色将被数据库拒绝。`)) return;
    const { error } = await supabase.from("roles").delete().eq("key", r.key);
    if (error) { alert("删除失败：" + (error.message.includes("violates foreign key") ? "仍有用户在使用该角色" : error.message)); return; }
    await load();
  };

  return (
    <div style={{ padding: 16, background: "#f0f2f5", minHeight: "100vh" }}>
      <div style={{ background: "#fff", borderRadius: 4, padding: 16, boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
                      marginBottom: 12, paddingBottom: 12, borderBottom: "1px solid #f0f0f0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {onBack && <button onClick={onBack} style={btn}>← 返回</button>}
            <span style={{ fontSize: 16, fontWeight: 700 }}>用户角色管理</span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {tab === "users" && <button onClick={() => setShowAccount(true)} style={btnPrimary}>+ 新建账号</button>}
            {tab === "roles" && <button onClick={() => setEditRole({ _new: true, data_scope: "all", is_internal: true, page_access: [] })} style={btnPrimary}>+ 新建角色</button>}
          </div>
        </div>

        {/* Tab */}
        <div style={{ display: "flex", marginBottom: 14, borderBottom: "1px solid #e8e8e8" }}>
          {[["users", "用户"], ["roles", "角色"]].map(([k, l]) => (
            <div key={k} onClick={() => setTab(k)}
                 style={{ padding: "10px 24px", cursor: "pointer", color: tab === k ? BRAND : "#666",
                          fontWeight: tab === k ? 700 : 500, fontSize: 13,
                          borderBottom: tab === k ? `2px solid ${BRAND}` : "2px solid transparent", marginBottom: -1 }}>
              {l}
            </div>
          ))}
        </div>

        {loading ? <div style={{ padding: 30, textAlign: "center", color: "#888" }}>加载中...</div> : tab === "users" ? (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#fafafa", color: "#444" }}>
                <th style={th}>姓名</th><th style={th}>角色</th><th style={th}>关联客户</th>
                <th style={{ ...th, textAlign: "center" }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} style={{ borderBottom: "1px solid #f5f5f5" }}>
                  <td style={td}>{u.display_name || u.full_name || <span style={{ color: "#bbb", fontFamily: "Consolas,monospace" }}>{u.id.slice(0, 8)}…</span>}</td>
                  <td style={td}>
                    <select value={u.role || ""} onChange={e => changeRole(u, e.target.value)} style={sel}>
                      {!u.role && <option value="">（未设）</option>}
                      {roles.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
                    </select>
                  </td>
                  <td style={td}>{u.customer_id ? (customers.find(c => c.id === u.customer_id)?.name || u.customer_id.slice(0, 8)) : "—"}</td>
                  <td style={{ ...td, textAlign: "center" }}>
                    <a onClick={() => setResetUser(u)} style={{ color: "#1990ff", cursor: "pointer" }}>重置密码</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#fafafa", color: "#444" }}>
                <th style={th}>角色</th><th style={th}>标识</th><th style={th}>财务范围</th>
                <th style={th}>可访问页面</th><th style={{ ...th, textAlign: "center" }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {roles.map(r => (
                <tr key={r.key} style={{ borderBottom: "1px solid #f5f5f5" }}>
                  <td style={td}>{r.label}{r.is_system && <span style={{ marginLeft: 6, fontSize: 10, color: "#999" }}>系统</span>}</td>
                  <td style={{ ...td, fontFamily: "Consolas,monospace", color: "#888" }}>{r.key}</td>
                  <td style={td}>{SCOPE_LABEL[r.data_scope] || r.data_scope}</td>
                  <td style={{ ...td, color: "#666", fontSize: 11 }}>{(r.page_access || []).length} 个页面</td>
                  <td style={{ ...td, textAlign: "center", whiteSpace: "nowrap" }}>
                    <a onClick={() => setEditRole(r)} style={{ color: "#1990ff", cursor: "pointer", marginRight: 10 }}>编辑</a>
                    {!r.is_system && <a onClick={() => delRole(r)} style={{ color: "#ff4d4f", cursor: "pointer" }}>删除</a>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showAccount && <AccountDialog roles={roles} customers={customers} onClose={() => setShowAccount(false)} onDone={() => { setShowAccount(false); load(); }} />}
      {resetUser && <ResetPwdDialog user={resetUser} onClose={() => setResetUser(null)} onDone={() => setResetUser(null)} />}
      {editRole && <RoleDialog role={editRole} onClose={() => setEditRole(null)} onDone={() => { setEditRole(null); load(); }} />}
    </div>
  );
}

// ── 新建账号 ──
function AccountDialog({ roles, customers, onClose, onDone }) {
  const [f, setF] = useState({ email: "", password: "", role: "operator", name: "", customer_id: "" });
  const [busy, setBusy] = useState(false);
  const needCustomer = ["customer", "supplier"].includes(f.role);

  const submit = async () => {
    if (!f.email || !f.password) { alert("邮箱和密码必填"); return; }
    if (f.password.length < 6) { alert("密码至少 6 位"); return; }
    if (needCustomer && !f.customer_id) { alert("该角色需选择关联客户"); return; }
    setBusy(true);
    try {
      await supabase.api("/functions/v1/admin-user-management", {
        method: "POST",
        body: JSON.stringify({ action: "create", email: f.email.trim(), password: f.password,
          role: f.role, name: f.name || null, customer_id: needCustomer ? f.customer_id : undefined }),
      });
      alert("✓ 账号已创建");
      onDone();
    } catch (e) { alert("创建失败：" + (e?.message || e)); }
    finally { setBusy(false); }
  };

  return (
    <Modal title="新建账号" onClose={onClose}>
      <Row label="邮箱 *"><input value={f.email} onChange={e => setF({ ...f, email: e.target.value })} style={inp} placeholder="user@bansargroup.com" /></Row>
      <Row label="初始密码 *"><input value={f.password} onChange={e => setF({ ...f, password: e.target.value })} style={inp} placeholder="≥6 位" /></Row>
      <Row label="姓名"><input value={f.name} onChange={e => setF({ ...f, name: e.target.value })} style={inp} /></Row>
      <Row label="角色 *">
        <select value={f.role} onChange={e => setF({ ...f, role: e.target.value })} style={inp}>
          {roles.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
        </select>
      </Row>
      {needCustomer && (
        <Row label="关联客户 *">
          <select value={f.customer_id} onChange={e => setF({ ...f, customer_id: e.target.value })} style={inp}>
            <option value="">请选择</option>
            {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Row>
      )}
      <Footer><button onClick={onClose} style={btn} disabled={busy}>取消</button>
        <button onClick={submit} style={btnPrimary} disabled={busy}>{busy ? "创建中..." : "创建"}</button></Footer>
    </Modal>
  );
}

// ── 重置密码 ──
function ResetPwdDialog({ user, onClose, onDone }) {
  const [pwd, setPwd] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (pwd.length < 6) { alert("密码至少 6 位"); return; }
    setBusy(true);
    try {
      await supabase.api("/functions/v1/admin-user-management", {
        method: "POST", body: JSON.stringify({ action: "reset_password", user_id: user.id, new_password: pwd }),
      });
      alert("✓ 密码已重置");
      onDone();
    } catch (e) { alert("失败：" + (e?.message || e)); }
    finally { setBusy(false); }
  };
  return (
    <Modal title={`重置密码 · ${user.display_name || user.full_name || ""}`} onClose={onClose}>
      <Row label="新密码 *"><input value={pwd} onChange={e => setPwd(e.target.value)} style={inp} placeholder="≥6 位" /></Row>
      <Footer><button onClick={onClose} style={btn} disabled={busy}>取消</button>
        <button onClick={submit} style={btnPrimary} disabled={busy}>{busy ? "提交中..." : "确认重置"}</button></Footer>
    </Modal>
  );
}

// ── 新建/编辑角色 ──
function RoleDialog({ role, onClose, onDone }) {
  const isNew = !!role._new;
  const [f, setF] = useState({
    key: role.key || "", label: role.label || "", data_scope: role.data_scope || "all",
    is_internal: role.is_internal ?? true, page_access: role.page_access || [], sort: role.sort || 100,
  });
  const [busy, setBusy] = useState(false);
  const togglePage = (p) => setF(s => ({ ...s, page_access: s.page_access.includes(p) ? s.page_access.filter(x => x !== p) : [...s.page_access, p] }));

  const submit = async () => {
    if (isNew && !/^[a-z][a-z0-9_]*$/.test(f.key)) { alert("角色标识用小写字母/数字/下划线，且以字母开头，如 finance_ar"); return; }
    if (!f.label.trim()) { alert("请填角色名称"); return; }
    setBusy(true);
    const payload = { label: f.label.trim(), data_scope: f.data_scope, is_internal: f.is_internal, page_access: f.page_access, sort: Number(f.sort) || 100 };
    let error;
    if (isNew) ({ error } = await supabase.from("roles").insert({ key: f.key, ...payload }));
    else       ({ error } = await supabase.from("roles").update(payload).eq("key", role.key));
    setBusy(false);
    if (error) { alert("保存失败：" + error.message); return; }
    onDone();
  };

  return (
    <Modal title={isNew ? "新建角色" : `编辑角色 · ${role.label}`} onClose={onClose}>
      <Row label="角色标识 *">
        <input value={f.key} disabled={!isNew} onChange={e => setF({ ...f, key: e.target.value })}
               style={{ ...inp, background: isNew ? "#fff" : "#f5f5f5", fontFamily: "Consolas,monospace" }} placeholder="如 finance_ar" />
      </Row>
      <Row label="角色名称 *"><input value={f.label} onChange={e => setF({ ...f, label: e.target.value })} style={inp} placeholder="如 应收财务" /></Row>
      <Row label="财务数据范围">
        <select value={f.data_scope} onChange={e => setF({ ...f, data_scope: e.target.value })} style={inp}>
          {SCOPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </Row>
      <Row label="内部角色">
        <label style={{ fontSize: 12 }}><input type="checkbox" checked={f.is_internal} onChange={e => setF({ ...f, is_internal: e.target.checked })} /> 内部员工角色（可读内部财务数据；客户/供应商类请取消勾选）</label>
      </Row>
      <div style={{ marginTop: 6 }}>
        <div style={{ ...lbl, marginBottom: 6 }}>可访问页面</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6 }}>
          {ALL_PAGES.map(([p, l]) => (
            <label key={p} style={{ fontSize: 12 }}>
              <input type="checkbox" checked={f.page_access.includes(p)} onChange={() => togglePage(p)} /> {l}
            </label>
          ))}
        </div>
      </div>
      <Footer><button onClick={onClose} style={btn} disabled={busy}>取消</button>
        <button onClick={submit} style={btnPrimary} disabled={busy}>{busy ? "保存中..." : "保存"}</button></Footer>
    </Modal>
  );
}

// ── 小组件 ──
function Modal({ title, onClose, children }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
         display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 6, width: 480, maxWidth: "92vw",
           maxHeight: "90vh", overflowY: "auto", boxShadow: "0 4px 32px rgba(0,0,0,0.15)" }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid #f0f0f0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{title}</span>
          <a onClick={onClose} style={{ cursor: "pointer", color: "#888", fontSize: 18 }}>×</a>
        </div>
        <div style={{ padding: 16 }}>{children}</div>
      </div>
    </div>
  );
}
function Row({ label, children }) {
  return <div style={{ marginBottom: 10 }}><div style={lbl}>{label}</div>{children}</div>;
}
function Footer({ children }) {
  return <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid #f0f0f0", display: "flex", justifyContent: "flex-end", gap: 8 }}>{children}</div>;
}

const th = { padding: "7px 6px", textAlign: "left", borderBottom: "1px solid #e8e8e8", fontWeight: 600 };
const td = { padding: 6 };
const lbl = { display: "block", color: "#666", marginBottom: 4, fontSize: 11 };
const inp = { width: "100%", padding: "5px 8px", border: "1px solid #d9d9d9", borderRadius: 3, fontSize: 12, boxSizing: "border-box" };
const sel = { padding: "4px 6px", border: "1px solid #d9d9d9", borderRadius: 3, fontSize: 12 };
const btn = { padding: "5px 14px", background: "#fff", border: "1px solid #d9d9d9", borderRadius: 3, fontSize: 12, cursor: "pointer" };
const btnPrimary = { ...btn, background: "#1990ff", color: "#fff", border: "1px solid #1990ff", fontWeight: 600 };
