// ============================================================================
// BillsList.jsx — 账单管理列表（财务模块核心）
// 路由：#/bills
// 功能：
//   - 列表：属性 / 账单号 / 结算单位 / 发票号 / 凭证号 / 金额 / 已核销 / 未核销 / 状态
//   - 筛选：关键字 / 属性 / 状态 / 期间
//   - 行操作：核销 / 开票 / 清空发票 / 撤销核销 / 凭证号
//   - 批量：批量开票（多条共享同一发票号，须同 partner+currency）
//   - 底部多维度小计：选中合计 + 全部合计，按属性+状态拆分
// ============================================================================

import { useEffect, useState } from "react";
import { supabase } from "../supabase.js";

const BRAND = "#1f3864";
const STATUS_LABELS = {
  unsettled: { label: "未核销",   color: "#666",    bg: "#f5f5f5" },
  partial:   { label: "部分核销", color: "#fa8c16", bg: "#fff7e6" },
  settled:   { label: "已核销",   color: "#52c41a", bg: "#f6ffed" },
  void:      { label: "作废",     color: "#888",    bg: "#fafafa" },
};

export default function BillsList({ onBack }) {
  const [bills, setBills] = useState([]);
  const [partnerMap, setPartnerMap] = useState({});
  const [shipMap, setShipMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(new Set());
  const [filters, setFilters] = useState({
    keyword: "", direction: "", status: "", date_from: "", date_to: "",
  });

  const [showSettle, setShowSettle] = useState(null);
  const [showInvoice, setShowInvoice] = useState(null);
  const [showVoucher, setShowVoucher] = useState(null);

  const load = async () => {
    setLoading(true);
    let q = supabase.from("bills").select("*").order("created_at", { ascending: false });
    if (filters.direction) q = q.eq("direction", filters.direction);
    if (filters.status)    q = q.eq("status", filters.status);
    if (filters.date_from) q = q.gte("created_at", filters.date_from);
    if (filters.date_to)   q = q.lte("created_at", filters.date_to + "T23:59:59");
    const { data, error } = await q;
    if (error) { alert("加载失败: " + error.message); setLoading(false); return; }

    let rows = data || [];
    if (filters.keyword) {
      const k = filters.keyword.toLowerCase();
      rows = rows.filter(r =>
        (r.bill_no || "").toLowerCase().includes(k) ||
        (r.invoice_no || "").toLowerCase().includes(k) ||
        (r.partner_name || "").toLowerCase().includes(k) ||
        (r.voucher_no || "").toLowerCase().includes(k)
      );
    }
    setBills(rows);

    const partnerIds = [...new Set(rows.map(b => b.partner_id).filter(Boolean))];
    if (partnerIds.length > 0) {
      const { data: ps } = await supabase.from("customers")
        .select("id, name").in("id", partnerIds);
      const m = {}; (ps || []).forEach(p => { m[p.id] = p.name; });
      setPartnerMap(m);
    }
    const shipIds = [...new Set(rows.map(b => b.shipment_id).filter(Boolean))];
    if (shipIds.length > 0) {
      const { data: ss } = await supabase.from("shipments")
        .select("id, order_no").in("id", shipIds);
      const m = {}; (ss || []).forEach(s => { m[s.id] = s; });
      setShipMap(m);
    }

    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const toggle = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };
  const toggleAll = () => {
    if (selected.size === bills.length) setSelected(new Set());
    else setSelected(new Set(bills.map(b => b.id)));
  };

  const batchInvoice = () => {
    if (selected.size === 0) { alert("请先勾选要开票的账单"); return; }
    const sel = bills.filter(b => selected.has(b.id));
    setShowInvoice({ bills: sel });
  };

  const settleBill = (b) => setShowSettle(b);
  const invoiceBill = (b) => setShowInvoice({ bills: [b] });
  const editVoucher = (b) => setShowVoucher(b);

  const clearInvoice = async (b) => {
    if (!confirm(`确认清除账单 ${b.bill_no} 的发票号 ${b.invoice_no}？`)) return;
    const { error } = await supabase.rpc("clear_invoice", { p_bill_ids: [b.id] });
    if (error) { alert("失败: " + error.message); return; }
    await load();
  };

  const unsettle = async (b) => {
    if (!confirm(`确认撤销账单 ${b.bill_no} 的核销？已核销金额将清零。`)) return;
    const { error } = await supabase.rpc("unsettle_bill", { p_bill_id: b.id });
    if (error) { alert("失败: " + error.message); return; }
    await load();
  };

  const calcSummary = (rows) => {
    const sum = { ar: {}, ap: {}, settled: {}, unsettled: {}, cny_total: 0 };
    rows.forEach(b => {
      const amt = Number(b.amount_total || 0);
      const settled = Number(b.settled_amount || 0);
      const remain = amt - settled;
      const ccy = b.currency || "CNY";
      const cny = Number(b.amount_cny || amt);
      if (b.direction === "AR") sum.ar[ccy] = (sum.ar[ccy] || 0) + amt;
      if (b.direction === "AP") sum.ap[ccy] = (sum.ap[ccy] || 0) + amt;
      sum.settled[ccy] = (sum.settled[ccy] || 0) + settled;
      sum.unsettled[ccy] = (sum.unsettled[ccy] || 0) + remain;
      sum.cny_total += cny;
    });
    return sum;
  };
  const renderCcySum = (obj) =>
    Object.entries(obj).filter(([_, v]) => v !== 0).map(([c, v]) => `${c} ${v.toFixed(2)}`).join("\n") || "—";

  const allSum = calcSummary(bills);
  const selSum = calcSummary(bills.filter(b => selected.has(b.id)));

  return (
    <div style={{ padding: 16, background: "#f0f2f5", minHeight: "100vh" }}>
      <div style={{ background: "#fff", borderRadius: 4, padding: 16,
                    boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
        {/* 顶部 */}
        <div style={{ display: "flex", justifyContent: "space-between",
                      alignItems: "center", marginBottom: 12, paddingBottom: 12,
                      borderBottom: "1px solid #f0f0f0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {onBack && <button onClick={onBack} style={btn}>← 返回</button>}
            <span style={{ fontSize: 16, fontWeight: 700 }}>账单管理</span>
            <span style={{ marginLeft: 4, color: "#888", fontSize: 12 }}>
              共 {bills.length} 条
              {selected.size > 0 && <> · 已选 <b style={{ color: "#1990ff" }}>{selected.size}</b> 条</>}
            </span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={batchInvoice} style={btn} disabled={selected.size === 0}>批量开票</button>
            <a href="#/statements" target="_blank" rel="noreferrer"
               style={{ ...btn, textDecoration: "none", display: "inline-block" }}>对账单管理</a>
          </div>
        </div>

        {/* 筛选 */}
        <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center", fontSize: 12, flexWrap: "wrap" }}>
          <input placeholder="账单号 / 发票号 / 结算单位 / 凭证号"
                 value={filters.keyword}
                 onChange={e => setFilters({...filters, keyword: e.target.value})}
                 onKeyDown={e => e.key === "Enter" && load()}
                 style={{ flex: "0 0 280px", padding: "5px 8px", border: "1px solid #d9d9d9", borderRadius: 3, fontSize: 12 }} />
          <select value={filters.direction}
                  onChange={e => setFilters({...filters, direction: e.target.value})}
                  style={selStyle}>
            <option value="">全部属性</option>
            <option value="AR">应收</option>
            <option value="AP">应付</option>
          </select>
          <select value={filters.status}
                  onChange={e => setFilters({...filters, status: e.target.value})}
                  style={selStyle}>
            <option value="">全部状态</option>
            <option value="unsettled">未核销</option>
            <option value="partial">部分核销</option>
            <option value="settled">已核销</option>
            <option value="void">作废</option>
          </select>
          <input type="date" value={filters.date_from}
                 onChange={e => setFilters({...filters, date_from: e.target.value})}
                 style={selStyle} />
          <span>~</span>
          <input type="date" value={filters.date_to}
                 onChange={e => setFilters({...filters, date_to: e.target.value})}
                 style={selStyle} />
          <button onClick={load} style={btn}>查询</button>
          <button onClick={() => { setFilters({keyword:"", direction:"", status:"", date_from:"", date_to:""}); setTimeout(load, 0); }}
                  style={btn}>重置</button>
        </div>

        {/* 列表 */}
        <div style={{ overflowX: "auto" }}>
          {loading ? (
            <div style={{ padding: 30, textAlign: "center", color: "#888" }}>加载中...</div>
          ) : bills.length === 0 ? (
            <div style={{ padding: 40, textAlign: "center", color: "#999" }}>暂无账单</div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
              <thead>
                <tr style={{ background: "#fafafa", color: "#444" }}>
                  <th style={{ ...th, width: 30, textAlign: "center" }}>
                    <input type="checkbox"
                           checked={selected.size === bills.length && bills.length > 0}
                           onChange={toggleAll} />
                  </th>
                  <th style={{ ...th, textAlign: "center" }}>属性</th>
                  <th style={th}>账单编号</th>
                  <th style={th}>结算单位</th>
                  <th style={th}>发票号</th>
                  <th style={th}>凭证号</th>
                  <th style={{ ...th, textAlign: "right" }}>币 / 金额</th>
                  <th style={{ ...th, textAlign: "right" }}>已核销</th>
                  <th style={{ ...th, textAlign: "right" }}>未核销</th>
                  <th style={{ ...th, textAlign: "center" }}>状态</th>
                  <th style={th}>来源</th>
                  <th style={th}>关联订单</th>
                  <th style={{ ...th, textAlign: "center", minWidth: 160 }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {bills.map(b => {
                  const st = STATUS_LABELS[b.status] || STATUS_LABELS.unsettled;
                  const isSel = selected.has(b.id);
                  const settled = Number(b.settled_amount || 0);
                  const total = Number(b.amount_total || 0);
                  const remain = total - settled;
                  const ship = shipMap[b.shipment_id];
                  return (
                    <tr key={b.id}
                        style={{ background: isSel ? "#e6f4ff" : "#fff",
                                  borderBottom: "1px solid #f5f5f5" }}>
                      <td style={{ ...td, textAlign: "center" }}>
                        <input type="checkbox" checked={isSel} onChange={() => toggle(b.id)} />
                      </td>
                      <td style={{ ...td, textAlign: "center" }}>
                        <span style={{
                          color: b.direction === "AR" ? "#52c41a" : "#fa541c",
                          fontWeight: 700,
                        }}>{b.direction === "AR" ? "应收" : "应付"}</span>
                      </td>
                      <td style={{ ...td, fontFamily: "Consolas,monospace", color: BRAND, fontWeight: 600 }}>
                        <a href={`#/bills/${b.id}`} target="_blank" rel="noreferrer"
                           style={{ color: "inherit", textDecoration: "none" }}>
                          {b.bill_no}
                        </a>
                      </td>
                      <td style={td}>{b.partner_name || partnerMap[b.partner_id] || "—"}</td>
                      <td style={td}>
                        {b.invoice_no
                          ? <span style={{ fontFamily: "Consolas,monospace", color: "#444" }}>{b.invoice_no}</span>
                          : <span style={{ color: "#bbb", fontStyle: "italic" }}>未开</span>}
                      </td>
                      <td style={{ ...td, fontFamily: "Consolas,monospace", color: "#666" }}>
                        {b.voucher_no || <span style={{ color: "#bbb" }}>—</span>}
                      </td>
                      <td style={{ ...td, textAlign: "right", fontFamily: "Consolas,monospace", fontWeight: 700 }}>
                        {b.currency} {total.toFixed(2)}
                      </td>
                      <td style={{ ...td, textAlign: "right", fontFamily: "Consolas,monospace",
                                    color: settled > 0 ? "#52c41a" : "#bbb",
                                    fontWeight: settled > 0 ? 600 : 400 }}>
                        {settled.toFixed(2)}
                      </td>
                      <td style={{ ...td, textAlign: "right", fontFamily: "Consolas,monospace",
                                    color: remain > 0.01 ? "#c00" : "#bbb",
                                    fontWeight: remain > 0.01 ? 600 : 400 }}>
                        {remain.toFixed(2)}
                      </td>
                      <td style={{ ...td, textAlign: "center" }}>
                        <span style={{ display: "inline-block", padding: "1px 7px",
                                        background: st.bg, color: st.color,
                                        borderRadius: 3, fontSize: 11 }}>
                          {st.label}
                        </span>
                      </td>
                      <td style={td}>{b.source || "—"}</td>
                      <td style={td}>
                        {ship ? <a href={`#/sea_export?id=${ship.id}`} target="_blank" rel="noreferrer"
                                    style={{ color: "#1990ff", textDecoration: "none" }}>
                          {ship.order_no}
                        </a> : "—"}
                        <br/><span style={{ fontSize: 10, color: "#999" }}>{formatDate(b.created_at)}</span>
                      </td>
                      <td style={{ ...td, textAlign: "center" }}>
                        {b.status !== "void" && b.status !== "settled" && (
                          <a onClick={() => settleBill(b)}
                             style={{ color: "#1990ff", cursor: "pointer", marginRight: 6 }}>核销</a>
                        )}
                        {b.status === "settled" && (
                          <a onClick={() => unsettle(b)}
                             style={{ color: "#fa541c", cursor: "pointer", marginRight: 6 }}>撤销</a>
                        )}
                        {!b.invoice_no && (
                          <a onClick={() => invoiceBill(b)}
                             style={{ color: "#fa8c16", cursor: "pointer", marginRight: 6 }}>开票</a>
                        )}
                        {b.invoice_no && (
                          <a onClick={() => clearInvoice(b)}
                             style={{ color: "#999", cursor: "pointer", marginRight: 6 }}>清票</a>
                        )}
                        <a onClick={() => editVoucher(b)}
                           style={{ color: "#666", cursor: "pointer" }}>凭证号</a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* 底部小计 */}
        {bills.length > 0 && (
          <div style={{ marginTop: 14, padding: "10px 12px",
                        background: "#fafafa", border: "1px solid #f0f0f0",
                        borderRadius: 3, fontSize: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: "6px 16px" }}>
              <div><span style={{ color: "#888" }}>总计 (选中)：</span><b style={{ color: BRAND }}>{selected.size} 条</b></div>
              <div><span style={{ color: "#888" }}>应收：</span>
                <b style={{ color: "#52c41a", fontFamily: "Consolas,monospace", whiteSpace: "pre-line" }}>{renderCcySum(selSum.ar)}</b>
              </div>
              <div><span style={{ color: "#888" }}>应付：</span>
                <b style={{ color: "#fa541c", fontFamily: "Consolas,monospace", whiteSpace: "pre-line" }}>{renderCcySum(selSum.ap)}</b>
              </div>
              <div><span style={{ color: "#888" }}>已核销：</span>
                <b style={{ color: "#52c41a", fontFamily: "Consolas,monospace", whiteSpace: "pre-line" }}>{renderCcySum(selSum.settled)}</b>
              </div>
              <div><span style={{ color: "#888" }}>未核销：</span>
                <b style={{ color: "#c00", fontFamily: "Consolas,monospace", whiteSpace: "pre-line" }}>{renderCcySum(selSum.unsettled)}</b>
              </div>
              <div></div>
            </div>
            <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px dashed #ddd",
                          display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: "6px 16px" }}>
              <div><span style={{ color: "#888" }}>总计 (全部)：</span><b style={{ color: BRAND }}>{bills.length} 条</b></div>
              <div><span style={{ color: "#888" }}>应收：</span>
                <b style={{ color: "#52c41a", fontFamily: "Consolas,monospace", whiteSpace: "pre-line" }}>{renderCcySum(allSum.ar)}</b>
              </div>
              <div><span style={{ color: "#888" }}>应付：</span>
                <b style={{ color: "#fa541c", fontFamily: "Consolas,monospace", whiteSpace: "pre-line" }}>{renderCcySum(allSum.ap)}</b>
              </div>
              <div><span style={{ color: "#888" }}>已核销：</span>
                <b style={{ color: "#52c41a", fontFamily: "Consolas,monospace", whiteSpace: "pre-line" }}>{renderCcySum(allSum.settled)}</b>
              </div>
              <div><span style={{ color: "#888" }}>未核销：</span>
                <b style={{ color: "#c00", fontFamily: "Consolas,monospace", whiteSpace: "pre-line" }}>{renderCcySum(allSum.unsettled)}</b>
              </div>
              <div><span style={{ color: "#888" }}>折本币:</span>
                <b style={{ color: BRAND, fontFamily: "Consolas,monospace" }}>CNY {allSum.cny_total.toFixed(2)}</b>
              </div>
            </div>
          </div>
        )}
      </div>

      {showSettle && (
        <SettleDialog bill={showSettle}
                       onClose={() => setShowSettle(null)}
                       onDone={async () => { setShowSettle(null); await load(); }} />
      )}
      {showInvoice && (
        <InvoiceDialog bills={showInvoice.bills}
                        onClose={() => setShowInvoice(null)}
                        onDone={async () => { setShowInvoice(null); setSelected(new Set()); await load(); }} />
      )}
      {showVoucher && (
        <VoucherDialog bill={showVoucher}
                        onClose={() => setShowVoucher(null)}
                        onDone={async () => { setShowVoucher(null); await load(); }} />
      )}
    </div>
  );
}

// 核销弹窗
function SettleDialog({ bill, onClose, onDone }) {
  const total = Number(bill.amount_total || 0);
  const already = Number(bill.settled_amount || 0);
  const remain = total - already;
  const [amount, setAmount] = useState(remain.toFixed(2));
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [settleNo, setSettleNo] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    const amt = Number(amount);
    if (!amt || amt <= 0) { alert("请填写有效金额"); return; }
    if (amt > remain + 0.01) { alert(`金额不能超过未核销 ${remain.toFixed(2)}`); return; }
    setSubmitting(true);
    const { error } = await supabase.rpc("settle_bill", {
      p_bill_id: bill.id,
      p_amount: amt,
      p_settled_at: date,
      p_settle_no: settleNo || null,
    });
    setSubmitting(false);
    if (error) { alert("核销失败: " + error.message); return; }
    onDone();
  };

  return (
    <Modal title={`核销账单 ${bill.bill_no}`} onClose={onClose}>
      <div style={{ marginBottom: 12, padding: 10, background: "#f5f8fc", borderRadius: 3, fontSize: 12 }}>
        <div>结算单位：<b>{bill.partner_name}</b></div>
        <div style={{ marginTop: 4 }}>账单金额：<b style={{ fontFamily: "Consolas,monospace" }}>{bill.currency} {total.toFixed(2)}</b>
          {already > 0 && <> · 已核销：<b style={{ color: "#52c41a", fontFamily: "Consolas,monospace" }}>{already.toFixed(2)}</b>
          · 未核销：<b style={{ color: "#c00", fontFamily: "Consolas,monospace" }}>{remain.toFixed(2)}</b></>}
        </div>
      </div>
      <div style={{ display: "grid", gap: 10 }}>
        <div>
          <label style={lbl}>本次核销金额 *</label>
          <input type="number" step="0.01" value={amount}
                 onChange={e => setAmount(e.target.value)}
                 style={inp} />
          <div style={{ marginTop: 4 }}>
            <a onClick={() => setAmount(remain.toFixed(2))}
               style={{ color: "#1990ff", cursor: "pointer", fontSize: 11 }}>
              整额核销 ({remain.toFixed(2)})
            </a>
          </div>
        </div>
        <div>
          <label style={lbl}>核销日期 *</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} style={inp} />
        </div>
        <div>
          <label style={lbl}>核销流水号 (银行单号 / 支票号 等，可选)</label>
          <input value={settleNo} onChange={e => setSettleNo(e.target.value)}
                 placeholder="如：银行流水 20260505...."
                 style={inp} />
        </div>
      </div>
      <ModalFooter>
        <button onClick={onClose} style={btn}>取消</button>
        <button onClick={submit} disabled={submitting} style={btnPrimary}>
          {submitting ? "核销中..." : "确认核销"}
        </button>
      </ModalFooter>
    </Modal>
  );
}

// 开票弹窗（单/多条）
function InvoiceDialog({ bills, onClose, onDone }) {
  const [invoiceNo, setInvoiceNo] = useState(bills.length === 1 && bills[0].invoice_no ? bills[0].invoice_no : "");
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [submitting, setSubmitting] = useState(false);

  const partners = [...new Set(bills.map(b => b.partner_id))];
  const currencies = [...new Set(bills.map(b => b.currency))];
  const total = bills.reduce((s, b) => s + Number(b.amount_total || 0), 0);
  const sameParter = partners.length === 1;
  const sameCcy = currencies.length === 1;

  const submit = async () => {
    if (!invoiceNo.trim()) { alert("请填写发票号"); return; }
    if (!sameParter || !sameCcy) {
      alert("所选账单结算单位/币别不一致，无法合开同一张发票");
      return;
    }
    setSubmitting(true);
    const { error } = await supabase.rpc("issue_invoice", {
      p_bill_ids: bills.map(b => b.id),
      p_invoice_no: invoiceNo.trim(),
      p_invoice_date: invoiceDate,
    });
    setSubmitting(false);
    if (error) { alert("开票失败: " + error.message); return; }
    onDone();
  };

  return (
    <Modal title={bills.length === 1 ? `开票：${bills[0].bill_no}` : `开票：${bills.length} 张账单合开`} onClose={onClose}>
      <div style={{ marginBottom: 12, padding: 10, background: "#f5f8fc", borderRadius: 3, fontSize: 12 }}>
        {bills.length > 1 ? (
          <>
            <div>账单数量：<b>{bills.length} 张</b></div>
            <div style={{ marginTop: 4 }}>结算单位：<b>{sameParter ? bills[0].partner_name : <span style={{ color: "#c00" }}>⚠ 多个结算单位（不能合开）</span>}</b></div>
            <div style={{ marginTop: 4 }}>币别：<b>{sameCcy ? bills[0].currency : <span style={{ color: "#c00" }}>⚠ 币别不一致（不能合开）</span>}</b></div>
            <div style={{ marginTop: 4 }}>合计金额：<b style={{ fontFamily: "Consolas,monospace" }}>{sameCcy ? bills[0].currency : "?"} {total.toFixed(2)}</b></div>
          </>
        ) : (
          <>
            <div>结算单位：<b>{bills[0].partner_name}</b></div>
            <div style={{ marginTop: 4 }}>账单金额：<b style={{ fontFamily: "Consolas,monospace" }}>{bills[0].currency} {Number(bills[0].amount_total).toFixed(2)}</b></div>
          </>
        )}
      </div>
      <div style={{ display: "grid", gap: 10 }}>
        <div>
          <label style={lbl}>发票号 *</label>
          <input value={invoiceNo} onChange={e => setInvoiceNo(e.target.value)}
                 placeholder="如：26932000000679915936"
                 style={inp} />
        </div>
        <div>
          <label style={lbl}>开票日期 *</label>
          <input type="date" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} style={inp} />
        </div>
      </div>
      <ModalFooter>
        <button onClick={onClose} style={btn}>取消</button>
        <button onClick={submit} disabled={submitting || !sameParter || !sameCcy}
                style={btnPrimary}>
          {submitting ? "开票中..." : "确认开票"}
        </button>
      </ModalFooter>
    </Modal>
  );
}

// 凭证号弹窗
function VoucherDialog({ bill, onClose, onDone }) {
  const [voucherNo, setVoucherNo] = useState(bill.voucher_no || "");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setSubmitting(true);
    const { error } = await supabase.from("bills")
      .update({ voucher_no: voucherNo.trim() || null })
      .eq("id", bill.id);
    setSubmitting(false);
    if (error) { alert("失败: " + error.message); return; }
    onDone();
  };

  return (
    <Modal title={`填写凭证号：${bill.bill_no}`} onClose={onClose}>
      <div style={{ marginBottom: 12, padding: 10, background: "#f5f8fc", borderRadius: 3, fontSize: 12 }}>
        结算单位：<b>{bill.partner_name}</b><br/>
        账单金额：<b style={{ fontFamily: "Consolas,monospace" }}>{bill.currency} {Number(bill.amount_total).toFixed(2)}</b>
      </div>
      <div>
        <label style={lbl}>财务凭证号</label>
        <input value={voucherNo} onChange={e => setVoucherNo(e.target.value)}
               placeholder="如：PV2604001 / 记字 2026-04-001"
               style={inp} autoFocus />
        <div style={{ marginTop: 4, fontSize: 11, color: "#888" }}>
          会计系统（用友/金蝶/SAP）的记账凭证号或付款凭证号
        </div>
      </div>
      <ModalFooter>
        <button onClick={onClose} style={btn}>取消</button>
        <button onClick={submit} disabled={submitting} style={btnPrimary}>
          {submitting ? "保存中..." : "保存"}
        </button>
      </ModalFooter>
    </Modal>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div onClick={onClose}
         style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  zIndex: 1000 }}>
      <div onClick={e => e.stopPropagation()}
           style={{ background: "#fff", borderRadius: 6, width: 480, maxWidth: "90vw",
                    boxShadow: "0 4px 32px rgba(0,0,0,0.15)" }}>
        <div style={{ padding: "12px 16px", borderBottom: "1px solid #f0f0f0",
                      display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 14, fontWeight: 600 }}>{title}</span>
          <a onClick={onClose} style={{ cursor: "pointer", color: "#888", fontSize: 18 }}>×</a>
        </div>
        <div style={{ padding: 16, fontSize: 12 }}>
          {children}
        </div>
      </div>
    </div>
  );
}
function ModalFooter({ children }) {
  return (
    <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid #f0f0f0",
                  display: "flex", justifyContent: "flex-end", gap: 8 }}>
      {children}
    </div>
  );
}

function formatDate(d) {
  if (!d) return "—";
  const date = new Date(d);
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const th  = { padding: "7px 6px", textAlign: "left", borderBottom: "1px solid #e8e8e8", fontWeight: 600 };
const td  = { padding: 6 };
const lbl = { display: "block", color: "#666", marginBottom: 4, fontSize: 11 };
const inp = { width: "100%", padding: "5px 8px", border: "1px solid #d9d9d9",
              borderRadius: 3, fontSize: 12, boxSizing: "border-box" };
const selStyle = { padding: "5px 8px", border: "1px solid #d9d9d9", borderRadius: 3, fontSize: 12 };
const btn = { padding: "5px 14px", background: "#fff", border: "1px solid #d9d9d9",
              borderRadius: 3, fontSize: 12, cursor: "pointer" };
const btnPrimary = { ...btn, background: "#1990ff", color: "#fff", border: "1px solid #1990ff",
                      fontWeight: 600 };
