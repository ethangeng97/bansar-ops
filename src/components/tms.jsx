// ═══════════════════════════════════════════════════════════════
// Bansar OPS - TMS 公用组件
// 配套 src/styles/tms.css 使用，所有组件用 className 而非 inline style
// ═══════════════════════════════════════════════════════════════

import { useState } from "react";

/* ── 标题栏 ─────────────────────────────────────────────────── */
export function TmsTitle({ title, user, role, onClose }) {
  return (
    <div className="tms-tb">
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
