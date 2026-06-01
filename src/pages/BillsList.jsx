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
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showBatchMenu, setShowBatchMenu] = useState(false);
  const [filters, setFilters] = useState({
    keyword: "", direction: "", status: "", date_from: "", date_to: "",
    partner_id: "", source: "", currency: "",
    amount_min: "", amount_max: "",
    has_invoice: "", has_voucher: "",
  });
  const [partnerOptions, setPartnerOptions] = useState([]);

  const [showSettle, setShowSettle] = useState(null);
  const [showInvoice, setShowInvoice] = useState(null);
  const [showVoucher, setShowVoucher] = useState(null);

  const load = async () => {
    setLoading(true);
    let q = supabase.from("bills").select("*").order("created_at", { ascending: false });
    if (filters.direction) q = q.eq("direction", filters.direction);
    if (filters.status)    q = q.eq("status", filters.status);
    if (filters.partner_id) q = q.eq("partner_id", filters.partner_id);
    if (filters.source)    q = q.eq("source", filters.source);
    if (filters.currency)  q = q.eq("currency", filters.currency);
    if (filters.date_from) q = q.gte("created_at", filters.date_from);
    if (filters.date_to)   q = q.lte("created_at", filters.date_to + "T23:59:59");
    const { data, error } = await q;
    if (error) { alert("加载失败: " + error.message); setLoading(false); return; }

    let rows = data || [];
    // 金额范围
    if (filters.amount_min) rows = rows.filter(r => Number(r.amount_total || 0) >= Number(filters.amount_min));
    if (filters.amount_max) rows = rows.filter(r => Number(r.amount_total || 0) <= Number(filters.amount_max));
    // 是否已开票
    if (filters.has_invoice === "yes") rows = rows.filter(r => !!r.invoice_no);
    if (filters.has_invoice === "no")  rows = rows.filter(r => !r.invoice_no);
    // 是否填凭证号
    if (filters.has_voucher === "yes") rows = rows.filter(r => !!r.voucher_no);
    if (filters.has_voucher === "no")  rows = rows.filter(r => !r.voucher_no);

    // ── 先取 shipments 数据，因为 keyword 要参与提单号搜索 ──
    const partnerIds = [...new Set(rows.map(b => b.partner_id).filter(Boolean))];
    let pMap = {};
    if (partnerIds.length > 0) {
      const { data: ps } = await supabase.from("customers")
        .select("id, name").in("id", partnerIds);
      (ps || []).forEach(p => { pMap[p.id] = p.name; });
    }
    setPartnerMap(pMap);

    const shipIds = [...new Set(rows.map(b => b.shipment_id).filter(Boolean))];
    let sMap = {};
    if (shipIds.length > 0) {
      const { data: ss } = await supabase.from("shipments")
        .select("id, order_no, booking_no, hbl_no, mbl_no").in("id", shipIds);
      (ss || []).forEach(s => { sMap[s.id] = s; });
    }
    setShipMap(sMap);

    // ── keyword 过滤：覆盖账单号 / 发票号 / 凭证号 / 结算单位 / 作业号 / 提单号 / 分提单号 ──
    if (filters.keyword) {
      const k = filters.keyword.toLowerCase().trim();
      rows = rows.filter(r => {
        const ship = sMap[r.shipment_id];
        const bl = ship ? ((ship.mbl_no || "").trim() || (ship.booking_no || "").trim()) : "";
        return (
          (r.bill_no || "").toLowerCase().includes(k) ||
          (r.invoice_no || "").toLowerCase().includes(k) ||
          (r.partner_name || "").toLowerCase().includes(k) ||
          (r.voucher_no || "").toLowerCase().includes(k) ||
          (ship?.order_no || "").toLowerCase().includes(k) ||
          bl.toLowerCase().includes(k) ||
          (ship?.hbl_no || "").toLowerCase().includes(k)
        );
      });
    }

    setBills(rows);
    setLoading(false);
  };

  // 加载所有 partners 选项（用于筛选下拉）
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("customers")
        .select("id, name, partner_type").order("name");
      setPartnerOptions(data || []);
    })();
  }, []);

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
    setShowBatchMenu(false);
  };

  // 申请开票：仅应收、同客户、同币别 → create_invoice_request（走「开票申请」流程）
  const batchRequestInvoice = async () => {
    if (selected.size === 0) { alert("请先勾选要申请开票的账单"); return; }
    const sel = bills.filter(b => selected.has(b.id));
    if (sel.some(b => b.direction !== "AR")) { alert("只能对应收账单申请开票"); return; }
    if ([...new Set(sel.map(b => b.partner_id))].length > 1) { alert("所选账单分属不同客户，无法合并申请"); return; }
    if ([...new Set(sel.map(b => b.currency || "CNY"))].length > 1) { alert("所选账单币别不一致，请分别申请"); return; }
    const note = prompt(`向「${sel[0].partner_name || "该客户"}」提交开票申请\n开票抬头/备注（可选）：`, "");
    if (note === null) return;
    const { error } = await supabase.rpc("create_invoice_request", {
      p_bill_ids: sel.map(b => b.id), p_note: note || null,
    });
    if (error) { alert("申请失败：" + error.message); return; }
    alert("✓ 已提交开票申请，可在财务模块「开票申请」中查看处理进度");
    setShowBatchMenu(false);
    setSelected(new Set());
  };

  // 批量核销（弹窗输入核销日期 + 流水号，每张账单整额核销其未核销部分）
  const batchSettle = async () => {
    if (selected.size === 0) { alert("请先勾选要核销的账单"); return; }
    const sel = bills.filter(b => selected.has(b.id));
    const eligible = sel.filter(b => b.status !== "void" && b.status !== "settled");
    if (eligible.length === 0) { alert("所选账单均已核销或作废，无可核销项"); return; }

    const date = prompt("核销日期 (YYYY-MM-DD)", new Date().toISOString().slice(0, 10));
    if (!date) return;
    const settleNo = prompt("核销流水号 (可选，回车跳过)", "") || null;

    if (!confirm(`确认整额核销 ${eligible.length} 张账单（每张按未核销余额）？`)) return;

    let ok = 0, fail = 0;
    for (const b of eligible) {
      const remain = Number(b.amount_total || 0) - Number(b.settled_amount || 0);
      if (remain <= 0.01) continue;
      const { error } = await supabase.rpc("settle_bill", {
        p_bill_id: b.id, p_amount: remain, p_settled_at: date, p_settle_no: settleNo,
      });
      if (error) fail++; else ok++;
    }
    alert(`核销完成：成功 ${ok} 张${fail ? `，失败 ${fail} 张` : ""}`);
    setShowBatchMenu(false);
    setSelected(new Set());
    await load();
  };

  const batchClearInvoice = async () => {
    if (selected.size === 0) { alert("请先勾选"); return; }
    const sel = bills.filter(b => selected.has(b.id) && b.invoice_no);
    if (sel.length === 0) { alert("所选账单均无发票号"); return; }
    if (!confirm(`确认清除 ${sel.length} 张账单的发票号？`)) return;
    const { error } = await supabase.rpc("clear_invoice", { p_bill_ids: sel.map(b => b.id) });
    if (error) { alert("失败: " + error.message); return; }
    setShowBatchMenu(false);
    setSelected(new Set());
    await load();
  };

  const batchDelete = async () => {
    if (selected.size === 0) { alert("请先勾选"); return; }
    const sel = bills.filter(b => selected.has(b.id));
    const blocked = sel.filter(b => b.status === "settled" || b.status === "partial");
    if (blocked.length > 0) {
      alert(`所选包含 ${blocked.length} 张已核销/部分核销账单，无法删除。请先撤销核销。`);
      return;
    }
    if (!confirm(`⚠ 确认删除 ${sel.length} 张账单？\n相关 charges 的 bill_id 会被解绑（charges 本身保留）。\n此操作不可恢复！`)) return;
    // 先解绑 charges
    await supabase.rpc("unbind_charges_from_bill", {
      p_charge_ids: [],  // 这里可能要按账单维度解绑，简化：直接 update charges
    }).catch(() => {});
    // 直接 update charges set bill_id = null
    await supabase.from("charges").update({ bill_id: null })
      .in("bill_id", sel.map(b => b.id));
    // 删账单
    const { error } = await supabase.from("bills").delete().in("id", sel.map(b => b.id));
    if (error) { alert("删除失败: " + error.message); return; }
    setShowBatchMenu(false);
    setSelected(new Set());
    await load();
  };

  // 导出 Excel
  const exportExcel = (which = "all") => {
    const rows = which === "selected"
      ? bills.filter(b => selected.has(b.id))
      : bills;
    if (rows.length === 0) { alert("无数据可导出"); return; }
    const headers = ["属性","账单编号","结算单位","发票号","开票时间","凭证号",
                     "币种","账单金额","已核销","未核销","状态","来源","创建人","创建时间"];
    const data = rows.map(b => [
      b.direction === "AR" ? "应收" : "应付",
      b.bill_no || "",
      b.partner_name || "",
      b.invoice_no || "",
      b.invoice_date ? formatDate(b.invoice_date) : "",
      b.voucher_no || "",
      b.currency || "",
      Number(b.amount_total || 0).toFixed(2),
      Number(b.settled_amount || 0).toFixed(2),
      (Number(b.amount_total || 0) - Number(b.settled_amount || 0)).toFixed(2),
      STATUS_LABELS[b.status]?.label || b.status,
      b.source || "",
      b.created_by || "",
      b.created_at ? formatDate(b.created_at) : "",
    ]);
    // 生成 CSV (Excel 兼容)
    const csvRows = [headers, ...data];
    const csv = csvRows.map(r =>
      r.map(c => {
        const s = String(c ?? "");
        if (s.includes(",") || s.includes('"') || s.includes("\n")) return `"${s.replace(/"/g, '""')}"`;
        return s;
      }).join(",")
    ).join("\r\n");
    // BOM 让 Excel 识别 UTF-8
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `账单管理_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
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
  // 汇总展示：有数字时按"USD 1234.56\nCNY 7890.00"换行显示；
  // 都为 0 时给"0.00"而不是 —，避免被误以为缺数据
  const renderCcySum = (obj) =>
    Object.entries(obj).filter(([_, v]) => v !== 0).map(([c, v]) => `${c} ${v.toFixed(2)}`).join("\n") || "0.00";

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
            <div style={{ position: "relative" }}>
              <button onClick={() => setShowBatchMenu(!showBatchMenu)}
                      style={{ ...btnPrimary, fontWeight: 600 }}
                      disabled={selected.size === 0}>
                批量操作 ▾
              </button>
              {showBatchMenu && selected.size > 0 && (
                <div style={{
                  position: "absolute", top: "100%", right: 0, marginTop: 4,
                  background: "#fff", border: "1px solid #d9d9d9", borderRadius: 3,
                  boxShadow: "0 4px 12px rgba(0,0,0,0.12)", width: 140, zIndex: 10,
                  padding: "4px 0",
                }}>
                  <div onClick={batchRequestInvoice} style={{ ...menuItem, color: "#fa8c16", fontWeight: 600 }}>申请开票</div>
                  <div onClick={batchInvoice} style={menuItem}>直接开票</div>
                  <div onClick={batchSettle} style={menuItem}>批量核销</div>
                  <div onClick={batchClearInvoice} style={menuItem}>批量清票</div>
                  <div onClick={batchDelete} style={{ ...menuItem, color: "#ff4d4f" }}>批量删除</div>
                </div>
              )}
            </div>
            <button onClick={() => exportExcel(selected.size > 0 ? "selected" : "all")} style={btn}>
              导出 {selected.size > 0 ? `选中 (${selected.size})` : "全部"}
            </button>
            <a href="#/statements" target="_blank" rel="noreferrer"
               style={{ ...btn, textDecoration: "none", display: "inline-block" }}>对账单管理</a>
          </div>
        </div>

        {/* 筛选 */}
        <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center", fontSize: 12, flexWrap: "wrap" }}>
          <input placeholder="账单号 / 发票号 / 结算单位 / 凭证号 / 作业号 / 提单号"
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
          <button onClick={() => { setFilters({
            keyword:"", direction:"", status:"", date_from:"", date_to:"",
            partner_id:"", source:"", currency:"",
            amount_min:"", amount_max:"",
            has_invoice:"", has_voucher:"",
          }); setTimeout(load, 0); }}
                  style={btn}>重置</button>
          <a onClick={() => setShowAdvanced(!showAdvanced)}
             style={{ marginLeft: "auto", color: "#1990ff", cursor: "pointer", fontSize: 12 }}>
            {showAdvanced ? "▲ 收起筛选" : "▼ 展开筛选"}
          </a>
        </div>

        {/* 高级筛选面板 */}
        {showAdvanced && (
          <div style={{ marginBottom: 12, padding: 12, background: "#fafafa",
                        border: "1px dashed #d9d9d9", borderRadius: 3,
                        display: "grid", gridTemplateColumns: "repeat(4, 1fr)",
                        gap: "10px 16px", fontSize: 12 }}>
            <div>
              <label style={lbl}>结算单位</label>
              <select value={filters.partner_id}
                      onChange={e => setFilters({...filters, partner_id: e.target.value})}
                      style={inp}>
                <option value="">全部</option>
                {partnerOptions.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={lbl}>来源</label>
              <select value={filters.source}
                      onChange={e => setFilters({...filters, source: e.target.value})}
                      style={inp}>
                <option value="">全部</option>
                <option value="海运出口">海运出口</option>
                <option value="海运进口">海运进口</option>
                <option value="集运">集运</option>
                <option value="陆运">陆运</option>
                <option value="空运">空运</option>
              </select>
            </div>
            <div>
              <label style={lbl}>币种</label>
              <select value={filters.currency}
                      onChange={e => setFilters({...filters, currency: e.target.value})}
                      style={inp}>
                <option value="">全部</option>
                <option value="CNY">CNY</option>
                <option value="USD">USD</option>
                <option value="EUR">EUR</option>
                <option value="GBP">GBP</option>
                <option value="JPY">JPY</option>
              </select>
            </div>
            <div></div>
            <div>
              <label style={lbl}>金额 ≥</label>
              <input type="number" step="0.01" value={filters.amount_min}
                     onChange={e => setFilters({...filters, amount_min: e.target.value})}
                     placeholder="0.00" style={inp} />
            </div>
            <div>
              <label style={lbl}>金额 ≤</label>
              <input type="number" step="0.01" value={filters.amount_max}
                     onChange={e => setFilters({...filters, amount_max: e.target.value})}
                     placeholder="0.00" style={inp} />
            </div>
            <div>
              <label style={lbl}>是否已开票</label>
              <select value={filters.has_invoice}
                      onChange={e => setFilters({...filters, has_invoice: e.target.value})}
                      style={inp}>
                <option value="">全部</option>
                <option value="yes">已开票</option>
                <option value="no">未开票</option>
              </select>
            </div>
            <div>
              <label style={lbl}>是否填凭证号</label>
              <select value={filters.has_voucher}
                      onChange={e => setFilters({...filters, has_voucher: e.target.value})}
                      style={inp}>
                <option value="">全部</option>
                <option value="yes">已填</option>
                <option value="no">未填</option>
              </select>
            </div>
          </div>
        )}

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
                  <th style={th}>提单号</th>
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
                      <td style={{ ...td, fontFamily: "Consolas,monospace", fontSize: 11 }}>
                        {(() => {
                          if (!ship) return <span style={{ color: "#bbb" }}>—</span>;
                          const mbl = (ship.mbl_no || "").trim() || (ship.booking_no || "").trim();
                          const hbl = (ship.hbl_no || "").trim();
                          return (
                            <>
                              <div style={{ color: "#444" }}>{mbl || <span style={{ color: "#bbb" }}>—</span>}</div>
                              {hbl && <div style={{ color: "#888", fontSize: 10 }}>HBL: {hbl}</div>}
                            </>
                          );
                        })()}
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

        {/* 底部小计 — 未选中时省去"选中"行，避免一排 0/— 让用户误判 */}
        {bills.length > 0 && (
          <div style={{ marginTop: 14, padding: "10px 12px",
                        background: "#fafafa", border: "1px solid #f0f0f0",
                        borderRadius: 3, fontSize: 12 }}>
            {selected.size > 0 && (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: "6px 16px",
                             marginBottom: 8, paddingBottom: 8, borderBottom: "1px dashed #ddd" }}>
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
            )}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: "6px 16px" }}>
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
const menuItem = { padding: "6px 12px", cursor: "pointer", fontSize: 12 };
