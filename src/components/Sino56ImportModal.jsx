// ============================================================================
// Sino56ImportModal — 拖拽 / 选择 Sino56 导出的 .xls 舱单文件，
//   解析后预览字段，应用到当前作业
//
// 字段写回路径：通过 onApply(fields, extras) 回调
//   - fields: shipments 主字段（vessel/voyage/pod/mbl_no/container_no/seal_no/
//             qty_packages/weight/volume/shipper/consignee/notify_party 等）
//   - extras: { containers: [...], cargoLines: [...] }
//             父组件负责写 shipment_containers / cargo_items
// ============================================================================
import { useState, useRef } from "react";
import { parseSino56Manifest, flattenSino56ForApply } from "../lib/sino56-manifest.js";

const FIELD_LABELS = {
  mbl_no: "总提单号", booking_no: "外运编号",
  vessel: "船名", voyage: "航次", pod: "目的港",
  container_no: "首箱箱号", seal_no: "首箱封号",
  qty_packages: "件数", weight: "毛重(KGS)", volume: "体积(CBM)",
  description: "英文品名", hs_code: "HS Code", marks: "唛头",
  shipper: "发货人", consignee: "收货人", notify_party: "通知人",
};

export default function Sino56ImportModal({ open, onClose, onApply }) {
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
      const buf = await file.arrayBuffer();
      const data = await parseSino56Manifest(buf);
      const { fields, extras } = flattenSino56ForApply(data);
      setParsed({ raw: data, fields, extras });
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
          <div style={{ fontSize: 14, fontWeight: 700 }}>📋 导入舱单 (Sino56 / 浙江兴港 .xls)</div>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ padding: "4px 12px" }}>关闭</button>
        </div>

        <div style={{ padding: 16, overflow: "auto", flex: 1 }}>
          {!parsed ? (
            <>
              <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>
                把 Sino56 或浙江兴港的 .xls 舱单拖到下方，或点击选择。系统会自动识别格式并提取船名/箱号/收发货人等字段。
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
                    : "📥 拖入或点击选择 .xls 文件"}
              </div>
              <input
                ref={inputRef}
                type="file"
                accept=".xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
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
                <b>{parsed.extras.cargoLines?.length || 0}</b> 条货物明细，
                会一起写到本票。
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <tbody>
                  {Object.entries(FIELD_LABELS).map(([k, label]) => (
                    <tr key={k}>
                      <td style={{ padding: 4, color: "#444", width: 110 }}>{label}</td>
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

              {/* 明细预览（只读，方便确认） */}
              {(parsed.extras.containers?.length > 0) && (
                <details style={{ marginTop: 10 }}>
                  <summary style={{ fontSize: 12, color: "#444", cursor: "pointer" }}>
                    集装箱 + VGM 明细 ({parsed.extras.containers.length})
                  </summary>
                  <table style={previewTable}>
                    <thead><tr>
                      <th style={th}>箱号</th><th style={th}>封号</th><th style={th}>箱型</th>
                      <th style={th}>件数</th><th style={th}>毛重</th><th style={th}>体积</th>
                      <th style={th}>VGM重量</th><th style={th}>责任方</th>
                    </tr></thead>
                    <tbody>
                      {parsed.extras.containers.map((c, i) => (
                        <tr key={i}>
                          <td style={td}>{c.container_no}</td><td style={td}>{c.seal_no}</td>
                          <td style={td}>{c.container_type}</td><td style={td}>{c.qty ?? "—"}</td>
                          <td style={td}>{c.weight ?? "—"}</td><td style={td}>{c.volume ?? "—"}</td>
                          <td style={td}>{c.vgm_weight ?? "—"}</td><td style={td}>{c.vgm_party ?? "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              )}
              {(parsed.extras.cargoLines?.length > 0) && (
                <details style={{ marginTop: 6 }}>
                  <summary style={{ fontSize: 12, color: "#444", cursor: "pointer" }}>
                    货物明细 ({parsed.extras.cargoLines.length})
                  </summary>
                  <table style={previewTable}>
                    <thead><tr>
                      <th style={th}>提单号</th><th style={th}>箱号</th><th style={th}>品名</th>
                      <th style={th}>HS</th><th style={th}>件数</th><th style={th}>毛重</th><th style={th}>体积</th>
                    </tr></thead>
                    <tbody>
                      {parsed.extras.cargoLines.map((c, i) => (
                        <tr key={i}>
                          <td style={td}>{c.hbl_no}</td><td style={td}>{c.container_no}</td>
                          <td style={td}>{c.product_name_en}</td><td style={td}>{c.hs_code}</td>
                          <td style={td}>{c.qty ?? "—"}</td><td style={td}>{c.gross_weight ?? "—"}</td>
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
