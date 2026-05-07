// ============================================================================
// BookingConfirmation.jsx — 委托书（Booking Confirmation）
// 路由：#/docs/booking/<shipment_id>
// 用途：发给船公司或订舱代理，确认订舱细节
// 排版：A4 纵向
// 打印：浏览器原生 window.print() + tms.css 的 @media print 规则
// ============================================================================

import { useEffect, useState } from "react";
import { supabase } from "../../supabase.js";

export default function BookingConfirmation({ shipmentId, onBack }) {
  const [shipment, setShipment] = useState(null);
  const [company, setCompany]   = useState(null);
  const [cargoItems, setCargo]  = useState([]);
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [{ data: s, error: e1 }, { data: c }] = await Promise.all([
        supabase.from("shipments").select("*").eq("id", shipmentId).single(),
        supabase.from("company_settings").select("*").eq("id", 1).single(),
      ]);
      if (e1) { alert("加载票号失败: " + e1.message); setLoading(false); return; }
      setShipment(s);
      setCompany(c || {});
      // 货物明细：按 PO 关联 container_items（与 Orders 详情页同样的逻辑）
      if (s?.po) {
        const { data: ci } = await supabase
          .from("container_items").select("*")
          .eq("po", s.po);
        setCargo(ci || []);
      }
      setLoading(false);
    })();
  }, [shipmentId]);

  const print = () => window.print();

  if (loading) return <div style={{ padding: 24 }}>加载中...</div>;
  if (!shipment) return <div style={{ padding: 24 }}>票号不存在</div>;

  const s = shipment;
  const co = company || {};

  // 计算货物合计
  const totalPkg = cargoItems.reduce((sum, x) => sum + (parseInt(x.qty_packages) || 0), 0);
  const totalWt  = cargoItems.reduce((sum, x) => sum + (parseFloat(x.gross_weight) || 0), 0);
  const totalVol = cargoItems.reduce((sum, x) => sum + (parseFloat(x.volume) || 0), 0);

  return (
    <div className="doc-page">
      {/* 自给自足的打印样式 + A4 排版 */}
      <style>{`
        .doc-page { background: #f0f0f0; min-height: 100vh; }
        .doc-a4 {
          width: 210mm; min-height: 297mm; padding: 16mm 14mm;
          margin: 16px auto; background: #fff;
          box-shadow: 0 2px 12px rgba(0,0,0,0.12);
          font-family: 'Segoe UI','Microsoft YaHei',sans-serif;
          color: #222;
          line-height: 1.45;
        }
        @media print {
          @page { size: A4; margin: 0; }
          body { background: #fff !important; }
          .no-print { display: none !important; }
          .doc-page { background: #fff; }
          .doc-a4 {
            width: 210mm; min-height: 297mm;
            margin: 0; padding: 14mm 12mm;
            box-shadow: none;
            page-break-after: always;
          }
        }
      `}</style>

      {/* 顶部工具条（打印时隐藏） */}
      <div className="doc-toolbar no-print" style={{
        position: "sticky", top: 0, zIndex: 10,
        padding: "10px 16px", background: "#f5f5f5", borderBottom: "1px solid #ddd",
        display: "flex", alignItems: "center", gap: 12,
      }}>
        <button onClick={onBack} style={btn}>← 返回</button>
        <span style={{ fontSize: 13, color: "#666" }}>
          委托书 · {s.order_no} · {s.customer || "—"}
        </span>
        <div style={{ flex: 1 }} />
        <button onClick={print} style={btnPrimary}>🖨 打印 / 另存为 PDF</button>
      </div>

      {/* A4 单证主体 */}
      <div className="doc-a4">
        {/* 抬头 */}
        <header style={{ borderBottom: "2px solid #000", paddingBottom: 8, marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              {co.logo_url
                ? <img src={co.logo_url} alt="logo" style={{ height: 50 }} />
                : <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: 1 }}>{co.name_en || "BANSAR"}</div>}
              <div style={{ fontSize: 14, fontWeight: 600, marginTop: 4 }}>{co.name_zh}</div>
            </div>
            <div style={{ textAlign: "right", fontSize: 10, color: "#444", lineHeight: 1.6 }}>
              {co.address_zh && <div>{co.address_zh}</div>}
              {co.tel && <div>电话 Tel: {co.tel}</div>}
              {co.email && <div>邮箱 Email: {co.email}</div>}
              {co.website && <div>{co.website}</div>}
            </div>
          </div>
        </header>

        {/* 大标题 */}
        <h1 style={{ textAlign: "center", fontSize: 22, letterSpacing: 6, margin: "8px 0 20px" }}>
          订舱委托书 / BOOKING CONFIRMATION
        </h1>

        {/* 元信息（作业号 + 日期） */}
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12, fontSize: 11 }}>
          <div><b>作业号 / Job No:</b> <span style={mono}>{s.order_no}</span></div>
          <div><b>日期 / Date:</b> {new Date().toLocaleDateString("en-CA")}</div>
        </div>

        {/* Section 1: 船舶信息 */}
        <Section title="一、船舶信息 / VESSEL INFO">
          <Grid cols={2}>
            <Cell label="船公司 Carrier"        value={s.carrier} />
            <Cell label="船名 Vessel"           value={s.vessel} />
            <Cell label="航次 Voyage"           value={s.voyage} />
            <Cell label="MB/L No."              value={s.booking_no} mono />
            <Cell label="起运港 POL"            value={s.pol} />
            <Cell label="卸货港 POD"            value={s.pod} />
            <Cell label="预计开航 ETD"          value={s.etd} />
            <Cell label="预计到港 ETA"          value={s.eta} />
            <Cell label="服务类型 Service"      value={s.service_type || "CY-CY"} />
            <Cell label="付款方式 Payment"      value={s.carrier_payment_term || "预付"} />
          </Grid>
        </Section>

        {/* Section 2: 提单信息 */}
        <Section title="二、提单信息 / B/L INFO">
          <Grid cols={2}>
            <Cell label="提单类型 B/L Type"     value={s.bl_type || s.ocean_bl_type} />
            <Cell label="HB/L No."              value={s.hbl_no} mono />
            <Cell label="贸易条款 Incoterms"    value={s.trade_term} />
            <Cell label="运费条款 Freight"      value={s.freight_term} />
          </Grid>
        </Section>

        {/* Section 3: 三大方 */}
        <Section title="三、相关方 / PARTIES">
          <BlockField label="发货人 Shipper" value={s.shipper_name || s.carrier_shipper} />
          <BlockField label="收货人 Consignee" value={s.consignee_name} />
          <BlockField label="通知人 Notify Party" value={s.notify_party} />
        </Section>

        {/* Section 4: 货物 */}
        <Section title="四、货物明细 / CARGO">
          <Grid cols={3}>
            <Cell label="品名 Commodity"        value={s.cargo_type || "普通货物"} />
            <Cell label="箱型箱量 Container"    value={s.qty_container} />
            <Cell label="件数 Pieces"           value={s.qty_packages || totalPkg || "—"} />
            <Cell label="毛重 Gross Weight"     value={(s.weight || totalWt) ? `${s.weight || totalWt.toFixed(2)} KGS` : "—"} />
            <Cell label="体积 Volume"           value={(s.volume || totalVol) ? `${s.volume || totalVol.toFixed(3)} CBM` : "—"} />
            <Cell label="HS Code"               value={cargoItems[0]?.hs_code || "—"} />
          </Grid>
          {cargoItems.length > 0 && (
            <table style={{ width: "100%", marginTop: 8, borderCollapse: "collapse", fontSize: 10 }}>
              <thead>
                <tr style={{ background: "#f0f0f0" }}>
                  <th style={cellTH}>#</th>
                  <th style={cellTH}>品名 Description</th>
                  <th style={cellTH}>HS Code</th>
                  <th style={cellTH}>件数 Pcs</th>
                  <th style={cellTH}>毛重 KGS</th>
                  <th style={cellTH}>体积 CBM</th>
                </tr>
              </thead>
              <tbody>
                {cargoItems.map((it, i) => (
                  <tr key={it.id || i}>
                    <td style={cellTD}>{i + 1}</td>
                    <td style={cellTD}>{it.description || it.cargo_name || "—"}</td>
                    <td style={cellTD}>{it.hs_code || "—"}</td>
                    <td style={{ ...cellTD, textAlign: "right" }}>{it.qty_packages || "—"}</td>
                    <td style={{ ...cellTD, textAlign: "right" }}>{it.gross_weight || "—"}</td>
                    <td style={{ ...cellTD, textAlign: "right" }}>{it.volume || "—"}</td>
                  </tr>
                ))}
                <tr style={{ background: "#fafafa", fontWeight: 600 }}>
                  <td style={cellTD} colSpan={3}>合计 Total</td>
                  <td style={{ ...cellTD, textAlign: "right" }}>{totalPkg || "—"}</td>
                  <td style={{ ...cellTD, textAlign: "right" }}>{totalWt ? totalWt.toFixed(2) : "—"}</td>
                  <td style={{ ...cellTD, textAlign: "right" }}>{totalVol ? totalVol.toFixed(3) : "—"}</td>
                </tr>
              </tbody>
            </table>
          )}
          {s.marks && (
            <BlockField label="唛头 Marks" value={s.marks} />
          )}
        </Section>

        {/* Section 5: 备注 */}
        {(s.operator_note || s.remark) && (
          <Section title="五、备注 / REMARKS">
            <div style={{ whiteSpace: "pre-wrap", padding: 8, background: "#fafafa",
                          border: "1px solid #eee", fontSize: 11 }}>
              {s.operator_note || s.remark}
            </div>
          </Section>
        )}

        {/* 签章区 */}
        <div style={{ marginTop: 32, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
          <SignatureBlock title="委托方 / Client" name={s.customer} />
          <SignatureBlock title="承运方 / Carrier" name={co.name_zh} stamp={co.stamp_url} />
        </div>

        {/* 页脚 */}
        <footer style={{ marginTop: 32, paddingTop: 8, borderTop: "1px solid #ccc",
                         textAlign: "center", fontSize: 9, color: "#888" }}>
          {co.name_zh} · {co.tel} · {co.email} · {co.website}
        </footer>
      </div>
    </div>
  );
}

