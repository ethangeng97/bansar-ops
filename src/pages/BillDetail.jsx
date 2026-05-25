// ============================================================================
// BillDetail.jsx  —  账单详情页
// 路由：#/bills/:id
// 功能：
//   - 显示账单基本信息（账单号/票号/结算单位/方向/币种/金额/状态/核销/开票）
//   - 关联费用列表（只读）
//   - 状态切换：unsettled / partial / settled / void（与 RPC 状态机一致）
//   - 视觉风格与 BillsList.jsx 统一：BRAND #1f3864、TMS 蓝 #1990ff、白底卡片
// ============================================================================

import { useEffect, useState } from "react";
import { supabase } from "../supabase.js";

const BRAND = "#1f3864";

// 与 BillsList 完全一致的状态字典
const STATUS_LABELS = {
  unsettled: { label: "未核销",   color: "#fa8c16", bg: "#fff7e6" },
  partial:   { label: "部分核销", color: "#1990ff", bg: "#e6f7ff" },
  settled:   { label: "已核销",   color: "#52c41a", bg: "#f6ffed" },
  void:      { label: "已作废",   color: "#999",    bg: "#f5f5f5" },
  // 兼容旧数据
  draft:     { label: "草稿",     color: "#8c8c8c", bg: "#f5f5f5" },
  issued:    { label: "已开票",   color: "#1990ff", bg: "#e6f7ff" },
  paid:      { label: "已结算",   color: "#52c41a", bg: "#f6ffed" },
};

