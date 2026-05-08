// ============================================================================
// InvoiceImportDialog.jsx — CSV 一键导入开票/收票记录
// 流程：上传 CSV → 解析 → 显示列名映射界面 → 用户确认列对应 →
//       预览有效行 + 跳过的行（红冲/作废） → 确认导入 → upsert invoices
// CSV 不需要含账单关联（导入后由用户手工配对）
// ============================================================================

import { useState, useMemo } from "react";
import { supabase } from "../supabase.js";

const BRAND = "#1f3864";

// 标准目标字段 + 中文别名（用来从 CSV 列名自动猜映射）
const TARGET_FIELDS = [
  { key: "invoice_no",      label: "发票号",       aliases: ["发票号码","发票号","号码","invoice no","invoice_no"], required: true },
  { key: "invoice_date",    label: "开票日期",     aliases: ["开票日期","日期","开具日期","invoice date","date"],   required: true },
  { key: "amount_total",    label: "价税合计",     aliases: ["价税合计","金额","合计金额","总金额","amount"],         required: true },
  { key: "amount_excl_tax", label: "不含税金额",   aliases: ["不含税金额","金额不含税","金额(不含税)","金额（不含税）","not_tax"] },
  { key: "tax_amount",      label: "税额",         aliases: ["税额","税","tax"] },
  { key: "tax_rate",        label: "税率",         aliases: ["税率","tax_rate"] },
  { key: "partner_name",    label: "对方名称",     aliases: ["对方名称","客户","供应商","购方","销方","购买方","销售方","买方","卖方","开票方","受票方","公司名称"] },
  { key: "currency",        label: "币种",         aliases: ["币种","币别","currency"] },
  { key: "source_status",   label: "票据状态",     aliases: ["票据状态","发票状态","状态","status","开票状态"] },
  { key: "notes",           label: "备注",         aliases: ["备注","摘要","note","memo"] },
];

const NORMAL_STATUS_KEYWORDS = ["正常", "已开票", "未冲", "valid", "normal", ""];
const VOIDED_STATUS_KEYWORDS = ["冲红", "已冲红", "红冲", "作废", "已作废", "无效", "红字", "red"];

// 简单 CSV 解析（支持引号 + 逗号转义）
function parseCSV(text) {
  // 去除 BOM
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const rows = [];
  let cur = [], field = "", inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuote) {
      if (c === '"' && text[i+1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuote = false;
      else field += c;
    } else {
      if (c === '"') inQuote = true;
      else if (c === ",") { cur.push(field); field = ""; }
      else if (c === "\n") { cur.push(field); rows.push(cur); cur = []; field = ""; }
      else if (c === "\r") { /* 跳过 */ }
      else field += c;
    }
  }
  if (field.length > 0 || cur.length > 0) { cur.push(field); rows.push(cur); }
  return rows.filter(r => r.some(x => String(x).trim() !== ""));
}

// 给定 CSV 列名，猜对应到哪个目标字段
function autoMatchHeaders(headers) {
  const result = {};
  for (const h of headers) {
    const hl = String(h).toLowerCase().trim();
    for (const tgt of TARGET_FIELDS) {
      if (result[tgt.key]) continue;
      if (tgt.aliases.some(a => hl === a.toLowerCase() || hl.includes(a.toLowerCase()))) {
        result[tgt.key] = h;
        break;
      }
    }
  }
  return result;
}

function normalizeStatus(raw) {
  const s = String(raw || "").trim().toLowerCase();
  if (VOIDED_STATUS_KEYWORDS.some(k => s.includes(k.toLowerCase()))) return "voided";
  return "normal";
}

function normalizeDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  // 常见 yyyy-mm-dd / yyyy/mm/dd / yyyymmdd
  const m1 = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (m1) return `${m1[1]}-${String(m1[2]).padStart(2,"0")}-${String(m1[3]).padStart(2,"0")}`;
  const m2 = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m2) return `${m2[1]}-${m2[2]}-${m2[3]}`;
  return null;
}

