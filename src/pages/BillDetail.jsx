// ============================================================================
// BillDetail.jsx  —  账单详情页（轻量版）
// 路由：#/bills/:id
// 功能：
//   - 显示账单基本信息（账单号/票号/结算单位/方向/币种/金额/状态）
//   - 关联费用列表（只读）
//   - 状态切换：draft → issued → paid，或 void
// ============================================================================

import { useEffect, useState } from "react";
import { supabase } from "../supabase.js";

export default function BillDetail({ billId, onBack }) {
  const [bill, setBill] = useState(null);
  const [shipment, setShipment] = useState(null);
  const [partner, setPartner] = useState(null);
  const [charges, setCharges] = useState([]);
  const [chargeItems, setChargeItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    setLoading(true);
    const { data: b, error } = await supabase
      .from("bills").select("*").eq("id", billId).single();
    if (error) { alert("加载账单失败: " + error.message); setLoading(false); return; }
    setBill(b);

    const [{ data: sh }, { data: pt }, { data: chs }, { data: items }] = await Promise.all([
      supabase.from("shipments")
        .select("id,order_no,booking_no,vessel,voyage,pol,pod")
        .eq("id", b.shipment_id).single(),
      supabase.from("customers").select("*").eq("id", b.partner_id).single(),
      supabase.from("charges").select("*").eq("bill_id", billId).order("sort_order"),
      supabase.from("charge_items").select("id, code, name_zh"),
    ]);
    setShipment(sh);
    setPartner(pt);
    setCharges(chs || []);
    setChargeItems(items || []);
    setLoading(false);
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [billId]);

  const updateStatus = async (newStatus) => {
    const stamps = {};
    if (newStatus === "issued") stamps.issued_at = new Date().toISOString();
    if (newStatus === "paid")   stamps.paid_at   = new Date().toISOString();
    const { error } = await supabase.from("bills")
      .update({ status: newStatus, ...stamps }).eq("id", billId);
    if (error) { alert("状态更新失败: " + error.message); return; }
    await reload();
  };

  if (loading) return <div style={{ padding: 24 }}>加载中...</div>;
  if (!bill) return <div style={{ padding: 24 }}>账单不存在</div>;

  const itemMap = {};
  chargeItems.forEach(it => { itemMap[it.id] = it; });

  const STATUS_MAP = {
    draft:  { text: "草稿",   color: "#8c8c8c", bg: "#f5f5f5" },
    issued: { text: "已开票", color: "#1890ff", bg: "#e6f7ff" },
    paid:   { text: "已结算", color: "#389e0d", bg: "#f6ffed" },
    void:   { text: "已作废", color: "#cf1322", bg: "#fff1f0" },
  };
  const statusLabel = STATUS_MAP[bill.status] || { text: bill.status, color: "#000", bg: "#fff" };

  const btn = {
    padding: "5px 14px", background: "#fff",
    border: "1px solid #d9d9d9", borderRadius: 3,
    fontSize: 12, cursor: "pointer",
  };
  const btnPrimary = { ...btn, background: "#1890ff", color: "#fff", border: "1px solid #1890ff" };
  const btnDanger  = { ...btn, background: "#ff4d4f", color: "#fff", border: "1px solid #ff4d4f" };

  return (
    <div style={{ padding: 16, maxWidth: 1200, margin: "0 auto", fontFamily: "'Segoe UI','Microsoft YaHei',sans-serif" }}>
      {/* 头部 */}
      <div style={{ display:"flex", alignItems:"center", gap: 12, marginBottom: 16 }}>
        <button onClick={onBack} style={btn}>← 返回</button>
        <h2 style={{ margin: 0, fontSize: 18 }}>
          账单 <span style={{ fontFamily: "'Consolas',monospace" }}>{bill.bill_no}</span>
          <span style={{
            marginLeft: 12, padding: "2px 8px", fontSize: 12, borderRadius: 3,
            color: statusLabel.color, background: statusLabel.bg
          }}>{statusLabel.text}</span>
          <span style={{
            marginLeft: 8, padding: "2px 8px", fontSize: 12, borderRadius: 3,
            color: bill.direction === "AR" ? "#1890ff" : "#fa8c16",
            background: bill.direction === "AR" ? "#e6f7ff" : "#fff7e6"
          }}>{bill.direction === "AR" ? "应收" : "应付"}</span>
        </h2>
        <div style={{ flex: 1 }} />

        {bill.status === "draft" && (
          <>
            <button onClick={() => updateStatus("issued")} style={btnPrimary}>开票</button>
            <button onClick={() => updateStatus("void")} style={btnDanger}>作废</button>
          </>
        )}
        {bill.status === "issued" && (
          <>
            <button onClick={() => updateStatus("paid")} style={btnPrimary}>标记已结算</button>
            <button onClick={() => updateStatus("draft")} style={btn}>撤回草稿</button>
          </>
        )}
        {bill.status === "paid" && (
          <button onClick={() => updateStatus("issued")} style={btn}>撤销结算</button>
        )}
      </div>

      {/* 基本信息 */}
      <div style={{
        display:"grid", gridTemplateColumns:"repeat(4, 1fr)", gap: 12,
        padding: 16, background:"#fafafa", borderRadius: 4, marginBottom: 16, fontSize: 13
      }}>
        <Field label="账单号" value={bill.bill_no} mono />
        <Field label="作业号" value={shipment?.order_no} mono />
        <Field label="结算单位" value={`${partner?.code || ""} ${partner?.name || ""}`} />
        <Field label="方向" value={bill.direction === "AR" ? "应收（来自客户）" : "应付（给供应商）"} />
        <Field label="币种" value={bill.currency} />
        <Field label="原币总额" value={Number(bill.amount_total).toFixed(2)} mono />
        <Field label="折 CNY" value={"¥ " + Number(bill.amount_cny).toFixed(2)} mono />
        <Field label="创建时间" value={new Date(bill.created_at).toLocaleString("zh-CN")} />
        {bill.issued_at && <Field label="开票时间" value={new Date(bill.issued_at).toLocaleString("zh-CN")} />}
        {bill.paid_at &&   <Field label="结算时间" value={new Date(bill.paid_at).toLocaleString("zh-CN")} />}
      </div>

      {/* 费用明细 */}
      <div style={{ border: "1px solid #f0f0f0", borderRadius: 4 }}>
        <div style={{ padding: "8px 12px", background:"#fafafa", fontWeight: 600, fontSize: 13 }}>
          费用明细（{charges.length} 项）
        </div>
        <table style={{ width: "100%", fontSize: 12, borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background:"#fff" }}>
              <th style={{ padding: 8, textAlign:"left" }}>费用名称</th>
              <th style={{ padding: 8 }}>计费单位</th>
              <th style={{ padding: 8 }}>数量</th>
              <th style={{ padding: 8 }}>币种</th>
              <th style={{ padding: 8 }}>汇率</th>
              <th style={{ padding: 8, textAlign:"right" }}>单价</th>
              <th style={{ padding: 8, textAlign:"right" }}>税率%</th>
              <th style={{ padding: 8, textAlign:"right" }}>原币总价</th>
              <th style={{ padding: 8, textAlign:"right" }}>折 CNY</th>
              <th style={{ padding: 8 }}>备注</th>
            </tr>
          </thead>
          <tbody>
            {charges.map(c => {
              const it = itemMap[c.charge_item_id];
              return (
                <tr key={c.id} style={{ borderTop: "1px solid #f0f0f0" }}>
                  <td style={{ padding: 8 }}>{it ? `${it.code} ${it.name_zh}` : "—"}</td>
                  <td style={{ padding: 8, textAlign:"center" }}>{c.unit}</td>
                  <td style={{ padding: 8, textAlign:"center" }}>{c.quantity}</td>
                  <td style={{ padding: 8, textAlign:"center" }}>{c.currency}</td>
                  <td style={{ padding: 8, textAlign:"center" }}>{Number(c.exchange_rate).toFixed(4)}</td>
                  <td style={{ padding: 8, textAlign:"right", fontFamily:"'Consolas',monospace" }}>{Number(c.unit_price).toFixed(2)}</td>
                  <td style={{ padding: 8, textAlign:"right" }}>{c.tax_rate || 0}</td>
                  <td style={{ padding: 8, textAlign:"right", fontFamily:"'Consolas',monospace" }}>{Number(c.amount_total).toFixed(2)}</td>
                  <td style={{ padding: 8, textAlign:"right", fontFamily:"'Consolas',monospace", color:"#1890ff", fontWeight: 600 }}>
                    {Number(c.amount_cny).toFixed(2)}
                  </td>
                  <td style={{ padding: 8, color:"#999" }}>{c.remark || "—"}</td>
                </tr>
              );
            })}
            {charges.length === 0 && (
              <tr><td colSpan={10} style={{ padding: 24, textAlign:"center", color:"#999" }}>无费用</td></tr>
            )}
          </tbody>
          <tfoot>
            <tr style={{ background:"#fafafa", fontWeight: 600 }}>
              <td colSpan={8} style={{ padding: 8, textAlign:"right" }}>合计 (CNY)：</td>
              <td style={{ padding: 8, textAlign:"right", fontFamily:"'Consolas',monospace", color:"#1890ff" }}>
                {Number(bill.amount_cny).toFixed(2)}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function Field({ label, value, mono, link }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "#999", marginBottom: 2 }}>{label}</div>
      <div style={{ fontFamily: mono ? "'Consolas',monospace" : "inherit", fontSize: 13 }}>
        {link ? <a href={link} style={{ color: "#1890ff" }}>{value || "—"}</a> : (value || "—")}
      </div>
    </div>
  );
}
