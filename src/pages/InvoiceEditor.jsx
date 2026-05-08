// ============================================================================
// InvoiceEditor.jsx — 发票新建/编辑对话框
// 由 InvoicesList 打开，单张发票 + 多账单关联（invoice_bills）
// 跟 PaymentEditor 同构：选对方→联动加载该 partner 名下未挂此发票的账单→勾选+分摊
// 非业务发票 (kind='non_business') 仅 admin 可创建/编辑（受 RLS 限制）
// ============================================================================

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase.js";

const BRAND = "#1f3864";
const CURRENCIES = ["CNY", "USD", "EUR", "GBP"];

const todayStr = () => new Date().toISOString().slice(0, 10);
const dateInputValue = (d) => {
  if (!d) return "";
  const s = String(d);
  return s.length >= 10 ? s.slice(0, 10) : s;
};

export default function InvoiceEditor({ invoice, direction, role, onClose, onSaved }) {
  const isEdit = !!invoice?.id;
  const isAdmin = role === "admin";

  const [form, setForm] = useState({
    invoice_no:      invoice?.invoice_no || "",
    invoice_date:    dateInputValue(invoice?.invoice_date) || todayStr(),
    amount_total:    invoice?.amount_total ?? "",
    amount_excl_tax: invoice?.amount_excl_tax ?? "",
    tax_amount:      invoice?.tax_amount ?? "",
    tax_rate:        invoice?.tax_rate ?? "",
    currency:        invoice?.currency || "CNY",
    partner_id:      invoice?.partner_id || "",
    partner_name:    invoice?.partner_name || "",
    kind:            invoice?.kind || "business",
    notes:           invoice?.notes || "",
  });

  const [partners, setPartners] = useState([]);
  const [bills, setBills] = useState([]);
  const [linkedBills, setLinkedBills] = useState({});  // { bill_id: applied_amount }
  const [saving, setSaving] = useState(false);
  const [loadingBills, setLoadingBills] = useState(false);

  useEffect(() => {
    supabase.from("customers")
      .select("id, name, partner_type, active")
      .eq("active", true).order("name")
      .then(({ data }) => setPartners(data || []));
  }, []);

  // 编辑时拉已挂账单
  useEffect(() => {
    if (!isEdit) return;
    supabase.from("invoice_bills")
      .select("bill_id, applied_amount")
      .eq("invoice_id", invoice.id)
      .then(({ data }) => {
        const map = {};
        (data || []).forEach(ib => { map[ib.bill_id] = Number(ib.applied_amount); });
        setLinkedBills(map);
      });
  }, [isEdit, invoice?.id]);

  // 选 partner 后加载其名下同 direction 的开放账单
  useEffect(() => {
    if (!form.partner_id || form.kind === "non_business") {
      setBills([]);
      return;
    }
    let cancelled = false;
    setLoadingBills(true);
    supabase.from("bills")
      .select("id, bill_no, currency, amount_total, settled_amount, status, shipment_id, invoice_no, created_at")
      .eq("partner_id", form.partner_id)
      .eq("direction", direction)
      .neq("status", "void")
      .order("created_at", { ascending: false })
      .then(({ data }) => {
        if (cancelled) return;
        setBills(data || []);
        setLoadingBills(false);
      });
    return () => { cancelled = true; };
  }, [form.partner_id, direction, form.kind]);

  const onPickPartner = (id) => {
    const p = partners.find(x => x.id === id);
    setForm({ ...form, partner_id: id, partner_name: p?.name || "" });
    if (id !== invoice?.partner_id) setLinkedBills({});
  };

  const toggleBill = (bill) => {
    const next = { ...linkedBills };
    if (bill.id in next) {
      delete next[bill.id];
    } else {
      next[bill.id] = Number(bill.amount_total || 0).toFixed(2);
    }
    setLinkedBills(next);
  };

  const setApplied = (billId, value) => {
    const next = { ...linkedBills };
    if (value === "" || value == null) delete next[billId];
    else next[billId] = value;
    setLinkedBills(next);
  };

  // partner 按 direction 排序（匹配的在前）
  const sortedPartners = useMemo(() => {
    const matchFn = (p) => direction === "AR" ? p.partner_type === "客户" : p.partner_type !== "客户";
    return [...partners].sort((a, b) => {
      const am = matchFn(a), bm = matchFn(b);
      if (am !== bm) return am ? -1 : 1;
      return (a.name || "").localeCompare(b.name || "");
    });
  }, [partners, direction]);

  const linkedTotal = useMemo(
    () => Object.values(linkedBills).reduce((s, v) => s + Number(v || 0), 0),
    [linkedBills]
  );
  const amountNum = Number(form.amount_total || 0);
  const overflow = linkedTotal > amountNum + 0.001;

  const onSave = async () => {
    if (!form.invoice_no?.trim()) { alert("请填发票号"); return; }
    if (!form.invoice_date) { alert("请填开票日期"); return; }
    if (!amountNum || amountNum <= 0) { alert("金额必须大于 0"); return; }
    if (form.kind === "business" && !form.partner_id) { alert(`请选择${direction === "AR" ? "客户" : "供应商"}`); return; }
    if (overflow) { alert(`挂账单合计 ${linkedTotal.toFixed(2)} 超过发票金额 ${amountNum.toFixed(2)}`); return; }

    setSaving(true);
    try {
      const payload = {
        invoice_no:      form.invoice_no.trim(),
        invoice_date:    form.invoice_date,
        direction,
        kind:            form.kind,
        partner_id:      form.partner_id || null,
        partner_name:    form.partner_name || null,
        amount_total:    amountNum,
        amount_excl_tax: form.amount_excl_tax ? Number(form.amount_excl_tax) : null,
        tax_amount:      form.tax_amount      ? Number(form.tax_amount)      : null,
        tax_rate:        form.tax_rate        ? Number(form.tax_rate)        : null,
        currency:        form.currency,
        notes:           form.notes || null,
        source_status:   "正常",
      };

      let invoiceId = invoice?.id;
      if (!isEdit) {
        const { data: insData, error: insErr } = await supabase.from("invoices").insert(payload);
        if (insErr) throw insErr;
        invoiceId = insData?.[0]?.id;
        if (!invoiceId) throw new Error("新建发票后未取到 id");
      } else {
        const { error: updErr } = await supabase.from("invoices").update(payload).eq("id", invoiceId);
        if (updErr) throw updErr;
        // 编辑模式：先删旧关联再插新关联（简单可靠）
        const { error: delErr } = await supabase.from("invoice_bills").delete().eq("invoice_id", invoiceId);
        if (delErr) throw delErr;
      }

      // 写关联（非业务 kind 不挂账单）
      if (form.kind === "business") {
        const rows = Object.entries(linkedBills)
          .filter(([, v]) => Number(v) > 0)
          .map(([bill_id, applied_amount]) => ({
            invoice_id:     invoiceId,
            bill_id,
            applied_amount: Number(applied_amount),
          }));
        if (rows.length) {
          const { error: lnkErr } = await supabase.from("invoice_bills").insert(rows);
          if (lnkErr) throw lnkErr;
        }
      }

      onSaved?.();
    } catch (e) {
      alert("保存失败: " + (e.message || e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={modalBg} onClick={onClose}>
      <div style={modal} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <span style={{ fontSize: 14, fontWeight: 700 }}>
            {isEdit ? "编辑" : "新建"}{direction === "AR" ? "开票记录" : "收票记录"}
          </span>
          <span onClick={onClose} style={{ cursor: "pointer", color: "#888", fontSize: 18 }}>×</span>
        </div>

        {/* 头表 */}
        <div style={{ display: "grid", gridTemplateColumns: "100px 1fr 100px 1fr", gap: 8, alignItems: "center", fontSize: 12 }}>
          <span>发票号 *</span>
          <input value={form.invoice_no} onChange={e => setForm({...form, invoice_no: e.target.value})} style={input} />

          <span>开票日期 *</span>
          <input type="date" value={form.invoice_date} onChange={e => setForm({...form, invoice_date: e.target.value})} style={input} />

          <span>币种</span>
          <select value={form.currency} onChange={e => setForm({...form, currency: e.target.value})} style={input}>
            {CURRENCIES.map(c => <option key={c}>{c}</option>)}
          </select>

          <span>金额（价税合计）*</span>
          <input type="number" step="0.01" value={form.amount_total}
                 onChange={e => setForm({...form, amount_total: e.target.value})} style={input} />

          <span>不含税金额</span>
          <input type="number" step="0.01" value={form.amount_excl_tax}
                 onChange={e => setForm({...form, amount_excl_tax: e.target.value})} style={input} />

          <span>税额</span>
          <input type="number" step="0.01" value={form.tax_amount}
                 onChange={e => setForm({...form, tax_amount: e.target.value})} style={input} />

          <span>类型</span>
          <select value={form.kind} onChange={e => setForm({...form, kind: e.target.value})} style={input} disabled={!isAdmin && form.kind !== "non_business"}>
            <option value="business">业务</option>
            <option value="non_business" disabled={!isAdmin}>非业务{isAdmin ? "" : "（仅 admin）"}</option>
          </select>

          <span>{direction === "AR" ? "客户" : "供应商"} {form.kind === "business" && "*"}</span>
          <select value={form.partner_id} onChange={e => onPickPartner(e.target.value)} style={input}>
            <option value="">— 选择 —</option>
            {sortedPartners.map(p => (
              <option key={p.id} value={p.id}>{p.name}（{p.partner_type}）</option>
            ))}
          </select>

          <span style={{ alignSelf: "flex-start", paddingTop: 6 }}>备注</span>
          <textarea value={form.notes} onChange={e => setForm({...form, notes: e.target.value})}
                    style={{ ...input, minHeight: 50, gridColumn: "span 3" }} />
        </div>

        {/* 关联账单（仅业务发票） */}
        {form.kind === "business" && form.partner_id && (
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #f0f0f0" }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>关联账单</span>
              <span style={{ fontSize: 11, color: overflow ? "#ff4d4f" : "#888" }}>
                已挂 {Object.keys(linkedBills).length} 张 · 合计 {linkedTotal.toFixed(2)}
                {overflow && " (超过发票金额)"}
              </span>
            </div>
            {loadingBills ? (
              <div style={{ padding: 12, color: "#888", fontSize: 12 }}>加载账单中...</div>
            ) : bills.length === 0 ? (
              <div style={{ padding: 12, color: "#aaa", fontSize: 12 }}>该对方名下暂无未挂发票的账单</div>
            ) : (
              <div style={{ maxHeight: 220, overflow: "auto", border: "1px solid #f0f0f0", borderRadius: 3 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
                  <thead style={{ position: "sticky", top: 0, background: "#fafafa" }}>
                    <tr style={{ color: "#666" }}>
                      <th style={{ ...subTh, width: 24 }}></th>
                      <th style={subTh}>账单号</th>
                      <th style={{ ...subTh, textAlign: "right" }}>金额</th>
                      <th style={{ ...subTh, textAlign: "right", width: 110 }}>分摊到本票</th>
                      <th style={subTh}>已挂发票</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bills.map(b => {
                      const checked = b.id in linkedBills;
                      const remain = Number(b.amount_total || 0) - Number(b.settled_amount || 0);
                      return (
                        <tr key={b.id} style={{ borderTop: "1px solid #fafafa", background: checked ? "#f0f7ff" : undefined }}>
                          <td style={subTd}>
                            <input type="checkbox" checked={checked} onChange={() => toggleBill(b)} />
                          </td>
                          <td style={{ ...subTd, fontFamily: "monospace" }}>{b.bill_no}</td>
                          <td style={{ ...subTd, textAlign: "right", fontFamily: "monospace" }}>
                            {b.currency} {Number(b.amount_total).toFixed(2)}
                          </td>
                          <td style={{ ...subTd, textAlign: "right" }}>
                            {checked && (
                              <input type="number" step="0.01"
                                     value={linkedBills[b.id]}
                                     onChange={e => setApplied(b.id, e.target.value)}
                                     style={{ ...input, width: 90, textAlign: "right" }} />
                            )}
                          </td>
                          <td style={{ ...subTd, color: b.invoice_no ? "#fa8c16" : "#aaa", fontSize: 10 }}>
                            {b.invoice_no || "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* 底部按钮 */}
        <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onClose} style={btn} disabled={saving}>取消</button>
          <button onClick={onSave} disabled={saving}
                  style={{ ...btn, background: BRAND, color: "#fff", borderColor: BRAND }}>
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}

const btn = { padding: "5px 14px", background: "#fff", border: "1px solid #d9d9d9", borderRadius: 3, fontSize: 12, cursor: "pointer" };
const input = { padding: "5px 8px", border: "1px solid #d9d9d9", borderRadius: 3, fontSize: 12, width: "100%", boxSizing: "border-box" };
const subTh = { padding: "5px 6px", textAlign: "left", borderBottom: "1px solid #e8e8e8", fontWeight: 600, fontSize: 11, color: "#888" };
const subTd = { padding: "5px 6px" };
const modalBg = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" };
const modal = { background: "#fff", borderRadius: 4, padding: 20, width: 720, maxHeight: "85vh", overflowY: "auto", boxShadow: "0 4px 16px rgba(0,0,0,0.2)" };
