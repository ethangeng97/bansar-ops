// ============================================================================
// ChargesPrint — 单票费用清单（可打印）
// 路由：#/print/charges/{shipmentId}
// 内部使用，含 AR + AP + 毛利。@media print 隐藏顶部工具条。
// ============================================================================
import { useEffect, useState } from "react";
import { supabase } from "../supabase.js";

export default function ChargesPrint({ shipmentId, onBack }) {
  const [shipment, setShipment] = useState(null);
  const [ar, setAr] = useState([]);
  const [ap, setAp] = useState([]);
  const [ciMap, setCiMap] = useState({});
  const [pMap, setPMap] = useState({});
  const [company, setCompany] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!shipmentId) { setError("缺少 shipmentId"); setLoading(false); return; }
    (async () => {
      try {
        const [{ data: ship }, { data: charges }, { data: items }, { data: parts }, { data: comp }] = await Promise.all([
          supabase.from("shipments").select("*").eq("id", shipmentId).single(),
          supabase.from("charges").select("*").eq("shipment_id", shipmentId).order("direction").order("sort_order").order("created_at"),
          supabase.from("charge_items").select("id, name_zh"),
          supabase.from("customers").select("id, name"),
          supabase.from("company_settings").select("*").eq("id", 1).single(),
        ]);
        if (!ship) throw new Error("作业不存在");
        setShipment(ship);
        setCiMap(Object.fromEntries((items || []).map(i => [i.id, i.name_zh])));
        setPMap(Object.fromEntries((parts || []).map(p => [p.id, p.name])));
        setCompany(comp || {});
        setAr((charges || []).filter(c => c.direction === "应收"));
        setAp((charges || []).filter(c => c.direction === "应付"));
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [shipmentId]);

  useEffect(() => {
    if (shipment) document.title = `费用清单 - ${shipment.order_no || shipmentId}`;
    return () => { document.title = "Bansar OPS"; };
  }, [shipment, shipmentId]);

  if (loading) return <div style={{ padding: 40, textAlign: "center", color: "#888" }}>加载中…</div>;
  if (error)   return <div style={{ padding: 40, textAlign: "center", color: "#c00" }}>{error}</div>;

  const arSum = ar.reduce((s, c) => s + (parseFloat(c.amount_cny) || 0), 0);
  const apSum = ap.reduce((s, c) => s + (parseFloat(c.amount_cny) || 0), 0);
  const gross = arSum - apSum;

  return (
    <div style={{ background: "#f4f5f7", minHeight: "100vh", paddingBottom: 40 }}>
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: #fff !important; }
          .print-page { box-shadow: none !important; margin: 0 !important; padding: 16mm !important; }
        }
      `}</style>
      <div className="no-print" style={{ background: "#fff", borderBottom: "1px solid #e0e0e0", padding: "10px 20px", display: "flex", gap: 10, alignItems: "center" }}>
        <button onClick={() => onBack ? onBack() : window.close()} style={btn("#e2e8f0", "#475569")}>关闭</button>
        <button onClick={() => window.print()} style={btn("#0ea5e9", "#fff")}>🖨️ 打印</button>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "#888" }}>提示：浏览器打印对话框中可选「另存为 PDF」</span>
      </div>
      <div className="print-page" style={{ background: "#fff", maxWidth: 900, margin: "20px auto", padding: 40, boxShadow: "0 2px 10px rgba(0,0,0,.06)", fontFamily: "'Microsoft YaHei', Arial, sans-serif" }}>
        <div style={{ textAlign: "center", marginBottom: 16 }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#1f3864" }}>{company.name_zh || "Bansar OPS"}</div>
          <div style={{ fontSize: 14, marginTop: 4 }}>费用清单 / Charges Statement</div>
        </div>
        <table style={{ width: "100%", fontSize: 12, marginBottom: 14 }}>
          <tbody>
            <tr>
              <td style={cell}><b>作业号</b></td><td style={cell}>{shipment.order_no || "—"}</td>
              <td style={cell}><b>MBL No.</b></td><td style={cell}>{shipment.mbl_no || "—"}</td>
            </tr>
            <tr>
              <td style={cell}><b>委托单位</b></td><td style={cell}>{shipment.customer || "—"}</td>
              <td style={cell}><b>船名航次</b></td><td style={cell}>{(shipment.vessel || "") + " / " + (shipment.voyage || "")}</td>
            </tr>
            <tr>
              <td style={cell}><b>装货港</b></td><td style={cell}>{shipment.pol || "—"}</td>
              <td style={cell}><b>卸货港</b></td><td style={cell}>{shipment.pod || "—"}</td>
            </tr>
            <tr>
              <td style={cell}><b>ETD</b></td><td style={cell}>{shipment.etd || "—"}</td>
              <td style={cell}><b>打印时间</b></td><td style={cell}>{new Date().toLocaleString("zh-CN")}</td>
            </tr>
          </tbody>
        </table>

        <ChargesTable title="应收（来自客户）" rows={ar} ciMap={ciMap} pMap={pMap} accent="#0050b3" />
        <div style={{ height: 14 }} />
        <ChargesTable title="应付（给供应商）" rows={ap} ciMap={ciMap} pMap={pMap} accent="#ad4e00" />

        <div style={{ marginTop: 18, padding: 12, background: "#f7faff", border: "1px solid #d6e4ff", borderRadius: 4, fontSize: 13 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 20 }}>
            <span>应收合计：<b style={{ color: "#0050b3" }}>{arSum.toFixed(2)} CNY</b></span>
            <span>应付合计：<b style={{ color: "#ad4e00" }}>{apSum.toFixed(2)} CNY</b></span>
            <span>毛利：<b style={{ color: gross >= 0 ? "#52c41a" : "#cf1322" }}>{gross >= 0 ? "+" : ""}{gross.toFixed(2)} CNY</b></span>
            <span>毛利率：<b>{arSum > 0 ? ((gross / arSum) * 100).toFixed(1) + "%" : "—"}</b></span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ChargesTable({ title, rows, ciMap, pMap, accent }) {
  const sum = rows.reduce((s, c) => s + (parseFloat(c.amount_cny) || 0), 0);
  return (
    <div>
      <div style={{ background: accent + "10", padding: "6px 10px", borderTop: `2px solid ${accent}`, fontSize: 13, fontWeight: 600, color: accent }}>
        {title}（{rows.length} 项 / 合计 {sum.toFixed(2)} CNY）
      </div>
      <table style={{ width: "100%", fontSize: 11.5, borderCollapse: "collapse", border: "1px solid #ddd" }}>
        <thead>
          <tr style={{ background: "#fafafa" }}>
            <th style={th}>#</th>
            <th style={th}>费用名称</th>
            <th style={th}>结算单位</th>
            <th style={th}>单位</th>
            <th style={th}>数量</th>
            <th style={th}>单价</th>
            <th style={th}>币种</th>
            <th style={th}>原币合计</th>
            <th style={th}>折 CNY</th>
            <th style={th}>备注</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr><td colSpan={10} style={{ padding: 10, textAlign: "center", color: "#aaa" }}>无</td></tr>
          )}
          {rows.map((r, i) => (
            <tr key={r.id} style={{ borderTop: "1px solid #eee" }}>
              <td style={td}>{i + 1}</td>
              <td style={td}>{ciMap[r.charge_item_id] || "—"}</td>
              <td style={td}>{pMap[r.partner_id] || r.partner_name || "—"}</td>
              <td style={td}>{r.unit}</td>
              <td style={tdRight}>{r.quantity}</td>
              <td style={tdRight}>{Number(r.unit_price).toFixed(2)}</td>
              <td style={td}>{r.currency}</td>
              <td style={tdRight}>{Number(r.amount_total || 0).toFixed(2)}</td>
              <td style={tdRight}>{Number(r.amount_cny || 0).toFixed(2)}</td>
              <td style={td}>{r.remark || ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const cell = { padding: "4px 8px", border: "1px solid #ddd" };
const th = { padding: "5px 8px", border: "1px solid #ddd", fontWeight: 600, color: "#555" };
const td = { padding: "4px 8px", border: "1px solid #eee" };
const tdRight = { ...td, textAlign: "right" };
const btn = (bg, fg) => ({
  padding: "6px 14px", border: "none", borderRadius: 4, background: bg, color: fg,
  fontSize: 13, fontWeight: 500, cursor: "pointer",
});
