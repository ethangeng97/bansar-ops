// ═══════════════════════════════════════════════════════════════
// 客商管理 (Partners.jsx)
// - 7 种 partner_type tab：客户/供应商/船东/海外代理/车队/报关行/仓库
// - 列表 + 筛选 + 新建 + 编辑 + 启用停用
// - 自动 code 生成（C001 / S001 / V001 / A001 / T001 / B001 / W001）
// ═══════════════════════════════════════════════════════════════

import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "../supabase.js";
import { TmsTitle, Mi, Tbl, TmsInfoBar, TmsPagination } from "../components/tms.jsx";

// 7 种 partner_type 定义
const PARTNER_TYPES = [
  { key: "客户",    code: "C", colorBg: "#e6f4ff", colorFg: "#1990FF" },
  { key: "供应商",  code: "S", colorBg: "#f6ffed", colorFg: "#52c41a" },
  { key: "船东",    code: "V", colorBg: "#fff7e6", colorFg: "#fa8c16" },
  { key: "海外代理", code: "A", colorBg: "#f9f0ff", colorFg: "#722ed1" },
  { key: "车队",    code: "T", colorBg: "#fff1f0", colorFg: "#cf1322" },
  { key: "报关行",  code: "B", colorBg: "#fcffe6", colorFg: "#a0d911" },
  { key: "仓库",    code: "W", colorBg: "#e6fffb", colorFg: "#13c2c2" },
];

// 列定义
const PARTNER_COLS = [
  { k: "chk",     w: 30,  label: "" },
  { k: "code",    w: 80,  label: "编号" },
  { k: "name",    w: 220, label: "名称(中文)", link: true },
  { k: "name_en", w: 200, label: "英文名" },
  { k: "name_sh", w: 100, label: "简称" },
  { k: "contact", w: 90,  label: "联系人" },
  { k: "phone",   w: 130, label: "电话" },
  { k: "email",   w: 180, label: "邮箱" },
  { k: "credit",  w: 100, label: "信用条款" },
  { k: "active",  w: 70,  label: "状态", center: true },
  { k: "use",     w: 80,  label: "订单数", center: true },
];
const PARTNER_COL_WIDTHS_KEY = "bansar_partners_col_widths_v1";

// ═══════════════════════════════════════════════════════════════
// 主组件
// ═══════════════════════════════════════════════════════════════

