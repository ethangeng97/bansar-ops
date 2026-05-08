// ═══════════════════════════════════════════════════════════════
// Bansar OPS - TMS 公用组件
// 配套 src/styles/tms.css 使用，所有组件用 className 而非 inline style
// ═══════════════════════════════════════════════════════════════

import { useState, useEffect } from "react";
import { LIFECYCLE, lifecycleOf, SOP_NODES, nodeStatusOf, applicableNodesFor } from "../lib/constants.js";

/* ── 标题栏 ─────────────────────────────────────────────────── */
export function TmsTitle({ title, user, role, onClose }) {
  const goHome = () => {
    if (window.confirm("确认返回主页？\n\n当前页面未保存的内容将丢失。")) {
      window.location.hash = "#/";
    }
  };
  return (
    <div className="tms-tb">
      <span
        className="tms-home-btn"
        onClick={goHome}
        title="返回主页"
        style={{
          cursor: "pointer", marginRight: 10, padding: "0 8px",
          display: "inline-flex", alignItems: "center", height: "100%",
          color: "#fff", opacity: 0.85, fontSize: 16, lineHeight: 1,
          borderRight: "1px solid rgba(255,255,255,0.2)",
        }}
        onMouseEnter={e => { e.currentTarget.style.opacity = 1; e.currentTarget.style.background = "rgba(255,255,255,0.12)"; }}
        onMouseLeave={e => { e.currentTarget.style.opacity = 0.85; e.currentTarget.style.background = "transparent"; }}
      >
        ⌂
      </span>
      <span className="tt">{title}</span>
      <div className="ri">
        <span className="mi">{user?.profile?.name || user?.email?.split("@")[0] || "用户"}<span className="ar"></span></span>
        <span className="mi">BS（NB）GJ<span className="ar"></span></span>
        <span className="mi">{role === "admin" ? "管理部" : "操作部"}<span className="ar"></span></span>
        <span className="mi">简体中文<span className="ar"></span></span>
        <span className="mi" onClick={onClose}>关闭<span className="ar"></span></span>
      </div>
    </div>
  );
}

/* ── 工具栏：菜单按钮 ───────────────────────────────────────── */
export function Mi({ children, onClick, checked, disabled, arrow }) {
  return (
    <div className="tms-mi">
      <div
        className={"tms-mb" + (checked ? " checked" : "") + (disabled ? " disable" : "")}
        onClick={disabled ? undefined : onClick}
      >
        {children}
        {arrow && <span className="ar"></span>}
      </div>
    </div>
  );
}

/* ── 工具栏：带下拉菜单的按钮 ─────────────────────────────────
   options: [{ label, onClick, disabled }]
   主按钮 onClick 不传时点击直接展开下拉，传了则先执行主操作
   ─────────────────────────────────────────────────────────── */
