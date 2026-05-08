// ============================================================================
// StatementsList.jsx — 对账单管理列表
// 路由：#/statements
// 功能：
//   - Tab 切换：应收 (AR) / 应付 (AP)
//   - 搜索：对账单号 / 客户名 / 状态 / 期间
//   - 操作：查看 / 解绑（删 statement_id 让 bills 重回未关联）
//   - 多选 + 批量开票/收票：合规校验（同 partner / 同 currency / 同 direction）
//     调 issue_invoice RPC 给底层所有 bills 一次性写入发票号
//   - 视觉风格与 BillsList / BillDetail 统一
// ============================================================================

import { useEffect, useState } from "react";
import { supabase } from "../supabase.js";

const BRAND = "#1f3864";

const STATUS_LABELS = {
  unsettled: { label: "未核销",   color: "#666",    bg: "#f5f5f5" },
  partial:   { label: "部分核销", color: "#fa8c16", bg: "#fff7e6" },
  settled:   { label: "已收款",   color: "#52c41a", bg: "#f6ffed" },
  void:      { label: "作废",     color: "#888",    bg: "#fafafa" },
};
const STATUS_LABELS_AP = {
  unsettled: { label: "未核销",   color: "#666",    bg: "#f5f5f5" },
  partial:   { label: "部分核销", color: "#fa8c16", bg: "#fff7e6" },
  settled:   { label: "已付款",   color: "#52c41a", bg: "#f6ffed" },
  void:      { label: "作废",     color: "#888",    bg: "#fafafa" },
};