export function PartnersPage({ user, onBack }) {
  const role = user.profile?.role || "operator";
  const [partners, setPartners] = useState([]);
  const [orderCounts, setOrderCounts] = useState({});  // {partner_name: count}
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("客户");
  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [page, setPage] = useState(0);
  const [pageSize] = useState(50);

  // 列宽
  const [colWidths, setColWidths] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(PARTNER_COL_WIDTHS_KEY) || "{}");
      return Object.fromEntries(PARTNER_COLS.map(c => [c.k, saved[c.k] || c.w]));
    } catch {
      return Object.fromEntries(PARTNER_COLS.map(c => [c.k, c.w]));
    }
  });
  const startColResize = (colKey, e) => {
    e.preventDefault(); e.stopPropagation();
    const startX = e.clientX;
    const startW = colWidths[colKey];
    const onMove = (ev) => {
      const newW = Math.max(40, startW + (ev.clientX - startX));
      setColWidths(p => ({ ...p, [colKey]: newW }));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      setColWidths(latest => {
        try { localStorage.setItem(PARTNER_COL_WIDTHS_KEY, JSON.stringify(latest)); } catch {}
        return latest;
      });
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };
  const resetColWidth = (colKey) => {
    const def = PARTNER_COLS.find(c => c.k === colKey);
    if (def) {
      const next = { ...colWidths, [colKey]: def.w };
      setColWidths(next);
      try { localStorage.setItem(PARTNER_COL_WIDTHS_KEY, JSON.stringify(next)); } catch {}
    }
  };
  const cols = PARTNER_COLS.map(c => ({ ...c, w: colWidths[c.k] }));
  const totalW = cols.reduce((a, c) => a + c.w, 0);

  // 加载客商
  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("customers")
      .select("*")
      .order("code", { ascending: true });
    if (!error) setPartners(data || []);
    setLoading(false);
  }, []);

  // 加载订单引用数
  const loadOrderCounts = useCallback(async () => {
    // 统计每个 customer 字段值的引用数（委托单位）
    const { data: customerRefs } = await supabase.from("shipments")
      .select("customer")
      .not("customer", "is", null);
    const { data: agentRefs } = await supabase.from("shipments")
      .select("overseas_agent")
      .not("overseas_agent", "is", null);

    const counts = {};
    (customerRefs || []).forEach(r => {
      if (r.customer) counts[r.customer] = (counts[r.customer] || 0) + 1;
    });
    (agentRefs || []).forEach(r => {
      if (r.overseas_agent) counts[r.overseas_agent] = (counts[r.overseas_agent] || 0) + 1;
    });
    setOrderCounts(counts);
  }, []);

  useEffect(() => { load(); loadOrderCounts(); }, [load, loadOrderCounts]);

  // 按 tab 过滤 + 搜索 + 启用过滤
  const filtered = useMemo(() => {
    return partners.filter(p => {
      if (p.partner_type !== tab) return false;
      if (!showInactive && p.active === false) return false;
      if (search) {
        const q = search.toLowerCase();
        const pool = [p.name, p.name_en, p.name_short, p.code, p.contact_name, p.contact_phone, p.contact_email].filter(Boolean).join(" ").toLowerCase();
        if (!pool.includes(q)) return false;
      }
      return true;
    });
  }, [partners, tab, showInactive, search]);

  const tabCounts = useMemo(() => {
    const counts = {};
    PARTNER_TYPES.forEach(pt => {
      counts[pt.key] = partners.filter(p => p.partner_type === pt.key && (showInactive || p.active !== false)).length;
    });
    return counts;
  }, [partners, showInactive]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paged = filtered.slice(page * pageSize, (page + 1) * pageSize);

  const selPartner = partners.find(p => p.id === selectedId);

  if (loading) return <div style={{ padding: 50, textAlign: "center" }}>加载中...</div>;
  if (selPartner) return (
    <PartnerDetail
      partner={selPartner}
      role={role}
      user={user}
      orderCount={orderCounts[selPartner.name] || 0}
      onBack={() => { setSelectedId(null); load(); }}
      onReload={load}
    />
  );

  return (
    <div className="tms">
      <TmsTitle title="客商管理 / 海运出口" user={user} role={role} onClose={onBack} />

      {/* 工具栏 */}
      <div className="tms-tb">
        <Mi onClick={onBack}>返回</Mi>
        <Tbl/>
        <Mi onClick={() => setShowNew(true)}>新建客商</Mi>
        <Mi onClick={load}>刷新</Mi>
        <Tbl/>
        <Mi disabled>导出</Mi>
        <Mi disabled>导入</Mi>
        <Tbl/>
        <Mi checked={showInactive} onClick={() => setShowInactive(s => !s)}>显示已停用</Mi>
      </div>

      {/* partner_type tabs */}
      <div className="tms-bigtabs">
        {PARTNER_TYPES.map(pt => (
          <div
            key={pt.key}
            className={"bt " + (tab === pt.key ? "act" : "")}
            onClick={() => { setTab(pt.key); setPage(0); }}
            style={tab === pt.key ? {} : {}}
          >
            <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: pt.colorFg, marginRight: 6 }}></span>
            {pt.key}
            <span style={{ marginLeft: 6, color: "#888", fontSize: 11 }}>({tabCounts[pt.key] || 0})</span>
          </div>
        ))}
      </div>

      {/* 筛选条 */}
      <div className="tms-filter-bar" style={{ padding: "8px 14px", background: "#e6f4ff", borderBottom: "1px solid #c8dfff", display: "flex", gap: 12, alignItems: "center", fontSize: 12 }}>
        <span>搜索:</span>
        <input
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(0); }}
          placeholder="编号 / 名称 / 简称 / 联系人 / 电话 / 邮箱"
          style={{ width: 320, height: 22, padding: "1px 8px", border: "1px solid #c1c1c1", borderRadius: 3, fontSize: 12 }}
        />
        {search && <span style={{ color: "#1990FF", cursor: "pointer", textDecoration: "underline" }} onClick={() => { setSearch(""); setPage(0); }}>清除</span>}
      </div>

      {/* 信息栏 */}
      <TmsInfoBar scope="分公司">
        当前: <b>{tab}</b>
        总数: <b>{filtered.length}</b>
      </TmsInfoBar>

      {/* 表格 */}
      <div className="tms-list">
        <table style={{ minWidth: totalW }}>
          <colgroup>
            {cols.map(c => <col key={c.k} style={{ width: c.w }} />)}
          </colgroup>
          <thead>
            <tr>
              {cols.map(c => (
                <th key={c.k} className={c.link ? "link" : ""}>
                  {c.k === "chk" ? <input type="checkbox" disabled /> : <span className="ht">{c.label}</span>}
                  <span className="col-resize" onMouseDown={e => startColResize(c.k, e)} onDoubleClick={() => resetColWidth(c.k)} title="拖动调整列宽" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paged.map((p, i) => {
              const evenOdd = i % 2 === 0 ? "even" : "odd";
              const useCount = orderCounts[p.name] || 0;
              return (
                <tr key={p.id} className={evenOdd}>
                  <td className="center"><input type="checkbox" /></td>
                  <td><b style={{ color: "#666" }}>{p.code || "—"}</b></td>
                  <td><span className="lk" onClick={() => setSelectedId(p.id)}>{p.name}</span></td>
                  <td>{p.name_en || ""}</td>
                  <td>{p.name_short || ""}</td>
                  <td>{p.contact_name || ""}</td>
                  <td>{p.contact_phone || ""}</td>
                  <td>{p.contact_email || ""}</td>
                  <td>{p.credit_terms || ""}</td>
                  <td className="center">
                    {p.active === false
                      ? <span style={{ color: "#999", fontSize: 11 }}>已停用</span>
                      : <span style={{ color: "#52c41a", fontSize: 11 }}>● 启用</span>}
                  </td>
                  <td className="center">{useCount > 0 ? <b style={{ color: "#1990FF" }}>{useCount}</b> : <span style={{ color: "#bbb" }}>—</span>}</td>
                </tr>
              );
            })}
            {paged.length === 0 && (
              <tr><td colSpan={cols.length} style={{ textAlign: "center", padding: 30, color: "#999" }}>暂无数据</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <TmsPagination page={page} setPage={setPage} totalPages={totalPages} pageSize={pageSize} total={filtered.length} />

      {showNew && (
        <PartnerEditModal
          mode="create"
          defaultType={tab}
          existingCodes={partners.map(p => p.code).filter(Boolean)}
          onClose={() => setShowNew(false)}
          onSaved={() => { setShowNew(false); load(); }}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// 客商详情页
// ═══════════════════════════════════════════════════════════════

function PartnerDetail({ partner, role, user, orderCount, onBack, onReload }) {
  const [editing, setEditing] = useState(false);
  const [ed, setEd] = useState({});

  const startEdit = () => { setEd({ ...partner }); setEditing(true); };
  const cancel = () => setEditing(false);
  const save = async () => {
    const changes = {};
    for (const k of Object.keys(ed)) {
      if (ed[k] !== partner[k] && !["id", "created_at", "updated_at"].includes(k)) {
        changes[k] = ed[k] === "" ? null : ed[k];
      }
    }
    if (Object.keys(changes).length) {
      const { error } = await supabase.from("customers").update(changes).eq("id", partner.id);
      if (error) { alert(error.message); return; }
    }
    setEditing(false);
    onReload();
  };

  // 启用/停用切换
  const toggleActive = async () => {
    const newActive = partner.active === false ? true : false;
    const action = newActive ? "启用" : "停用";
    if (!confirm(`确定${action}客商「${partner.name}」？`)) return;
    const { error } = await supabase.from("customers").update({ active: newActive }).eq("id", partner.id);
    if (error) { alert(error.message); return; }
    onReload();
  };

  // 删除（仅当无订单引用时）
  const tryDelete = async () => {
    if (orderCount > 0) {
      alert(`该客商已被 ${orderCount} 个订单使用，无法删除。\n\n建议：先停用此客商（订单数据保留，但不再出现在新建订单的下拉选项里）。`);
      return;
    }
    if (!confirm(`确定永久删除客商「${partner.name}」？\n此操作不可恢复。`)) return;
    const { error } = await supabase.from("customers").delete().eq("id", partner.id);
    if (error) { alert(error.message); return; }
    onBack();
  };

  const v = (f) => editing ? (ed[f] ?? "") : (partner[f] ?? "");
  const ch = (f, val) => setEd(p => ({ ...p, [f]: val }));
  const pt = PARTNER_TYPES.find(t => t.key === partner.partner_type) || PARTNER_TYPES[0];

  return (
    <div className="tms">
      <TmsTitle title={`客商详情 / ${partner.partner_type}`} user={user} role={role} onClose={onBack} />

      <div className="tms-dtb1">
        <Mi onClick={onBack}>返回</Mi>
        <Tbl/>
        {!editing ? (
          <Mi onClick={startEdit}>编辑</Mi>
        ) : (
          <>
            <Mi onClick={save}>保存</Mi>
            <Mi onClick={cancel}>取消</Mi>
          </>
        )}
        <Tbl/>
        <Mi onClick={toggleActive}>
          {partner.active === false ? "启用" : "停用"}
        </Mi>
        <Mi onClick={tryDelete} disabled={orderCount > 0} title={orderCount > 0 ? `已被 ${orderCount} 订单使用，无法删除` : "永久删除"}>
          删除
        </Mi>
        <Tbl/>
        <Mi onClick={onReload}>刷新</Mi>
      </div>

      <div className="tms-detail-body">
        {/* 顶部信息条 */}
        <div style={{
          margin: "12px 12px 8px",
          padding: "12px 16px",
          background: pt.colorBg,
          border: `1px solid ${pt.colorFg}40`,
          borderRadius: 5,
          borderLeft: `4px solid ${pt.colorFg}`,
          display: "flex",
          gap: 24,
          alignItems: "center",
        }}>
          <span style={{ fontSize: 16, fontWeight: "bold", color: "#222" }}>{partner.name}</span>
          {partner.name_en && <span style={{ color: "#888", fontSize: 13 }}>{partner.name_en}</span>}
          <span style={{
            padding: "3px 12px", borderRadius: 12, fontSize: 11,
            background: pt.colorFg, color: "#fff", fontWeight: "bold",
          }}>{partner.partner_type}</span>
          <span style={{ color: "#666", fontSize: 12 }}>编号: <b>{partner.code || "—"}</b></span>
          <span style={{ color: "#666", fontSize: 12 }}>订单引用: <b style={{ color: "#1990FF" }}>{orderCount}</b></span>
          {partner.active === false && (
            <span style={{ marginLeft: "auto", color: "#888", fontSize: 12, fontStyle: "italic" }}>（已停用）</span>
          )}
        </div>

        {/* 基本信息 */}
        <div className="tms-detail-section">基本信息</div>
        <div className="tms-detail-panel">
          <div className="tms-detail-grid">
            <div className="tms-df"><label>编号</label><div className="tms-df-blk"><input value={v("code")} disabled className="readonly" /></div></div>
            <div className="tms-df"><label>类型</label><div className="tms-df-blk">
              <select value={v("partner_type")} onChange={e => ch("partner_type", e.target.value)} disabled={!editing}>
                {PARTNER_TYPES.map(t => <option key={t.key}>{t.key}</option>)}
              </select>
            </div></div>
            <div className="tms-df"><label className="req">名称(中文)</label><div className="tms-df-blk">
              <input value={v("name")} onChange={e => ch("name", e.target.value)} disabled={!editing} className="notnull" />
            </div></div>
            <div className="tms-df"><label>英文名</label><div className="tms-df-blk">
              <input value={v("name_en")} onChange={e => ch("name_en", e.target.value)} disabled={!editing} placeholder="用于 shipper / manifest" />
            </div></div>
            <div className="tms-df"><label>简称</label><div className="tms-df-blk">
              <input value={v("name_short")} onChange={e => ch("name_short", e.target.value)} disabled={!editing} placeholder="用于 portal 显示" />
            </div></div>
            <div className="tms-df"><label>启用</label><div className="tms-df-blk">
              <select value={v("active") === false ? "false" : "true"} onChange={e => ch("active", e.target.value === "true")} disabled={!editing}>
                <option value="true">启用</option>
                <option value="false">停用</option>
              </select>
            </div></div>
          </div>
        </div>

        {/* 联系信息 */}
        <div className="tms-detail-section">联系信息</div>
        <div className="tms-detail-panel-light">
          <div className="tms-detail-grid">
            <div className="tms-df"><label>联系人</label><div className="tms-df-blk">
              <input value={v("contact_name")} onChange={e => ch("contact_name", e.target.value)} disabled={!editing} />
            </div></div>
            <div className="tms-df"><label>电话</label><div className="tms-df-blk">
              <input value={v("contact_phone")} onChange={e => ch("contact_phone", e.target.value)} disabled={!editing} />
            </div></div>
            <div className="tms-df"><label>邮箱</label><div className="tms-df-blk">
              <input value={v("contact_email")} onChange={e => ch("contact_email", e.target.value)} disabled={!editing} />
            </div></div>
            <div className="tms-df full3"><label>中文地址</label><div className="tms-df-blk">
              <textarea value={v("address_zh")} onChange={e => ch("address_zh", e.target.value)} disabled={!editing} placeholder="例如：浙江省宁波市..." />
            </div></div>
            <div className="tms-df full3"><label>英文地址</label><div className="tms-df-blk">
              <textarea value={v("address_en")} onChange={e => ch("address_en", e.target.value)} disabled={!editing} placeholder="用于 shipper 信息显示" />
            </div></div>
          </div>
        </div>

        {/* 财务信息 */}
        <div className="tms-detail-section">财务信息</div>
        <div className="tms-detail-panel">
          <div className="tms-detail-grid">
            <div className="tms-df"><label>信用条款</label><div className="tms-df-blk">
              <input value={v("credit_terms")} onChange={e => ch("credit_terms", e.target.value)} disabled={!editing} placeholder="例如：30 天月结" />
            </div></div>
            <div className="tms-df full2"><label>开票抬头</label><div className="tms-df-blk">
              <input value={v("invoice_title")} onChange={e => ch("invoice_title", e.target.value)} disabled={!editing} />
            </div></div>
            <div className="tms-df"><label>税号</label><div className="tms-df-blk">
              <input value={v("tax_id")} onChange={e => ch("tax_id", e.target.value)} disabled={!editing} />
            </div></div>
            <div className="tms-df full2"><label>开户银行</label><div className="tms-df-blk">
              <input value={v("bank_name")} onChange={e => ch("bank_name", e.target.value)} disabled={!editing} />
            </div></div>
            <div className="tms-df full4"><label>银行账号</label><div className="tms-df-blk">
              <input value={v("bank_account")} onChange={e => ch("bank_account", e.target.value)} disabled={!editing} />
            </div></div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// 新建客商 Modal
// ═══════════════════════════════════════════════════════════════

function PartnerEditModal({ defaultType = "客户", existingCodes = [], onClose, onSaved }) {
  const [form, setForm] = useState({
    partner_type: defaultType,
    code: "",  // 自动算
    name: "",
    name_en: "",
    name_short: "",
    contact_name: "",
    contact_phone: "",
    contact_email: "",
    active: true,
  });
  const [saving, setSaving] = useState(false);

  // 自动生成 code
  useEffect(() => {
    const pt = PARTNER_TYPES.find(t => t.key === form.partner_type);
    if (!pt) return;
    const prefix = pt.code;
    const used = existingCodes
      .filter(c => c && c.startsWith(prefix))
      .map(c => parseInt(c.substring(prefix.length)))
      .filter(n => !Number.isNaN(n));
    const max = used.length > 0 ? Math.max(...used) : 0;
    const next = String(max + 1).padStart(3, "0");
    setForm(p => ({ ...p, code: prefix + next }));
  }, [form.partner_type, existingCodes]);

  const set = (k, val) => setForm(p => ({ ...p, [k]: val }));

  const save = async () => {
    if (!form.name?.trim()) { alert("名称(中文) 必填"); return; }
    setSaving(true);
    const { error } = await supabase.from("customers").insert([{
      ...form,
      name: form.name.trim(),
    }]);
    setSaving(false);
    if (error) { alert("新建失败：" + error.message); return; }
    onSaved();
  };

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
    }}>
      <div style={{
        background: "#fff", borderRadius: 5, width: 520, maxHeight: "90vh", overflow: "auto",
        boxShadow: "0 10px 40px rgba(0,0,0,0.2)",
      }}>
        <div style={{
          padding: "10px 16px", background: "linear-gradient(#1990FF,#0e7fe6)", color: "#fff",
          fontSize: 14, fontWeight: "bold", display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <span>新建客商</span>
          <span style={{ cursor: "pointer", fontSize: 18 }} onClick={onClose}>×</span>
        </div>

        <div style={{ padding: 16 }}>
          <div className="tms-detail-grid" style={{ gap: "10px 14px" }}>
            <div className="tms-df full2"><label className="req">类型</label><div className="tms-df-blk">
              <select value={form.partner_type} onChange={e => set("partner_type", e.target.value)}>
                {PARTNER_TYPES.map(t => <option key={t.key}>{t.key}</option>)}
              </select>
            </div></div>
            <div className="tms-df full2"><label>编号</label><div className="tms-df-blk">
              <input value={form.code} disabled className="readonly" />
            </div></div>

            <div className="tms-df full4"><label className="req">名称(中文)</label><div className="tms-df-blk">
              <input value={form.name} onChange={e => set("name", e.target.value)} className="notnull" autoFocus />
            </div></div>
            <div className="tms-df full4"><label>英文名</label><div className="tms-df-blk">
              <input value={form.name_en} onChange={e => set("name_en", e.target.value)} placeholder="shipper/manifest 用" />
            </div></div>
            <div className="tms-df full4"><label>简称</label><div className="tms-df-blk">
              <input value={form.name_short} onChange={e => set("name_short", e.target.value)} placeholder="portal 用" />
            </div></div>

            <div className="tms-df full2"><label>联系人</label><div className="tms-df-blk">
              <input value={form.contact_name} onChange={e => set("contact_name", e.target.value)} />
            </div></div>
            <div className="tms-df full2"><label>电话</label><div className="tms-df-blk">
              <input value={form.contact_phone} onChange={e => set("contact_phone", e.target.value)} />
            </div></div>
            <div className="tms-df full4"><label>邮箱</label><div className="tms-df-blk">
              <input value={form.contact_email} onChange={e => set("contact_email", e.target.value)} />
            </div></div>
          </div>

          <div style={{ marginTop: 16, padding: 10, background: "#f0f7ff", border: "1px solid #c8dfff", borderRadius: 3, fontSize: 12, color: "#666" }}>
            提示：地址、财务信息、信用条款等可在保存后进入详情页补全。
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
            <button onClick={onClose} style={{ padding: "6px 18px", background: "#f5f5f5", border: "1px solid #ddd", borderRadius: 3, cursor: "pointer", fontSize: 13 }}>取消</button>
            <button onClick={save} disabled={saving || !form.name?.trim()} style={{
              padding: "6px 18px",
              background: saving || !form.name?.trim() ? "#ccc" : "#1990FF",
              color: "#fff", border: "none", borderRadius: 3,
              cursor: saving || !form.name?.trim() ? "not-allowed" : "pointer", fontSize: 13,
            }}>
              {saving ? "保存中..." : "保存"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
