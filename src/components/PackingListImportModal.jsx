// ============================================================================
// PackingListImportModal — 拖入客户发来的装箱单 .xlsx，解析后预览 cargo_items
//
// 只写 cargo_items（货物明细行），不动 shipments 票级字段、不动 shipment_containers。
// 通过 onApply({}, { cargoLines }) 走父组件 applySino56Import 的 cargo 落库管线。
// ============================================================================
import { useState, useRef } from "react";
import { parsePackingListFile } from "../lib/packing-list-xlsx-parser.js";

export default function PackingListImportModal({ open, onClose, onApply }) {
  const [parsed, setParsed] = useState(null);
  const [fileName, setFileName] = useState("");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);

  if (!open) return null;

  const reset = () => { setParsed(null); setFileName(""); setErr(null); };

  const handleFile = async (file) => {
    if (!file) return;
    setErr(null);
    setBusy(true);
    setFileName(file.name);
    try {
      const data = await parsePackingListFile(file);
      setParsed(data);
    } catch (e) {
      console.error(e);
      setErr("解析失败：" + (e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer?.files?.[0];
    if (f) handleFile(f);
  };

  const updateLine = (idx, key, value) => {
    setParsed(p => {
      const next = { ...p, cargoLines: p.cargoLines.slice() };
      next.cargoLines[idx] = { ...next.cargoLines[idx], [key]: value };
      return next;
    });
  };

  const doApply = () => {
    onApply({}, { cargoLines: parsed.cargoLines, containers: [], mappings: {} });
    reset();
    onClose();
  };

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", padding: "10px 16px", borderBottom: "1px solid #eee" }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>📦 导入装箱单 (.xlsx)</div>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ padding: "4px 12px" }}>关闭</button>
        </div>

        <div style={{ padding: 16, overflow: "auto", flex: 1 }}>
          {!parsed ? (
            <>
              <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>
                把客户发来的 .xlsx 装箱单拖到下方或点击选择。
                只会写入「货物明细」（cargo_items），不会动票级字段和集装箱表。
              </div>
              <div style={{ fontSize: 11, color: "#999", marginBottom: 10 }}>
                模板要求：表头含「产品名称 / 总箱数 / 总毛重 / 总体积 / 柜号 / 封条号 / SO」等列。
              </div>
              <div
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                onClick={() => inputRef.current?.click()}
                style={{
                  border: `2px dashed ${dragOver ? "#1990ff" : "#bbb"}`,
                  background: dragOver ? "#e6f4ff" : "#fafafa",
                  borderRadius: 6, padding: "40px 20px", textAlign: "center",
                  cursor: "pointer", color: "#555", fontSize: 13,
                }}
              >
                {busy
                  ? "解析中…"
                  : fileName
                    ? `已选择：${fileName}（若未自动解析，点这里重选）`
                    : "📥 拖入或点击选择 .xlsx 文件"}
              </div>
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                style={{ display: "none" }}
                onChange={e => handleFile(e.target.files?.[0])}
              />
              {err && <div style={{ marginTop: 8, color: "#c00", fontSize: 12 }}>⚠ {err}</div>}
            </>
          ) : (
            <>
              {parsed.meta && Object.keys(parsed.meta).length > 0 && (
                <details style={{ marginBottom: 10, fontSize: 12, color: "#444" }} open>
                  <summary style={{ cursor: "pointer", color: "#666" }}>装箱单抬头信息（仅展示，不写入）</summary>
                  <table style={{ marginTop: 4, fontSize: 11 }}>
                    <tbody>
                      {Object.entries(parsed.meta).map(([k, v]) => (
                        <tr key={k}>
                          <td style={{ padding: "1px 8px 1px 0", color: "#888" }}>{META_LABELS[k] || k}</td>
                          <td style={{ padding: "1px 0" }}>{v}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              )}

              <div style={{ fontSize: 12, color: "#666", marginBottom: 8 }}>
                解析到 <b>{parsed.cargoLines.length}</b> 条货物明细。可微调后点「写入货物明细」。
              </div>

              <table style={previewTable}>
                <thead><tr>
                  <th style={th}>柜号</th>
                  <th style={th}>封号</th>
                  <th style={th}>品名</th>
                  <th style={th}>件数</th>
                  <th style={th}>包装</th>
                  <th style={th}>毛重 (KGS)</th>
                  <th style={th}>体积 (CBM)</th>
                </tr></thead>
                <tbody>
                  {parsed.cargoLines.map((c, i) => (
                    <tr key={i}>
                      <td style={td}><input value={c.container_no || ""} onChange={e => updateLine(i, "container_no", e.target.value)} style={cellInput} /></td>
                      <td style={td}><input value={c.seal_no || ""} onChange={e => updateLine(i, "seal_no", e.target.value)} style={cellInput} /></td>
                      <td style={td}><input value={c.product_name_en || ""} onChange={e => updateLine(i, "product_name_en", e.target.value)} style={cellInput} /></td>
                      <td style={td}><input value={c.qty ?? ""} onChange={e => updateLine(i, "qty", e.target.value === "" ? null : Number(e.target.value))} style={{ ...cellInput, width: 60 }} /></td>
                      <td style={td}><input value={c.package_unit || ""} onChange={e => updateLine(i, "package_unit", e.target.value)} style={{ ...cellInput, width: 70 }} /></td>
                      <td style={td}><input value={c.gross_weight ?? ""} onChange={e => updateLine(i, "gross_weight", e.target.value === "" ? null : Number(e.target.value))} style={{ ...cellInput, width: 70 }} /></td>
                      <td style={td}><input value={c.volume ?? ""} onChange={e => updateLine(i, "volume", e.target.value === "" ? null : Number(e.target.value))} style={{ ...cellInput, width: 70 }} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
                <button onClick={doApply} style={btnPrimary}>写入货物明细</button>
                <button onClick={reset} style={btn}>重新选择文件</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const META_LABELS = {
  customer: "客户",
  shipper_addr: "客户地址",
  declare_port: "报关地",
  pod: "目的港",
  loading_date: "装柜日期",
  declare_date: "报关日期",
  pi_date: "PI 日期",
  power: "电压/功率",
};

const overlayStyle = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,.4)",
  display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
};
const modalStyle = {
  width: "min(900px, 95vw)", maxHeight: "90vh", background: "#fff", borderRadius: 6,
  boxShadow: "0 6px 30px rgba(0,0,0,.2)", display: "flex", flexDirection: "column",
};
const btn = { padding: "5px 14px", cursor: "pointer", border: "1px solid #d9d9d9", background: "#fff", borderRadius: 3 };
const btnPrimary = { ...btn, background: "#1990ff", color: "#fff", border: "1px solid #1990ff", fontWeight: 600 };
const previewTable = { width: "100%", borderCollapse: "collapse", fontSize: 11, marginTop: 4, border: "1px solid #eee" };
const th = { padding: 4, background: "#f5f5f5", border: "1px solid #eee", textAlign: "left", fontWeight: 600 };
const td = { padding: 2, border: "1px solid #f0f0f0" };
const cellInput = { width: "100%", fontSize: 11, padding: "2px 4px", boxSizing: "border-box", border: "1px solid #ddd", borderRadius: 2 };
