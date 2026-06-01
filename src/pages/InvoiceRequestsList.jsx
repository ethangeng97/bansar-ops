// ============================================================================
// InvoiceRequestsList.jsx — 开票申请（AR / 我方给客户开票）
// 路由：#/invoice-requests
// 功能：
//   - 状态 Tab：待开票 / 已开票 / 全部
//   - 搜索：申请号 / 客户名 / 状态 / 申请日期
//   - 展开行：查看该申请绑定的账单（bill_no / 提单号 / 金额）+ 已上传发票
//   - 财务/管理员：完成开票（填票号+日期+上传发票PDF→ complete_invoice_request）、驳回
//   - 已开票：下载发票（私有桶 invoice-files 的签名 URL）
//   发起入口在「账单管理 / 对账单详情」，由 create_invoice_request 写入。
// ============================================================================

import { useEffect, useState } from "react";
import { supabase } from "../supabase.js";
import { dataScopeOf } from "../lib/permissions.js";

const BRAND = "#1f3864";
const BUCKET = "invoice-files";

const STATUS = {
  pending:   { label: "待开票", color: "#fa8c16", bg: "#fff7e6" },
  completed: { label: "已开票", color: "#52c41a", bg: "#f6ffed" },
  rejected:  { label: "已驳回", color: "#ff4d4f", bg: "#fff1f0" },
  cancelled: { label: "已取消", color: "#888",    bg: "#fafafa" },
};

