// ============================================================================
// PaymentEditor.jsx — 收付款新建/编辑对话框
// 由 PaymentsList 打开
// 流程:填表头 → 选对方(联动加载该 partner 名下未作废的同向账单)→ 勾选 + 录分摊金额
// 保存:新建走 RPC next_payment_no 取单号 → insert payments → insert payment_bills
//        编辑直接 update + 重写 payment_bills(先 delete 全部 + 再 insert)
// trigger 自动重算 bills.settled_amount(见 migration 004)
// ============================================================================

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../supabase.js";

const BRAND = "#1f3864";

const METHOD_OPTIONS = [
  { v: "transfer", label: "银行转账" },
  { v: "cash",     label: "现金" },
  { v: "check",    label: "支票" },
  { v: "other",    label: "其他" },
];

const CURRENCIES = ["CNY", "USD", "EUR", "GBP"];

const todayStr = () => new Date().toISOString().slice(0, 10);
const dateInputValue = (d) => {
  if (!d) return "";
  const s = String(d);
  return s.length >= 10 ? s.slice(0, 10) : s;
};

export default function PaymentEditor({ payment, direction, onClose, onSaved }) {
  const isEdit = !!payment?.id;

  const [form, setForm] = useState({
    payment_date:   dateInputValue(payment?.payment_date) || todayStr(),
    amount:         payment?.amount ?? "",
    currency:       payment?.currency || "CNY",
    exchange_rate:  payment?.exchange_rate ?? 1,
    partner_id:     payment?.partner_id || "",
    partner_name:   payment?.partner_name || "",
    bank_account:   payment?.bank_account || "",
    payment_method: payment?.payment_method || "transfer",
    notes:          payment?.notes || "",
  });

  const [partners, setPartners] = useState([]);
  const [bills, setBills] = useState([]);
  const [linkedBills, setLinkedBills] = useState({}); // { bill_id: applied_amount }
  const [loadingBills, setLoadingBills] = useState(false);
  const [saving, setSaving] = useState(false);

  // 加载 partner 列表
  useEffect(() => {
    supabase.from("customers")
      .select("id, name, partner_type, active")
      .eq("active", true)
      .order("name")
      .then(({ data }) => setPartners(data || []));
  }, []);

  // 编辑模式:加载已挂的 payment_bills
  useEffect(() => {
    if (!isEdit) return;
    supabase.from("payment_bills")
      .select("bill_id, applied_amount")
      .eq("payment_id", payment.id)
      .then(({ data }) => {
        const map = {};
        (data || []).forEach(pb => { map[pb.bill_id] = Number(pb.applied_amount); });
        setLinkedBills(map);
      });
  }, [isEdit, payment?.id]);

  // 选完 partner 后联动加载其名下的开放账单(同方向、非作废)
  useEffect(() => {
    if (!form.partner_id) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setBills([]);
      return;
    }
    let cancelled = false;
    setLoadingBills(true);
    supabase.from("bills")
      .select("id, bill_no, currency, amount_total, settled_amount, status, shipment_id, created_at")
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
  }, [form.partner_id, direction]);

  const onPickPartner = (id) => {
    const p = partners.find(x => x.id === id);
    setForm({ ...form, partner_id: id, partner_name: p?.name || "" });
    // 改 partner 清空挂的账单(否则旧 bill_id 跟新 partner 对不上)
    if (id !== payment?.partner_id) setLinkedBills({});
  };

  const toggleBill = (bill) => {
    const next = { ...linkedBills };
    if (bill.id in next) {
      delete next[bill.id];
    } else {
      const remain = Number(bill.amount_total || 0) - Number(bill.settled_amount || 0);
      next[bill.id] = remain > 0 ? Number(remain.toFixed(2)) : 0;
    }
    setLinkedBills(next);
  };

  const setApplied = (billId, value) => {
    const next = { ...linkedBills };
    if (value === "" || value == null) delete next[billId];
    else next[billId] = value;
    setLinkedBills(next);
  };

  // partner 按 direction 推荐排序(匹配的在前)
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
  const amountNum = Number(form.amount || 0);
  const overflow = linkedTotal > amountNum + 0.001;

  const onSave = async () => {
    if (!form.payment_date) { alert("请填写日期"); return; }
    if (!amountNum || amountNum <= 0) { alert("金额必须大于 0"); return; }
    if (!form.partner_id) { alert(`请选择${direction === "AR" ? "客户" : "供应商"}`); return; }
    if (overflow) { alert(`挂账单合计 ${linkedTotal.toFixed(2)} 超过本笔金额 ${amountNum.toFixed(2)}`); return; }
    for (const [bid, amt] of Object.entries(linkedBills)) {
      if (Number(amt) < 0) {
        const b = bills.find(x => x.id === bid);
        alert(`账单 ${b?.bill_no || bid} 分摊金额不能为负`);
        return;
      }
    }

    setSaving(true);
    try {
      let paymentId = payment?.id;

      if (!isEdit) {
        const { data: noData, error: noErr } = await supabase.rpc("next_payment_no", { p_direction: direction });
        if (noErr) throw noErr;
        const { data: insData, error: insErr } = await supabase.from("payments").insert({
          payment_no:     noData,
          direction,
          payment_date:   form.payment_date,
          amount:         amountNum,
          currency:       form.currency,
          exchange_rate:  Number(form.exchange_rate || 1),
          partner_id:     form.partner_id,
          partner_name:   form.partner_name,
          bank_account:   form.bank_account || null,
          payment_method: form.payment_method,
          notes:          form.notes || null,
          status:         "active",
        });
        if (insErr) throw insErr;
        paymentId = insData?.[0]?.id;
        if (!paymentId) throw new Error("新建 payment 后未取到 id");
      } else {
        const { error: updErr } = await supabase.from("payments").update({
          payment_date:   form.payment_date,
          amount:         amountNum,
          currency:       form.currency,
          exchange_rate:  Number(form.exchange_rate || 1),
          partner_id:     form.partner_id,
          partner_name:   form.partner_name,
          bank_account:   form.bank_account || null,
          payment_method: form.payment_method,
          notes:          form.notes || null,
        }).eq("id", paymentId);
        if (updErr) throw updErr;
        // 编辑模式:先删旧关联,再插新的(简单可靠;trigger 会自动重算关联账单)
        const { error: delErr } = await supabase.from("payment_bills").delete().eq("payment_id", paymentId);
        if (delErr) throw delErr;
      }

      const rows = Object.entries(linkedBills)
        .filter(([, v]) => Number(v) > 0)
        .map(([bill_id, applied_amount]) => ({
          payment_id: paymentId,
          bill_id,
          applied_amount: Number(applied_amount),
        }));
      if (rows.length > 0) {
        const { error: pbErr } = await supabase.from("payment_bills").insert(rows);
        if (pbErr) throw pbErr;
      }

      onSaved();
    } catch (e) {
      alert("保存失败: " + (e.message || e));
      setSaving(false);
    }
  };

  return (
    <div style={mask} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={panel}>
        <div style={panelHead}>
          <span style={{ fontSize: 15, fontWeight: 700 }}>
            {isEdit ? "编辑" : "新建"}{direction === "AR" ? "收款" : "付款"}
            {isEdit && payment?.payment_no && (
              <span style={{ fontFamily: "Consolas,monospace", color: BRAND, marginLeft: 10 }}>
                {payment.payment_no}
              </span>
            )}
          </span>
          <span onClick={onClose} style={{ cursor: "pointer", color: "#999", fontSize: 18, lineHeight: 1 }}>✕</span>
        </div>

        <div style={panelBody}>
          {/* 表头 4×2 网格 */}
          <div style={grid4}>
            <Field label="日期 *">
              <input type="date" value={form.payment_date}
                     onChange={e => setForm({ ...form, payment_date: e.target.value })}
                     style={inp} />
            </Field>
            <Field label={`${direction === "AR" ? "客户" : "供应商"} *`}>
              <select value={form.partner_id} onChange={e => onPickPartner(e.target.value)} style={inp}>
                <option value="">— 请选择 —</option>
                {sortedPartners.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.name}{p.partner_type ? ` (${p.partner_type})` : ""}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="币种">
              <select value={form.currency} onChange={e => setForm({ ...form, currency: e.target.value })} style={inp}>
                {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="金额 *">
              <input type="number" step="0.01" min="0" value={form.amount}
                     onChange={e => setForm({ ...form, amount: e.target.value })}
                     style={{ ...inp, fontFamily: "Consolas,monospace" }} />
            </Field>
            <Field label="汇率(对 CNY)">
              <input type="number" step="0.0001" min="0" value={form.exchange_rate}
                     onChange={e => setForm({ ...form, exchange_rate: e.target.value })}
                     style={{ ...inp, fontFamily: "Consolas,monospace" }} />
            </Field>
            <Field label="付款方式">
              <select value={form.payment_method} onChange={e => setForm({ ...form, payment_method: e.target.value })} style={inp}>
                {METHOD_OPTIONS.map(m => <option key={m.v} value={m.v}>{m.label}</option>)}
              </select>
            </Field>
            <Field label="银行账号" wide>
              <input value={form.bank_account}
                     onChange={e => setForm({ ...form, bank_account: e.target.value })}
                     placeholder="(可选)我方收/付款的银行账号"
                     style={inp} />
            </Field>
            <Field label="备注" wide>
              <input value={form.notes}
                     onChange={e => setForm({ ...form, notes: e.target.value })}
                     style={inp} />
            </Field>
          </div>

          {/* 挂账单区 */}
          <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid #eee" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>挂账单(分摊核销)</span>
              <span style={{ fontSize: 11, color: overflow ? "#ff4d4f" : "#888" }}>
                合计 {form.currency} {linkedTotal.toFixed(2)} / 本笔 {amountNum.toFixed(2)}
                {overflow && " — 超额!"}
              </span>
            </div>

            {!form.partner_id ? (
              <div style={emptyHint}>请先选择{direction === "AR" ? "客户" : "供应商"}</div>
            ) : loadingBills ? (
              <div style={emptyHint}>加载账单中...</div>
            ) : bills.length === 0 ? (
              <div style={emptyHint}>该{direction === "AR" ? "客户" : "供应商"}名下暂无开放账单</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "#fafafa", color: "#666" }}>
                    <th style={{ ...subTh, width: 28 }}></th>
                    <th style={subTh}>账单号</th>
                    <th style={{ ...subTh, textAlign: "right" }}>账单金额</th>
                    <th style={{ ...subTh, textAlign: "right" }}>已核销</th>
                    <th style={{ ...subTh, textAlign: "right" }}>未核销</th>
                    <th style={{ ...subTh, textAlign: "right", width: 130 }}>本笔分摊</th>
                    <th style={{ ...subTh, textAlign: "center", width: 60 }}>状态</th>
                  </tr>
                </thead>
                <tbody>
                  {bills.map(b => {
                    const checked = b.id in linkedBills;
                    const remain = Number(b.amount_total || 0) - Number(b.settled_amount || 0);
                    const ccyMismatch = b.currency !== form.currency;
                    return (
                      <tr key={b.id} style={{ borderTop: "1px solid #f0f0f0", background: checked ? "#f6faff" : "transparent" }}>
                        <td style={{ ...subTd, textAlign: "center" }}>
                          <input type="checkbox" checked={checked} onChange={() => toggleBill(b)} />
                        </td>
                        <td style={{ ...subTd, fontFamily: "Consolas,monospace", color: BRAND, fontWeight: 600 }}>
                          {b.bill_no}
                          {ccyMismatch && (
                            <span style={{ marginLeft: 6, color: "#fa8c16", fontSize: 10 }}>
                              ⚠ 币种 {b.currency} 与本笔 {form.currency} 不一致
                            </span>
                          )}
                        </td>
                        <td style={{ ...subTd, textAlign: "right", fontFamily: "Consolas,monospace" }}>
                          {b.currency} {Number(b.amount_total || 0).toFixed(2)}
                        </td>
                        <td style={{ ...subTd, textAlign: "right", fontFamily: "Consolas,monospace", color: "#52c41a" }}>
                          {Number(b.settled_amount || 0).toFixed(2)}
                        </td>
                        <td style={{ ...subTd, textAlign: "right", fontFamily: "Consolas,monospace", fontWeight: 600 }}>
                          {remain.toFixed(2)}
                        </td>
                        <td style={{ ...subTd, textAlign: "right" }}>
                          {checked ? (
                            <input type="number" step="0.01" min="0"
                                   value={linkedBills[b.id]}
                                   onChange={e => setApplied(b.id, e.target.value)}
                                   style={{ width: 110, padding: "3px 6px", border: "1px solid #d9d9d9", borderRadius: 3, fontFamily: "Consolas,monospace", fontSize: 11.5, textAlign: "right" }} />
                          ) : <span style={{ color: "#bbb" }}>—</span>}
                        </td>
                        <td style={{ ...subTd, textAlign: "center", color: "#888", fontSize: 11 }}>
                          {b.status}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div style={panelFoot}>
          <button onClick={onClose} style={btn} disabled={saving}>取消</button>
          <button onClick={onSave}
                  disabled={saving || overflow}
                  style={{ ...btn, background: overflow ? "#ccc" : BRAND, color: "#fff", borderColor: overflow ? "#ccc" : BRAND }}>
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children, wide }) {
  return (
    <div style={{ gridColumn: wide ? "span 2" : "span 1" }}>
      <div style={{ fontSize: 11, color: "#666", marginBottom: 3 }}>{label}</div>
      {children}
    </div>
  );
}

const mask = { position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" };
const panel = { background: "#fff", borderRadius: 6, width: 820, maxWidth: "95vw", maxHeight: "90vh", display: "flex", flexDirection: "column" };
const panelHead = { padding: "12px 16px", borderBottom: "1px solid #f0f0f0", display: "flex", justifyContent: "space-between", alignItems: "center" };
const panelBody = { padding: 16, overflowY: "auto", flex: 1 };
const panelFoot = { padding: 12, borderTop: "1px solid #f0f0f0", display: "flex", justifyContent: "flex-end", gap: 8 };
const grid4 = { display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 };
const inp = { width: "100%", padding: "5px 8px", border: "1px solid #d9d9d9", borderRadius: 3, fontSize: 12, boxSizing: "border-box" };
const btn = { padding: "6px 18px", background: "#fff", border: "1px solid #d9d9d9", borderRadius: 3, fontSize: 12, cursor: "pointer" };
const subTh = { padding: "6px 6px", textAlign: "left", borderBottom: "1px solid #e8e8e8", fontWeight: 600, fontSize: 11, color: "#666" };
const subTd = { padding: "5px 6px" };
const emptyHint = { padding: 20, textAlign: "center", color: "#bbb", fontSize: 12, border: "1px dashed #eee", borderRadius: 3 };
