// ============================================================================
// StatementDetail.jsx — 对账单详情（明细列表）
// 路由：#/statements/:id
// 功能：
//   - 顶部：对账单号 / 客户 / 账期 / 总额 / 状态徽章 + 操作按钮
//   - 主体：关联 bills 列表（含提单号、费用项数、原币/折CNY、已核销、状态）
//   - 底部：合计行
//   - 操作：查看 PDF / 标已收 / 解绑 / 单条解绑 / 编辑（v2）
// 视觉风格与 BillsList / BillDetail 统一
// ============================================================================

import { useEffect, useState } from "react";
import { supabase } from "../supabase.js";

const BRAND = "#1f3864";

const STATUS_LABELS = {
  unsettled: { label: "未核销",   color: "#fa8c16", bg: "#fff7e6" },
  partial:   { label: "部分核销", color: "#1990ff", bg: "#e6f7ff" },
  settled:   { label: "已核销",   color: "#52c41a", bg: "#f6ffed" },
  void:      { label: "已作废",   color: "#999",    bg: "#f5f5f5" },
};

const formatDate = (d) => {
  if (!d) return "—";
  const date = new Date(d);
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const formatDateTime = (d) => {
  if (!d) return "—";
  const date = new Date(d);
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};

export default function StatementDetail({ statementId, onBack }) {
  const [stmt, setStmt] = useState(null);
  const [bills, setBills] = useState([]);
  const [shipMap, setShipMap] = useState({});
  const [chargeCountMap, setChargeCountMap] = useState({}); // bill_id => 费用项数
  const [partner, setPartner] = useState(null);
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    setLoading(true);
    // 1. 对账单本体
    const { data: s, error } = await supabase
      .from("statements").select("*").eq("id", statementId).single();
    if (error) { alert("加载失败: " + error.message); setLoading(false); return; }
    setStmt(s);

    // 2. partner（如有 partner_id 才查）
    if (s.partner_id) {
      const { data: p } = await supabase.from("customers")
        .select("*").eq("id", s.partner_id).single();
      setPartner(p);
    } else {
      setPartner(null);
    }

    // 3. 关联 bills
    const { data: bs } = await supabase
      .from("bills").select("*")
      .eq("statement_id", statementId)
      .order("created_at", { ascending: true });
    const billRows = bs || [];
    setBills(billRows);

    // 4. 关联 shipments（一次拿）
    const shipIds = [...new Set(billRows.map(b => b.shipment_id).filter(Boolean))];
    if (shipIds.length > 0) {
      const { data: ss } = await supabase.from("shipments")
        .select("id, order_no, booking_no, hbl_no, mbl_no").in("id", shipIds);
      const m = {}; (ss || []).forEach(x => { m[x.id] = x; });
      setShipMap(m);
    } else {
      setShipMap({});
    }

    // 5. 每张 bill 下的 charges 数（轻量：只取 id）
    const billIds = billRows.map(b => b.id);
    if (billIds.length > 0) {
      const { data: chs } = await supabase.from("charges")
        .select("id, bill_id").in("bill_id", billIds);
      const cm = {};
      (chs || []).forEach(c => { cm[c.bill_id] = (cm[c.bill_id] || 0) + 1; });
      setChargeCountMap(cm);
    } else {
      setChargeCountMap({});
    }

    setLoading(false);
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [statementId]);

  // 标记结清（手动改 status，不走核销 RPC——对账单整体状态用于提示）
  const markSettled = async () => {
    if (!confirm(`确认将本对账单标记为已${stmt.direction === "AP" ? "付" : "收"}？\n（此操作只改对账单状态标签，不影响下方 bills 的核销记录）`)) return;
    const { error } = await supabase.rpc("update_statement_status", {
      p_stmt_id: Number(statementId),
      p_status: "settled",
    });
    if (error) { alert("更新失败: " + error.message); return; }
    await reload();
  };

  // 撤销结清
  const markUnsettled = async () => {
    const { error } = await supabase.rpc("update_statement_status", {
      p_stmt_id: Number(statementId),
      p_status: "unsettled",
    });
    if (error) { alert("更新失败: " + error.message); return; }
    await reload();
  };

  // 解绑全部 bills
  const unbindAll = async () => {
    if (!confirm(`确认解绑全部 ${bills.length} 张账单？\n解绑后这些账单将不再属于本对账单，本对账单将被作废。`)) return;
    const { error } = await supabase.rpc("unbind_bills_from_statement", {
      p_stmt_id: Number(statementId),
    });
    if (error) { alert("解绑失败: " + error.message); return; }
    alert("已解绑全部账单，本对账单已作废");
    onBack?.();
  };

  // 申请开票：对本对账单下的应收账单整单提交开票申请
  const requestInvoice = async () => {
    const arBills = bills.filter(b => b.direction === "AR" && b.status !== "void");
    if (arBills.length === 0) { alert("本对账单下无可申请开票的应收账单"); return; }
    const note = prompt(`为本对账单 ${arBills.length} 张应收账单提交开票申请\n开票抬头/备注（可选）：`, "");
    if (note === null) return;
    const { error } = await supabase.rpc("create_invoice_request", {
      p_bill_ids: arBills.map(b => b.id), p_note: note || null,
    });
    if (error) { alert("申请失败：" + error.message); return; }
    alert("✓ 已提交开票申请，可在财务模块「开票申请」中查看处理进度");
    await reload();
  };

  // 单条解绑（直接清 bill.statement_id）
  const unbindOne = async (bill) => {
    if (!confirm(`确认从对账单中移除账单 ${bill.bill_no}？`)) return;
    const { error } = await supabase.from("bills")
      .update({ statement_id: null }).eq("id", bill.id);
    if (error) { alert("解绑失败: " + error.message); return; }
    await reload();
  };

  if (loading) return <div style={{ padding: 30, textAlign: "center", color: "#888" }}>加载中...</div>;
  if (!stmt)   return <div style={{ padding: 30, textAlign: "center", color: "#999" }}>对账单不存在</div>;

  const st = STATUS_LABELS[stmt.status] || { label: stmt.status, color: "#000", bg: "#fff" };
  const directionLabel = stmt.direction === "AR" ? "应收 (AR)" : "应付 (AP)";

  // 合计
  const totalAmount = bills.reduce((sum, b) => sum + Number(b.amount_total || 0), 0);
  const totalSettled = bills.reduce((sum, b) => sum + Number(b.settled_amount || 0), 0);
  const totalRemain = totalAmount - totalSettled;
  const totalCny = bills.reduce((sum, b) => sum + Number(b.amount_cny || 0), 0);

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
            <span style={{ fontSize: 16, fontWeight: 700 }}>对账单详情</span>
            <span style={{ fontFamily: "Consolas,monospace", color: BRAND, fontWeight: 600, fontSize: 14 }}>
              {stmt.statement_no}
            </span>
            <span style={{
              padding: "2px 10px", fontSize: 11, borderRadius: 3,
              color: stmt.direction === "AR" ? "#1990ff" : "#fa8c16",
              background: stmt.direction === "AR" ? "#e6f7ff" : "#fff7e6",
              border: `1px solid ${stmt.direction === "AR" ? "#91d5ff" : "#ffd591"}`,
            }}>{directionLabel}</span>
            <span style={{
              padding: "2px 10px", fontSize: 11, borderRadius: 3,
              color: st.color, background: st.bg,
            }}>{st.label}</span>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <a href={`#/docs/stmt_batch/${statementId}`} target="_blank" rel="noreferrer"
               style={{ ...btn, textDecoration: "none", display: "inline-block" }}>
              查看 PDF
            </a>
            {stmt.direction === "AR" && stmt.status !== "void" && (
              <button onClick={requestInvoice}
                      style={{ ...btnPrimary, background: "#fa8c16", border: "1px solid #fa8c16" }}>
                申请开票
              </button>
            )}
            {stmt.status !== "settled" && stmt.status !== "void" && (
              <button onClick={markSettled} style={btnPrimary}>
                标{stmt.direction === "AP" ? "已付" : "已收"}
              </button>
            )}
            {stmt.status === "settled" && (
              <button onClick={markUnsettled} style={btn}>撤销结清</button>
            )}
            {stmt.status !== "void" && (
              <button onClick={unbindAll} style={btnDanger}>解绑全部</button>
            )}
          </div>
        </div>

        {/* 基本信息 */}
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14,
          padding: 14, background: "#fafafa", borderRadius: 3, marginBottom: 14, fontSize: 12,
          border: "1px solid #f0f0f0",
        }}>
          <Field label="对账单号" value={stmt.statement_no} mono />
          <Field label="结算单位" value={`${partner?.code || ""} ${stmt.partner_name || partner?.name || "—"}`} />
          <Field label="方向" value={directionLabel} />
          <Field label="币种" value={stmt.currency || "CNY"} />
          <Field label="账期起" value={stmt.period_from ? formatDate(stmt.period_from) : "—"} mono />
          <Field label="账期止" value={stmt.period_to ? formatDate(stmt.period_to) : "—"} mono />
          <Field label="到期日" value={stmt.due_date ? formatDate(stmt.due_date) : "—"} mono />
          <Field label="开单人" value={stmt.issued_by || "—"} />
          <Field label="原币总额"
                 value={`${stmt.currency || "CNY"} ${Number(stmt.amount_total || 0).toFixed(2)}`}
                 mono valueColor="#1990ff" valueBold />
          <Field label="账单数" value={`${bills.length} 张`} />
          <Field label="创建时间" value={formatDateTime(stmt.created_at)} />
          <Field label="备注" value={stmt.notes || "—"} />
        </div>

        {/* 账单列表 */}
        <div style={{ border: "1px solid #f0f0f0", borderRadius: 3 }}>
          <div style={{ padding: "8px 12px", background: "#fafafa", fontWeight: 600, fontSize: 12,
                         borderBottom: "1px solid #f0f0f0",
                         display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>关联账单 <span style={{ color: "#888", fontWeight: 400 }}>共 {bills.length} 张</span></span>
          </div>
          <table style={{ width: "100%", fontSize: 11.5, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#fff", color: "#444" }}>
                <th style={th}>账单编号</th>
                <th style={th}>作业号</th>
                <th style={th}>提单号</th>
                <th style={{ ...th, textAlign: "center" }}>费用项</th>
                <th style={th}>发票号</th>
                <th style={{ ...th, textAlign: "right" }}>原币 / 金额</th>
                <th style={{ ...th, textAlign: "right" }}>折 CNY</th>
                <th style={{ ...th, textAlign: "right" }}>已核销</th>
                <th style={{ ...th, textAlign: "right" }}>未核销</th>
                <th style={{ ...th, textAlign: "center" }}>状态</th>
                <th style={{ ...th, textAlign: "center" }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {bills.map(b => {
                const ship = shipMap[b.shipment_id];
                const total = Number(b.amount_total || 0);
                const settled = Number(b.settled_amount || 0);
                const remain = total - settled;
                const billSt = STATUS_LABELS[b.status] || STATUS_LABELS.unsettled;
                const mbl = ship ? ((ship.mbl_no || "").trim() || (ship.booking_no || "").trim()) : "";
                const hbl = ship ? (ship.hbl_no || "").trim() : "";
                return (
                  <tr key={b.id} style={{ borderTop: "1px solid #f5f5f5" }}>
                    <td style={{ ...td, fontFamily: "Consolas,monospace", color: BRAND, fontWeight: 600 }}>
                      <a href={`#/bills/${b.id}`} target="_blank" rel="noreferrer"
                         style={{ color: "inherit", textDecoration: "none" }}>{b.bill_no}</a>
                    </td>
                    <td style={{ ...td, fontFamily: "Consolas,monospace" }}>
                      {ship ? <a href={`#/sea_export?id=${ship.id}`} target="_blank" rel="noreferrer"
                                  style={{ color: "#1990ff", textDecoration: "none" }}>
                        {ship.order_no}
                      </a> : <span style={{ color: "#bbb" }}>—</span>}
                    </td>
                    <td style={{ ...td, fontFamily: "Consolas,monospace" }}>
                      <div style={{ color: "#444" }}>{mbl || <span style={{ color: "#bbb" }}>—</span>}</div>
                      {hbl && <div style={{ color: "#888", fontSize: 10 }}>HBL: {hbl}</div>}
                    </td>
                    <td style={{ ...td, textAlign: "center", color: "#666" }}>
                      {chargeCountMap[b.id] || 0} 项
                    </td>
                    <td style={{ ...td, fontFamily: "Consolas,monospace" }}>
                      {b.invoice_no || <span style={{ color: "#bbb", fontStyle: "italic" }}>未开</span>}
                    </td>
                    <td style={{ ...td, textAlign: "right", fontFamily: "Consolas,monospace", fontWeight: 700 }}>
                      {b.currency} {total.toFixed(2)}
                    </td>
                    <td style={{ ...td, textAlign: "right", fontFamily: "Consolas,monospace", color: "#1990ff" }}>
                      {Number(b.amount_cny || 0).toFixed(2)}
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
                                      background: billSt.bg, color: billSt.color,
                                      borderRadius: 3, fontSize: 11 }}>
                        {billSt.label}
                      </span>
                    </td>
                    <td style={{ ...td, textAlign: "center" }}>
                      {stmt.status !== "void" && (
                        <a onClick={() => unbindOne(b)}
                           style={{ color: "#fa541c", cursor: "pointer", fontSize: 11 }}>移除</a>
                      )}
                    </td>
                  </tr>
                );
              })}
              {bills.length === 0 && (
                <tr><td colSpan={11} style={{ padding: 30, textAlign: "center", color: "#999" }}>
                  本对账单下无关联账单
                </td></tr>
              )}
            </tbody>
            {bills.length > 0 && (
              <tfoot>
                <tr style={{ background: "#fafafa", fontWeight: 600, borderTop: "1px solid #e8e8e8" }}>
                  <td colSpan={5} style={{ ...td, textAlign: "right" }}>合计：</td>
                  <td style={{ ...td, textAlign: "right", fontFamily: "Consolas,monospace" }}>
                    {stmt.currency || "CNY"} {totalAmount.toFixed(2)}
                  </td>
                  <td style={{ ...td, textAlign: "right", fontFamily: "Consolas,monospace", color: "#1990ff" }}>
                    {totalCny.toFixed(2)}
                  </td>
                  <td style={{ ...td, textAlign: "right", fontFamily: "Consolas,monospace", color: "#52c41a" }}>
                    {totalSettled.toFixed(2)}
                  </td>
                  <td style={{ ...td, textAlign: "right", fontFamily: "Consolas,monospace",
                                color: totalRemain > 0.01 ? "#c00" : "#999" }}>
                    {totalRemain.toFixed(2)}
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
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