export default function InvoiceRequestsList({ user, onBack }) {
  const role = user?.profile?.role;
  // 完成开票=销项=应收：admin / 应收财务(scope all 或 ar) 可操作
  const canIssue = role === "admin" || ["all", "ar"].includes(dataScopeOf(user));

  const [tab, setTab] = useState("pending"); // pending / completed / all
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ keyword: "", date_from: "", date_to: "" });
  const [expanded, setExpanded] = useState(null);   // request_id
  const [complete, setComplete] = useState(null);    // request row being completed
  const [showNew, setShowNew] = useState(false);     // 新建开票申请弹窗

  const load = async () => {
    setLoading(true);
    let q = supabase.from("invoice_requests").select("*")
      .order("requested_at", { ascending: false });
    if (tab !== "all") q = q.eq("status", tab);
    if (filters.date_from) q = q.gte("requested_at", filters.date_from);
    if (filters.date_to)   q = q.lte("requested_at", filters.date_to + "T23:59:59");
    const { data, error } = await q;
    if (error) { alert("加载失败：" + error.message); setLoading(false); return; }
    let list = data || [];
    if (filters.keyword) {
      const k = filters.keyword.toLowerCase();
      list = list.filter(r =>
        (r.request_no || "").toLowerCase().includes(k) ||
        (r.partner_name || "").toLowerCase().includes(k));
    }
    setRows(list);
    setExpanded(null);
    setLoading(false);
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [tab]);

  const onReject = async (r) => {
    const note = prompt(`驳回开票申请「${r.request_no}」\n请填写驳回原因（可空）：`, "");
    if (note === null) return;
    const { error } = await supabase.rpc("reject_invoice_request", { p_request_id: r.id, p_note: note || null });
    if (error) { alert("驳回失败：" + error.message); return; }
    await load();
  };

  return (
    <div style={{ padding: 16, background: "#f0f2f5", minHeight: "100vh" }}>
      <div style={{ background: "#fff", borderRadius: 4, padding: 16, boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
        {/* 顶部 */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
                      marginBottom: 12, paddingBottom: 12, borderBottom: "1px solid #f0f0f0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            {onBack && <button onClick={onBack} style={btn}>← 返回</button>}
            <span style={{ fontSize: 16, fontWeight: 700 }}>开票申请</span>
            <span style={{ marginLeft: 4, color: "#888", fontSize: 12 }}>共 {rows.length} 条</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {!canIssue && <span style={{ color: "#bbb", fontSize: 12 }}>仅应收财务 / 管理员可完成开票</span>}
            <button onClick={() => setShowNew(true)} style={btnPrimary}>+ 新建开票申请</button>
          </div>
        </div>

        {/* Tab */}
        <div style={{ display: "flex", marginBottom: 14, borderBottom: "1px solid #e8e8e8" }}>
          {[["pending", "待开票"], ["completed", "已开票"], ["all", "全部"]].map(([key, label]) => (
            <div key={key} onClick={() => setTab(key)}
                 style={{ padding: "10px 24px", cursor: "pointer",
                          color: tab === key ? BRAND : "#666",
                          fontWeight: tab === key ? 700 : 500,
                          borderBottom: tab === key ? `2px solid ${BRAND}` : "2px solid transparent",
                          marginBottom: -1, fontSize: 13 }}>
              {label}
            </div>
          ))}
        </div>

        {/* 筛选 */}
        <div style={{ display: "flex", gap: 8, marginBottom: 12, alignItems: "center", fontSize: 12, flexWrap: "wrap" }}>
          <input placeholder="申请号 / 客户名" value={filters.keyword}
                 onChange={e => setFilters({ ...filters, keyword: e.target.value })}
                 onKeyDown={e => e.key === "Enter" && load()}
                 style={{ flex: "0 0 220px", padding: "5px 8px", border: "1px solid #d9d9d9", borderRadius: 3, fontSize: 12 }} />
          <input type="date" value={filters.date_from}
                 onChange={e => setFilters({ ...filters, date_from: e.target.value })}
                 style={{ padding: "5px 8px", border: "1px solid #d9d9d9", borderRadius: 3, fontSize: 12 }} />
          <span>~</span>
          <input type="date" value={filters.date_to}
                 onChange={e => setFilters({ ...filters, date_to: e.target.value })}
                 style={{ padding: "5px 8px", border: "1px solid #d9d9d9", borderRadius: 3, fontSize: 12 }} />
          <button onClick={load} style={btn}>查询</button>
          <button onClick={() => { setFilters({ keyword: "", date_from: "", date_to: "" }); setTimeout(load, 0); }} style={btn}>重置</button>
        </div>

        {/* 列表 */}
        {loading ? (
          <div style={{ padding: 30, textAlign: "center", color: "#888" }}>加载中...</div>
        ) : rows.length === 0 ? (
          <div style={{ padding: 40, textAlign: "center", color: "#999" }}>暂无开票申请</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#fafafa", color: "#444" }}>
                <th style={{ ...th, width: 28 }}></th>
                <th style={th}>申请号</th>
                <th style={th}>客户</th>
                <th style={{ ...th, textAlign: "right" }}>币别 / 金额</th>
                <th style={th}>申请人 / 时间</th>
                <th style={{ ...th, textAlign: "center" }}>状态</th>
                <th style={th}>发票号</th>
                <th style={{ ...th, textAlign: "center", minWidth: 150 }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const st = STATUS[r.status] || STATUS.pending;
                const isOpen = expanded === r.id;
                return (
                  <FragmentRow key={r.id}>
                    <tr style={{ background: isOpen ? "#e6f4ff" : "#fff", borderBottom: "1px solid #f5f5f5" }}>
                      <td style={{ ...td, textAlign: "center", cursor: "pointer", color: "#999" }}
                          onClick={() => setExpanded(isOpen ? null : r.id)}>
                        {isOpen ? "▾" : "▸"}
                      </td>
                      <td style={{ ...td, fontFamily: "Consolas,monospace", color: BRAND, fontWeight: 600 }}>{r.request_no}</td>
                      <td style={td}>{r.partner_name}</td>
                      <td style={{ ...td, textAlign: "right", fontFamily: "Consolas,monospace", fontWeight: 700 }}>
                        {r.currency} {Number(r.amount_total).toFixed(2)}
                      </td>
                      <td style={{ ...td, color: "#666" }}>{fmtDateTime(r.requested_at)}</td>
                      <td style={{ ...td, textAlign: "center" }}>
                        <span style={{ display: "inline-block", padding: "2px 8px", background: st.bg, color: st.color, borderRadius: 3, fontSize: 11 }}>
                          {st.label}
                        </span>
                      </td>
                      <td style={{ ...td, fontFamily: "Consolas,monospace", color: "#444" }}>
                        {r.invoice_no || <span style={{ color: "#bbb" }}>—</span>}
                      </td>
                      <td style={{ ...td, textAlign: "center", whiteSpace: "nowrap" }}>
                        {r.status === "pending" && canIssue && (
                          <>
                            <a onClick={() => setComplete(r)} style={{ color: "#52c41a", cursor: "pointer", marginRight: 10, fontWeight: 600 }}>完成开票</a>
                            <a onClick={() => onReject(r)} style={{ color: "#ff4d4f", cursor: "pointer" }}>驳回</a>
                          </>
                        )}
                        {r.status === "completed" && (
                          <a onClick={() => setExpanded(isOpen ? null : r.id)} style={{ color: "#1990ff", cursor: "pointer" }}>查看/下载</a>
                        )}
                        {r.status === "pending" && !canIssue && <span style={{ color: "#bbb" }}>待财务处理</span>}
                      </td>
                    </tr>
                    {isOpen && (
                      <tr>
                        <td></td>
                        <td colSpan={7} style={{ padding: "8px 6px 16px", background: "#fbfdff" }}>
                          <ExpandDetail request={r} />
                        </td>
                      </tr>
                    )}
                  </FragmentRow>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {complete && (
        <CompleteDialog
          request={complete}
          user={user}
          onClose={() => setComplete(null)}
          onDone={() => { setComplete(null); load(); }}
        />
      )}
      {showNew && (
        <NewRequestDialog
          onClose={() => setShowNew(false)}
          onDone={() => { setShowNew(false); setTab("pending"); load(); }}
        />
      )}
    </div>
  );
}

// ── 新建开票申请：搜订单/提单/客户 → 勾选相关应收账单(单票/多票) → create_invoice_request ──
function NewRequestDialog({ onClose, onDone }) {
  const [allBills, setAllBills] = useState([]);   // 候选应收账单(含订单信息)
  const [picked, setPicked] = useState(new Set());
  const [kw, setKw] = useState("");
  const [requirement, setRequirement] = useState(""); // 开票要求
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [hints, setHints] = useState([]); // 搜到但不可申请的订单(无账单/已开票)，仅提示

  // 载入所有可申请的应收账单(未作废、未在 待开票/已开票 申请中)，附订单号/提单号
  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: bs } = await supabase.from("bills")
        .select("id, bill_no, shipment_id, partner_id, amount_total, currency, status, invoice_no")
        .eq("direction", "AR").order("created_at", { ascending: false });
      let rows = (bs || []).filter(b => b.status !== "void");
      const ids = rows.map(b => b.id);
      if (ids.length) {
        const { data: used } = await supabase.from("invoice_request_bills").select("bill_id, request_id").in("bill_id", ids);
        const reqIds = [...new Set((used || []).map(u => u.request_id))];
        let activeReq = new Set();
        if (reqIds.length) {
          const { data: reqs } = await supabase.from("invoice_requests").select("id, status").in("id", reqIds);
          activeReq = new Set((reqs || []).filter(r => ["pending", "completed"].includes(r.status)).map(r => r.id));
        }
        const usedSet = new Set((used || []).filter(u => activeReq.has(u.request_id)).map(u => u.bill_id));
        rows = rows.filter(b => !usedSet.has(b.id));
      }
      const shipIds = [...new Set(rows.map(b => b.shipment_id).filter(Boolean))];
      let m = {};
      if (shipIds.length) {
        const { data: ss } = await supabase.from("shipments").select("id, order_no, mbl_no, hbl_no, booking_no").in("id", shipIds);
        (ss || []).forEach(x => { m[x.id] = x; });
      }
      const custIds = [...new Set(rows.map(b => b.partner_id).filter(Boolean))];
      let cmap = {};
      if (custIds.length) {
        const { data: cs } = await supabase.from("customers").select("id, name").in("id", custIds);
        (cs || []).forEach(c => { cmap[c.id] = c.name; });
      }
      rows = rows.map(b => {
        const s = m[b.shipment_id] || {};
        const pn = cmap[b.partner_id] || "";
        const mbl = (s.mbl_no || "").trim() || (s.hbl_no || "").trim() || (s.booking_no || "").trim();
        // 搜索串覆盖：订单号 / MBL / HBL / 订舱号 / 账单号 / 客户
        const _search = [s.order_no, s.mbl_no, s.hbl_no, s.booking_no, b.bill_no, pn]
          .filter(Boolean).join(" ").toLowerCase();
        return { ...b, partner_name: pn, order_no: s.order_no || "", mbl, _search };
      });
      setAllBills(rows);
      setLoading(false);
    })();
  }, []);

  const k = kw.toLowerCase().trim();
  const bills = !k ? allBills : allBills.filter(b => (b._search || "").includes(k));

  // 搜索时：把"匹配到订单、但没有可申请应收账单"的订单查出来做灰色提示
  useEffect(() => {
    const key = kw.trim();
    if (key.length < 2) { setHints([]); return; }
    let cancelled = false;
    (async () => {
      const esc = key.replace(/[%,*]/g, "");
      const { data: ss } = await supabase.from("shipments")
        .select("id, order_no, mbl_no, hbl_no, booking_no, customer")
        .or(`order_no.ilike.*${esc}*,mbl_no.ilike.*${esc}*,hbl_no.ilike.*${esc}*,booking_no.ilike.*${esc}*`)
        .limit(20);
      const candShip = new Set(allBills.map(b => b.shipment_id));
      const matched = (ss || []).filter(s => !candShip.has(s.id));
      if (!matched.length) { if (!cancelled) setHints([]); return; }
      const { data: bb } = await supabase.from("bills").select("shipment_id, direction").in("shipment_id", matched.map(s => s.id));
      const arShip = new Set((bb || []).filter(b => b.direction === "AR").map(b => b.shipment_id));
      const h = matched.map(s => ({
        id: s.id, order_no: s.order_no,
        mbl: (s.mbl_no || "").trim() || (s.hbl_no || "").trim() || (s.booking_no || "").trim(),
        customer: s.customer,
        reason: arShip.has(s.id) ? "应收账单已开票或已在申请中" : "未生成应收账单，不能申请开票",
      }));
      if (!cancelled) setHints(h);
    })();
    return () => { cancelled = true; };
  }, [kw, allBills]);

  const toggle = (id) => { const n = new Set(picked); n.has(id) ? n.delete(id) : n.add(id); setPicked(n); };
  const pickedBills = allBills.filter(b => picked.has(b.id));
  const partners = [...new Set(pickedBills.map(b => b.partner_id))];
  const currencies = [...new Set(pickedBills.map(b => b.currency || "CNY"))];
  const total = pickedBills.reduce((s, b) => s + Number(b.amount_total || 0), 0);

  const submit = async () => {
    if (picked.size === 0) { alert("请勾选要开票的应收账单（可跨订单多选，但须同一客户、同一币别）"); return; }
    if (partners.length > 1) { alert("所选账单分属不同客户，无法合并到一张发票申请"); return; }
    if (currencies.length > 1) { alert("所选账单币别不一致，请分别申请"); return; }
    setBusy(true);
    const { error } = await supabase.rpc("create_invoice_request", {
      p_bill_ids: [...picked], p_note: requirement || null, p_invoice_title: title || null,
    });
    setBusy(false);
    if (error) { alert("提交失败：" + error.message); return; }
    alert("✓ 已提交开票申请");
    onDone();
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex",
                  alignItems: "center", justifyContent: "center", zIndex: 100 }}>
      <div style={{ background: "#fff", borderRadius: 4, width: 760, maxWidth: "95vw", maxHeight: "90vh",
                    display: "flex", flexDirection: "column", boxShadow: "0 4px 16px rgba(0,0,0,0.2)" }}>
        <div style={{ padding: 16, borderBottom: "1px solid #f0f0f0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 14, fontWeight: 700 }}>新建开票申请（应收）</span>
          <a onClick={onClose} style={{ cursor: "pointer", color: "#999" }}>×</a>
        </div>

        <div style={{ padding: "12px 16px", borderBottom: "1px solid #f0f0f0" }}>
          <input value={kw} onChange={e => setKw(e.target.value)} placeholder="搜索 订单号 / 提单号 / 客户 / 账单号 —— 选 1 票或多票"
                 style={{ width: "100%", padding: "6px 10px", border: "1px solid #d9d9d9", borderRadius: 3, fontSize: 12, boxSizing: "border-box" }} />
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 16 }}>
          {loading ? (
            <div style={{ padding: 20, textAlign: "center", color: "#888" }}>加载中...</div>
          ) : (bills.length === 0 && hints.length === 0) ? (
            <div style={{ padding: 20, textAlign: "center", color: "#999" }}>{allBills.length === 0 ? "暂无可申请的应收账单（都已开票或已在申请中）" : "无匹配结果"}</div>
          ) : (
            <table style={{ width: "100%", fontSize: 11.5, borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#fafafa", color: "#444" }}>
                  <th style={{ ...th, width: 28, textAlign: "center" }}>
                    <input type="checkbox" checked={bills.every(b => picked.has(b.id)) && bills.length > 0}
                           onChange={() => { const n = new Set(picked); const all = bills.every(b => picked.has(b.id)); bills.forEach(b => all ? n.delete(b.id) : n.add(b.id)); setPicked(n); }} />
                  </th>
                  <th style={th}>订单号</th><th style={th}>提单号</th><th style={th}>客户</th><th style={th}>账单号</th><th style={{ ...th, textAlign: "right" }}>金额</th>
                </tr>
              </thead>
              <tbody>
                {bills.map(b => (
                  <tr key={b.id} style={{ borderTop: "1px solid #f5f5f5", background: picked.has(b.id) ? "#e6f4ff" : "#fff" }}>
                    <td style={{ ...td, textAlign: "center" }}><input type="checkbox" checked={picked.has(b.id)} onChange={() => toggle(b.id)} /></td>
                    <td style={{ ...td, fontFamily: "Consolas,monospace", color: "#1990ff" }}>{b.order_no || "—"}</td>
                    <td style={{ ...td, fontFamily: "Consolas,monospace", color: "#444" }}>{b.mbl || "—"}</td>
                    <td style={td}>{b.partner_name || "—"}</td>
                    <td style={{ ...td, fontFamily: "Consolas,monospace", color: BRAND }}>{b.bill_no}</td>
                    <td style={{ ...td, textAlign: "right", fontFamily: "Consolas,monospace" }}>{b.currency} {Number(b.amount_total).toFixed(2)}</td>
                  </tr>
                ))}
                {/* 搜到但不可申请的订单：灰色提示，不可勾选 */}
                {hints.map(h => (
                  <tr key={h.id} style={{ borderTop: "1px solid #f5f5f5", background: "#fafafa", color: "#bbb" }} title={h.reason}>
                    <td style={{ ...td, textAlign: "center" }}>🚫</td>
                    <td style={{ ...td, fontFamily: "Consolas,monospace" }}>{h.order_no || "—"}</td>
                    <td style={{ ...td, fontFamily: "Consolas,monospace" }}>{h.mbl || "—"}</td>
                    <td style={td}>{h.customer || "—"}</td>
                    <td colSpan={2} style={{ ...td, color: "#fa8c16" }}>⚠ {h.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div style={{ marginTop: 12, display: "flex", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <div style={{ color: "#888", fontSize: 12, marginBottom: 4 }}>开票抬头（可选）</div>
              <input value={title} onChange={e => setTitle(e.target.value)} placeholder="客户开票抬头 / 税号"
                     style={{ width: "100%", padding: "6px 10px", border: "1px solid #d9d9d9", borderRadius: 3, fontSize: 12, boxSizing: "border-box" }} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ color: "#888", fontSize: 12, marginBottom: 4 }}>开票要求（可选）</div>
              <input value={requirement} onChange={e => setRequirement(e.target.value)} placeholder="如：专票 / 普票、寄送方式、开票内容等"
                     style={{ width: "100%", padding: "6px 10px", border: "1px solid #d9d9d9", borderRadius: 3, fontSize: 12, boxSizing: "border-box" }} />
            </div>
          </div>
        </div>

        <div style={{ padding: 12, borderTop: "1px solid #f0f0f0", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 12, color: "#666" }}>
            已选 <b style={{ color: BRAND }}>{picked.size}</b> 张
            {picked.size > 0 && <> · {pickedBills[0]?.partner_name} · 合计 <b style={{ color: "#1990ff", fontFamily: "Consolas,monospace" }}>{currencies[0] || ""} {total.toFixed(2)}</b></>}
            {partners.length > 1 && <span style={{ color: "#ff4d4f" }}> · ⚠ 含多个客户</span>}
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={onClose} style={btn} disabled={busy}>取消</button>
            <button onClick={submit} style={btnPrimary} disabled={busy || picked.size === 0}>{busy ? "提交中..." : "提交申请"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// 让一行展开两个 <tr> 而不引入额外 DOM 节点
function FragmentRow({ children }) { return <>{children}</>; }

// ── 展开：绑定账单 + 发票备注 + 已上传发票文件下载 ──
function ExpandDetail({ request }) {
  const [bills, setBills] = useState([]);
  const [shipMap, setShipMap] = useState({});
  const [files, setFiles] = useState([]);
  const [invs, setInvs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: rb } = await supabase.from("invoice_request_bills")
        .select("bill_id, amount").eq("request_id", request.id);
      const billIds = (rb || []).map(x => x.bill_id);
      let billRows = [];
      if (billIds.length) {
        const { data } = await supabase.from("bills")
          .select("id, bill_no, shipment_id, amount_total, currency, invoice_no, status")
          .in("id", billIds);
        billRows = data || [];
        const shipIds = [...new Set(billRows.map(b => b.shipment_id).filter(Boolean))];
        if (shipIds.length) {
          const { data: ss } = await supabase.from("shipments")
            .select("id, order_no, booking_no, hbl_no, mbl_no").in("id", shipIds);
          const m = {}; (ss || []).forEach(x => { m[x.id] = x; });
          setShipMap(m);
        }
      }
      setBills(billRows);
      const { data: f } = await supabase.from("invoice_request_files")
        .select("*").eq("request_id", request.id).order("created_at", { ascending: true });
      setFiles(f || []);
      const { data: iv } = await supabase.from("invoices")
        .select("id, invoice_no, invoice_date, tax_rate, amount_total, currency")
        .eq("request_id", request.id).order("created_at", { ascending: true });
      setInvs(iv || []);
      setLoading(false);
    })();
    /* eslint-disable-next-line */
  }, [request.id]);

  const openFile = async (f) => {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(f.file_url, 3600);
    if (error) { alert("打开失败：" + error.message); return; }
    window.open(data.signedUrl, "_blank");
  };

  if (loading) return <div style={{ padding: 12, color: "#888" }}>加载中...</div>;

  return (
    <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
      {/* 账单 */}
      <div style={{ flex: "1 1 420px", minWidth: 320 }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: "#555" }}>
          绑定账单（{bills.length} 张）
        </div>
        <table style={{ width: "100%", fontSize: 11.5, borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#f5f7fa", color: "#444" }}>
              <th style={th}>账单号</th>
              <th style={th}>提单号</th>
              <th style={{ ...th, textAlign: "right" }}>金额</th>
            </tr>
          </thead>
          <tbody>
            {bills.map(b => {
              const ship = shipMap[b.shipment_id];
              const mbl = ship ? ((ship.mbl_no || "").trim() || (ship.hbl_no || "").trim() || (ship.booking_no || "").trim()) : "";
              return (
                <tr key={b.id} style={{ borderTop: "1px solid #eee" }}>
                  <td style={{ ...td, fontFamily: "Consolas,monospace", color: BRAND }}>{b.bill_no}</td>
                  <td style={{ ...td, fontFamily: "Consolas,monospace", color: "#444" }}>{mbl || "—"}</td>
                  <td style={{ ...td, textAlign: "right", fontFamily: "Consolas,monospace" }}>
                    {b.currency} {Number(b.amount_total).toFixed(2)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {request.invoice_title && (
          <div style={{ marginTop: 8, fontSize: 11.5, color: "#666" }}>
            开票抬头：{request.invoice_title}{request.tax_no ? ` ／ 税号 ${request.tax_no}` : ""}
          </div>
        )}
        {request.request_note && (
          <div style={{ marginTop: 4, fontSize: 11.5, color: "#666" }}>开票要求：{request.request_note}</div>
        )}
        {request.reject_note && (
          <div style={{ marginTop: 4, fontSize: 11.5, color: "#ff4d4f" }}>驳回原因：{request.reject_note}</div>
        )}
      </div>

      {/* 发票（可能多张） */}
      <div style={{ flex: "1 1 300px", minWidth: 260 }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: "#555" }}>
          发票（{invs.length}）
        </div>
        {invs.length === 0 ? (
          <>
            <div style={{ fontSize: 11.5, color: "#bbb" }}>尚未开票</div>
            {files.length > 0 && (
              <ul style={{ margin: "6px 0 0", paddingLeft: 0, listStyle: "none" }}>
                {files.map(f => (
                  <li key={f.id} style={{ marginBottom: 4 }}>
                    <a onClick={() => openFile(f)} style={{ color: "#1990ff", cursor: "pointer", fontSize: 12 }}>📄 {f.file_name || "发票.pdf"}</a>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <table style={{ width: "100%", fontSize: 11.5, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#f5f7fa", color: "#444" }}>
                <th style={th}>发票号</th><th style={{ ...th, textAlign: "center" }}>税率</th>
                <th style={{ ...th, textAlign: "right" }}>金额</th><th style={th}>文件</th>
              </tr>
            </thead>
            <tbody>
              {invs.map(iv => {
                const ivFiles = files.filter(f => f.invoice_id === iv.id);
                return (
                  <tr key={iv.id} style={{ borderTop: "1px solid #eee" }}>
                    <td style={{ ...td, fontFamily: "Consolas,monospace", color: "#444" }}>{iv.invoice_no}</td>
                    <td style={{ ...td, textAlign: "center" }}>{iv.tax_rate == null ? "混合" : fmtRate(iv.tax_rate)}</td>
                    <td style={{ ...td, textAlign: "right", fontFamily: "Consolas,monospace" }}>{iv.currency} {Number(iv.amount_total).toFixed(2)}</td>
                    <td style={td}>
                      {ivFiles.length ? ivFiles.map(f => (
                        <a key={f.id} onClick={() => openFile(f)} style={{ color: "#1990ff", cursor: "pointer", display: "block" }}>📄 下载</a>
                      )) : <span style={{ color: "#bbb" }}>无</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ── 完成开票弹窗：把应收费用按税率分成多张发票(可手动调) → complete_invoice_request_split ──
const fmtRate = (r) => (Number(r) === 0 ? "免税(0%)" : `${Number(r)}%`);

function CompleteDialog({ request, onClose, onDone }) {
  const [charges, setCharges] = useState([]);     // {id, name, bill_id, amount_total, rate}
  const [cards, setCards] = useState([]);          // [{key, invoice_no, invoice_date, file}]
  const [assign, setAssign] = useState({});        // chargeId -> cardKey
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: rb } = await supabase.from("invoice_request_bills").select("bill_id").eq("request_id", request.id);
      const billIds = (rb || []).map(x => x.bill_id);
      let cs = [];
      if (billIds.length) {
        const { data } = await supabase.from("charges")
          .select("id, charge_item_id, bill_id, amount_total, tax_rate, remark")
          .in("bill_id", billIds).eq("direction", "应收");
        cs = data || [];
        const itemIds = [...new Set(cs.map(c => c.charge_item_id).filter(Boolean))];
        let nm = {};
        if (itemIds.length) {
          const { data: items } = await supabase.from("charge_items").select("id, name_zh, code").in("id", itemIds);
          (items || []).forEach(i => { nm[i.id] = i.name_zh || i.code; });
        }
        cs = cs.map(c => ({ id: c.id, name: nm[c.charge_item_id] || c.remark || "费用",
                            bill_id: c.bill_id, amount_total: Number(c.amount_total || 0), rate: Number(c.tax_rate || 0) }));
      }
      // 按税率预分组：每个税率一张发票卡
      const today = new Date().toISOString().slice(0, 10);
      const rates = [...new Set(cs.map(c => c.rate))].sort((a, b) => a - b);
      const newCards = rates.map(r => ({ key: crypto.randomUUID(), _rate: r, invoice_no: "", invoice_date: today, file: null }));
      const rateToKey = {}; newCards.forEach(c => { rateToKey[c._rate] = c.key; });
      const asg = {}; cs.forEach(c => { asg[c.id] = rateToKey[c.rate]; });
      setCharges(cs); setCards(newCards); setAssign(asg);
      setLoading(false);
    })();
    /* eslint-disable-next-line */
  }, [request.id]);

  const cardCharges = (key) => charges.filter(c => assign[c.id] === key);
  const cardAmount = (key) => cardCharges(key).reduce((s, c) => s + c.amount_total, 0);
  const cardRateLabel = (key) => {
    const rs = [...new Set(cardCharges(key).map(c => c.rate))];
    return rs.length === 0 ? "（空）" : rs.length === 1 ? fmtRate(rs[0]) : "混合税率";
  };
  const setCard = (key, field, val) => setCards(cs => cs.map(c => c.key === key ? { ...c, [field]: val } : c));
  const addCard = () => setCards(cs => [...cs, { key: crypto.randomUUID(), invoice_no: "", invoice_date: new Date().toISOString().slice(0, 10), file: null }]);
  const removeCard = (key) => {
    if (cardCharges(key).length > 0) { alert("该发票下还有费用，请先把费用移到别的发票再删除"); return; }
    setCards(cs => cs.filter(c => c.key !== key));
  };

  const submit = async () => {
    const used = cards.filter(c => cardCharges(c.key).length > 0);
    if (used.length === 0) { alert("没有可开票的费用"); return; }
    for (const c of used) {
      if (!c.invoice_no.trim()) { alert("每张发票都要填发票号"); return; }
    }
    setSubmitting(true);
    try {
      const payload = [];
      for (const c of used) {
        let file_url = null, file_name = null;
        if (c.file) {
          const uuid = crypto.randomUUID();
          const safeName = c.file.name.replace(/[^\w.\-一-龥()（）]/g, "_");
          const path = `${request.customer_id}/${request.id}/${uuid}-${safeName}`;
          const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, c.file);
          if (upErr) { alert(`上传「${c.file.name}」失败：` + upErr.message); setSubmitting(false); return; }
          file_url = path; file_name = c.file.name;
        }
        payload.push({
          invoice_no: c.invoice_no.trim(), invoice_date: c.invoice_date || null,
          charge_ids: cardCharges(c.key).map(x => x.id), file_url, file_name,
        });
      }
      const { error } = await supabase.rpc("complete_invoice_request_split", {
        p_request_id: request.id, p_invoices: payload,
      });
      if (error) { alert("完成开票失败：" + error.message); setSubmitting(false); return; }
      alert(`✓ 已完成开票，共 ${payload.length} 张发票`);
      onDone();
    } finally { setSubmitting(false); }
  };

  const grandTotal = charges.reduce((s, c) => s + c.amount_total, 0);

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex",
                  alignItems: "center", justifyContent: "center", zIndex: 100 }}>
      <div style={{ background: "#fff", borderRadius: 4, width: 820, maxWidth: "96vw",
                    maxHeight: "92vh", display: "flex", flexDirection: "column",
                    boxShadow: "0 4px 16px rgba(0,0,0,0.2)" }}>
        <div style={{ padding: 16, borderBottom: "1px solid #f0f0f0", display: "flex",
                      justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 14, fontWeight: 700 }}>完成开票 · {request.request_no} <span style={{ fontWeight: 400, color: "#888", fontSize: 12, marginLeft: 8 }}>{request.partner_name} · {request.currency} {Number(request.amount_total).toFixed(2)}</span></span>
          <a onClick={onClose} style={{ cursor: "pointer", color: "#999" }}>×</a>
        </div>

        {loading ? <div style={{ padding: 30, textAlign: "center", color: "#888" }}>加载中...</div> : (
        <div style={{ padding: 16, flex: 1, overflowY: "auto" }}>
          <div style={{ fontSize: 12, color: "#666", marginBottom: 10 }}>
            已按税率自动分成 <b style={{ color: BRAND }}>{cards.filter(c => cardCharges(c.key).length).length}</b> 张发票；
            可在下方「费用归属」里手动把费用挪到别的发票，或「+ 新增一张发票」。
          </div>

          {/* 发票卡片 */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 14 }}>
            {cards.map((c, idx) => (
              <div key={c.key} style={{ flex: "1 1 240px", minWidth: 240, border: "1px solid #e8e8e8", borderRadius: 4, padding: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <b style={{ fontSize: 12, color: BRAND }}>发票{idx + 1} · {cardRateLabel(c.key)}</b>
                  <span style={{ fontFamily: "Consolas,monospace", fontSize: 12 }}>{request.currency} {cardAmount(c.key).toFixed(2)}</span>
                </div>
                <input value={c.invoice_no} onChange={e => setCard(c.key, "invoice_no", e.target.value)} placeholder="发票号 *"
                       style={{ width: "100%", padding: "5px 8px", border: "1px solid #d9d9d9", borderRadius: 3, fontSize: 12, fontFamily: "Consolas,monospace", boxSizing: "border-box", marginBottom: 6 }} />
                <input type="date" value={c.invoice_date} onChange={e => setCard(c.key, "invoice_date", e.target.value)}
                       style={{ width: "100%", padding: "5px 8px", border: "1px solid #d9d9d9", borderRadius: 3, fontSize: 12, boxSizing: "border-box", marginBottom: 6 }} />
                <input type="file" accept="application/pdf,image/*" onChange={e => setCard(c.key, "file", e.target.files?.[0] || null)} style={{ fontSize: 11 }} />
                {c.file && <div style={{ fontSize: 11, color: "#555", marginTop: 4 }}>{c.file.name}</div>}
                {cardCharges(c.key).length === 0 && (
                  <a onClick={() => removeCard(c.key)} style={{ color: "#ff4d4f", cursor: "pointer", fontSize: 11, display: "inline-block", marginTop: 6 }}>删除该发票</a>
                )}
              </div>
            ))}
            <button onClick={addCard} style={{ ...btn, alignSelf: "flex-start" }}>+ 新增一张发票</button>
          </div>

          {/* 费用归属 */}
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6, color: "#555" }}>费用归属（合计 {request.currency} {grandTotal.toFixed(2)}）</div>
          <table style={{ width: "100%", fontSize: 11.5, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#fafafa", color: "#444" }}>
                <th style={th}>费用项</th><th style={{ ...th, textAlign: "center" }}>税率</th>
                <th style={{ ...th, textAlign: "right" }}>金额</th><th style={th}>归到哪张发票</th>
              </tr>
            </thead>
            <tbody>
              {charges.map(c => (
                <tr key={c.id} style={{ borderTop: "1px solid #f5f5f5" }}>
                  <td style={td}>{c.name}</td>
                  <td style={{ ...td, textAlign: "center" }}>{fmtRate(c.rate)}</td>
                  <td style={{ ...td, textAlign: "right", fontFamily: "Consolas,monospace" }}>{c.amount_total.toFixed(2)}</td>
                  <td style={td}>
                    <select value={assign[c.id] || ""} onChange={e => setAssign(a => ({ ...a, [c.id]: e.target.value }))}
                            style={{ padding: "3px 6px", border: "1px solid #d9d9d9", borderRadius: 3, fontSize: 11.5 }}>
                      {cards.map((card, idx) => <option key={card.key} value={card.key}>发票{idx + 1}（{cardRateLabel(card.key)}）</option>)}
                    </select>
                  </td>
                </tr>
              ))}
              {charges.length === 0 && <tr><td colSpan={4} style={{ padding: 20, textAlign: "center", color: "#999" }}>该申请账单下没有应收费用，无法开票</td></tr>}
            </tbody>
          </table>
          <div style={{ marginTop: 10, fontSize: 11.5, color: "#999" }}>
            完成后按上面分组生成多张发票记录、盖发票号到每条费用；客户可在 portal 下载各张发票。
          </div>
        </div>
        )}

        <div style={{ padding: 12, borderTop: "1px solid #f0f0f0", display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button onClick={onClose} style={btn} disabled={submitting}>取消</button>
          <button onClick={submit} style={btnPrimary} disabled={submitting || loading || charges.length === 0}>
            {submitting ? "提交中..." : "确认完成开票"}
          </button>
        </div>
      </div>
    </div>
  );
}

function fmtDateTime(s) {
  if (!s) return "—";
  return new Date(s).toLocaleString("zh-CN", { hour12: false }).replace(/\//g, "-");
}

const th = { padding: "7px 6px", textAlign: "left", borderBottom: "1px solid #e8e8e8", fontWeight: 600 };
const td = { padding: 6 };
const btn = { padding: "5px 14px", background: "#fff", border: "1px solid #d9d9d9", borderRadius: 3, fontSize: 12, cursor: "pointer" };
const btnPrimary = { ...btn, background: "#1990ff", color: "#fff", border: "1px solid #1990ff", fontWeight: 600 };
