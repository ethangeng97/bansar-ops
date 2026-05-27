// ============================================================================
// SpotBookingImportModal — 现舱批量导入
// 1. 下载模板（带示例行的 .xlsx）
// 2. 拖入 / 选文件上传
// 3. 解析 → 预览（含校验错误） → 确认 → 批量 insert spot_bookings
// 去重：按 booking_no 匹配，已存在的跳过；没 booking_no 的全部当新增
// ============================================================================
import { useState, useRef, useEffect } from "react";
import { supabase } from "../supabase.js";
import { exportToXlsx, parseXlsx } from "../lib/excel-export.js";
import { parseMaerskBC } from "../lib/maersk-bc-pdf-parser.js";

// Excel header → DB column + 转换
const COLS = [
  { hdr: "船公司",       col: "carrier",          required: true },
  { hdr: "船名",         col: "vessel" },
  { hdr: "航次",         col: "voyage" },
  { hdr: "航线",         col: "route" },
  { hdr: "POL",          col: "pol",              required: true },
  { hdr: "POD",          col: "pod",              required: true },
  { hdr: "ETD",          col: "etd",              parse: toDate },
  { hdr: "ETA",          col: "eta",              parse: toDate },
  { hdr: "柜型尺寸",     col: "container_size" },
  { hdr: "柜型类型",     col: "container_type" },
  { hdr: "总舱位",       col: "total_qty",        required: true, parse: toInt },
  { hdr: "SI截单",       col: "si_cutoff",        parse: toDateTime },
  { hdr: "VGM截单",      col: "vgm_cutoff",       parse: toDateTime },
  { hdr: "报关截单",     col: "customs_cutoff",   parse: toDateTime },
  { hdr: "截港",         col: "port_cutoff",      parse: toDateTime },
  { hdr: "进价",         col: "purchase_price",   parse: toNum },
  { hdr: "售价下限",     col: "sell_price_min",   parse: toNum },
  { hdr: "售价上限",     col: "sell_price_max",   parse: toNum },
  { hdr: "币种",         col: "currency" },
  { hdr: "订舱号",       col: "booking_no" },
  { hdr: "MBL",          col: "mbl_no" },
  { hdr: "备注",         col: "notes" },
];

