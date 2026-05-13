import { useState, useRef, useEffect, useMemo } from "react";
import { STATUS_COLORS } from "../lib/constants.js";

export const Badge = ({ value, small }) => {
  if (!value) return null;
  const color = STATUS_COLORS[value] || "#64748b";
  return (
    <span style={{ display: "inline-block", padding: small ? "1px 8px" : "2px 10px", borderRadius: 99, fontSize: small ? 10 : 11, fontWeight: 600, background: color + "18", color, border: `1px solid ${color}44`, whiteSpace: "nowrap" }}>{value}</span>
  );
};

export const Field = ({ label, value }) => (
  <div style={{ marginBottom: 8 }}>
    <div style={{ fontSize: 10, fontWeight: 600, color: "#8896a7", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 3 }}>{label}</div>
    <div style={{ fontSize: 13, fontWeight: 600, color: value ? "#0f172a" : "#cbd5e1", fontFamily: "'DM Mono', monospace" }}>{value || "—"}</div>
  </div>
);

export const SectionHeader = ({ icon, title, accent, right }) => (
  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <span style={{ fontSize: 16 }}>{icon}</span>
      <span style={{ fontSize: 14, fontWeight: 700, color: "#0f172a" }}>{title}</span>
    </div>
    {right}
    <div style={{ flex: 1, height: 2, marginLeft: 10, background: `linear-gradient(to right, ${accent}, transparent)`, borderRadius: 1 }} />
  </div>
);

