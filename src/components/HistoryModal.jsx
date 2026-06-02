// ============================================================================
// HistoryModal — 作业修改历史 audit log 展示
// 拉 shipments_audit + join user_profiles_view 拿用户名
// 按 changed_at desc 显示
// ============================================================================
import { useState, useEffect } from "react";
import { supabase } from "../supabase.js";
import { ModalShell } from "./tms.jsx";

// 英文 col → 中文 label（部分常用字段）。其他直接显示 col 名
const COL_LABELS = {
  order_no: "作业号", customer: "委托单位", supplier: "供应商",
  booking_no: "MB/L No.", mbl_no: "MB/L No.", hbl_no: "HB/L No.", e_booking_no: "外运编号",
  vessel: "船名", voyage: "航次", carrier: "船东", overseas_agent: "海外代理",
  pol: "起运港", pod: "卸货港", destination: "目的地", terminal: "起运港码头",
  pol_code: "起运港码", pod_code: "卸货港码", destination_code: "目的地码",
  etd: "ETD", eta: "ETA", atd: "ATD",
  qty_container: "箱型箱量", container_no: "箱号", seal_no: "封号",
  qty_packages: "件数", weight: "毛重", volume: "体积",
  description: "品名", desc_en: "英文品名", desc_zh: "中文品名", hs_code: "HSCode",
  shipper: "发货人", consignee: "收货人", notify_party: "通知人",
  po: "PO#", customer_po: "客户 PO", po_no: "PO#",
  lifecycle: "生命周期", qc_status: "QC", space_status: "出运状态",
  hbl_status: "HBL 状态", mbl_status: "MBL 状态", finance_status: "费用状态",
  bl_type: "提单类型", freight_terms: "付款方式", incoterms: "贸易条款",
  manifest_confirmed_at: "✓ 舱单确认", route_confirmed_at: "✓ 航线确认",
  booking_confirmed_at: "✓ 订舱确认", space_released_at: "✓ 放舱确认",
  container_released_at: "✓ 放箱确认",
};

const label = (col) => COL_LABELS[col] || col;
const fmtVal = (v) => {
  if (v === null || v === undefined) return <span style={{ color: "#999" }}>(空)</span>;
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > 60 ? s.slice(0, 60) + "…" : s;
};

export default function HistoryModal({ open, onClose, shipmentId }) {
  const [rows, setRows] = useState([]);
  const [users, setUsers] = useState({});  // id → display name
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open || !shipmentId) return;
    setLoading(true);
    Promise.all([
      supabase.from("shipments_audit").select("*")
        .eq("shipment_id", shipmentId).order("changed_at", { ascending: false }).limit(200),
      supabase.from("user_profiles_view").select("id, display_name, full_name, email"),
    ]).then(([{ data: audit }, { data: us }]) => {
      setRows(audit || []);
      const m = {};
      (us || []).forEach(u => { m[u.id] = u.display_name || u.full_name || u.email; });
      setUsers(m);
      setLoading(false);
    });
  }, [open, shipmentId]);

  if (!open) return null;

  const fmtTime = (s) => {
    if (!s) return "";
    const d = new Date(s);
    const pad = n => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };

  return (
    <ModalShell title={`📜 修改历史（${rows.length} 条，最多 200）`} width={880} zIndex={1000} onClose={onClose}>
          {loading ? (
            <div style={{ padding: 24, textAlign: "center", color: "#888" }}>加载中…</div>
          ) : rows.length === 0 ? (
            <div style={{ padding: 24, textAlign: "center", color: "#888" }}>暂无历史</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {rows.map(r => {
                const changes = r.changes || {};
                const cols = Object.keys(changes);
                return (
                  <div key={r.id} style={{ border: "1px solid #e6e6e6", borderRadius: 4, padding: 10, background: "#fafafa" }}>
                    <div style={{ fontSize: 11, color: "#666", marginBottom: 6, fontFamily: "Consolas,monospace" }}>
                      {fmtTime(r.changed_at)}
                      <span style={{ marginLeft: 12, color: "#1990ff", fontWeight: 600 }}>
                        {users[r.changed_by] || "(系统)"}
                      </span>
                      <span style={{ marginLeft: 12, color: "#888" }}>{cols.length} 处变化</span>
                    </div>
                    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                      <tbody>
                        {cols.map(c => (
                          <tr key={c}>
                            <td style={{ padding: 3, width: 140, color: "#444", verticalAlign: "top" }}>{label(c)}</td>
                            <td style={{ padding: 3, color: "#c00", verticalAlign: "top" }}>{fmtVal(changes[c]?.old)}</td>
                            <td style={{ padding: 3, color: "#888", verticalAlign: "top", width: 24, textAlign: "center" }}>→</td>
                            <td style={{ padding: 3, color: "#52c41a", verticalAlign: "top" }}>{fmtVal(changes[c]?.new)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>
          )}
    </ModalShell>
  );
}
