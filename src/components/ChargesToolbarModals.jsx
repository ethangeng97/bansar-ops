// ============================================================================
// ChargesToolbarModals — 费用 tab 工具栏调起的 4 个 modal
//   1) ChargeImportModal              从 Excel 导入费用
//   2) ChargeCopyFromShipmentModal    复制其他作业的费用
//   3) ChargeTemplateApplyModal       应用费用模板
//   4) ChargeTemplateSaveModal        把当前 AR / AP 存为费用模板
// ============================================================================
import { useState, useEffect, useMemo, useRef } from "react";
import { supabase } from "../supabase.js";
import { Modal, Button, Input } from "./ui.jsx";
import { parseBillCfmPdf } from "../lib/bill-cfm-pdf-parser.js";

const AR_AP_TO_DIR = { AR: "应收", AP: "应付" };

// ── 共用：行预览表格 ──
function ChargesPreviewTable({ rows, chargeItems, partners, emptyText = "暂无" }) {
  const ciMap = useMemo(() => Object.fromEntries((chargeItems || []).map(c => [c.id, c])), [chargeItems]);
  const pMap = useMemo(() => Object.fromEntries((partners || []).map(p => [p.id, p])), [partners]);
  if (!rows || rows.length === 0) {
    return <div style={{ padding: 12, color: "#999", fontSize: 12, textAlign: "center" }}>{emptyText}</div>;
  }
  return (
    <div style={{ maxHeight: 220, overflowY: "auto", border: "1px solid #eee", borderRadius: 4 }}>
      <table style={{ width: "100%", fontSize: 11.5, borderCollapse: "collapse" }}>
        <thead style={{ position: "sticky", top: 0, background: "#fafafa" }}>
          <tr style={{ textAlign: "left" }}>
            <th style={th}>费用名称</th>
            <th style={th}>结算单位</th>
            <th style={{ ...th, width: 50 }}>单位</th>
            <th style={{ ...th, width: 50 }}>数量</th>
            <th style={{ ...th, width: 70 }}>单价</th>
            <th style={{ ...th, width: 50 }}>币种</th>
            <th style={th}>备注</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const ci = ciMap[r.charge_item_id];
            const p = pMap[r.partner_id];
            const missing = !r.charge_item_id;
            return (
              <tr key={i} style={{ borderTop: "1px solid #f0f0f0", background: missing ? "#fff7e6" : "#fff" }}>
                <td style={td}>{ci?.name_zh || <span style={{ color: "#cf1322" }}>{r._name || "（未匹配）"}</span>}</td>
                <td style={td}>{p?.name || r.partner_name || ""}</td>
                <td style={td}>{r.unit || ""}</td>
                <td style={td}>{r.quantity}</td>
                <td style={td}>{r.unit_price}</td>
                <td style={td}>{r.currency || "CNY"}</td>
                <td style={td}>{r.remark || ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
const th = { padding: "5px 8px", borderBottom: "1px solid #ddd", fontWeight: 600, color: "#555", fontSize: 11 };
const td = { padding: "4px 8px", color: "#333", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" };

// 字段提取 helper — 支持中英文表头别名
function getCol(row, names) {
  for (const n of names) {
    if (row[n] !== undefined && row[n] !== "") return row[n];
  }
  return "";
}

// ────────────────────────────────────────────────────────────────────────────
// 1) ChargeImportModal — 从 Excel 导入费用
// 期望 Excel 有 应收 / 应付 两个 sheet（或单 sheet 通过列指明方向）
// ────────────────────────────────────────────────────────────────────────────
export function ChargeImportModal({ chargeItems, partners, rates, onClose, onConfirm }) {
  const [drafts, setDrafts] = useState([]);  // [{direction, charge_item_id, partner_id, ...}]
  const [errors, setErrors] = useState([]);
  const [parsing, setParsing] = useState(false);
  const [pdfHeader, setPdfHeader] = useState(null);  // PDF 模式下抽到的票头信息，仅展示
  const fileRef = useRef(null);

  const matchChargeItem = (name) => {
    if (!name) return "";
    const q = String(name).trim().toLowerCase();
    if (!q) return "";
    const exact = chargeItems.find(c => (c.name_zh || "").toLowerCase() === q);
    if (exact) return exact.id;
    const part = chargeItems.find(c => (c.name_zh || "").toLowerCase().includes(q) || q.includes((c.name_zh || "").toLowerCase()));
    return part?.id || "";
  };
  const matchPartner = (name) => {
    if (!name) return { id: "", name: "" };
    const q = String(name).trim().toLowerCase();
    if (!q) return { id: "", name: "" };
    const exact = partners.find(p => (p.name || "").toLowerCase() === q);
    if (exact) return { id: exact.id, name: exact.name };
    return { id: "", name: String(name).trim() };
  };

  const sheetToDrafts = (rows, direction) => {
    return rows.map(r => {
      const feeName = getCol(r, ["费用名称", "费用项", "name", "name_zh"]);
      const partnerName = getCol(r, ["结算单位", "客户", "供应商", "partner"]);
      const unit = getCol(r, ["计费单位", "单位", "unit"]) || "票";
      const qty = parseFloat(getCol(r, ["数量", "quantity", "qty"])) || 1;
      const price = parseFloat(getCol(r, ["单价", "unit_price", "price"])) || 0;
      const currency = (getCol(r, ["币种", "currency"]) || "CNY").toUpperCase();
      const exRate = parseFloat(getCol(r, ["汇率", "exchange_rate", "rate"])) || rates[currency] || 1;
      const taxRate = parseFloat(getCol(r, ["税率%", "税率", "tax_rate"])) || 0;
      const remark = getCol(r, ["备注", "remark", "note"]) || "";
      const ci = matchChargeItem(feeName);
      const p = matchPartner(partnerName);
      return {
        _draft: true,
        _id: "draft-imp-" + Date.now() + "-" + Math.random().toString(36).slice(2),
        _name: feeName,  // 用于预览（即使没匹配上也能显示原文）
        direction,
        charge_item_id: ci,
        partner_id: p.id,
        partner_name: p.name,
        unit,
        quantity: qty,
        unit_price: price,
        currency,
        exchange_rate: exRate,
        tax_rate: taxRate,
        remark,
        status: "草稿",
      };
    });
  };

  // PDF 费用确认单 → 全部当应付（结算给货代），币种 RMB 映射为 CNY
  const pdfChargesToDrafts = (pdfResult) => {
    const partnerName = pdfResult.partner_name || "";
    const p = matchPartner(partnerName);
    return pdfResult.charges.map(c => {
      const ci = matchChargeItem(c.name);
      const currency = c.currency === "RMB" ? "CNY" : (c.currency || "CNY");
      const exRate = rates[currency] || 1;
      return {
        _draft: true,
        _id: "draft-pdf-" + Date.now() + "-" + Math.random().toString(36).slice(2),
        _name: c.name,
        direction: "应付",
        charge_item_id: ci,
        partner_id: p.id,
        partner_name: p.name || partnerName,
        unit: "票",
        quantity: c.quantity || 1,
        unit_price: c.unit_price || 0,
        currency,
        exchange_rate: exRate,
        tax_rate: 0,
        remark: "",
        status: "草稿",
      };
    });
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setParsing(true);
    setErrors([]);
    setPdfHeader(null);
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    try {
      let ds;
      if (ext === "pdf") {
        const pdfResult = await parseBillCfmPdf(file);
        ds = pdfChargesToDrafts(pdfResult);
        setPdfHeader({ partner: pdfResult.partner_name, ...pdfResult.header });
      } else {
        const XLSX = await import("xlsx");
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        let arRows = [], apRows = [];
        const sheetNames = wb.SheetNames;
        const arSheet = sheetNames.find(n => n.includes("应收") || n.toUpperCase() === "AR") || sheetNames[0];
        const apSheet = sheetNames.find(n => n.includes("应付") || n.toUpperCase() === "AP");
        if (arSheet) arRows = XLSX.utils.sheet_to_json(wb.Sheets[arSheet], { defval: "", raw: false });
        if (apSheet && apSheet !== arSheet) apRows = XLSX.utils.sheet_to_json(wb.Sheets[apSheet], { defval: "", raw: false });
        ds = [...sheetToDrafts(arRows, "应收"), ...sheetToDrafts(apRows, "应付")]
          .filter(d => d._name || d.unit_price);
      }
      const errs = [];
      ds.forEach(d => {
        if (!d.charge_item_id) errs.push(`未匹配到费用项: "${d._name}"`);
      });
      setDrafts(ds);
      setErrors(errs);
    } catch (err) {
      console.error(err);
      alert("解析失败：" + (err?.message || err));
    } finally {
      setParsing(false);
    }
  };

  const submit = () => {
    const valid = drafts.filter(d => d.charge_item_id);
    if (valid.length === 0) { alert("没有可导入的有效行（费用名称必须能匹配上）"); return; }
    onConfirm(valid);
  };

  return (
    <Modal title="导入费用单" onClose={onClose} width={760}>
      <div style={{ fontSize: 12, color: "#666", marginBottom: 10 }}>
        支持两种格式：
        <ul style={{ margin: "4px 0 0 0", paddingLeft: 20 }}>
          <li><b>Excel</b>：sheet 名 <b>应收</b> 和 <b>应付</b>（或 AR / AP），列：费用名称 / 结算单位 / 计费单位 / 数量 / 单价 / 币种 / 汇率 / 税率% / 备注。</li>
          <li><b>PDF</b>：货代发的费用确认单（如安俐达），所有费用默认作"应付"录入，RMB 自动映射为 CNY。</li>
        </ul>
      </div>
      <input ref={fileRef} type="file" accept=".xlsx,.xls,.pdf" onChange={onFile} style={{ marginBottom: 12 }} />
      {parsing && <div style={{ color: "#888", fontSize: 12 }}>解析中…</div>}
      {pdfHeader && (
        <div style={{ marginBottom: 10, padding: 8, background: "#f0f5ff", border: "1px solid #adc6ff", borderRadius: 4, fontSize: 11.5, color: "#1d39c4" }}>
          <div style={{ fontWeight: 600, marginBottom: 2 }}>📄 PDF 抬头</div>
          <div style={{ display: "grid", gridTemplateColumns: "auto 1fr auto 1fr", gap: "2px 10px" }}>
            {pdfHeader.partner && <><span style={{ color: "#666" }}>结算单位</span><span>{pdfHeader.partner}</span></>}
            {pdfHeader.mbl_no && <><span style={{ color: "#666" }}>主单号</span><span>{pdfHeader.mbl_no}</span></>}
            {pdfHeader.hbl_no && <><span style={{ color: "#666" }}>分单号</span><span>{pdfHeader.hbl_no}</span></>}
            {pdfHeader.job_no && <><span style={{ color: "#666" }}>Job No</span><span>{pdfHeader.job_no}</span></>}
            {pdfHeader.vessel_voyage && <><span style={{ color: "#666" }}>船名航次</span><span>{pdfHeader.vessel_voyage}</span></>}
            {pdfHeader.etd && <><span style={{ color: "#666" }}>开航日</span><span>{pdfHeader.etd}</span></>}
            {pdfHeader.total_amount != null && <><span style={{ color: "#666" }}>合计</span><span style={{ fontWeight: 600 }}>{pdfHeader.total_amount}</span></>}
          </div>
        </div>
      )}
      {drafts.length > 0 && (
        <>
          <div style={{ display: "flex", gap: 12, marginBottom: 8, fontSize: 12 }}>
            <span>共 <b>{drafts.length}</b> 行</span>
            <span style={{ color: "#0050b3" }}>应收 {drafts.filter(d => d.direction === "应收").length}</span>
            <span style={{ color: "#ad4e00" }}>应付 {drafts.filter(d => d.direction === "应付").length}</span>
            {errors.length > 0 && <span style={{ color: "#cf1322" }}>未匹配 {errors.length} 行</span>}
          </div>
          <ChargesPreviewTable rows={drafts} chargeItems={chargeItems} partners={partners} />
          {errors.length > 0 && (
            <div style={{ marginTop: 8, padding: 8, background: "#fff7e6", border: "1px solid #ffd591", borderRadius: 4, fontSize: 11, color: "#874d00", maxHeight: 80, overflowY: "auto" }}>
              {errors.slice(0, 10).map((e, i) => <div key={i}>· {e}</div>)}
              {errors.length > 10 && <div>… 还有 {errors.length - 10} 条</div>}
            </div>
          )}
        </>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
        <Button variant="secondary" onClick={onClose}>取消</Button>
        <Button onClick={submit} disabled={drafts.length === 0}>导入 {drafts.filter(d => d.charge_item_id).length} 行</Button>
      </div>
    </Modal>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 2) ChargeCopyFromShipmentModal — 复制其他作业的费用
// ────────────────────────────────────────────────────────────────────────────
export function ChargeCopyFromShipmentModal({ currentShipmentId, chargeItems, partners, rowsToDrafts, onClose, onConfirm }) {
  const [q, setQ] = useState("");
  const [candidates, setCandidates] = useState([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState(null);  // {id, order_no, mbl_no, customer}
  const [srcAr, setSrcAr] = useState([]);
  const [srcAp, setSrcAp] = useState([]);
  const [loadingCharges, setLoadingCharges] = useState(false);
  const [pickAr, setPickAr] = useState(true);
  const [pickAp, setPickAp] = useState(true);

  // 默认拉最近 30 票（不带搜索词时）
  useEffect(() => {
    let cancel = false;
    setSearching(true);
    (async () => {
      let qb = supabase.from("shipments")
        .select("id, order_no, mbl_no, customer, etd, pol, pod")
        .neq("id", currentShipmentId)
        .order("etd", { ascending: false, nullsLast: true })
        .limit(30);
      const term = q.trim();
      if (term) qb = qb.or(`order_no.ilike.*${term}*,mbl_no.ilike.*${term}*,customer.ilike.*${term}*`);
      const { data } = await qb;
      if (!cancel) {
        setCandidates(data || []);
        setSearching(false);
      }
    })();
    return () => { cancel = true; };
  }, [q, currentShipmentId]);

  // 选中票 → 拉费用
  useEffect(() => {
    if (!selected?.id) { setSrcAr([]); setSrcAp([]); return; }
    setLoadingCharges(true);
    supabase.from("charges").select("*").eq("shipment_id", selected.id).order("sort_order").order("created_at")
      .then(({ data }) => {
        setSrcAr((data || []).filter(c => c.direction === "应收"));
        setSrcAp((data || []).filter(c => c.direction === "应付"));
        setLoadingCharges(false);
      });
  }, [selected?.id]);

  const submit = () => {
    if (!selected) return;
    const drafts = [];
    if (pickAr) drafts.push(...rowsToDrafts(srcAr, "应收"));
    if (pickAp) drafts.push(...rowsToDrafts(srcAp, "应付"));
    if (drafts.length === 0) { alert("没有可复制的费用行"); return; }
    onConfirm(drafts);
  };

  return (
    <Modal title="从其他作业复制费用" onClose={onClose} width={820}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 14 }}>
        {/* 左：搜索 + 候选列表 */}
        <div>
          <Input placeholder="搜索作业号 / MBL / 客户" value={q} onChange={e => setQ(e.target.value)} />
          <div style={{ marginTop: 8, maxHeight: 360, overflowY: "auto", border: "1px solid #eee", borderRadius: 4 }}>
            {searching && <div style={{ padding: 10, fontSize: 12, color: "#888" }}>搜索中…</div>}
            {!searching && candidates.length === 0 && <div style={{ padding: 10, fontSize: 12, color: "#999" }}>无匹配作业</div>}
            {candidates.map(s => {
              const active = selected?.id === s.id;
              return (
                <div key={s.id}
                  onClick={() => setSelected(s)}
                  style={{ padding: "6px 10px", cursor: "pointer", fontSize: 12,
                           borderBottom: "1px solid #f5f5f5", background: active ? "#e6f7ff" : "#fff" }}
                  onMouseEnter={e => !active && (e.currentTarget.style.background = "#fafafa")}
                  onMouseLeave={e => !active && (e.currentTarget.style.background = "#fff")}
                >
                  <div style={{ fontWeight: 600 }}>{s.order_no || "（无作业号）"}</div>
                  <div style={{ color: "#888", fontSize: 11 }}>
                    {s.customer || "—"} · {s.mbl_no || "无 MBL"} · {s.etd || "—"}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        {/* 右：预览 */}
        <div>
          {!selected && <div style={{ padding: 20, color: "#999", fontSize: 12, textAlign: "center" }}>← 先在左侧选一个作业</div>}
          {selected && (
            <>
              <div style={{ fontSize: 12, marginBottom: 8 }}>
                源作业：<b>{selected.order_no}</b> · {selected.customer || "—"}
              </div>
              {loadingCharges ? (
                <div style={{ color: "#888", fontSize: 12 }}>加载费用中…</div>
              ) : (
                <>
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#0050b3", marginBottom: 4 }}>
                    <input type="checkbox" checked={pickAr} onChange={e => setPickAr(e.target.checked)} />
                    应收（{srcAr.length} 行）
                  </label>
                  <ChargesPreviewTable rows={srcAr} chargeItems={chargeItems} partners={partners} emptyText="该作业无应收" />
                  <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#ad4e00", margin: "10px 0 4px" }}>
                    <input type="checkbox" checked={pickAp} onChange={e => setPickAp(e.target.checked)} />
                    应付（{srcAp.length} 行）
                  </label>
                  <ChargesPreviewTable rows={srcAp} chargeItems={chargeItems} partners={partners} emptyText="该作业无应付" />
                </>
              )}
            </>
          )}
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
        <Button variant="secondary" onClick={onClose}>取消</Button>
        <Button onClick={submit} disabled={!selected || loadingCharges}>复制为草稿</Button>
      </div>
    </Modal>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 3) ChargeTemplateApplyModal — 应用费用模板
// ────────────────────────────────────────────────────────────────────────────
export function ChargeTemplateApplyModal({ defaultPartnerId, chargeItems, partners, rates, rowsToDrafts, onClose, onConfirm }) {
  const [partnerId, setPartnerId] = useState(defaultPartnerId || "");
  const [direction, setDirection] = useState("AR");
  const [templates, setTemplates] = useState([]);
  const [selected, setSelected] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!partnerId) { setTemplates([]); setSelected(null); setItems([]); return; }
    setLoading(true);
    supabase.from("charge_templates")
      .select("*")
      .eq("partner_id", partnerId)
      .eq("direction", direction)
      .eq("active", true)
      .order("name")
      .then(({ data }) => {
        setTemplates(data || []);
        setLoading(false);
      });
  }, [partnerId, direction]);

  useEffect(() => {
    if (!selected?.id) { setItems([]); return; }
    supabase.from("charge_template_items")
      .select("*")
      .eq("template_id", selected.id)
      .order("sort_order")
      .then(({ data }) => setItems(data || []));
  }, [selected?.id]);

  const previewRows = useMemo(() => items.map(it => ({
    charge_item_id: it.charge_item_id,
    partner_id: partnerId,
    unit: it.unit,
    quantity: it.quantity,
    unit_price: it.unit_price,
    currency: it.currency,
    exchange_rate: rates[it.currency] || 1,
    tax_rate: it.tax_rate,
    remark: it.remark,
  })), [items, partnerId, rates]);

  const submit = () => {
    if (!selected || items.length === 0) return;
    const drafts = rowsToDrafts(previewRows, AR_AP_TO_DIR[direction]);
    onConfirm(drafts);
  };

  return (
    <Modal title="应用费用模板" onClose={onClose} width={760}>
      <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>结算单位</div>
          <select value={partnerId} onChange={e => setPartnerId(e.target.value)}
            style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #e2e8f0", fontSize: 12.5 }}>
            <option value="">— 选择 —</option>
            {partners.map(p => <option key={p.id} value={p.id}>{p.name}（{p.partner_type}）</option>)}
          </select>
        </div>
        <div style={{ width: 120 }}>
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>方向</div>
          <select value={direction} onChange={e => setDirection(e.target.value)}
            style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #e2e8f0", fontSize: 12.5 }}>
            <option value="AR">应收</option>
            <option value="AP">应付</option>
          </select>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.6fr", gap: 14 }}>
        <div>
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>模板</div>
          <div style={{ maxHeight: 260, overflowY: "auto", border: "1px solid #eee", borderRadius: 4 }}>
            {!partnerId && <div style={{ padding: 10, fontSize: 12, color: "#999" }}>先选结算单位</div>}
            {partnerId && loading && <div style={{ padding: 10, fontSize: 12, color: "#888" }}>加载中…</div>}
            {partnerId && !loading && templates.length === 0 && <div style={{ padding: 10, fontSize: 12, color: "#999" }}>该结算单位+方向暂无模板</div>}
            {templates.map(t => {
              const active = selected?.id === t.id;
              return (
                <div key={t.id} onClick={() => setSelected(t)}
                  style={{ padding: "6px 10px", cursor: "pointer", fontSize: 12, borderBottom: "1px solid #f5f5f5", background: active ? "#e6f7ff" : "#fff" }}>
                  <div style={{ fontWeight: 600 }}>{t.name}</div>
                  {t.notes && <div style={{ color: "#888", fontSize: 11 }}>{t.notes}</div>}
                </div>
              );
            })}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>预览（{items.length} 项）</div>
          <ChargesPreviewTable rows={previewRows} chargeItems={chargeItems} partners={partners} emptyText="点左侧模板查看" />
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
        <Button variant="secondary" onClick={onClose}>取消</Button>
        <Button onClick={submit} disabled={!selected || items.length === 0}>应用为 {AR_AP_TO_DIR[direction]} 草稿</Button>
      </div>
    </Modal>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// 4) ChargeTemplateSaveModal — 把当前 AR / AP 存为费用模板
// ────────────────────────────────────────────────────────────────────────────
export function ChargeTemplateSaveModal({ arRows, apRows, chargeItems, partners, defaultPartnerId, userId, onClose }) {
  const [direction, setDirection] = useState("AR");
  const [partnerId, setPartnerId] = useState(defaultPartnerId || "");
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const srcRows = direction === "AR" ? arRows : apRows;
  const eligible = useMemo(() => srcRows.filter(r => r.charge_item_id && r.unit_price), [srcRows]);
  const [picked, setPicked] = useState(() => new Set(eligible.map(r => r.id || r._id)));
  useEffect(() => {
    setPicked(new Set(eligible.map(r => r.id || r._id)));
  }, [direction]);  // 切方向时重置选择

  const togglePick = (id) => {
    setPicked(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const submit = async () => {
    if (!partnerId) { alert("请选择结算单位"); return; }
    if (!name.trim()) { alert("请填写模板名称"); return; }
    const items = eligible.filter(r => picked.has(r.id || r._id));
    if (items.length === 0) { alert("至少选 1 行费用"); return; }
    setSaving(true);
    const { data: tpl, error: e1 } = await supabase.from("charge_templates").insert({
      partner_id: partnerId,
      name: name.trim(),
      direction,
      notes: notes.trim() || null,
      created_by: userId || null,
    }).select().single();
    if (e1) {
      setSaving(false);
      alert("保存失败：" + e1.message);
      return;
    }
    const payload = items.map((r, i) => ({
      template_id: tpl.id,
      charge_item_id: r.charge_item_id,
      unit: r.unit || "票",
      quantity: parseFloat(r.quantity) || 1,
      unit_price: parseFloat(r.unit_price) || 0,
      currency: r.currency || "CNY",
      tax_rate: parseFloat(r.tax_rate) || 0,
      remark: r.remark || null,
      sort_order: i,
    }));
    const { error: e2 } = await supabase.from("charge_template_items").insert(payload);
    setSaving(false);
    if (e2) { alert("模板项保存失败：" + e2.message); return; }
    alert(`模板已保存：${tpl.name}（${items.length} 项）`);
    onClose();
  };

  const ciMap = useMemo(() => Object.fromEntries(chargeItems.map(c => [c.id, c])), [chargeItems]);

  return (
    <Modal title="存为费用模板" onClose={onClose} width={680}>
      <div style={{ display: "flex", gap: 10, marginBottom: 10 }}>
        <div style={{ width: 110 }}>
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>方向</div>
          <select value={direction} onChange={e => setDirection(e.target.value)}
            style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #e2e8f0", fontSize: 12.5 }}>
            <option value="AR">应收</option>
            <option value="AP">应付</option>
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>结算单位</div>
          <select value={partnerId} onChange={e => setPartnerId(e.target.value)}
            style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #e2e8f0", fontSize: 12.5 }}>
            <option value="">— 选择 —</option>
            {partners.map(p => <option key={p.id} value={p.id}>{p.name}（{p.partner_type}）</option>)}
          </select>
        </div>
      </div>
      <div style={{ marginBottom: 10 }}>
        <Input label="模板名称" placeholder="如：宁波美弘-FCL 上海港标准应收" value={name} onChange={e => setName(e.target.value)} />
      </div>
      <div style={{ marginBottom: 10 }}>
        <Input label="备注（可选）" value={notes} onChange={e => setNotes(e.target.value)} />
      </div>
      <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>选择要保存的费用行（{picked.size}/{eligible.length}）</div>
      <div style={{ maxHeight: 220, overflowY: "auto", border: "1px solid #eee", borderRadius: 4 }}>
        {eligible.length === 0 && <div style={{ padding: 10, color: "#999", fontSize: 12 }}>当前 {AR_AP_TO_DIR[direction]} 无可保存行（费用项+单价齐全）</div>}
        {eligible.map(r => {
          const id = r.id || r._id;
          const ci = ciMap[r.charge_item_id];
          return (
            <label key={id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 10px", borderBottom: "1px solid #f5f5f5", fontSize: 12, cursor: "pointer" }}>
              <input type="checkbox" checked={picked.has(id)} onChange={() => togglePick(id)} />
              <span style={{ flex: 1 }}>{ci?.name_zh || "—"}</span>
              <span style={{ color: "#888" }}>{r.unit} × {r.quantity} @ {r.unit_price} {r.currency}</span>
            </label>
          );
        })}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
        <Button variant="secondary" onClick={onClose}>取消</Button>
        <Button onClick={submit} disabled={saving}>{saving ? "保存中…" : "保存模板"}</Button>
      </div>
    </Modal>
  );
}