export default function StatementsList({ onBack }) {
  const [direction, setDirection] = useState("AR"); // AR / AP
  const [statements, setStatements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({
    keyword: "", status: "", date_from: "", date_to: "",
  });

  // 多选
  const [selected, setSelected] = useState(new Set());

  // 批量开票弹窗
  const [showInvoice, setShowInvoice] = useState(null); // { statements: [...] }

  const load = async () => {
    setLoading(true);
    let q = supabase.from("statements").select("*")
      .eq("direction", direction)
      .order("created_at", { ascending: false });

    if (filters.status) q = q.eq("status", filters.status);
    if (filters.date_from) q = q.gte("period_from", filters.date_from);
    if (filters.date_to)   q = q.lte("period_to", filters.date_to);

    const { data, error } = await q;
    if (error) { alert("加载失败: " + error.message); setLoading(false); return; }

    let rows = data || [];
    // 客户端过滤关键字
    if (filters.keyword) {
      const k = filters.keyword.toLowerCase();
      rows = rows.filter(r =>
        (r.statement_no || "").toLowerCase().includes(k) ||
        (r.partner_name || "").toLowerCase().includes(k)
      );
    }
    setStatements(rows);
    setSelected(new Set()); // 重新加载清空选择
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [direction]);

  const labels = direction === "AP" ? STATUS_LABELS_AP : STATUS_LABELS;

  const toggle = (id) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };
  const toggleAll = () => {
    if (selected.size === statements.length) setSelected(new Set());
    else setSelected(new Set(statements.map(s => s.id)));
  };

  const updateStatus = async (id, newStatus) => {
    if (!confirm(`确认将状态改为「${labels[newStatus].label}」?`)) return;
    const { error } = await supabase.rpc("update_statement_status", {
      p_stmt_id: id, p_status: newStatus
    });
    if (error) { alert("更新失败: " + error.message); return; }
    await load();
  };

  const unbindAll = async (stmt) => {
    if (!confirm(`确认解绑对账单「${stmt.statement_no}」?\n所有关联账单将重新回到未对账状态，对账单本身保留为草稿。`)) return;
    const { error: e1 } = await supabase.rpc("unbind_bills_from_statement", { p_stmt_id: stmt.id });
    if (e1) { alert("解绑失败: " + e1.message); return; }
    // 状态改为 void
    await supabase.rpc("update_statement_status", { p_stmt_id: stmt.id, p_status: "void" });
    await load();
  };

  // ── 批量开票/收票入口：校验同 partner / 同 currency / 同 direction ──
  const onBatchInvoice = () => {
    if (selected.size === 0) { alert("请先勾选对账单"); return; }
    const sel = statements.filter(s => selected.has(s.id));

    // 校验 1：必须同 partner
    const partnerIds = [...new Set(sel.map(s => s.partner_id))];
    if (partnerIds.length > 1) {
      alert("所选对账单分属不同客户/供应商，无法合并开同一张发票");
      return;
    }
    // 校验 2：必须同 currency
    const currencies = [...new Set(sel.map(s => s.currency || "CNY"))];
    if (currencies.length > 1) {
      alert(`所选对账单币种不一致 (${currencies.join(", ")})，无法合并开票`);
      return;
    }
    // 校验 3：作废的不能开
    const voided = sel.filter(s => s.status === "void");
    if (voided.length > 0) {
      alert(`所选含 ${voided.length} 张已作废对账单，请先取消勾选`);
      return;
    }
    // direction 由当前 tab 保证一致
    setShowInvoice({ statements: sel });
  };

  return (
    <div style={{ padding: 16, background: "#f0f2f5", minHeight: "100vh" }}>
      <div style={{ background: "#fff", borderRadius: 4, padding: 16,
                    boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
        {/* 顶部 */}
        <div style={{ display: "flex", justifyContent: "space-between",
                      alignItems: "center", marginBottom: 12, paddingBottom: 12,
                      borderBottom: "1px solid #f0f0f0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            {onBack && <button onClick={onBack} style={btn}>← 返回</button>}
            <span style={{ fontSize: 16, fontWeight: 700 }}>对账单管理</span>
            <span style={{ marginLeft: 4, color: "#888", fontSize: 12 }}>
              共 {statements.length} 个
              {selected.size > 0 && <> · 已选 <b style={{ color: "#1990ff" }}>{selected.size}</b> 个</>}
            </span>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={onBatchInvoice}
                    style={{ ...btnPrimary }}
                    disabled={selected.size === 0}>
              批量{direction === "AR" ? "开票" : "收票"}
            </button>
            <a href={`#/statements/new?direction=${direction}`}
               style={{ padding: "5px 14px", background: BRAND, color: "#fff",
                        textDecoration: "none", borderRadius: 3, fontWeight: 600,
                        fontSize: 12, display: "inline-block" }}>
              + 新建{direction === "AR" ? "应收" : "应付"}对账单
            </a>
          </div>
        </div>

        {/* Tab */}
        <div style={{ display: "flex", gap: 0, marginBottom: 14, borderBottom: "1px solid #e8e8e8" }}>
          {[["AR", "应收对账单"], ["AP", "应付对账单"]].map(([key, label]) => (
            <div key={key}
                 onClick={() => setDirection(key)}
                 style={{
                   padding: "10px 24px", cursor: "pointer",
                   color: direction === key ? BRAND : "#666",
                   fontWeight: direction === key ? 700 : 500,
                   borderBottom: direction === key ? `2px solid ${BRAND}` : "2px solid transparent",
                   marginBottom: -1,
                   fontSize: 13,
                 }}>
              {label}
            </div>
          ))}
        </div>

        {/* 筛选 */}
        <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center", fontSize: 12, flexWrap: "wrap" }}>
          <input placeholder={direction === "AP" ? "对账单号 / 供应商名" : "对账单号 / 客户名"}
                 value={filters.keyword}
                 onChange={e => setFilters({...filters, keyword: e.target.value})}
                 onKeyDown={e => e.key === "Enter" && load()}
                 style={{ flex: "0 0 220px", padding: "5px 8px", border: "1px solid #d9d9d9",
                          borderRadius: 3, fontSize: 12 }} />
          <select value={filters.status}
                  onChange={e => setFilters({...filters, status: e.target.value})}
                  style={{ padding: "5px 8px", border: "1px solid #d9d9d9", borderRadius: 3, fontSize: 12 }}>
            <option value="">全部状态</option>
            <option value="unsettled">未核销</option>
            <option value="partial">部分核销</option>
            <option value="settled">{direction === "AP" ? "已付款" : "已收款"}</option>
            <option value="void">作废</option>
          </select>
          <input type="date" value={filters.date_from}
                 onChange={e => setFilters({...filters, date_from: e.target.value})}
                 style={{ padding: "5px 8px", border: "1px solid #d9d9d9", borderRadius: 3, fontSize: 12 }} />
          <span>~</span>
          <input type="date" value={filters.date_to}
                 onChange={e => setFilters({...filters, date_to: e.target.value})}
                 style={{ padding: "5px 8px", border: "1px solid #d9d9d9", borderRadius: 3, fontSize: 12 }} />
          <button onClick={load} style={btn}>查询</button>
          <button onClick={() => { setFilters({keyword: "", status: "", date_from: "", date_to: ""}); setTimeout(load, 0); }}
                  style={btn}>重置</button>
        </div>

        {/* 列表 */}
        {loading ? (
          <div style={{ padding: 30, textAlign: "center", color: "#888" }}>加载中...</div>
        ) : statements.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "#999" }}>
            暂无{direction === "AR" ? "应收" : "应付"}对账单
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#fafafa", color: "#444" }}>
                <th style={{ ...th, width: 30, textAlign: "center" }}>
                  <input type="checkbox"
                         checked={selected.size === statements.length && statements.length > 0}
                         onChange={toggleAll} />
                </th>
                <th style={th}>对账单号</th>
                <th style={th}>{direction === "AR" ? "客户" : "供应商"}</th>
                <th style={th}>账期</th>
                <th style={{ ...th, textAlign: "right" }}>币别 / 金额</th>
                <th style={{ ...th, textAlign: "left" }}>到期日</th>
                <th style={{ ...th, textAlign: "center" }}>状态</th>
                <th style={{ ...th, textAlign: "center", minWidth: 160 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {statements.map(s => {
                const st = labels[s.status] || labels.unsettled;
                const isSel = selected.has(s.id);
                return (
                  <tr key={s.id}
                      style={{ background: isSel ? "#e6f4ff" : "#fff",
                                borderBottom: "1px solid #f5f5f5" }}>
                    <td style={{ ...td, textAlign: "center" }}>
                      <input type="checkbox" checked={isSel} onChange={() => toggle(s.id)} />
                    </td>
                    <td style={td}>
                      <a href={`#/statements/${s.id}`} target="_blank" rel="noreferrer"
                         style={{ color: BRAND, fontWeight: 600, fontFamily: "Consolas,monospace",
                                  textDecoration: "none" }}>
                        {s.statement_no}
                      </a>
                    </td>
                    <td style={td}>{s.partner_name}</td>
                    <td style={td}>
                      {s.period_from ? formatDate(s.period_from) : "—"} ~ {s.period_to ? formatDate(s.period_to) : "—"}
                    </td>
                    <td style={{ ...td, textAlign: "right", fontFamily: "Consolas,monospace", fontWeight: 700 }}>
                      {s.currency} {Number(s.amount_total).toFixed(2)}
                    </td>
                    <td style={td}>{s.due_date ? formatDate(s.due_date) : "—"}</td>
                    <td style={{ ...td, textAlign: "center" }}>
                      <span style={{ display: "inline-block", padding: "2px 8px",
                                      background: st.bg, color: st.color, borderRadius: 3, fontSize: 11 }}>
                        {st.label}
                      </span>
                    </td>
                    <td style={{ ...td, textAlign: "center" }}>
                      <a href={`#/statements/${s.id}`} target="_blank" rel="noreferrer"
                         style={{ color: "#1990ff", textDecoration: "none", marginRight: 8 }}>查看</a>
                      {s.status !== "settled" && s.status !== "void" && (
                        <a onClick={() => updateStatus(s.id, "settled")}
                           style={{ color: "#52c41a", cursor: "pointer", marginRight: 8 }}>
                          标{direction === "AP" ? "已付" : "已收"}
                        </a>
                      )}
                      {s.status !== "void" && (
                        <a onClick={() => unbindAll(s)}
                           style={{ color: "#ff4d4f", cursor: "pointer" }}>解绑</a>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* 批量开票弹窗 */}
      {showInvoice && (
        <BatchInvoiceDialog
          direction={direction}
          statements={showInvoice.statements}
          onClose={() => setShowInvoice(null)}
          onDone={() => { setShowInvoice(null); load(); }}
        />
      )}
    </div>
  );
}

// ── 批量开票/收票弹窗 ──
// 流程：
//   1. 拉出选中对账单下所有 bills（statement_id IN selected.ids）
//   2. 显示：客户、币种、张数、总额（自动算）、bill 列表
//   3. 用户输入 invoice_no + invoice_date
//   4. 调 issue_invoice RPC 把所有 bills.id 一次性挂上 invoice_no
function BatchInvoiceDialog({ direction, statements, onClose, onDone }) {
  const [bills, setBills] = useState([]);
  const [shipMap, setShipMap] = useState({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [invoiceNo, setInvoiceNo] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));

  const stmtIds = statements.map(s => s.id);
  const partner = statements[0]?.partner_name || "—";
  const currency = statements[0]?.currency || "CNY";

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data, error } = await supabase.from("bills")
        .select("id, bill_no, shipment_id, amount_total, amount_cny, currency, invoice_no, status, statement_id")
        .in("statement_id", stmtIds);
      if (error) { alert("加载关联账单失败: " + error.message); setLoading(false); return; }
      const billRows = data || [];
      setBills(billRows);

      const shipIds = [...new Set(billRows.map(b => b.shipment_id).filter(Boolean))];
      if (shipIds.length > 0) {
        const { data: ss } = await supabase.from("shipments")
          .select("id, order_no, booking_no, hbl_no, mbl_no").in("id", shipIds);
        const m = {}; (ss || []).forEach(x => { m[x.id] = x; });
        setShipMap(m);
      }
      setLoading(false);
    })();
    /* eslint-disable-next-line */
  }, []);

  const totalAmount = bills.reduce((sum, b) => sum + Number(b.amount_total || 0), 0);
  const alreadyInvoiced = bills.filter(b => b.invoice_no).length;
  const validBills = bills.filter(b => b.status !== "void");
  const validBillIds = validBills.map(b => b.id);

  const submit = async () => {
    if (!invoiceNo.trim()) { alert("请输入发票号"); return; }
    if (validBillIds.length === 0) { alert("无可开票账单"); return; }

    if (alreadyInvoiced > 0) {
      if (!confirm(`所选账单中有 ${alreadyInvoiced} 张已有发票号，将被覆盖。继续？`)) return;
    }
    setSubmitting(true);
    const { error } = await supabase.rpc("issue_invoice", {
      p_bill_ids: validBillIds,
      p_invoice_no: invoiceNo.trim(),
      p_invoice_date: invoiceDate + "T00:00:00",
    });
    setSubmitting(false);
    if (error) { alert("开票失败: " + error.message); return; }
    alert(`✓ 已${direction === "AR" ? "开票" : "收票"} ${validBillIds.length} 张账单，发票号 ${invoiceNo.trim()}`);
    onDone();
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  zIndex: 100 }}>
      <div style={{ background: "#fff", borderRadius: 4, width: 720, maxWidth: "95vw",
                    maxHeight: "90vh", display: "flex", flexDirection: "column",
                    boxShadow: "0 4px 16px rgba(0,0,0,0.2)" }}>
        {/* 头部 */}
        <div style={{ padding: 16, borderBottom: "1px solid #f0f0f0",
                      display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 14, fontWeight: 700 }}>
            批量{direction === "AR" ? "开票" : "收票"}
          </span>
          <a onClick={onClose} style={{ cursor: "pointer", color: "#999" }}>×</a>
        </div>

        {/* 信息汇总 */}
        <div style={{ padding: 16, background: "#fafafa", borderBottom: "1px solid #f0f0f0",
                       fontSize: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
            <Field label={direction === "AR" ? "客户" : "供应商"} value={partner} />
            <Field label="对账单数" value={`${statements.length} 张`} />
            <Field label="币种" value={currency} mono />
            <Field label="开票总额"
                   value={`${currency} ${totalAmount.toFixed(2)}`}
                   mono valueColor="#1990ff" valueBold />
          </div>
          <div style={{ marginTop: 8, color: "#666" }}>
            将给 <b style={{ color: BRAND }}>{validBills.length}</b> 张底层账单写入同一个发票号
            {alreadyInvoiced > 0 && <span style={{ color: "#fa8c16" }}>
              （含 {alreadyInvoiced} 张已有发票号，将被覆盖）
            </span>}
          </div>
        </div>

        {/* 表单 */}
        <div style={{ padding: 16, borderBottom: "1px solid #f0f0f0" }}>
          <div style={{ display: "flex", gap: 12, fontSize: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ color: "#888", marginBottom: 4 }}>发票号 <span style={{ color: "#ff4d4f" }}>*</span></div>
              <input value={invoiceNo}
                     onChange={e => setInvoiceNo(e.target.value)}
                     placeholder="请输入发票号"
                     style={{ width: "100%", padding: "6px 10px", border: "1px solid #d9d9d9",
                              borderRadius: 3, fontSize: 12, fontFamily: "Consolas,monospace",
                              boxSizing: "border-box" }} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ color: "#888", marginBottom: 4 }}>开票日期</div>
              <input type="date" value={invoiceDate}
                     onChange={e => setInvoiceDate(e.target.value)}
                     style={{ width: "100%", padding: "6px 10px", border: "1px solid #d9d9d9",
                              borderRadius: 3, fontSize: 12, boxSizing: "border-box" }} />
            </div>
          </div>
        </div>

        {/* bills 列表 */}
        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
            涉及账单（{bills.length} 张）
          </div>
          {loading ? (
            <div style={{ padding: 20, textAlign: "center", color: "#888" }}>加载中...</div>
          ) : (
            <table style={{ width: "100%", fontSize: 11.5, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#fafafa", color: "#444" }}>
                  <th style={th}>账单号</th>
                  <th style={th}>提单号</th>
                  <th style={{ ...th, textAlign: "right" }}>金额</th>
                  <th style={th}>当前发票号</th>
                </tr>
              </thead>
              <tbody>
                {bills.map(b => {
                  const ship = shipMap[b.shipment_id];
                  const mbl = ship ? ((ship.mbl_no || "").trim() || (ship.booking_no || "").trim()) : "";
                  return (
                    <tr key={b.id} style={{ borderTop: "1px solid #f5f5f5",
                                             opacity: b.status === "void" ? 0.5 : 1 }}>
                      <td style={{ ...td, fontFamily: "Consolas,monospace", color: BRAND }}>
                        {b.bill_no}
                      </td>
                      <td style={{ ...td, fontFamily: "Consolas,monospace", color: "#444" }}>
                        {mbl || "—"}
                      </td>
                      <td style={{ ...td, textAlign: "right", fontFamily: "Consolas,monospace" }}>
                        {b.currency} {Number(b.amount_total).toFixed(2)}
                      </td>
                      <td style={{ ...td, fontFamily: "Consolas,monospace", color: "#888" }}>
                        {b.invoice_no || <span style={{ color: "#bbb", fontStyle: "italic" }}>未开</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* 底部按钮 */}
        <div style={{ padding: 12, borderTop: "1px solid #f0f0f0",
                      display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onClose} style={btn} disabled={submitting}>取消</button>
          <button onClick={submit} style={btnPrimary} disabled={submitting || loading}>
            {submitting ? "提交中..." : "确认" + (direction === "AR" ? "开票" : "收票")}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, mono, valueColor, valueBold }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "#888", marginBottom: 3 }}>{label}</div>
      <div style={{
        fontFamily: mono ? "Consolas,monospace" : "inherit",
        fontSize: 12.5,
        color: valueColor || "#222",
        fontWeight: valueBold ? 700 : 400,
      }}>{value || "—"}</div>
    </div>
  );
}

function formatDate(d) {
  if (!d) return "—";
  const date = new Date(d);
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const th = { padding: "7px 6px", textAlign: "left", borderBottom: "1px solid #e8e8e8", fontWeight: 600 };
const td = { padding: 6 };
const btn = { padding: "5px 14px", background: "#fff", border: "1px solid #d9d9d9",
              borderRadius: 3, fontSize: 12, cursor: "pointer" };
const btnPrimary = { ...btn, background: "#1990ff", color: "#fff", border: "1px solid #1990ff",
                     fontWeight: 600 };