// ────────── 子组件 ──────────

function Section({ title, children }) {
  return (
    <section style={{ marginBottom: 14 }}>
      <h3 style={{
        fontSize: 12, fontWeight: 700, padding: "4px 8px",
        background: "#000", color: "#fff", margin: "0 0 6px",
      }}>{title}</h3>
      <div style={{ paddingLeft: 4 }}>{children}</div>
    </section>
  );
}

function Grid({ cols, children }) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: `repeat(${cols}, 1fr)`,
      gap: "4px 16px",
    }}>{children}</div>
  );
}

function Cell({ label, value, mono: isMono }) {
  return (
    <div style={{ display: "flex", padding: "3px 0", borderBottom: "1px dotted #ddd", fontSize: 11 }}>
      <span style={{ flex: "0 0 110px", color: "#666" }}>{label}</span>
      <span style={{ flex: 1, fontWeight: 500, ...(isMono ? mono : {}) }}>
        {value || "—"}
      </span>
    </div>
  );
}

function BlockField({ label, value }) {
  return (
    <div style={{ marginTop: 4, marginBottom: 4 }}>
      <div style={{ fontSize: 10, color: "#666", marginBottom: 2 }}>{label}</div>
      <div style={{
        whiteSpace: "pre-wrap", minHeight: 36,
        padding: 6, fontSize: 11,
        border: "1px solid #ddd", background: "#fff",
      }}>{value || "—"}</div>
    </div>
  );
}

