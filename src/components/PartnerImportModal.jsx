// ============================================================================
// PartnerImportModal — 客商批量导入
// 1. 下载模板 (.xlsx with header row)
// 2. 用户填好后上传
// 3. 按 (code + partner_type) 或 (name + partner_type) 匹配现有记录
// 4. 预览 新增 / 更新 / 跳过 → 确认 → upsert
// ============================================================================
import { useState, useRef } from "react";
import { supabase } from "../supabase.js";
import { exportToXlsx, parseXlsx } from "../lib/excel-export.js";
import { invalidate as invalidateRef } from "../lib/ref-cache.js";

const PARTNER_TYPES = ["客户","供应商","船东","订舱代理","海外代理","车队","报关行","仓库"];

// 列定义：Excel header → DB column
const COLS = [
  { hdr: "类型",        col: "partner_type",  required: true },
  { hdr: "编号",        col: "code" },
  { hdr: "名称(中文)",  col: "name",          required: true },
  { hdr: "英文名",      col: "name_en" },
  { hdr: "简称",        col: "name_short" },
  { hdr: "中文地址",    col: "address_zh" },
  { hdr: "英文地址",    col: "address_en" },
  { hdr: "国家/地区",   col: "country" },
  { hdr: "联系人",      col: "contact_name" },
  { hdr: "电话",        col: "contact_phone" },
  { hdr: "邮箱",        col: "contact_email" },
  { hdr: "税号 (USCI/VAT)", col: "tax_id" },
  { hdr: "信用条款",    col: "credit_terms" },
  { hdr: "开户行",      col: "bank_name" },
  { hdr: "银行账号",    col: "bank_account" },
  { hdr: "发票抬头",    col: "invoice_title" },
  { hdr: "状态",        col: "active", parse: v => v === "停用" ? false : true },
];

