// ============================================================================
// SIDocImportModal — 拖入一代/客户发来的 SI（Shipping Information / 提单补料）
//
// 支持两种格式：
//   .doc  — Word 97-2003，走 si-doc-parser
//   .xlsx — Excel 提单补料 / SI Form，走 si-xlsx-parser
// 解析后预览字段（同 Sino56ImportModal 的样式），用户确认后调 onApply。
// fields/extras 结构与 Sino56 一致，复用父组件的 applySino56Import handler。
// ============================================================================
import { useState, useRef } from "react";
import { parseSIDocFile } from "../lib/si-doc-parser.js";
import { parseSIXlsxFile } from "../lib/si-xlsx-parser.js";

const FIELD_LABELS = {
  booking_no: "订舱号 SO No.",
  vessel: "船名 Vessel",
  voyage: "航次 Voyage",
  shipper: "发货人 Shipper",
  consignee: "收货人 Consignee",
  notify_party: "通知人 Notify",
  pol: "起运港 POL",
  pod: "卸货港 POD",
  destination: "目的地 Destination",
  qty_container: "箱型箱量",
  hs_code: "HS Code",
  marks: "唛头 Marks",
  desc_en: "品名 Description",
  po: "PO No.",
  payment_terms: "付款方式",
  bl_type: "提单类型",
};

export default function SIDocImportModal({ open, onClose, onApply }) {
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
      const lower = file.name.toLowerCase();
      const data = lower.endsWith(".xlsx") || lower.endsWith(".xls")
        ? await parseSIXlsxFile(file)
        : await parseSIDocFile(file);
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

  const updateField = (k, v) => setParsed(p => ({ ...p, fields: { ...p.fields, [k]: v } }));

  const doApply = () => {
    onApply(parsed.fields, parsed.extras);
    reset();
    onClose();
  };

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", padding: "10px 16px", borderBottom: "1px solid #eee" }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>📄 导入 SI (.doc / .xlsx)</div>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ padding: "4px 12px" }}>关闭</button>
        </div>

        <div style={{ padding: 16, overflow: "auto", flex: 1 }}>
          {!parsed ? (
            <>
              <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>
                把一代/客户发来的 SI（Shipping Information / 提单补料）拖到下方，或点击选择。
                系统会自动解析 SO号/Shipper/Consignee/Notify/POL/POD/箱号/件毛体/VGM 等字段。
              </div>
              <div style={{ fontSize: 11, color: "#999", marginBottom: 10 }}>
                支持 .doc（Word 97-2003）和 .xlsx（Excel 提单补料）；按扩展名自动识别。
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
                    : "📥 拖入或点击选择 .doc / .xlsx 文件"}
              </div>
              <input
                ref={inputRef}
                type="file"
                accept=".doc,.xlsx,.xls,application/msword,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                style={{ display: "none" }}
                onChange={e => handleFile(e.target.files?.[0])}
              />
              {err && <div style={{ marginTop: 8, color: "#c00", fontSize: 12 }}>⚠ {err}</div>}
            </>
          ) : (
            <>
              <div style={{ fontSize: 12, color: "#666", marginBottom: 8 }}>
                字段已提取，确认/修改后点「应用到本票」。
                解析到 <b>{parsed.extras.containers?.length || 0}</b> 个集装箱、
                <b>{parsed.extras.cargoLines?.length || 0}</b> 条货物明细。
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <tbody>
                  {Object.entries(FIELD_LABELS).map(([k, label]) => (
                    <tr key={k}>
                      <td style={{ padding: 4, color: "#444", width: 130 }}>{label}</td>
                      <td style={{ padding: 4 }}>
                        {(k === "shipper" || k === "consignee" || k === "notify_party") ? (
                          <textarea
                            value={parsed.fields[k] || ""}
                            onChange={e => updateField(k, e.target.value)}
                            rows={3}
                            style={{ width: "100%", fontSize: 11, fontFamily: "Consolas,monospace", padding: 4, boxSizing: "border-box" }}
                          />
                        ) : (
                          <input
                            value={parsed.fields[k] ?? ""}
                            onChange={e => updateField(k, e.target.value)}
                            style={{ width: "100%", fontSize: 12, padding: "3px 6px", boxSizing: "border-box" }}
                          />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {(parsed.extras.containers?.length > 0) && (
                <details style={{ marginTop: 10 }} open>
                  <summary style={{ fontSize: 12, color: "#444", cursor: "pointer" }}>
                    集装箱 + VGM 明细 ({parsed.extras.containers.length})
                  </summary>
                  <table style={previewTable}>
                    <thead><tr>
                      <th style={th}>箱号</th><th style={th}>封号</th><th style={th}>箱型</th>
                      <th style={th}>件数</th><th style={th}>毛重 (KGS)</th>
                      <th style={th}>VGM (KGS)</th><th style={th}>体积 (CBM)</th>
                    </tr></thead>
                    <tbody>
                      {parsed.extras.containers.map((c, i) => (
                        <tr key={i}>
                          <td style={td}>{c.container_no}</td><td style={td}>{c.seal_no}</td>
                          <td style={td}>{c.container_type}</td><td style={td}>{c.qty ?? "—"}</td>
                          <td style={td}>{c.weight ?? "—"}</td>
                          <td style={td}>{c.vgm_weight ?? "—"}</td>
                          <td style={td}>{c.volume ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              )}

              <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
                <button onClick={doApply} style={btnPrimary}>应用到本票</button>
                <button onClick={reset} style={btn}>重新选择文件</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const overlayStyle = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,.4)",
  display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
};
const modalStyle = {
  width: "min(820px, 95vw)", maxHeight: "90vh", background: "#fff", borderRadius: 6,
  boxShadow: "0 6px 30px rgba(0,0,0,.2)", display: "flex", flexDirection: "column",
};
const btn = { padding: "5px 14px", cursor: "pointer", border: "1px solid #d9d9d9", background: "#fff", borderRadius: 3 };
const btnPrimary = { ...btn, background: "#1990ff", color: "#fff", border: "1px solid #1990ff", fontWeight: 600 };
const previewTable = { width: "100%", borderCollapse: "collapse", fontSize: 11, marginTop: 4, border: "1px solid #eee" };
const th = { padding: 3, background: "#f5f5f5", border: "1px solid #eee", textAlign: "left", fontWeight: 600 };
const td = { padding: 3, border: "1px solid #f0f0f0" };