function SignatureBlock({ title, name, stamp }) {
  return (
    <div style={{ border: "1px solid #ccc", padding: 12, minHeight: 100, position: "relative" }}>
      <div style={{ fontSize: 10, color: "#666", marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 12, fontWeight: 600 }}>{name || "—"}</div>
      {stamp && (
        <img src={stamp} alt="stamp"
             style={{ position: "absolute", right: 12, bottom: 8, height: 60, opacity: 0.85 }} />
      )}
      <div style={{ position: "absolute", bottom: 8, left: 12, fontSize: 9, color: "#999" }}>
        签字 / 盖章 · 日期：__________
      </div>
    </div>
  );
}

// ────────── 样式常量 ──────────

const mono   = { fontFamily: "'Consolas','Microsoft YaHei',monospace" };
const cellTH = { padding: "4px 6px", border: "1px solid #ccc", fontWeight: 600, fontSize: 10, textAlign: "left" };
const cellTD = { padding: "4px 6px", border: "1px solid #ddd", fontSize: 10 };

const btn = {
  padding: "5px 14px", background: "#fff",
  border: "1px solid #d9d9d9", borderRadius: 3,
  fontSize: 12, cursor: "pointer",
};
const btnPrimary = { ...btn, background: "#1890ff", color: "#fff", border: "1px solid #1890ff" };