export default function PartnerImportModal({ open, onClose, onImported }) {
  const [parsed, setParsed] = useState(null);   // { newRows, updateRows, skipped }
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);

  if (!open) return null;

  const reset = () => { setParsed(null); setErr(null); };

  const downloadTemplate = () => {
    exportToXlsx({
      filename: "客商导入模板.xlsx",
      sheetName: "客商",
      columns: COLS.map(c => ({ key: c.col, label: c.hdr, width: 18 })),
      rows: [
        { partner_type: "客户", name: "示例公司有限公司", name_short: "示例", country: "CN", active: "启用" },
        { partner_type: "供应商", name: "示例供应商有限公司", country: "CN", active: "启用" },
      ],
    });
  };

  const handleFile = async (file) => {
    if (!file) return;
    reset();
    setBusy(true);
    try {
      const rows = await parseXlsx(file);
      if (!rows || rows.length === 0) { setErr("文件没读出数据。第一行应该是表头。"); return; }
      // 表头 → DB col
      const colByHdr = new Map(COLS.map(c => [c.hdr, c]));
      const parseRow = (r) => {
        const out = {};
        for (const [hdr, val] of Object.entries(r)) {
          const c = colByHdr.get(hdr);
          if (!c) continue;
          out[c.col] = c.parse ? c.parse(val) : (val === "" ? null : val);
        }
        return out;
      };
      const cleaned = rows.map(parseRow);

      // 拉一次现有客商，按 (code, partner_type) 和 (name, partner_type) 建索引匹配
      const { data: existing } = await supabase.from("customers")
        .select("id, code, name, partner_type").limit(2000);
      const byCode = new Map();   // `${code}|${type}` → row
      const byName = new Map();   // `${name}|${type}` → row
      for (const e of (existing || [])) {
        if (e.code) byCode.set(`${e.code}|${e.partner_type}`, e);
        byName.set(`${e.name}|${e.partner_type}`, e);
      }

      const newRows = [];
      const updateRows = [];
      const skipped = [];
      for (let i = 0; i < cleaned.length; i++) {
        const r = cleaned[i];
        // 必填校验
        if (!r.partner_type || !r.name) {
          skipped.push({ idx: i + 2, reason: "缺少 类型 或 名称(中文)", row: r });
          continue;
        }
        if (!PARTNER_TYPES.includes(r.partner_type)) {
          skipped.push({ idx: i + 2, reason: `非法类型 "${r.partner_type}"`, row: r });
          continue;
        }
        // 匹配
        const match = (r.code && byCode.get(`${r.code}|${r.partner_type}`))
                   || byName.get(`${r.name}|${r.partner_type}`);
        if (match) {
          updateRows.push({ id: match.id, ...r });
        } else {
          newRows.push(r);
        }
      }
      setParsed({ newRows, updateRows, skipped, total: cleaned.length });
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
    handleFile(e.dataTransfer?.files?.[0]);
  };

  const doImport = async () => {
    if (!parsed) return;
    setBusy(true);
    try {
      let okN = 0, okU = 0, fail = 0;
      // 新增：分批 insert
      for (const chunk of chunks(parsed.newRows, 100)) {
        const { error } = await supabase.from("customers").insert(chunk);
        if (error) fail += chunk.length;
        else okN += chunk.length;
      }
      // 更新：逐条 update（避免覆盖同名冲突）
      for (const r of parsed.updateRows) {
        const { id, ...payload } = r;
        const { error } = await supabase.from("customers").update(payload).eq("id", id);
        if (error) fail++;
        else okU++;
      }
      invalidateRef("customers", "customers_full");
      alert(`导入完成：新增 ${okN}，更新 ${okU}，跳过 ${parsed.skipped.length}${fail ? `，失败 ${fail}` : ""}`);
      onImported?.();
      reset();
      onClose();
    } catch (e) {
      alert("导入失败：" + (e?.message || e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", padding: "10px 16px", borderBottom: "1px solid #eee" }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>📥 批量导入客商</div>
          <div style={{ flex: 1 }} />
          <button onClick={downloadTemplate} style={btn}>📄 下载模板</button>
          <button onClick={onClose} style={{ ...btn, marginLeft: 8 }}>关闭</button>
        </div>
        <div style={{ padding: 16, overflow: "auto", flex: 1 }}>
          {!parsed ? (
            <>
              <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>
                先<b>下载模板</b>填好数据再拖回来。匹配规则：先按 (编号+类型)，再按 (名称+类型)；
                匹配到既有客商则<b>更新</b>，没匹配到则<b>新增</b>。
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
                {busy ? "解析中…" : "📥 拖入或点击选择 .xls / .xlsx 文件"}
              </div>
              <input ref={inputRef} type="file" accept=".xls,.xlsx" style={{ display: "none" }}
                onChange={e => handleFile(e.target.files?.[0])} />
              {err && <div style={{ marginTop: 8, color: "#c00", fontSize: 12 }}>⚠ {err}</div>}
            </>
          ) : (
            <>
              <div style={{ marginBottom: 10, fontSize: 12 }}>
                共解析 <b>{parsed.total}</b> 行 · 新增 <b style={{ color: "#52c41a" }}>{parsed.newRows.length}</b> · 更新 <b style={{ color: "#1990ff" }}>{parsed.updateRows.length}</b> · 跳过 <b style={{ color: "#c00" }}>{parsed.skipped.length}</b>
              </div>

              {parsed.newRows.length > 0 && <Section title={`新增 (${parsed.newRows.length})`} rows={parsed.newRows.slice(0, 10)} />}
              {parsed.updateRows.length > 0 && <Section title={`更新 (${parsed.updateRows.length})`} rows={parsed.updateRows.slice(0, 10)} />}
              {parsed.skipped.length > 0 && (
                <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#c00", marginBottom: 4 }}>跳过 ({parsed.skipped.length})</div>
                  <table style={tableStyle}><thead><tr>
                    <th style={th}>Excel 行</th><th style={th}>原因</th><th style={th}>名称</th>
                  </tr></thead><tbody>
                    {parsed.skipped.slice(0, 10).map((s, i) => (
                      <tr key={i}><td style={td}>{s.idx}</td><td style={{ ...td, color: "#c00" }}>{s.reason}</td><td style={td}>{s.row?.name || "—"}</td></tr>
                    ))}
                  </tbody></table>
                </div>
              )}

              <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
                <button disabled={busy || (parsed.newRows.length === 0 && parsed.updateRows.length === 0)}
                  onClick={doImport} style={btnPrimary}>
                  {busy ? "导入中…" : `✓ 确认导入（新增 ${parsed.newRows.length} + 更新 ${parsed.updateRows.length}）`}
                </button>
                <button onClick={reset} style={btn}>重新选择文件</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, rows }) {
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>{title} {rows.length < 10 ? "" : "（仅显示前 10 条）"}</div>
      <table style={tableStyle}><thead><tr>
        <th style={th}>类型</th><th style={th}>编号</th><th style={th}>名称</th><th style={th}>简称</th><th style={th}>电话</th>
      </tr></thead><tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td style={td}>{r.partner_type}</td><td style={td}>{r.code || "—"}</td>
            <td style={td}>{r.name}</td><td style={td}>{r.name_short || "—"}</td><td style={td}>{r.contact_phone || "—"}</td>
          </tr>
        ))}
      </tbody></table>
    </div>
  );
}

function chunks(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
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
const tableStyle = { width: "100%", borderCollapse: "collapse", fontSize: 11, marginTop: 4, border: "1px solid #eee" };
const th = { padding: 4, background: "#f5f5f5", border: "1px solid #eee", textAlign: "left", fontWeight: 600 };
const td = { padding: 4, border: "1px solid #f0f0f0" };