const formatDate = (d) => {
  if (!d) return "—";
  const date = new Date(d);
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const formatDateTime = (d) => {
  if (!d) return "—";
  const date = new Date(d);
  const Y = date.getFullYear();
  const M = String(date.getMonth()+1).padStart(2, "0");
  const D = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  return `${Y}-${M}-${D} ${h}:${m}`;
};

export default function BillDetail({ billId, onBack }) {
  const [bill, setBill] = useState(null);
  const [shipment, setShipment] = useState(null);
  const [partner, setPartner] = useState(null);
  const [charges, setCharges] = useState([]);
  const [chargeItems, setChargeItems] = useState([]);
  const [linkedInvoices, setLinkedInvoices] = useState([]);
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    setLoading(true);
    const { data: b, error } = await supabase
      .from("bills").select("*").eq("id", billId).single();
    if (error) { alert("加载账单失败: " + error.message); setLoading(false); return; }
    setBill(b);

    const [{ data: sh }, { data: pt }, { data: chs }, { data: items }] = await Promise.all([
      supabase.from("shipments")
        .select("id, order_no, booking_no, hbl_no, mbl_no, vessel, voyage, pol, pod")
        .eq("id", b.shipment_id).single(),
      supabase.from("customers").select("*").eq("id", b.partner_id).single(),
      supabase.from("charges").select("*").eq("bill_id", billId).order("sort_order"),
      supabase.from("charge_items").select("id, code, name_zh"),
    ]);
    setShipment(sh);
    setPartner(pt);
    setCharges(chs || []);
    setChargeItems(items || []);

    // 拉关联发票（invoice_bills join invoices）
    const { data: ibs } = await supabase.from("invoice_bills")
      .select("id, applied_amount, invoice_id").eq("bill_id", billId);
    if (ibs && ibs.length > 0) {
      const invIds = ibs.map(x => x.invoice_id);
      const { data: invs } = await supabase.from("invoices")
        .select("id, invoice_no, invoice_date, amount_total, currency, kind, direction")
        .in("id", invIds);
      const invMap = {};
      (invs || []).forEach(x => { invMap[x.id] = x; });
      setLinkedInvoices(ibs.map(ib => ({ ...ib, ...(invMap[ib.invoice_id] || {}) })));
    } else {
      setLinkedInvoices([]);
    }

    setLoading(false);
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [billId]);

  // 作废 / 撤销作废 用直接 update（RPC 没有 void_bill，沿用历史做法）
  const updateStatus = async (newStatus) => {
    const { error } = await supabase.from("bills")
      .update({ status: newStatus }).eq("id", billId);
    if (error) { alert("状态更新失败: " + error.message); return; }
    await reload();
  };

  // 开票（调用已有 RPC）
  const onInvoice = async () => {
    const inv = prompt("请输入发票号：");
    if (!inv) return;
    const dt = new Date().toISOString();
    const { error } = await supabase.rpc("issue_invoice", {
      p_bill_ids: [billId],
      p_invoice_no: inv.trim(),
      p_invoice_date: dt,
    });
    if (error) { alert("开票失败: " + error.message); return; }
    await reload();
  };

  // 清票
  const onClearInvoice = async () => {
    if (!confirm("确认清除该账单的发票号？")) return;
    const { error } = await supabase.rpc("clear_invoice", { p_bill_ids: [billId] });
    if (error) { alert("清票失败: " + error.message); return; }
    await reload();
  };

  // 核销
  const onSettle = async () => {
    const remain = Number(bill.amount_total) - Number(bill.settled_amount || 0);
    const amt = prompt(`请输入本次核销金额（剩余 ${remain.toFixed(2)} ${bill.currency}）：`, remain.toFixed(2));
    if (!amt) return;
    const n = Number(amt);
    if (!(n > 0)) { alert("金额无效"); return; }
    const { error } = await supabase.rpc("settle_bill", {
      p_bill_id: billId,
      p_amount: n,
      p_settled_at: new Date().toISOString(),
    });
    if (error) { alert("核销失败: " + error.message); return; }
    await reload();
  };

  // 撤销核销
  const onUnsettle = async () => {
    if (!confirm("确认撤销本账单的全部核销记录？")) return;
    const { error } = await supabase.rpc("unsettle_bill", { p_bill_id: billId });
    if (error) { alert("撤销失败: " + error.message); return; }
    await reload();
  };

  if (loading) return <div style={{ padding: 30, textAlign: "center", color: "#888" }}>加载中...</div>;
  if (!bill)   return <div style={{ padding: 30, textAlign: "center", color: "#999" }}>账单不存在</div>;

  const itemMap = {};
  chargeItems.forEach(it => { itemMap[it.id] = it; });
  const st = STATUS_LABELS[bill.status] || { label: bill.status, color: "#000", bg: "#fff" };
  const blNo = (shipment?.mbl_no || "").trim() || (shipment?.booking_no || "").trim() || "—";
  const hblNo = (shipment?.hbl_no || "").trim();
  const settled = Number(bill.settled_amount || 0);
  const total = Number(bill.amount_total || 0);
  const remain = total - settled;

  return (
    <div style={{ padding: 16, background: "#f0f2f5", minHeight: "100vh" }}>
      <div style={{ background: "#fff", borderRadius: 4, padding: 16,
                    boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>

        {/* 顶部标题栏 */}
        <div style={{ display: "flex", justifyContent: "space-between",
                      alignItems: "center", marginBottom: 12, paddingBottom: 12,
                      borderBottom: "1px solid #f0f0f0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            {onBack && <button onClick={onBack} style={btn}>← 返回</button>}
            <span style={{ fontSize: 16, fontWeight: 700 }}>账单详情</span>
            <span style={{ fontFamily: "Consolas,monospace", color: BRAND, fontWeight: 600, fontSize: 14 }}>
              {bill.bill_no}
            </span>
            <span style={{
              padding: "2px 10px", fontSize: 11, borderRadius: 3,
              color: bill.direction === "AR" ? "#1990ff" : "#fa8c16",
              background: bill.direction === "AR" ? "#e6f7ff" : "#fff7e6",
              border: `1px solid ${bill.direction === "AR" ? "#91d5ff" : "#ffd591"}`,
            }}>{bill.direction === "AR" ? "应收 (AR)" : "应付 (AP)"}</span>
            <span style={{
              padding: "2px 10px", fontSize: 11, borderRadius: 3,
              color: st.color, background: st.bg,
            }}>{st.label}</span>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {bill.status !== "void" && bill.status !== "settled" && (
              <button onClick={onSettle} style={btnPrimary}>核销</button>
            )}
            {(bill.status === "settled" || bill.status === "partial") && (
              <button onClick={onUnsettle} style={btn}>撤销核销</button>
            )}
            {!bill.invoice_no && bill.status !== "void" && (
              <button onClick={onInvoice} style={btn}>开票</button>
            )}
            {bill.invoice_no && (
              <button onClick={onClearInvoice} style={btn}>清票</button>
            )}
            {bill.status !== "void" && (
              <button onClick={() => updateStatus("void")} style={btnDanger}>作废</button>
            )}
            {bill.status === "void" && (
              <button onClick={() => updateStatus("unsettled")} style={btn}>恢复</button>
            )}
          </div>
        </div>

        {/* 基本信息 */}
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14,
          padding: 14, background: "#fafafa", borderRadius: 3, marginBottom: 14, fontSize: 12,
          border: "1px solid #f0f0f0",
        }}>
          <Field label="账单号" value={bill.bill_no} mono />
          <Field label="作业号"
                 value={shipment?.order_no}
                 link={shipment ? `#/sea_export?id=${shipment.id}` : null}
                 mono />
          <Field label="提单号 (MBL)" value={blNo} mono />
          <Field label="分提单号 (HBL)" value={hblNo || "—"} mono />
          <Field label="结算单位" value={`${partner?.code || ""} ${partner?.name || "—"}`} />
          <Field label="币种 / 金额"
                 value={`${bill.currency} ${total.toFixed(2)}`} mono />
          <Field label="折 CNY"
                 value={`¥ ${Number(bill.amount_cny || 0).toFixed(2)}`}
                 mono valueColor="#1990ff" valueBold />
          <Field label="发票号" value={bill.invoice_no || "—"} mono />
          <Field label="凭证号" value={bill.voucher_no || "—"} mono />
          <Field label="已核销"
                 value={`${bill.currency} ${settled.toFixed(2)}`}
                 mono valueColor="#52c41a" />
          <Field label="未核销"
                 value={`${bill.currency} ${remain.toFixed(2)}`}
                 mono valueColor={remain > 0 ? "#fa541c" : "#999"} valueBold={remain > 0} />
          <Field label="来源" value={bill.source || "海运出口"} />
          <Field label="创建时间" value={formatDateTime(bill.created_at)} />
          {bill.invoice_date && <Field label="开票时间" value={formatDateTime(bill.invoice_date)} />}
          {bill.settled_at &&   <Field label="核销时间" value={formatDateTime(bill.settled_at)} />}
          {bill.statement_id && (
            <Field label="所属对账单"
                   value={`STM #${bill.statement_id}`}
                   link={`#/statements/${bill.statement_id}`} mono />
          )}
        </div>

        {/* 船次信息（如有） */}
        {(shipment?.vessel || shipment?.voyage || shipment?.pol || shipment?.pod) && (
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14,
            padding: 14, background: "#fafafa", borderRadius: 3, marginBottom: 14, fontSize: 12,
            border: "1px solid #f0f0f0",
          }}>
            <Field label="船名" value={shipment.vessel || "—"} />
            <Field label="航次" value={shipment.voyage || "—"} />
            <Field label="起运港 (POL)" value={shipment.pol || "—"} />
            <Field label="目的港 (POD)" value={shipment.pod || "—"} />
          </div>
        )}

        {/* 费用明细 */}
        <div style={{ border: "1px solid #f0f0f0", borderRadius: 3 }}>
          <div style={{ padding: "8px 12px", background: "#fafafa", fontWeight: 600, fontSize: 12,
                         borderBottom: "1px solid #f0f0f0" }}>
            费用明细 <span style={{ color: "#888", fontWeight: 400 }}>共 {charges.length} 项</span>
          </div>
          <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#fff", color: "#444" }}>
                <th style={th}>费用项</th>
                <th style={{ ...th, textAlign: "center" }}>计费单位</th>
                <th style={{ ...th, textAlign: "right" }}>数量</th>
                <th style={{ ...th, textAlign: "center" }}>币种</th>
                <th style={{ ...th, textAlign: "right" }}>汇率</th>
                <th style={{ ...th, textAlign: "right" }}>单价</th>
                <th style={{ ...th, textAlign: "right" }}>税率%</th>
                <th style={{ ...th, textAlign: "right" }}>原币总价</th>
                <th style={{ ...th, textAlign: "right" }}>折 CNY</th>
                <th style={th}>备注</th>
              </tr>
            </thead>
            <tbody>
              {charges.map(c => {
                const it = itemMap[c.charge_item_id];
                return (
                  <tr key={c.id} style={{ borderTop: "1px solid #f5f5f5" }}>
                    <td style={td}>{it ? `${it.code} ${it.name_zh}` : "—"}</td>
                    <td style={{ ...td, textAlign: "center" }}>{c.unit}</td>
                    <td style={{ ...td, textAlign: "right", fontFamily: "Consolas,monospace" }}>{c.quantity}</td>
                    <td style={{ ...td, textAlign: "center" }}>{c.currency}</td>
                    <td style={{ ...td, textAlign: "right", fontFamily: "Consolas,monospace" }}>{Number(c.exchange_rate).toFixed(4)}</td>
                    <td style={{ ...td, textAlign: "right", fontFamily: "Consolas,monospace" }}>{Number(c.unit_price).toFixed(2)}</td>
                    <td style={{ ...td, textAlign: "right" }}>{c.tax_rate || 0}</td>
                    <td style={{ ...td, textAlign: "right", fontFamily: "Consolas,monospace" }}>{Number(c.amount_total).toFixed(2)}</td>
                    <td style={{ ...td, textAlign: "right", fontFamily: "Consolas,monospace",
                                  color: "#1990ff", fontWeight: 700 }}>
                      {Number(c.amount_cny).toFixed(2)}
                    </td>
                    <td style={{ ...td, color: "#999" }}>{c.remark || "—"}</td>
                  </tr>
                );
              })}
              {charges.length === 0 && (
                <tr><td colSpan={10} style={{ padding: 30, textAlign: "center", color: "#999" }}>无费用</td></tr>
              )}
            </tbody>
            <tfoot>
              <tr style={{ background: "#fafafa", fontWeight: 600, borderTop: "1px solid #e8e8e8" }}>
                <td colSpan={8} style={{ ...td, textAlign: "right" }}>合计 (折 CNY)：</td>
                <td style={{ ...td, textAlign: "right", fontFamily: "Consolas,monospace", color: "#1990ff" }}>
                  {Number(bill.amount_cny || 0).toFixed(2)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>

        {/* 已开发票（关联 invoices） */}
        {linkedInvoices.length > 0 && (
          <div style={{ marginTop: 14, border: "1px solid #f0f0f0", borderRadius: 3 }}>
            <div style={{ padding: "8px 12px", background: "#fafafa", fontWeight: 600, fontSize: 12,
                          borderBottom: "1px solid #f0f0f0",
                          display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>已开发票 <span style={{ color: "#888", fontWeight: 400 }}>共 {linkedInvoices.length} 张</span></span>
              <a href="#/invoices" style={{ fontSize: 11, color: "#1990ff", textDecoration: "none" }}>
                去发票列表管理 →
              </a>
            </div>
            <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#fff", color: "#444" }}>
                  <th style={th}>发票号</th>
                  <th style={th}>开票日期</th>
                  <th style={{ ...th, width: 70 }}>类型</th>
                  <th style={{ ...th, textAlign: "right" }}>发票金额</th>
                  <th style={{ ...th, textAlign: "right" }}>分摊到本账单</th>
                </tr>
              </thead>
              <tbody>
                {linkedInvoices.map(li => (
                  <tr key={li.id} style={{ borderTop: "1px solid #f5f5f5" }}>
                    <td style={{ ...td, fontFamily: "Consolas,monospace", color: BRAND, fontWeight: 600 }}>
                      {li.invoice_no}
                    </td>
                    <td style={{ ...td, fontFamily: "Consolas,monospace" }}>
                      {li.invoice_date ? String(li.invoice_date).slice(0, 10) : "—"}
                    </td>
                    <td style={td}>
                      <span style={{
                        padding: "1px 6px", fontSize: 11, borderRadius: 2,
                        background: li.kind === "non_business" ? "#fff7e6" : "#f0f7ff",
                        color: li.kind === "non_business" ? "#fa8c16" : "#1990ff",
                      }}>
                        {li.kind === "non_business" ? "非业务" : "业务"}
                      </span>
                    </td>
                    <td style={{ ...td, textAlign: "right", fontFamily: "Consolas,monospace" }}>
                      {li.currency} {Number(li.amount_total).toFixed(2)}
                    </td>
                    <td style={{ ...td, textAlign: "right", fontFamily: "Consolas,monospace", color: "#1990ff", fontWeight: 600 }}>
                      {Number(li.applied_amount).toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

      </div>
    </div>
  );
}

function Field({ label, value, mono, link, valueColor, valueBold }) {
  const valStyle = {
    fontFamily: mono ? "Consolas,monospace" : "inherit",
    fontSize: 12.5,
    color: valueColor || "#222",
    fontWeight: valueBold ? 700 : 400,
  };
  return (
    <div>
      <div style={{ fontSize: 11, color: "#888", marginBottom: 3 }}>{label}</div>
      <div style={valStyle}>
        {link
          ? <a href={link} target="_blank" rel="noreferrer"
               style={{ color: valueColor || "#1990ff", textDecoration: "none" }}>{value || "—"}</a>
          : (value || "—")}
      </div>
    </div>
  );
}

const th = { padding: "7px 6px", textAlign: "left", borderBottom: "1px solid #e8e8e8", fontWeight: 600 };
const td = { padding: 6 };
const btn = { padding: "5px 14px", background: "#fff", border: "1px solid #d9d9d9",
              borderRadius: 3, fontSize: 12, cursor: "pointer" };
const btnPrimary = { ...btn, background: "#1990ff", color: "#fff", border: "1px solid #1990ff",
                     fontWeight: 600 };
const btnDanger = { ...btn, background: "#fff", color: "#ff4d4f", border: "1px solid #ffa39e" };