export const Modal = ({ children, onClose, title, width }) => (
  <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }} onClick={e => e.target === e.currentTarget && onClose()}>
    <div style={{ background: "#fff", borderRadius: 16, padding: 24, width: width || 600, maxWidth: "95vw", maxHeight: "90vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.2)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{title}</h2>
        <button onClick={onClose} style={{ border: "none", background: "none", fontSize: 22, cursor: "pointer", color: "#94a3b8", lineHeight: 1 }}>✕</button>
      </div>
      {children}
    </div>
  </div>
);

export const Button = ({ children, onClick, disabled, variant, small, style }) => {
  const base = { padding: small ? "5px 12px" : "8px 18px", borderRadius: 8, fontSize: small ? 11.5 : 13, fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer", border: "none", transition: "all .15s", opacity: disabled ? 0.5 : 1, ...style };
  const styles = {
    primary:   { ...base, background: "#0ea5e9", color: "#fff" },
    secondary: { ...base, background: "#f1f5f9", color: "#475569", border: "1px solid #e2e8f0" },
    accent:    { ...base, background: "#f59e0b", color: "#fff" },
    danger:    { ...base, background: "#ef4444", color: "#fff" },
  };
  return <button onClick={onClick} disabled={disabled} style={styles[variant] || styles.primary}>{children}</button>;
};

export const Input = ({ label, ...props }) => (
  <div>
    {label && <div style={{ fontSize: 10, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>{label}</div>}
    <input {...props} style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #e2e8f0", fontSize: 12.5, outline: "none", boxSizing: "border-box", fontFamily: "'DM Mono', monospace", ...props.style }} />
  </div>
);

export const Select = ({ label, options, ...props }) => (
  <div>
    {label && <div style={{ fontSize: 10, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>{label}</div>}
    <select {...props} style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #e2e8f0", fontSize: 12.5, outline: "none", boxSizing: "border-box", ...props.style }}>
      <option value="">—</option>
      {(options || []).map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  </div>
);

export const FilterDropdown = ({ label, value, options, onChange, optionLabels }) => {
  const isActive = value !== "All";
  return (
    <select value={value} onChange={e => onChange(e.target.value)} style={{
      padding: "6px 28px 6px 10px", borderRadius: 6, fontSize: 12, fontWeight: 500, outline: "none", cursor: "pointer",
      border: isActive ? "2px solid #0ea5e9" : "1px solid #e2e8f0",
      background: isActive ? "#f0f9ff" : "#fff", color: isActive ? "#0369a1" : "#64748b",
      appearance: "none",
      backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`,
      backgroundRepeat: "no-repeat", backgroundPosition: "right 8px center",
    }}>
      <option value="All">{label}</option>
      {options.map(o => <option key={o} value={o}>{(optionLabels && optionLabels[o]) || o}</option>)}
    </select>
  );
};

export const Spinner = () => <div style={{ display: "flex", justifyContent: "center", padding: 40 }}><div style={{ width: 28, height: 28, border: "3px solid #e2e8f0", borderTopColor: "#0ea5e9", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} /><style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style></div>;

export const EmptyState = ({ children }) => <div style={{ padding: "40px 20px", textAlign: "center", color: "#94a3b8", fontSize: 13 }}>{children}</div>;

// ── ComboBox: searchable dropdown ────────────────────────────────
// options 接受两种形态：
//   1. string[]                                    （兜底，单值匹配）
//   2. Array<{ value: string, aliases?: string[] }> （富对象，可按缩写/英文名等别名搜，命中后排序更近）
// 排序：精确 > value 前缀 > alias 前缀 > value 子串 > alias 子串
export function ComboBox({ value, onChange, options, placeholder, style: extStyle }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // 规范化：统一成 { value, aliases }
  const normalized = useMemo(() => (options || []).map(o =>
    typeof o === "string"
      ? { value: o, aliases: [] }
      : { value: o.value, aliases: (o.aliases || []).filter(Boolean) }
  ), [options]);

  // 过滤 + 按"最接近"排序，返回带 _hint（命中的别名，用于在下拉里淡显）
  const filtered = useMemo(() => {
    if (!query) return normalized.map(o => ({ ...o, _hint: "" }));
    const lq = query.toLowerCase();
    const scored = [];
    for (const o of normalized) {
      const v = (o.value || "").toLowerCase();
      let score = -1, hint = "";
      if (v === lq) score = 0;
      else if (v.startsWith(lq)) score = 1;
      else {
        const aliasMatch = (cmp) => {
          for (const a of o.aliases) {
            if (cmp(String(a).toLowerCase(), lq)) { hint = a; return true; }
          }
          return false;
        };
        if (aliasMatch((a, q) => a === q)) score = 2;
        else if (aliasMatch((a, q) => a.startsWith(q))) score = 3;
        else if (v.includes(lq)) score = 4;
        else if (aliasMatch((a, q) => a.includes(q))) score = 5;
      }
      if (score >= 0) scored.push({ ...o, _score: score, _hint: hint });
    }
    scored.sort((a, b) => a._score - b._score || a.value.localeCompare(b.value));
    return scored;
  }, [normalized, query]);

  const display = open ? query : (value || "");
  const exactMatch = useMemo(() => normalized.some(o => o.value === query), [normalized, query]);

  return (
    <div ref={ref} style={{ position: "relative", ...extStyle }}>
      <input
        ref={inputRef}
        value={display}
        placeholder={placeholder || "搜索..."}
        onChange={(e) => { setQuery(e.target.value); if (!open) setOpen(true); }}
        onFocus={() => { setQuery(value || ""); setOpen(true); }}
        style={{
          width: "100%", padding: "5px 24px 5px 8px", borderRadius: 5,
          border: open ? "1px solid #0ea5e9" : "1px solid #e2e8f0",
          fontSize: 11.5, outline: "none", boxSizing: "border-box", background: "#fff",
        }}
      />
      <span style={{
        position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)",
        fontSize: 10, color: "#94a3b8", pointerEvents: "none",
      }}>▼</span>
      {value && !open && (
        <button onClick={() => { onChange(""); inputRef.current?.focus(); }}
          style={{
            position: "absolute", right: 18, top: "50%", transform: "translateY(-50%)",
            background: "none", border: "none", fontSize: 12, color: "#94a3b8",
            cursor: "pointer", padding: 0, lineHeight: 1,
          }}>✕</button>
      )}
      {open && (
        <div style={{
          position: "absolute", top: "100%", left: 0, right: 0, maxHeight: 200,
          overflowY: "auto", background: "#fff", border: "1px solid #e2e8f0",
          borderRadius: "0 0 6px 6px", boxShadow: "0 4px 12px rgba(0,0,0,0.1)",
          zIndex: 100,
        }}>
          {filtered.length === 0 && (
            <div style={{ padding: "8px 10px", fontSize: 11, color: "#94a3b8" }}>无匹配项</div>
          )}
          {filtered.slice(0, 50).map((o) => (
            <div key={o.value}
              onClick={() => { onChange(o.value); setOpen(false); setQuery(""); }}
              style={{
                padding: "6px 10px", fontSize: 11.5, cursor: "pointer",
                background: o.value === value ? "#f0f9ff" : "transparent",
                color: o.value === value ? "#0369a1" : "#334155",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = "#f0f9ff")}
              onMouseLeave={(e) => (e.currentTarget.style.background = o.value === value ? "#f0f9ff" : "transparent")}
            >
              {o.value}
              {o._hint && o._hint !== o.value && (
                <span style={{ marginLeft: 6, color: "#94a3b8", fontSize: 10 }}>（{o._hint}）</span>
              )}
            </div>
          ))}
          {query && !exactMatch && (
            <div
              onClick={() => { onChange(query); setOpen(false); setQuery(""); }}
              style={{ padding: "6px 10px", fontSize: 11.5, cursor: "pointer", color: "#0ea5e9", borderTop: "1px solid #f1f5f9" }}
            >使用 "{query}"</div>
          )}
        </div>
      )}
    </div>
  );
}

// ── EditField: standalone edit/display field (must be top-level, not nested in render) ──
export function EditField({ label, field, type, options, editing, value, displayValue, onChange }) {
  if (!editing) return <Field label={label} value={displayValue ?? value} />;
  if (options) return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 10, fontWeight: 600, color: "#8896a7", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 3 }}>{label}</div>
      <ComboBox
        value={value ?? ""}
        onChange={(v) => onChange(field, v)}
        options={options}
        placeholder={`搜索 ${label}...`}
        style={{ width: "100%" }}
      />
    </div>
  );
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ fontSize: 10, fontWeight: 600, color: "#8896a7", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 3 }}>{label}</div>
      <input
        type={type || "text"}
        value={value ?? ""}
        onChange={(e) => onChange(field, e.target.value)}
        style={{
          width: "100%", padding: "5px 8px", borderRadius: 5,
          border: "1px solid #bae6fd", background: "#f0f9ff",
          fontSize: 12, fontWeight: 600, outline: "none", color: "#0c4a6e",
          boxSizing: "border-box", fontFamily: "'DM Mono',monospace",
        }}
      />
    </div>
  );
}