function toInt(v)      { if (v === "" || v == null) return null; const n = parseInt(v, 10); return Number.isFinite(n) ? n : null; }
function toNum(v)      { if (v === "" || v == null) return null; const n = Number(v);       return Number.isFinite(n) ? n : null; }
function toDate(v) {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  // 接受 YYYY-MM-DD / YYYY/MM/DD / YYYY.M.D 等
  const m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${String(m[2]).padStart(2,"0")}-${String(m[3]).padStart(2,"0")}`;
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : null;
}
function toDateTime(v) {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString();
  const s = String(v).trim();
  // 接受 "YYYY-MM-DD HH:MM" / "YYYY/MM/DD HH:MM:SS" 等
  const norm = s.replace(/\//g, "-").replace(/\./g, "-");
  const d = new Date(norm);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

export default function SpotBookingImportModal({ open, onClose, onImported }) {
  const [parsed, setParsed] = useState(null);   // { rows, errors }
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [customers, setCustomers] = useState([]);
  const [partnerName, setPartnerName] = useState("");
  const [partnerId, setPartnerId] = useState(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    supabase.from("customers").select("id, name, name_short, partner_type").order("name").then(({ data }) => {
      setCustomers(data || []);
    });
  }, [open]);

  if (!open) return null;

  const reset = () => { setParsed(null); setErr(null); };

  const downloadTemplate = () => {
    exportToXlsx({
      filename: "现舱导入模板.xlsx",
      sheetName: "现舱",
      columns: COLS.map(c => ({ key: c.col, label: c.hdr, width: 14 })),
      rows: [
        {
          carrier: "Maersk", vessel: "EBBA MAERSK", voyage: "613W",
          route: "USEC", pol: "NINGBO", pod: "LONDON GATEWAY",
          etd: "2026-06-15", eta: "2026-07-10",
          container_size: "40", container_type: "HC", total_qty: 5,
          si_cutoff: "2026-06-12 17:00", vgm_cutoff: "2026-06-12 17:00",
          customs_cutoff: "2026-06-13 12:00", port_cutoff: "2026-06-14 18:00",
          purchase_price: 2000, sell_price_min: 2500, sell_price_max: 3000,
          currency: "USD", booking_no: "MAEU123456789", mbl_no: "",
          notes: "标准船期",
        },
        {
          carrier: "MSC", vessel: "MSC AMBRA", voyage: "MS525W",
          route: "USEC", pol: "SHANGHAI", pod: "LONG BEACH",
          etd: "2026-06-20", eta: "2026-07-08",
          container_size: "40", container_type: "HQ", total_qty: 3,
          si_cutoff: "2026-06-17 17:00", vgm_cutoff: "2026-06-17 17:00",
          customs_cutoff: "2026-06-18 12:00", port_cutoff: "2026-06-19 18:00",
          purchase_price: 1800, sell_price_min: 2300, sell_price_max: 2800,
          currency: "USD", booking_no: "MSCU987654321", mbl_no: "",
          notes: "",
        },
      ],
    });
  };

  const handleFile = async (file) => {
    if (!file) return;
    reset();
    setBusy(true);
    try {
      const isPdf = /\.pdf$/i.test(file.name) || file.type === "application/pdf";
      let rows = [];
      const errors = [];

      if (isPdf) {
        // PDF 单文件解析（目前只支持 Maersk BC）
        const r = await parseMaerskBC(file);
        if (!r.ok) {
          setErr(r.error || "PDF 解析失败");
          return;
        }
        const out = r.data;
        // 校验必填
        const missing = COLS.filter(c => c.required && (out[c.col] == null || out[c.col] === ""))
                            .map(c => c.hdr);
        if (missing.length > 0) {
          errors.push(`PDF 缺：${missing.join(" / ")}（可在导入后手动补）`);
        }
        rows.push({ rowNo: file.name, data: out });
      } else {
        // Excel 模板
        const rawRows = await parseXlsx(file);
        if (!rawRows || rawRows.length === 0) { setErr("文件没读出数据。第一行应该是表头。"); return; }
        const colByHdr = new Map(COLS.map(c => [c.hdr, c]));
        rawRows.forEach((r, i) => {
          const rowNo = i + 2;
          const out = {};
          for (const [hdr, val] of Object.entries(r)) {
            const c = colByHdr.get(hdr.trim());
            if (!c) continue;
            const v = c.parse ? c.parse(val) : (val === "" ? null : String(val).trim());
            out[c.col] = v;
          }
          const missing = COLS.filter(c => c.required && (out[c.col] == null || out[c.col] === ""))
                              .map(c => c.hdr);
          if (missing.length > 0) {
            errors.push(`第 ${rowNo} 行缺：${missing.join(" / ")}`);
            return;
          }
          if (!out.status) out.status = "可售";
          if (!out.currency) out.currency = "USD";
          rows.push({ rowNo, data: out });
        });
      }

      // 跟现有 spot_bookings 按 booking_no 去重
      const bookingNos = rows.map(r => r.data.booking_no).filter(Boolean);
      let existingByBn = new Set();
      if (bookingNos.length > 0) {
        const { data: exists } = await supabase.from("spot_bookings")
          .select("booking_no").in("booking_no", bookingNos);
        existingByBn = new Set((exists || []).map(x => x.booking_no));
      }
      const newRows = [], skipRows = [];
      for (const r of rows) {
        if (r.data.booking_no && existingByBn.has(r.data.booking_no)) skipRows.push(r);
        else newRows.push(r);
      }

      setParsed({ newRows, skipRows, errors });
    } catch (e) {
      console.error(e);
      setErr("解析失败：" + (e.message || String(e)));
    } finally {
      setBusy(false);
    }
  };

  const onDrop = (e) => {
    e.preventDefault(); setDragOver(false);
    handleFile(e.dataTransfer.files?.[0]);
  };

  const onConfirm = async () => {
    if (!parsed || parsed.newRows.length === 0) return;
    setBusy(true);
    setErr(null);
    try {
      // 关联客户/海外代理（统一应用到本批所有导入行）
      const payload = parsed.newRows.map(r => ({
        ...r.data,
        ...(partnerName ? { partner_name: partnerName, partner_id: partnerId || null } : {}),
      }));
      const { error } = await supabase.from("spot_bookings").insert(payload);
      if (error) { setErr("导入失败：" + error.message); setBusy(false); return; }
      alert(`✓ 已导入 ${payload.length} 条现舱（跳过 ${parsed.skipRows.length} 条已存在）`);
      onImported?.();
      onClose();
    } catch (e) {
      setErr("导入失败：" + (e.message || String(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div onClick={onClose} style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,.35)",
      zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: "#fff", borderRadius: 6, width: "min(820px, 95vw)",
        maxHeight: "92vh", display: "flex", flexDirection: "column",
        boxShadow: "0 10px 40px rgba(0,0,0,.2)",
      }}>
        <div style={{ padding: "12px 18px", borderBottom: "1px solid #e8e8e8",
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      background: "linear-gradient(#fafafa,#f0f0f0)" }}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>📥 现舱批量导入</span>
          <button onClick={onClose} style={{ border: "none", background: "transparent", fontSize: 18, cursor: "pointer", color: "#999" }}>×</button>
        </div>

        <div style={{ padding: 18, overflowY: "auto", flex: 1 }}>
          {/* 步骤说明 + 模板 */}
          <div style={{ padding: 12, background: "#e6f4ff", border: "1px solid #c8dfff", borderRadius: 4, marginBottom: 14, fontSize: 12, lineHeight: 1.8 }}>
            <b>使用说明：</b>
            <div>1. <b>Excel 通用模板</b>：<span className="lk" onClick={downloadTemplate} style={{ color: "#1990FF", cursor: "pointer", textDecoration: "underline" }}>下载模板</span>（带 2 行示例，22 列）</div>
            <div>2. <b>Maersk 订舱确认 PDF</b>：直接拖入 PDF，自动识别 + 抽字段（船名航次/POL/POD/ETD/ETA/柜型/还箱时间）</div>
            <div>3. 系统按<b>船公司订舱号</b>去重（已存在的跳过），其他全部新增</div>
            <div>4. 必填：船公司 / POL / POD / 总舱位（PDF 缺字段可在导入后手动补）</div>
          </div>

          {/* 关联客户 / 海外代理 —— 应用到本批所有导入行 */}
          <div style={{ marginBottom: 14, padding: 10, background: "#fafafa", border: "1px solid #e8e8e8", borderRadius: 4 }}>
            <label style={{ fontSize: 12, color: "#555", marginRight: 8, fontWeight: 600 }}>本批关联客户/海外代理（可选）：</label>
            <input list="import-partners" value={partnerName}
                   onChange={e => {
                     const v = e.target.value;
                     setPartnerName(v);
                     const c = customers.find(c => c.name === v);
                     setPartnerId(c?.id || null);
                   }}
                   placeholder="输入客户或代理名"
                   style={{ width: 280, padding: "4px 8px", border: "1px solid #c1c1c1", borderRadius: 3, fontSize: 12 }} />
            <datalist id="import-partners">
              {customers.map(c => (
                <option key={c.id} value={c.name}>{c.partner_type || ""} · {c.name_short || ""}</option>
              ))}
            </datalist>
            {partnerName && (
              <button onClick={() => { setPartnerName(""); setPartnerId(null); }}
                      style={{ marginLeft: 6, padding: "2px 8px", fontSize: 11, border: "1px solid #d9d9d9", background: "#fff", borderRadius: 3, cursor: "pointer" }}>清除</button>
            )}
            <div style={{ fontSize: 11, color: "#999", marginTop: 4 }}>
              留空就不关联；填了会应用到本次导入的所有现舱
            </div>
          </div>

          {/* 拖入区 */}
          {!parsed && (
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              onClick={() => inputRef.current?.click()}
              style={{
                border: `2px dashed ${dragOver ? "#1990FF" : "#d9d9d9"}`,
                background: dragOver ? "#e6f4ff" : "#fafafa",
                borderRadius: 6, padding: 40, textAlign: "center",
                cursor: "pointer", transition: "all .15s",
              }}
            >
              <div style={{ fontSize: 36, color: "#bbb", marginBottom: 8 }}>📋</div>
              <div style={{ fontSize: 13, color: "#666" }}>
                {busy ? "解析中..." : "拖入 .xlsx 模板 或 Maersk .pdf 订舱确认，或点击选择"}
              </div>
              <input ref={inputRef} type="file" accept=".xlsx,.xls,.pdf"
                     onChange={e => handleFile(e.target.files?.[0])}
                     style={{ display: "none" }} />
            </div>
          )}

          {err && (
            <div style={{ marginTop: 12, padding: 10, background: "#fff1f0", border: "1px solid #ffa39e",
                          borderRadius: 4, fontSize: 12, color: "#cf1322" }}>
              ⚠ {err}
            </div>
          )}

          {/* 预览 */}
          {parsed && (
            <div style={{ marginTop: 4 }}>
              <div style={{ marginBottom: 10, fontSize: 13 }}>
                解析结果：
                <b style={{ color: "#52c41a", margin: "0 6px" }}>{parsed.newRows.length}</b> 条新增 ·
                <b style={{ color: "#888", margin: "0 6px" }}>{parsed.skipRows.length}</b> 条已存在跳过 ·
                <b style={{ color: "#cf1322", margin: "0 6px" }}>{parsed.errors.length}</b> 条校验错误
              </div>

              {parsed.errors.length > 0 && (
                <div style={{ padding: 10, background: "#fff1f0", border: "1px solid #ffa39e",
                              borderRadius: 4, fontSize: 12, color: "#cf1322", marginBottom: 10, maxHeight: 120, overflow: "auto" }}>
                  {parsed.errors.map((e, i) => <div key={i}>{e}</div>)}
                </div>
              )}

              {parsed.newRows.length > 0 && (
                <div style={{ border: "1px solid #e8e8e8", borderRadius: 4, maxHeight: 320, overflow: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                    <thead style={{ background: "#fafafa", position: "sticky", top: 0 }}>
                      <tr>
                        {["#", "订舱号", "船公司", "船名航次", "POL→POD", "ETD", "柜型", "数", "关联"].map(h => (
                          <th key={h} style={{ padding: "6px 8px", borderBottom: "1px solid #e8e8e8", textAlign: "left", color: "#666" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {parsed.newRows.map((r, i) => (
                        <tr key={i} style={{ borderBottom: "1px solid #f0f0f0" }}>
                          <td style={{ padding: "6px 8px", color: "#999" }}>{r.rowNo}</td>
                          <td style={{ padding: "6px 8px", fontFamily: "monospace", fontSize: 10 }}>{r.data.booking_no || "—"}</td>
                          <td style={{ padding: "6px 8px" }}>{r.data.carrier}</td>
                          <td style={{ padding: "6px 8px" }}>{r.data.vessel || "—"}{r.data.voyage ? ` / ${r.data.voyage}` : ""}</td>
                          <td style={{ padding: "6px 8px" }}>{r.data.pol} → {r.data.pod}</td>
                          <td style={{ padding: "6px 8px" }}>{r.data.etd || "—"}</td>
                          <td style={{ padding: "6px 8px" }}>{r.data.container_size || ""}{r.data.container_type || ""}</td>
                          <td style={{ padding: "6px 8px", textAlign: "right" }}>{r.data.total_qty}</td>
                          <td style={{ padding: "6px 8px", color: partnerName ? "#1990FF" : "#bbb" }}>{partnerName || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {parsed.skipRows.length > 0 && (
                <div style={{ marginTop: 10, padding: 8, background: "#fafafa", border: "1px solid #eee", borderRadius: 4, fontSize: 11, color: "#888" }}>
                  跳过的订舱号：{parsed.skipRows.map(r => r.data.booking_no).join(", ")}
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ padding: "10px 18px", borderTop: "1px solid #e8e8e8",
                      display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            {parsed && <button onClick={reset} style={{
              padding: "6px 14px", border: "1px solid #d9d9d9", borderRadius: 3,
              background: "#fff", cursor: "pointer", fontSize: 12,
            }}>重新选择</button>}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onClose} style={{
              padding: "6px 16px", background: "#fff", border: "1px solid #d9d9d9",
              borderRadius: 3, fontSize: 12, cursor: "pointer",
            }}>取消</button>
            <button onClick={onConfirm} disabled={busy || !parsed || parsed.newRows.length === 0} style={{
              padding: "6px 16px",
              background: busy || !parsed || parsed.newRows.length === 0 ? "#d9d9d9" : "#1990ff",
              color: "#fff", border: "1px solid transparent",
              borderRadius: 3, fontSize: 12, cursor: busy ? "not-allowed" : "pointer", fontWeight: 600,
            }}>{busy ? "导入中..." : `确认导入 ${parsed?.newRows.length || 0} 条`}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
