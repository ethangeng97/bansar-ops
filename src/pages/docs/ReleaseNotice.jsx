// ============================================================================
// ReleaseNotice.jsx — 放舱信息
// 用途：发发货人/拖车队
// 字段（按行业实际需求）：
//   船期：船名航次/船公司/订舱号/POL/POD/ETD/ETA
//   截止：截关/SI 截单/VGM 截单
//   港口操作（宁波）：结算代码/进港代码/条码有效期
//   集装箱：提箱地点/起运港免用箱/免用箱计算方式/还箱期限
// 不显示：件毛体/箱封号（放舱时还没装柜）
// ============================================================================

import { useEffect, useState } from "react";
import { supabase } from "../../supabase.js";

const BRAND = "#1f3864";
const STAMP_RED = "#c00";

export default function ReleaseNotice({ shipmentId, onBack }) {
  const [shipment, setShipment] = useState(null);
  const [company, setCompany] = useState(null);
  const [loading, setLoading] = useState(true);

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
      setLoading(false);
    })();
  }, [shipmentId]);

  if (loading) return <div style={{ padding: 24 }}>加载中...</div>;
  if (!shipment) return <div style={{ padding: 24 }}>票号不存在</div>;

  const s = shipment;
  const co = company || {};
  const print = () => window.print();

  const issueDate = formatDateLong(new Date());

  return (
    <div className="doc-page" style={{ background: "#f0f0f0", minHeight: "100vh" }}>
      <style>{`
        @media print {
          @page { size: A4; margin: 0; }
          body { background: #fff !important; }
          .no-print { display: none !important; }
          .doc-page { background: #fff; }
          .rln-page { margin: 0 !important; box-shadow: none !important; }
        }
      `}</style>

      <div className="no-print" style={{
        position: "sticky", top: 0, zIndex: 100,
        padding: "10px 16px", background: "#f5f5f5", borderBottom: "1px solid #ddd",
        display: "flex", alignItems: "center", gap: 12,
      }}>
        <button onClick={onBack} style={btn}>← 返回</button>
        <span style={{ fontSize: 13, color: "#666" }}>放舱信息 · {s.order_no}</span>
        <div style={{ flex: 1 }} />
        <button onClick={print} style={btnPrimary}>🖨 打印 / 另存为 PDF</button>
      </div>

      <div className="rln-page" style={{
        width: "210mm", minHeight: "297mm", padding: "14mm 14mm",
        margin: "16px auto", background: "#fff",
        boxShadow: "0 2px 12px rgba(0,0,0,0.12)",
        fontFamily: "'Segoe UI','Microsoft YaHei',sans-serif",
        color: "#000", fontSize: 11, lineHeight: 1.5,
      }}>
        {/* 顶部抬头 */}
        <header style={{ display: "flex", alignItems: "center", gap: 12, paddingBottom: 10,
                          borderBottom: `2px solid ${BRAND}`, marginBottom: 12 }}>
          <div style={{ flex: "0 0 auto", width: 75 }}>
            {co.logo_url
              ? <img src={co.logo_url} alt="logo" style={{ maxWidth: 75, maxHeight: 60 }} />
              : <div style={{ width: 75, height: 60, border: "1px dashed #ccc",
                              display: "flex", alignItems: "center", justifyContent: "center",
                              color: "#999", fontSize: 9 }}>LOGO</div>}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 800, color: BRAND, letterSpacing: 0.2,
                          lineHeight: 1.25, whiteSpace: "nowrap" }}>
              {(co.name_en || "BANSAR (NINGBO) INT'L TRANSPORTATION CO., LTD.").toUpperCase()}
            </div>
          </div>
          <div style={{ flex: "0 0 auto", textAlign: "right", paddingLeft: 8 }}>
            <div style={{ fontSize: 8, color: "#444" }}>Reference No.</div>
            <div style={{ fontSize: 9.5, fontWeight: 700, fontFamily: "'Consolas',monospace", color: "#000" }}>
              {s.order_no || "—"}
            </div>
          </div>
        </header>

        {/* 大标题 */}
        <div style={{ textAlign: "center", margin: "16px 0 20px" }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: BRAND, letterSpacing: 3 }}>RELEASE NOTICE</div>
          <div style={{ fontSize: 13, color: "#444", marginTop: 4, letterSpacing: 4 }}>放 舱 信 息</div>
        </div>

        {/* 抬头信息 */}
        <div style={{ background: "#f5f8fc", border: "1px solid #cdd9ec",
                      padding: "10px 14px", marginBottom: 14, fontSize: 10.5 }}>
          <div><b>致 / To:</b> {s.shipper_name || "—"}</div>
          <div style={{ marginTop: 4 }}>
            <b>日期 / Date:</b> {issueDate}
            {(s.po || s.customer_po) && <>
              　　<b>客户参考号 / Customer Ref:</b> {s.po || s.customer_po}
            </>}
          </div>
        </div>

        {/* 船期信息 */}
        <Section title="船 期 信 息 / Vessel Schedule" headBg={BRAND} rows={[
            ["船名/航次 Vessel/Voy", `${s.vessel || "—"}${s.voyage ? " / " + s.voyage : ""}`],
            ["船公司 Carrier", s.carrier_name || s.shipping_line || "—"],
            ["订舱号 Booking No.", s.booking_no || "—", { bold: true, mono: true }],
            ["装港 / 卸港 POL/POD", `${s.pol || "—"} → ${s.pod || "—"}`],
            ["预计开航 ETD", s.etd ? formatDateLong(s.etd) : "—"],
            ["预计到港 ETA", s.eta ? formatDateLong(s.eta) : "—"],
        ]} />

        {/* 关键截止时间 */}
        <Section title="关 键 截 止 时 间 / Critical Cut-off Times" headBg={STAMP_RED} cellBg="#fff5f5" labelColor={STAMP_RED} rows={[
            ["截关时间 Customs Cut-off", s.customs_cutoff ? formatDateTime(s.customs_cutoff) : "—", { bold: true }],
            ["截单时间 SI Cut-off", s.si_cutoff ? formatDateTime(s.si_cutoff) : "—", { bold: true }],
            ["截 VGM 时间 VGM Cut-off", s.vgm_cutoff ? formatDateTime(s.vgm_cutoff) : "—", { bold: true }],
            ["还箱期限 Equipment Return", s.equipment_return ? formatDateTime(s.equipment_return) : "—", { bold: true }],
        ]} />

        {/* 港口操作信息 */}
        <Section title="港 口 操 作 信 息 / Port Operation" headBg={BRAND} rows={[
            ["结算代码 Settlement Code", s.settlement_code || "—", { mono: true }],
            ["进港代码 Port Entry Code", s.port_entry_code || "—", { mono: true, bold: true }],
            ["条码有效期 Barcode Expiry", s.barcode_expiry ? formatDateTime(s.barcode_expiry) : "—"],
        ]} />

        {/* 提箱信息 */}
        <Section title="提 箱 信 息 / Container Pickup" headBg={BRAND} rows={[
            ["提箱地点 Pickup Depot", s.pickup_depot || "—"],
            ["起运港免用箱 Free Demurrage", s.free_demurrage_days || "—", { bold: true }],
            ["免用箱计算方式 Free Demurrage Calc", s.free_demurrage_calc || "—"],
        ]} />

        {/* 警示框 */}
        <div style={{ fontSize: 10, lineHeight: 1.6, color: "#555",
                      padding: "8px 10px", background: "#fffbe6",
                      borderLeft: "3px solid #faad14", marginBottom: 16 }}>
          <b>请发货人务必：</b><br/>
          1. 在<b>截关时间</b>前完成报关申报<br/>
          2. 在<b>截单时间</b>前提供完整提单信息（Shipping Instruction）<br/>
          3. 装柜后及时提供箱号、封号、件数、重量、体积<br/>
          4. 在<b>还箱期限</b>前完成进港，逾期产生的滞箱/堆存费由发货人承担<br/>
          5. 注意条码有效期，过期需重新申请
        </div>

        {/* 签章区 (放舱信息属于内部操作通知，不需要章) */}
        <div style={{ marginTop: 24, paddingTop: 8, borderTop: "1px solid #ddd",
                      fontSize: 10, color: "#444", textAlign: "right" }}>
          Operator / 操作: <b style={{ color: "#000" }}>
            {(co.name_en || "BANSAR (NINGBO) INT'L TRANSPORTATION CO., LTD.").toUpperCase()}
          </b>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between",
                      marginTop: 14, paddingTop: 6, borderTop: "1px solid #ddd",
                      fontSize: 8, color: "#888" }}>
          <div>{(co.name_en || "BANSAR").toUpperCase()}</div>
          <div>Form BNSR-RLN</div>
        </div>
      </div>
    </div>
  );
}

