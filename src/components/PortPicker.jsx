// ============================================================================
// PortPicker.jsx — 港口选择器
// 输入 LOCODE / 中文名 / 英文名 都能搜
// 选中后 onChange({ code, name }) — 调用方写入 *_code 和 *_name 两个字段
//
// 用法：
//   <PortPicker
//     value={{ code: form.pol_code, name: form.pol }}
//     onChange={({code, name}) => setForm({...form, pol_code: code, pol: name})}
//     placeholder="起运港"
//     disabled={!editing}
//   />
// ============================================================================

import { useEffect, useState, useRef } from "react";
import { supabase } from "../supabase.js";

// 全局缓存（单页生命周期），避免每个 PortPicker 都查一次
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

export default function PortPicker({ value, onChange, placeholder, disabled, style }) {
  const [ports, setPorts] = useState([]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => { loadPorts().then(setPorts); }, []);

  // 外部 value 变化时同步显示
  const displayText = (() => {
    if (open) return query;  // 打开下拉时显示用户输入
    if (value?.code && value?.name) return `${value.code} ${value.name}`;
    if (value?.code) return value.code;
    if (value?.name) return value.name;
    return "";
  })();

  // 点外部关闭
  useEffect(() => {
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false);
        setQuery("");
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
      }).slice(0, 60)  // 最多展示 60 条
    : ports.slice(0, 60);

  const pick = (p) => {
    onChange?.({ code: p.code, name: p.name_en });
    setOpen(false);
    setQuery("");
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
    }
  };

  return (
    <div ref={wrapRef} style={{ position: "relative", display: "inline-block", width: "100%", ...(style || {}) }}>
      <input
        ref={inputRef}
        value={displayText}
        onChange={e => { setQuery(e.target.value.toUpperCase()); setOpen(true); setHighlight(0); }}
        onFocus={() => !disabled && setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder={placeholder || "搜索港口代码/中英文名"}
        disabled={disabled}
        style={{
          width: "100%", boxSizing: "border-box",
          padding: "4px 24px 4px 8px",
          border: "1px solid #d9d9d9", borderRadius: 3,
          fontSize: 12, fontFamily: "Consolas, monospace",
          background: disabled ? "#f5f5f5" : "#fff",
          color: disabled ? "#666" : "#222",
        }}
      />
      {value?.code && !disabled && (
        <span onClick={clear}
              style={{
                position: "absolute", right: 6, top: "50%", transform: "translateY(-50%)",
                cursor: "pointer", color: "#bbb", fontSize: 14, lineHeight: 1, userSelect: "none",
              }}
              title="清空">×</span>
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
            <div key={p.code}
                 onMouseDown={e => { e.preventDefault(); pick(p); }}
                 onMouseEnter={() => setHighlight(idx)}
                 style={{
                   padding: "5px 10px",
                   cursor: "pointer",
                   fontSize: 12,
                   background: idx === highlight ? "#e6f4ff" : "#fff",
                   borderBottom: idx < filtered.length - 1 ? "1px solid #f5f5f5" : "none",
                   display: "flex", alignItems: "center", gap: 8,
                 }}>
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
