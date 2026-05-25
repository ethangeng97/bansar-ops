// ============================================================================
// StatementNew.jsx — 新建对账单
// 路由：#/statements/new?direction=AR (or AP)
// 流程：
//   1. 选 direction (AR/AP) - URL 参数已带，但页面 Tab 也可切
//   2. 选 partner（客户/供应商）
//   3. 选完后自动列出该 partner 所有 statement_id IS NULL 的同 direction bills
//   4. 勾选合并 → 校验同币别 → 调 RPC create_statement_from_bills
//   5. 创建成功 → 跳转 #/statements/:id 看详情
// ============================================================================

import { useEffect, useState } from "react";
import { supabase } from "../supabase.js";

const BRAND = "#1f3864";

export default function StatementNew({ initialDirection, onBack }) {
  // URL: #/statements/new?direction=AR
  const initDir = initialDirection
    || new URLSearchParams(window.location.hash.split("?")[1] || "").get("direction")
    || "AR";

  const [direction, setDirection] = useState(initDir);
  const [partners, setPartners] = useState([]);
  const [partnerId, setPartnerId] = useState("");
  const [bills, setBills] = useState([]);
  const [shipMap, setShipMap] = useState({}); // ship_id => shipment
  const [selected, setSelected] = useState(new Set());
  const [form, setForm] = useState({
    period_from: defaultPeriodFrom(),
    period_to: defaultPeriodTo(),
    due_date: defaultDueDate(),
    notes: "",
  });
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // 加载客商列表
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("customers")
        .select("id, name, partner_type")
        .order("name");
      setPartners(data || []);
    })();
  }, []);

  // 选择 partner 后加载该 partner 的可合并 bills
  useEffect(() => {
    if (!partnerId) { setBills([]); setSelected(new Set()); return; }
    (async () => {
      setLoading(true);
      // 该 partner 所有 direction = AR/AP 且 statement_id IS NULL 的 bills
      const { data: bs, error } = await supabase.from("bills")
        .select("*")
        .eq("partner_id", partnerId)
        .eq("direction", direction)
        .is("statement_id", null)
        .order("created_at", { ascending: false });
      if (error) { alert("加载失败: " + error.message); setLoading(false); return; }
      setBills(bs || []);
      setSelected(new Set());

      // 加载关联 shipments 简要
      const shipIds = [...new Set((bs || []).map(b => b.shipment_id).filter(Boolean))];
      if (shipIds.length > 0) {
        const { data: ships } = await supabase.from("shipments")
          .select("id, order_no, mbl_no, hbl_no, pol, pod, etd")
          .in("id", shipIds);
        const m = {};
        (ships || []).forEach(s => { m[s.id] = s; });
        setShipMap(m);
      }
      setLoading(false);
    })();
  }, [partnerId, direction]);

  const toggle = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };
  const toggleAll = () => {
    if (selected.size === bills.length) setSelected(new Set());
    else setSelected(new Set(bills.map(b => b.id)));
  };

  // 校验：所选 bills 必须同币别
  const selectedBills = bills.filter(b => selected.has(b.id));
  const currencies = [...new Set(selectedBills.map(b => b.currency))];
  const currency = currencies[0] || "—";
  const total = selectedBills.reduce((sum, b) => sum + Number(b.amount_total || 0), 0);

  const submit = async () => {
    if (!partnerId) { alert("请选择" + (direction === "AR" ? "客户" : "供应商")); return; }
    if (selectedBills.length === 0) { alert("请勾选要合并的账单"); return; }
    if (currencies.length > 1) { alert("所选账单币别不一致，无法合并"); return; }
    if (!form.period_from || !form.period_to) { alert("请填写账期"); return; }

    setSubmitting(true);
    const { data: stmtId, error } = await supabase.rpc("create_statement_from_bills", {
      p_bill_ids:    selectedBills.map(b => b.id),
      p_period_from: form.period_from,
      p_period_to:   form.period_to,
      p_due_date:    form.due_date || null,
      p_issued_by:   null,  // 留给后续接 user.email
      p_notes:       form.notes || null,
    });
    setSubmitting(false);
    if (error) { alert("创建失败: " + error.message); return; }

    alert(`对账单创建成功！(ID: ${stmtId})`);
    window.location.hash = `#/statements/${stmtId}`;
  };

  // partner 类型筛选：AR 默认显示客户类型，AP 默认显示其他
  const filteredPartners = partners.filter(p => {
    if (direction === "AR") return p.partner_type === "客户";
    return p.partner_type !== "客户"; // 供应商/船东/海外代理/车队/报关行/仓库
  });

  return (
    <>
      <h1 className="page-title">新建{direction === "AR" ? "应收" : "应付"}对账单</h1>

      <div style={{ display: "flex", borderBottom: "1px solid var(--shell-border)", marginBottom: 12 }}>
        {[["AR", "应收（发客户）"], ["AP", "应付（核对供应商）"]].map(([key, label]) => {
          const active = direction === key;
          return (
            <button key={key} onClick={() => { setDirection(key); setPartnerId(""); }} style={{
              padding: "8px 18px", border: "none", background: "transparent", cursor: "pointer", fontSize: 13,
              color: active ? "var(--shell-primary)" : "var(--shell-text-2)",
              fontWeight: active ? 600 : 400,
              borderBottom: active ? "2px solid var(--shell-primary)" : "2px solid transparent",
              marginBottom: -1,
            }}>{label}</button>
          );
        })}
      </div>

      <div className="page-card">

        {/* 表单 */}
        <div style={{ background: "#f5f8fc", border: "1px solid #cdd9ec", padding: 12, marginBottom: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr 1fr", gap: "10px 16px", fontSize: 12 }}>
            <div>
              <label style={lbl}>{direction === "AR" ? "客户" : "供应商"} *</label>
              <select value={partnerId} onChange={e => setPartnerId(e.target.value)}
                      style={inp}>
                <option value="">请选择...</option>
                {filteredPartners.map(p => (
                  <option key={p.id} value={p.id}>{p.name} ({p.partner_type})</option>
                ))}
              </select>
            </div>
            <div>
              <label style={lbl}>账期起 *</label>
              <input type="date" value={form.period_from}
                     onChange={e => setForm({...form, period_from: e.target.value})}
                     style={inp} />
            </div>
            <div>
              <label style={lbl}>账期止 *</label>
              <input type="date" value={form.period_to}
                     onChange={e => setForm({...form, period_to: e.target.value})}
                     style={inp} />
            </div>
            <div>
              <label style={lbl}>到期日</label>
              <input type="date" value={form.due_date}
                     onChange={e => setForm({...form, due_date: e.target.value})}
                     style={inp} />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              <label style={lbl}>备注</label>
              <input value={form.notes}
                     onChange={e => setForm({...form, notes: e.target.value})}
                     placeholder={direction === "AR" ? "如：4 月业务对账，请于 5 月底前付款" : "如：核对 4 月供应商账单"}
                     style={inp} />
            </div>
          </div>
        </div>

        {/* 账单列表 */}
        {!partnerId ? (
          <div style={{ padding: 40, textAlign: "center", color: "#999", background: "#fafafa", borderRadius: 4 }}>
            请先选择{direction === "AR" ? "客户" : "供应商"}
          </div>
        ) : loading ? (
          <div style={{ padding: 30, textAlign: "center", color: "#888" }}>加载中...</div>
        ) : (
          <>
            <div style={{ display: "flex", justifyContent: "space-between",
                          alignItems: "center", marginBottom: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>
                可合并的账单
                <span style={{ marginLeft: 8, color: "#888", fontWeight: 400, fontSize: 11 }}>
                  （仅显示尚未关联对账单的 {direction} 账单）
                </span>
              </div>
              <div style={{ fontSize: 12, color: "#888" }}>
                已选 <b style={{ color: "#1990ff" }}>{selectedBills.length}</b> 票 ·
                合计 <b style={{ color: "#c00", fontFamily: "Consolas,monospace" }}>
                  {currency} {total.toFixed(2)}
                </b>
                {currencies.length > 1 && (
                  <span style={{ marginLeft: 8, color: "#c00", fontWeight: 600 }}>⚠ 币别不一致</span>
                )}
              </div>
            </div>

            {bills.length === 0 ? (
              <div style={{ padding: 40, textAlign: "center", color: "#999",
                            background: "#fafafa", borderRadius: 4 }}>
                该{direction === "AR" ? "客户" : "供应商"}暂无未关联对账单的{direction}账单
              </div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "#fafafa", color: "#444" }}>
                    <th style={{ ...th, width: 36, textAlign: "center" }}>
                      <input type="checkbox"
                             checked={selected.size === bills.length && bills.length > 0}
                             onChange={toggleAll} />
                    </th>
                    <th style={th}>账单号</th>
                    <th style={th}>关联订单</th>
                    <th style={th}>主单号</th>
                    <th style={th}>航线</th>
                    <th style={th}>ETD</th>
                    <th style={{ ...th, textAlign: "right" }}>金额</th>
                  </tr>
                </thead>
                <tbody>
                  {bills.map(b => {
                    const ship = shipMap[b.shipment_id] || {};
                    const isSel = selected.has(b.id);
                    return (
                      <tr key={b.id}
                          onClick={() => toggle(b.id)}
                          style={{ background: isSel ? "#e6f4ff" : "#fff",
                                    cursor: "pointer", borderBottom: "1px solid #f5f5f5" }}>
                        <td style={{ ...td, textAlign: "center" }}>
                          <input type="checkbox" checked={isSel} onChange={() => toggle(b.id)} />
                        </td>
                        <td style={{ ...td, fontFamily: "Consolas,monospace", color: BRAND }}>
                          {b.bill_no}
                        </td>
                        <td style={td}>{ship.order_no || "—"}</td>
                        <td style={td}>{ship.mbl_no || "—"}</td>
                        <td style={td}>{ship.pol || "—"} → {ship.pod || "—"}</td>
                        <td style={td}>{ship.etd ? formatDate(ship.etd) : "—"}</td>
                        <td style={{ ...td, textAlign: "right", fontFamily: "Consolas,monospace", fontWeight: 700 }}>
                          {b.currency} {Number(b.amount_total).toFixed(2)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </>
        )}

        {/* 底部按钮 */}
        <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid #f0f0f0",
                      display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onBack || (() => { window.location.hash = "#/statements"; })}
                  style={btn}>取消</button>
          <button onClick={submit}
                  disabled={submitting || selectedBills.length === 0 || currencies.length > 1}
                  className="btn primary">
            {submitting ? "创建中..." : "创建对账单 →"}
          </button>
        </div>
      </div>
    </>
  );
}

function defaultPeriodFrom() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2, "0")}-01`;
}
function defaultPeriodTo() {
  const d = new Date();
  // 当月最后一天
  const last = new Date(d.getFullYear(), d.getMonth()+1, 0);
  return `${last.getFullYear()}-${String(last.getMonth()+1).padStart(2, "0")}-${String(last.getDate()).padStart(2, "0")}`;
}
function defaultDueDate() {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function formatDate(d) {
  if (!d) return "—";
  const date = new Date(d);
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const lbl = { display: "block", color: "#666", marginBottom: 4, fontSize: 11 };
const inp = { width: "100%", padding: "5px 8px", border: "1px solid #d9d9d9",
               borderRadius: 3, fontSize: 12, boxSizing: "border-box" };
const th  = { padding: 7, textAlign: "left", borderBottom: "1px solid #e8e8e8", fontWeight: 600 };
const td  = { padding: 7 };
const btn = { padding: "6px 16px", background: "#fff", border: "1px solid #d9d9d9",
               borderRadius: 3, fontSize: 13, cursor: "pointer" };
const btnPrimary = { ...btn, background: "#1990ff", color: "#fff", border: "1px solid #1990ff",
                      fontWeight: 600 };