function Section({ title, headBg, cellBg, labelColor, rows }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse",
                    marginBottom: 14, fontSize: 10.5 }}>
      <thead>
        <tr style={{ background: headBg, color: "#fff" }}>
          <th colSpan={2} style={{ padding: "6px 10px", textAlign: "left",
                                    fontSize: 11, letterSpacing: 1 }}>
            {title}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, val, opts], i) => {
          const o = opts || {};
          return (
            <tr key={i}>
              <td style={{ padding: "6px 10px", border: "1px solid #888",
                            background: cellBg || "#f5f8fc",
                            width: "32%",
                            fontWeight: 600,
                            color: labelColor || headBg }}>
                {label}
              </td>
              <td style={{ padding: "6px 10px", border: "1px solid #888",
                            fontWeight: o.bold ? 700 : 400,
                            fontFamily: o.mono ? "'Consolas',monospace" : "inherit",
                            whiteSpace: "pre-wrap" }}>
                {val}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function formatDateLong(d) {
  if (!d) return "—";
  const date = new Date(d);
  if (isNaN(date.getTime())) return "—";
  const months = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
  return `${date.getDate().toString().padStart(2, "0")} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

function formatDateTime(d) {
  if (!d) return "—";
  const date = new Date(d);
  if (isNaN(date.getTime())) return "—";
  const dateStr = formatDateLong(date);
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${dateStr} / ${hh}:${mm}`;
}

const btn = { padding: "5px 14px", background: "#fff", border: "1px solid #d9d9d9",
              borderRadius: 3, fontSize: 12, cursor: "pointer" };
const btnPrimary = { ...btn, background: "#1890ff", color: "#fff", border: "1px solid #1890ff" };