export function MiDropdown({ children, options = [], disabled }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  // 点别处自动关闭（用 click 而不是 mousedown，避免和按钮自身 onClick 冲突）
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (!e.target.closest?.(".tms-mi-dd")) close();
    };
    // 延迟绑定，避免立即被同一次 click 触发关闭
    const t = setTimeout(() => document.addEventListener("click", onDoc), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener("click", onDoc);
    };
  }, [open]);

  return (
    <div className="tms-mi tms-mi-dd" style={{ position: "relative" }}>
      <div
        className={"tms-mb" + (disabled ? " disable" : "") + (open ? " checked" : "")}
        onClick={(e) => {
          e.stopPropagation();
          if (!disabled) setOpen(o => !o);
        }}
      >
        {children}
        <span className="ar"></span>
      </div>
      {open && options.length > 0 && (
        <div className="tms-mb-menu" onClick={(e) => e.stopPropagation()}>
          {options.map((o, i) => (
            <div
              key={i}
              className={"tms-mb-mi" + (o.disabled ? " disable" : "")}
              onClick={(e) => {
                e.stopPropagation();
                if (o.disabled) return;
                close();
                o.onClick?.();
              }}
            >
              {o.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── 工具栏：竖分隔线 ───────────────────────────────────────── */
export function Tbl() {
  return <div className="tms-tbl"><div></div></div>;
}

/* ── 工具栏：右侧控件容器 ───────────────────────────────────── */
export function TmsToolbarRight({ children }) {
  return <div className="tms-mn-r">{children}</div>;
}

/* ── 筛选区：单字段 ─────────────────────────────────────────── */
export function Fi({ label, refLabel, required, children }) {
  const cls = (refLabel ? "ref " : "") + (required ? "notnull" : "");
  return (
    <div className="tms-fi">
      <label className={cls.trim()}>{label}</label>
      <span className="tms-blk">{children}</span>
    </div>
  );
}

/* ── 筛选区：tabs ───────────────────────────────────────────── */
export function TmsTabs({ tabs, active, onChange }) {
  return (
    <ul className="tms-tabs">
      {tabs.map(t => (
        <li
          key={t}
          className={active === t ? "active" : ""}
          onClick={() => onChange?.(t)}
        >{t}</li>
      ))}
    </ul>
  );
}

/* ── 信息栏 ─────────────────────────────────────────────────── */
export function TmsInfoBar({ scope = "分公司", children }) {
  return (
    <div className="tms-info">
      <span className="or">数据范围: {scope}</span>
      <span style={{ marginLeft: 8 }}>{children}</span>
    </div>
  );
}

/* ── 分页 ───────────────────────────────────────────────────── */
function pagButtons(cur, total) {
  const out = [];
  if (total <= 7) { for (let i = 0; i < total; i++) out.push(i); return out; }
  out.push(0);
  if (cur > 3) out.push("...");
  const s = Math.max(1, cur - 1), e = Math.min(total - 2, cur + 1);
  for (let i = s; i <= e; i++) out.push(i);
  if (cur < total - 4) out.push("...");
  out.push(total - 1);
  return out;
}

export function TmsPagination({ total, page, pageSize, totalPages, onPageChange, onPageSizeChange }) {
  return (
    <div className="tms-pg">
      <span style={{ marginRight: 8 }}>共 {total} 条</span>
      <select value={pageSize} onChange={e => { onPageSizeChange?.(+e.target.value); onPageChange?.(0); }}>
        <option value={20}>20条/页</option>
        <option value={50}>50条/页</option>
        <option value={100}>100条/页</option>
        <option value={200}>200条/页</option>
      </select>
      <button disabled={page === 0} onClick={() => onPageChange?.(0)}>‹‹</button>
      <button disabled={page === 0} onClick={() => onPageChange?.(Math.max(0, page - 1))}>‹</button>
      {pagButtons(page, totalPages).map((p, i) =>
        p === "..." ? (
          <span key={i} style={{ padding: "0 4px" }}>...</span>
        ) : (
          <button key={i} className={p === page ? "on" : ""} onClick={() => onPageChange?.(p)}>{p + 1}</button>
        )
      )}
      <button disabled={page >= totalPages - 1} onClick={() => onPageChange?.(Math.min(totalPages - 1, page + 1))}>›</button>
      <button disabled={page >= totalPages - 1} onClick={() => onPageChange?.(totalPages - 1)}>››</button>
      <span style={{ marginLeft: 4 }}>前往</span>
      <input
        style={{ width: 36, textAlign: "center" }}
        value={page + 1}
        onChange={e => {
          const v = parseInt(e.target.value, 10);
          if (!isNaN(v)) onPageChange?.(Math.max(0, Math.min(totalPages - 1, v - 1)));
        }}
      />
      <span>页</span>
    </div>
  );
}

/* ── 占位页（未实现模块） ───────────────────────────────────── */
export function TmsPlaceholder({ title, onBack }) {
  return (
    <div className="tms-placeholder">
      <svg className="icn" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M9 9h6M9 13h6M9 17h4" />
      </svg>
      <div className="ttl">{title}</div>
      <div className="sub">该模块功能开发中，敬请期待</div>
      <button onClick={onBack}>返回首页</button>
    </div>
  );
}

/* ── 详情页生命周期印章 ──────────────────────────────────────── */

export function LifecycleStamp({ shipment }) {
  const lc = lifecycleOf(shipment);
  return (
    <div className="tms-stamp" style={{ "--stamp-color": lc.color }}>
      {lc.v}
    </div>
  );
}

/* ── 详情字段 ───────────────────────────────────────────────── */
export function Df({ label, required, refLabel, optional, children, span }) {
  const cls = (required ? "req" : refLabel ? "ref" : optional ? "opt" : "");
  const colCls = span === 2 ? "full2" : span === 3 ? "full3" : span === 4 ? "full4" : span === 6 ? "full6" : "";
  return (
    <div className={"tms-df " + colCls}>
      <label className={cls}>
        {required && <span style={{ color: "#ff4d4f", marginRight: 2 }}>*</span>}
        {label}
      </label>
      <div className="tms-df-blk">{children}</div>
    </div>
  );
}

export function DfCheckbox({ label, checked, onChange, disabled }) {
  return (
    <label className="tms-df-checkbox">
      <input type="checkbox" checked={!!checked} onChange={e => onChange?.(e.target.checked)} disabled={disabled} />
      {label}
    </label>
  );
}

/* ── SOP 节点卡片（详情页 SOP 进度 tab 用） ─────────────────── */
const SOP_ICONS = {
  check:    <><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></>,
  ship:     <><path d="M2 20a2.4 2.4 0 0 0 2 1 2.4 2.4 0 0 0 2-1 2.4 2.4 0 0 1 2-1 2.4 2.4 0 0 1 2 1"/><path d="M19.38 20A11.6 11.6 0 0 0 21 14l-9-4-9 4c0 2.9.94 5.34 2.81 7.76"/><path d="M19 13V7a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v6"/></>,
  filelist: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></>,
  file:     <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></>,
  dollar:   <><line x1="12" y1="2" x2="12" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></>,
};

function SopIcon({ name }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {SOP_ICONS[name] || null}
    </svg>
  );
}

export function SopCard({ node, shipment, onChange, disabled }) {
  const status = nodeStatusOf(shipment, node);
  const iconClass = status.danger ? "icn danger" : status.done ? "icn done" : "icn";
  const statClass = "stat " + (status.danger ? "danger" : status.done ? "done" : status.value === node.options[0].v ? "pending" : "warn");
  return (
    <div className="tms-sop-card">
      <div className={iconClass}><SopIcon name={node.icon} /></div>
      <div className="nm">{node.zh}</div>
      <div className={statClass}>{status.label}</div>
      <select
        value={status.value}
        disabled={disabled}
        onChange={e => onChange?.(node.field, e.target.value)}
      >
        {node.options.map(o => <option key={o.v} value={o.v}>{o.v}</option>)}
      </select>
    </div>
  );
}

export function SopProgress({ shipment, onUpdate, disabled }) {
  const nodes = applicableNodesFor(shipment);
  const total = nodes.length;
  const done = nodes.filter(n => nodeStatusOf(shipment, n).done).length;
  const pct = total > 0 ? Math.round(done / total * 100) : 0;

  return (
    <div className="tms-sop-area">
      <div className="tms-sop-summary">
        <span>当前进度：</span>
        <b>{done} / {total}</b>
        <span>节点完成（{pct}%）</span>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
          <div style={{ width: 200, height: 8, background: "#f0f0f0", borderRadius: 4, overflow: "hidden" }}>
            <div style={{ width: pct + "%", height: "100%", background: pct === 100 ? "#52c41a" : "var(--tms-primary)", transition: "width .25s" }} />
          </div>
        </div>
      </div>
      <div className="tms-sop-grid">
        {nodes.map(n => (
          <SopCard key={n.code} node={n} shipment={shipment} onChange={onUpdate} disabled={disabled} />
        ))}
      </div>
      {!shipment.has_hbl && (
        <div style={{ marginTop: 14, padding: 8, color: "#888", fontSize: 12, textAlign: "center" }}>
          提示：当前订单未勾选「签 HBL」，HB 提单节点已隐藏。如需启用，请回到「作业」tab 勾选。
        </div>
      )}
    </div>
  );
}
