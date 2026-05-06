// ============================================================================
// PortPicker.jsx — 港口选择器（V4 风格双框）
// 左框 LOCODE（5 字符）+ 右框 港口名称
// 任一框聚焦都打开下拉；选中港口后 onChange({code, name}) 同时填两个值
//
// 用法：
//   <PortPicker
//     value={{ code: form.pol_code, name: form.pol }}
//     onChange={({code, name}) => setForm({...form, pol_code: code, pol: name})}
//     disabled={!editing}
//   />
// ============================================================================

import { useEffect, useState, useRef } from "react";
import { supabase } from "../supabase.js";

// 全局缓存
let _portsCache = null;
let _loadingPromise = null;
async function loadPorts() {
  if (_portsCache) return _portsCache;
  if (_loadingPromise) return _loadingPromise;
  _loadingPromise = (async () => {
    const { data } = await supabase.from("ports")
      .select("code, name_en, name_zh, country")
      .eq("active", true)
      .order("code");
    _portsCache = data || [];
    return _portsCache;
  })();
  return _loadingPromise;
}

export default function PortPicker({ value, onChange, disabled, style }) {
  const [ports, setPorts] = useState([]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [activeField, setActiveField] = useState(null);  // "code" | "name" | null
  const wrapRef = useRef(null);

  useEffect(() => { loadPorts().then(setPorts); }, []);

  // 显示文本：根据当前 active 框决定
  const displayCode = (() => {
    if (open && activeField === "code") return query;
    return value?.code || "";
  })();
  const displayName = (() => {
    if (open && activeField === "name") return query;
    return value?.name || "";
  })();

  // 点外部关闭
  useEffect(() => {
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
        setQuery("");
        setActiveField(null);
      }
    };
    if (open) document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  // 过滤
  const q = query.trim().toLowerCase();
  const filtered = q
    ? ports.filter(p => {
        const en = (p.name_en || "").toLowerCase();
        const zh = p.name_zh || "";
        const code = (p.code || "").toLowerCase();
        return code.includes(q) || en.includes(q) || zh.includes(query.trim());
      }).slice(0, 60)
    : ports.slice(0, 60);

  const pick = (p) => {
    onChange?.({ code: p.code, name: p.name_en });
    setOpen(false);
    setQuery("");
    setActiveField(null);
  };

  const clear = (e) => {
    e?.stopPropagation();
    onChange?.({ code: "", name: "" });
    setQuery("");
  };

  const onKeyDown = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight(h => Math.min(filtered.length - 1, h + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight(h => Math.max(0, h - 1));
    } else if (e.key === "Enter") {
      if (filtered[highlight]) { e.preventDefault(); pick(filtered[highlight]); }
    } else if (e.key === "Escape") {
      setOpen(false);
      setQuery("");
      setActiveField(null);
    }
  };

  const handleFocus = (field) => {
    if (disabled) return;
    setActiveField(field);
    setOpen(true);
    setHighlight(0);
    setQuery("");
  };

  const handleChange = (e, field) => {
    const v = field === "code" ? e.target.value.toUpperCase() : e.target.value;
    setQuery(v);
    setActiveField(field);
    setOpen(true);
    setHighlight(0);
  };

  // 共用 input style
  const inputStyle = {
    boxSizing: "border-box",
    padding: "4px 8px",
    border: "1px solid #d9d9d9",
    borderRadius: 3,
    fontSize: 12,
    background: disabled ? "#f5f5f5" : "#fff",
    color: disabled ? "#666" : "#222",
    outline: "none",
  };

  return (
    <div ref={wrapRef} style={{ position: "relative", display: "flex", gap: 4, ...(style || {}) }}>
      {/* 代码框（窄） */}
      <input
        value={displayCode}
        onChange={e => handleChange(e, "code")}
        onFocus={() => handleFocus("code")}
        onKeyDown={onKeyDown}
        disabled={disabled}
        placeholder="代码"
        style={{
          ...inputStyle,
          width: 80,
          flex: "0 0 80px",
          fontFamily: "Consolas,monospace",
          fontWeight: 600,
          color: disabled ? "#666" : "#1f3864",
        }}
      />
      {/* 名称框（宽，flex: 1） */}
      <input
        value={displayName}
        onChange={e => handleChange(e, "name")}
        onFocus={() => handleFocus("name")}
        onKeyDown={onKeyDown}
        disabled={disabled}
        placeholder="港口名"
        style={{
          ...inputStyle,
          flex: 1,
          minWidth: 0,
          fontFamily: "Consolas,monospace",
        }}
      />
      {value?.code && !disabled && (
        <span
          onClick={clear}
          style={{
            position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)",
            cursor: "pointer", color: "#bbb", fontSize: 14, lineHeight: 1,
            userSelect: "none", padding: "0 2px",
          }}
          title="清空"
        >×</span>
      )}
      {open && !disabled && (
        <div style={{
          position: "absolute", top: "100%", left: 0, right: 0, marginTop: 2,
          background: "#fff",
          border: "1px solid #d9d9d9", borderRadius: 3,
          boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
          maxHeight: 280, overflowY: "auto",
          zIndex: 100,
        }}>
          {filtered.length === 0 ? (
            <div style={{ padding: "8px 12px", color: "#999", fontSize: 12 }}>
              无匹配港口
            </div>
          ) : filtered.map((p, idx) => (
            <div
              key={p.code}
              onMouseDown={e => { e.preventDefault(); pick(p); }}
              onMouseEnter={() => setHighlight(idx)}
              style={{
                padding: "5px 10px",
                cursor: "pointer",
                fontSize: 12,
                background: idx === highlight ? "#e6f4ff" : "#fff",
                borderBottom: idx < filtered.length - 1 ? "1px solid #f5f5f5" : "none",
                display: "flex", alignItems: "center", gap: 8,
              }}
            >
              <span style={{ fontFamily: "Consolas,monospace", fontWeight: 600, color: "#1f3864", minWidth: 50 }}>
                {p.code}
              </span>
              <span style={{ flex: 1, color: "#222" }}>{p.name_en}</span>
              <span style={{ color: "#888" }}>{p.name_zh}</span>
              <span style={{ color: "#bbb", fontSize: 10, fontFamily: "Consolas,monospace" }}>{p.country}</span>
            </div>
          ))}
          {ports.length > 60 && q === "" && (
            <div style={{ padding: "5px 10px", color: "#bbb", fontSize: 11, borderTop: "1px solid #f5f5f5", textAlign: "center" }}>
              显示前 60 条，输入关键字过滤更多
            </div>
          )}
        </div>
      )}
    </div>
  );
}