function num(raw) {
  if (raw == null || raw === "") return null;
  const v = parseFloat(String(raw).replace(/[,，¥$]/g, ""));
  return isNaN(v) ? null : v;
}

export default function InvoiceImportDialog({ direction, onClose, onImported }) {
  const [step, setStep] = useState("upload"); // upload / map / preview / done
  const [rawRows, setRawRows] = useState([]);
  const [headers, setHeaders] = useState([]);
  const [mapping, setMapping] = useState({});
  const [kind, setKind] = useState("business");
  const [partners, setPartners] = useState([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);

  const onFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    const text = await f.text();
    const rows = parseCSV(text);
    if (rows.length < 2) { alert("CSV 行数太少（至少需要 1 行表头 + 1 行数据）"); return; }
    const hdr = rows[0].map(x => String(x).trim());
    const data = rows.slice(1);
    setHeaders(hdr);
    setRawRows(data);
    setMapping(autoMatchHeaders(hdr));

    // 同时拉 partners 用于 partner_name → partner_id 匹配
    const { data: pts } = await supabase.from("customers")
      .select("id, name, partner_type").eq("active", true);
    setPartners(pts || []);

    setStep("map");
  };

  // 构建预览行（按映射 + 状态过滤）
  const preview = useMemo(() => {
    if (step === "upload") return null;
    const colIdx = {};
    Object.entries(mapping).forEach(([k, h]) => { colIdx[k] = headers.indexOf(h); });

    const partnerByName = new Map();
    partners.forEach(p => { partnerByName.set((p.name || "").toLowerCase().trim(), p); });

    const valid = [], skipped = [];
    rawRows.forEach((row, i) => {
      const get = (k) => colIdx[k] >= 0 ? String(row[colIdx[k]] ?? "").trim() : "";
      const status = normalizeStatus(get("source_status"));
      const invoice_no = get("invoice_no");
      const amount_total = num(get("amount_total"));

      if (status === "voided") {
        skipped.push({ row: i + 2, reason: "红冲/作废", invoice_no });
        return;
      }
      if (!invoice_no) { skipped.push({ row: i + 2, reason: "无发票号" }); return; }
      if (amount_total == null || amount_total === 0) { skipped.push({ row: i + 2, reason: "金额无效", invoice_no }); return; }
      if (amount_total < 0) { skipped.push({ row: i + 2, reason: "负数金额（红字票）", invoice_no }); return; }

      const pname = get("partner_name");
      const matched = partnerByName.get(pname.toLowerCase());

      valid.push({
        invoice_no,
        invoice_date:    normalizeDate(get("invoice_date")),
        amount_total,
        amount_excl_tax: num(get("amount_excl_tax")),
        tax_amount:      num(get("tax_amount")),
        tax_rate:        num(get("tax_rate")),
        currency:        (get("currency") || "CNY").toUpperCase(),
        partner_id:      matched?.id || null,
        partner_name:    pname || null,
        partner_unmatched: pname && !matched,
        source_status:   "正常",
        notes:           get("notes") || null,
      });
    });
    return { valid, skipped };
  }, [step, rawRows, headers, mapping, partners]);

  const onConfirmImport = async () => {
    setImporting(true);
    try {
      const batchTag = `csv:${new Date().toISOString().slice(0, 10)}`;
      const payload = preview.valid.map(v => ({
        invoice_no:      v.invoice_no,
        invoice_date:    v.invoice_date,
        direction,
        kind,
        partner_id:      v.partner_id,
        partner_name:    v.partner_name,
        amount_total:    v.amount_total,
        amount_excl_tax: v.amount_excl_tax,
        tax_amount:      v.tax_amount,
        tax_rate:        v.tax_rate,
        currency:        v.currency,
        source_status:   "正常",
        notes:           v.notes,
        imported_from:   batchTag,
      }));
      // upsert：同 (invoice_no, direction) 已存在则跳过
      const { error } = await supabase.from("invoices")
        .upsert(payload, { onConflict: "invoice_no,direction" });
      if (error) throw error;
      setResult({ inserted: payload.length });
      setStep("done");
      onImported?.();
    } catch (e) {
      alert("导入失败: " + (e.message || e));
    } finally {
      setImporting(false);
    }
  };

  return (
    <div style={modalBg} onClick={importing ? undefined : onClose}>
      <div style={modal} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <span style={{ fontSize: 14, fontWeight: 700 }}>
            CSV 导入 {direction === "AR" ? "开票" : "收票"}记录
          </span>
          <span onClick={onClose} style={{ cursor: "pointer", color: "#888", fontSize: 18 }}>×</span>
        </div>

        {/* 步骤指示 */}
        <div style={{ display: "flex", gap: 0, marginBottom: 16, fontSize: 12 }}>
          {[["upload","上传"],["map","列映射"],["preview","预览"],["done","完成"]].map(([k, label], i) => (
            <div key={k} style={{
              padding: "5px 14px",
              background: step === k ? BRAND : "#fafafa",
              color: step === k ? "#fff" : "#888",
              borderRadius: i === 0 ? "3px 0 0 3px" : i === 3 ? "0 3px 3px 0" : 0,
              fontWeight: step === k ? 600 : 400,
            }}>
              {i+1}. {label}
            </div>
          ))}
        </div>

        {/* 1. 上传 */}
        {step === "upload" && (
          <div style={{ padding: 24, textAlign: "center", border: "1px dashed #d9d9d9", borderRadius: 4 }}>
            <div style={{ marginBottom: 12, color: "#666", fontSize: 13 }}>
              选择本地 CSV 文件（UTF-8 编码，第一行表头）
            </div>
            <input type="file" accept=".csv,text/csv" onChange={onFile} />
            <div style={{ marginTop: 16, fontSize: 11, color: "#888", lineHeight: 1.6 }}>
              支持的列名：发票号 / 开票日期 / 价税合计 / 不含税金额 / 税额 / 税率 / 对方名称 / 票据状态 / 备注<br/>
              "已冲红""已作废""红字票"等状态会自动跳过
            </div>
          </div>
        )}

        {/* 2. 列映射 */}
        {step === "map" && (
          <div>
            <div style={{ marginBottom: 12, fontSize: 12, color: "#666" }}>
              已读到 <b>{rawRows.length}</b> 行数据。请确认列名映射（自动匹配的可以微调）：
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 12 }}>
              {TARGET_FIELDS.map(tgt => (
                <div key={tgt.key} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <label style={{ width: 100, color: "#666", flexShrink: 0 }}>
                    {tgt.label}{tgt.required && <span style={{ color: "#ff4d4f" }}>*</span>}
                  </label>
                  <select value={mapping[tgt.key] || ""}
                          onChange={e => setMapping({ ...mapping, [tgt.key]: e.target.value || undefined })}
                          style={{ ...input, flex: 1 }}>
                    <option value="">— 不映射 —</option>
                    {headers.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 14, fontSize: 12, display: "flex", gap: 14, alignItems: "center" }}>
              <span style={{ color: "#666" }}>本批发票类型：</span>
              <label><input type="radio" checked={kind==="business"} onChange={()=>setKind("business")} /> 业务</label>
              <label><input type="radio" checked={kind==="non_business"} onChange={()=>setKind("non_business")} /> 非业务（仅 admin 可见）</label>
            </div>
            <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button style={btn} onClick={() => setStep("upload")}>← 重选文件</button>
              <button style={{ ...btn, background: BRAND, color: "#fff", borderColor: BRAND }}
                      onClick={() => {
                        if (!mapping.invoice_no || !mapping.invoice_date || !mapping.amount_total) {
                          alert("发票号 / 开票日期 / 价税合计 必须映射"); return;
                        }
                        setStep("preview");
                      }}>
                下一步 →
              </button>
            </div>
          </div>
        )}

        {/* 3. 预览 */}
        {step === "preview" && preview && (
          <div>
            <div style={{ marginBottom: 12, fontSize: 13, display: "flex", gap: 16 }}>
              <span style={{ color: "#52c41a" }}>✓ 有效 {preview.valid.length} 张</span>
              <span style={{ color: "#fa8c16" }}>⊘ 跳过 {preview.skipped.length} 张</span>
              {preview.valid.filter(v => v.partner_unmatched).length > 0 && (
                <span style={{ color: "#fa541c" }}>⚠ 对方名匹配不到 {preview.valid.filter(v => v.partner_unmatched).length} 张（导入时 partner_id 留空，后续手工补）</span>
              )}
            </div>
            <div style={{ maxHeight: 320, overflow: "auto", border: "1px solid #f0f0f0", borderRadius: 3 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
                <thead style={{ background: "#fafafa", position: "sticky", top: 0 }}>
                  <tr>
                    <th style={subTh}>发票号</th>
                    <th style={subTh}>日期</th>
                    <th style={subTh}>对方</th>
                    <th style={{ ...subTh, textAlign: "right" }}>金额</th>
                    <th style={subTh}>状态</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.valid.map((v, i) => (
                    <tr key={i} style={{ borderTop: "1px solid #fafafa" }}>
                      <td style={{ ...subTd, fontFamily: "monospace" }}>{v.invoice_no}</td>
                      <td style={subTd}>{v.invoice_date || "—"}</td>
                      <td style={{ ...subTd, color: v.partner_unmatched ? "#fa541c" : "inherit" }}>
                        {v.partner_name || "—"}{v.partner_unmatched && " ⚠"}
                      </td>
                      <td style={{ ...subTd, textAlign: "right" }}>{v.currency} {v.amount_total.toFixed(2)}</td>
                      <td style={{ ...subTd, color: "#52c41a" }}>有效</td>
                    </tr>
                  ))}
                  {preview.skipped.map((s, i) => (
                    <tr key={`s${i}`} style={{ borderTop: "1px solid #fafafa", color: "#aaa" }}>
                      <td style={{ ...subTd, fontFamily: "monospace" }}>{s.invoice_no || "—"}</td>
                      <td colSpan={3} style={subTd}>第 {s.row} 行</td>
                      <td style={{ ...subTd, color: "#fa8c16" }}>跳过：{s.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button style={btn} onClick={() => setStep("map")} disabled={importing}>← 返回</button>
              <button style={{ ...btn, background: BRAND, color: "#fff", borderColor: BRAND }}
                      disabled={importing || preview.valid.length === 0}
                      onClick={onConfirmImport}>
                {importing ? "导入中..." : `确认导入 ${preview.valid.length} 张`}
              </button>
            </div>
          </div>
        )}

        {/* 4. 完成 */}
        {step === "done" && result && (
          <div style={{ padding: 30, textAlign: "center" }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>✓</div>
            <div style={{ fontSize: 14, color: "#222", marginBottom: 8 }}>
              已导入 {result.inserted} 张发票
            </div>
            <div style={{ fontSize: 12, color: "#888" }}>
              重复 invoice_no 已自动跳过。请回到列表查看。
            </div>
            <button style={{ ...btn, marginTop: 18 }} onClick={onClose}>关闭</button>
          </div>
        )}
      </div>
    </div>
  );
}

const btn = { padding: "5px 14px", background: "#fff", border: "1px solid #d9d9d9", borderRadius: 3, fontSize: 12, cursor: "pointer" };
const input = { padding: "5px 8px", border: "1px solid #d9d9d9", borderRadius: 3, fontSize: 12 };
const subTh = { padding: "5px 6px", textAlign: "left", borderBottom: "1px solid #e8e8e8", fontWeight: 600, fontSize: 11, color: "#888" };
const subTd = { padding: "5px 6px" };
const modalBg = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" };
const modal = { background: "#fff", borderRadius: 4, padding: 20, width: 720, maxHeight: "90vh", overflowY: "auto", boxShadow: "0 4px 16px rgba(0,0,0,0.2)" };
