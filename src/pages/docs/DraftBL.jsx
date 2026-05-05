// ============================================================================
// DraftBL.jsx — 提单确认件 (Draft B/L)
// 路由：#/docs/draft_bl/<shipment_id>
// 用途：发客户确认提单内容；客户确认后据此签 OBL
// 排版：A4 纵向，16 框国际通用提单格式
// 关键：左上角 DRAFT 水印 + "Subject to confirmation" 声明
// ============================================================================

import { useEffect, useState } from "react";
import { supabase } from "../../supabase.js";

export default function DraftBL({ shipmentId, onBack }) {
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
      if (s?.po) {
        const { data: ci } = await supabase
          .from("container_items").select("*").eq("po", s.po);
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

  // 货物合计
  const totalPkg = cargoItems.reduce((sum, x) => sum + (parseInt(x.qty_packages) || 0), 0);
  const totalWt  = cargoItems.reduce((sum, x) => sum + (parseFloat(x.gross_weight) || 0), 0);
  const totalVol = cargoItems.reduce((sum, x) => sum + (parseFloat(x.volume) || 0), 0);

  // 提单号优先 HBL，没有用 MBL
  const blNo = s.hbl_no || s.booking_no || "";

  // 描述：合并所有 container_items 的描述，或用 cargo_type
  const desc = cargoItems.length > 0
    ? cargoItems.map(it => it.description || it.cargo_name).filter(Boolean).join("\n")
    : (s.cargo_type || "GENERAL CARGO");

  return (
    <div className="doc-page">
      <style>{`
        .doc-page { background: #f0f0f0; min-height: 100vh; }
        .bl-a4 {
          width: 210mm; min-height: 297mm; padding: 12mm 10mm;
          margin: 16px auto; background: #fff;
          box-shadow: 0 2px 12px rgba(0,0,0,0.12);
          font-family: 'Segoe UI','Microsoft YaHei',sans-serif;
          color: #000;
          font-size: 10px;
          line-height: 1.4;
          position: relative;
        }
        .bl-watermark {
          position: absolute; top: 35%; left: 50%;
          transform: translate(-50%, -50%) rotate(-25deg);
          font-size: 140px; font-weight: 900;
          color: rgba(255, 0, 0, 0.08);
          letter-spacing: 14px;
          pointer-events: none;
          z-index: 1;
          user-select: none;
        }
        .bl-grid {
          position: relative; z-index: 2;
          border: 2px solid #000;
        }
        .bl-row { display: flex; border-bottom: 1px solid #000; }
        .bl-row:last-child { border-bottom: none; }
        .bl-cell { padding: 4px 6px; border-right: 1px solid #000; }
        .bl-cell:last-child { border-right: none; }
        .bl-label {
          font-size: 8px; font-weight: 700;
          color: #444; text-transform: uppercase; letter-spacing: 0.5px;
          margin-bottom: 2px;
        }
        .bl-value {
          font-size: 10px; white-space: pre-wrap;
          min-height: 12px;
        }
        @media print {
          @page { size: A4; margin: 0; }
          body { background: #fff !important; }
          .no-print { display: none !important; }
          .doc-page { background: #fff; }
          .bl-a4 {
            width: 210mm; min-height: 297mm;
            margin: 0; padding: 10mm 8mm;
            box-shadow: none;
            page-break-after: always;
          }
        }
      `}</style>

      {/* 工具条（打印时隐藏） */}
      <div className="no-print" style={{
        position: "sticky", top: 0, zIndex: 10,
        padding: "10px 16px", background: "#f5f5f5", borderBottom: "1px solid #ddd",
        display: "flex", alignItems: "center", gap: 12,
      }}>
        <button onClick={onBack} style={btn}>← 返回</button>
        <span style={{ fontSize: 13, color: "#666" }}>
          提单确认件 Draft B/L · {s.order_no} · {blNo}
        </span>
        <div style={{ flex: 1 }} />
        <button onClick={print} style={btnPrimary}>🖨 打印 / 另存为 PDF</button>
      </div>

      {/* A4 单证主体 */}
      <div className="bl-a4">
        {/* DRAFT 水印 */}
        <div className="bl-watermark">DRAFT</div>

        {/* 抬头条 */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
                      borderBottom: "2px solid #000", paddingBottom: 6, marginBottom: 4, position: "relative", zIndex: 2 }}>
          <div>
            {co.logo_url
              ? <img src={co.logo_url} alt="logo" style={{ height: 38 }} />
              : <div style={{ fontSize: 18, fontWeight: 800, letterSpacing: 1 }}>{co.name_en || "BANSAR"}</div>}
            <div style={{ fontSize: 9, color: "#444" }}>{co.name_zh}</div>
          </div>
          <div style={{ textAlign: "center", flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 800, letterSpacing: 4 }}>BILL OF LADING</div>
            <div style={{ fontSize: 9, color: "#a00", fontWeight: 700, marginTop: 2 }}>
              ⚠ DRAFT — Subject to client confirmation
            </div>
          </div>
          <div style={{ textAlign: "right", fontSize: 9, color: "#444" }}>
            {co.address_zh && <div>{co.address_zh}</div>}
            {co.tel && <div>Tel: {co.tel}</div>}
            {co.email && <div>{co.email}</div>}
          </div>
        </div>

        {/* 16 框 B/L 格式 */}
        <div className="bl-grid">
          {/* Row 1: Shipper | B/L No. */}
          <div className="bl-row">
            <div className="bl-cell" style={{ flex: 1.2 }}>
              <div className="bl-label">Shipper / 发货人</div>
              <div className="bl-value" style={{ minHeight: 60 }}>{s.shipper_name || "—"}</div>
            </div>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", borderRight: "1px solid #000" }}>
              <div className="bl-cell" style={{ borderBottom: "1px solid #000" }}>
                <div className="bl-label">B/L No.</div>
                <div className="bl-value" style={mono}>{blNo || "—"}</div>
              </div>
              <div className="bl-cell" style={{ borderBottom: "1px solid #000" }}>
                <div className="bl-label">Booking No.</div>
                <div className="bl-value" style={mono}>{s.booking_no || "—"}</div>
              </div>
              <div className="bl-cell">
                <div className="bl-label">Reference No. / 参考号</div>
                <div className="bl-value" style={mono}>{s.order_no || "—"}</div>
              </div>
            </div>
          </div>

          {/* Row 2: Consignee */}
          <div className="bl-row">
            <div className="bl-cell" style={{ flex: 1, width: "100%" }}>
              <div className="bl-label">Consignee / 收货人</div>
              <div className="bl-value" style={{ minHeight: 60 }}>{s.consignee_name || "—"}</div>
            </div>
          </div>

          {/* Row 3: Notify Party */}
          <div className="bl-row">
            <div className="bl-cell" style={{ flex: 1, width: "100%" }}>
              <div className="bl-label">Notify Party / 通知人</div>
              <div className="bl-value" style={{ minHeight: 60 }}>{s.notify_party || "SAME AS CONSIGNEE"}</div>
            </div>
          </div>

          {/* Row 4: Pre-carriage / Place of Receipt | Vessel / Voyage */}
          <div className="bl-row">
            <div className="bl-cell" style={{ flex: 1 }}>
              <div className="bl-label">Pre-carriage by / 前段运输</div>
              <div className="bl-value">—</div>
            </div>
            <div className="bl-cell" style={{ flex: 1 }}>
              <div className="bl-label">Place of Receipt / 收货地</div>
              <div className="bl-value">{s.pol || "—"}</div>
            </div>
            <div className="bl-cell" style={{ flex: 1 }}>
              <div className="bl-label">Vessel / 船名</div>
              <div className="bl-value">{s.vessel || "—"}</div>
            </div>
            <div className="bl-cell" style={{ flex: 0.7 }}>
              <div className="bl-label">Voy. / 航次</div>
              <div className="bl-value">{s.voyage || "—"}</div>
            </div>
          </div>

          {/* Row 5: POL | POD | Place of Delivery */}
          <div className="bl-row">
            <div className="bl-cell" style={{ flex: 1 }}>
              <div className="bl-label">Port of Loading / 装货港</div>
              <div className="bl-value">{s.pol || "—"}</div>
            </div>
            <div className="bl-cell" style={{ flex: 1 }}>
              <div className="bl-label">Port of Discharge / 卸货港</div>
              <div className="bl-value">{s.pod || "—"}</div>
            </div>
            <div className="bl-cell" style={{ flex: 1.7 }}>
              <div className="bl-label">Place of Delivery / 交货地</div>
              <div className="bl-value">{s.pod || "—"}</div>
            </div>
          </div>

          {/* Row 6: Cargo description headers */}
          <div className="bl-row" style={{ background: "#f5f5f5" }}>
            <div className="bl-cell" style={{ flex: 1, fontWeight: 700, fontSize: 9 }}>
              Marks &amp; Numbers / 唛头
            </div>
            <div className="bl-cell" style={{ flex: 0.6, textAlign: "center", fontWeight: 700, fontSize: 9 }}>
              No. of Pkgs<br/>件数
            </div>
            <div className="bl-cell" style={{ flex: 1.8, fontWeight: 700, fontSize: 9 }}>
              Description of Goods / 货物描述
            </div>
            <div className="bl-cell" style={{ flex: 0.7, textAlign: "right", fontWeight: 700, fontSize: 9 }}>
              Gross Weight<br/>毛重 (KGS)
            </div>
            <div className="bl-cell" style={{ flex: 0.7, textAlign: "right", fontWeight: 700, fontSize: 9 }}>
              Measurement<br/>体积 (CBM)
            </div>
          </div>

          {/* Row 7: Cargo body */}
          <div className="bl-row" style={{ minHeight: 180 }}>
            <div className="bl-cell" style={{ flex: 1, whiteSpace: "pre-wrap" }}>
              {s.marks || "N/M"}
            </div>
            <div className="bl-cell" style={{ flex: 0.6, textAlign: "center" }}>
              {(s.qty_packages || totalPkg) ? `${s.qty_packages || totalPkg}\nPACKAGES` : "—"}
            </div>
            <div className="bl-cell" style={{ flex: 1.8, whiteSpace: "pre-wrap" }}>
              {desc}
              {s.qty_container && <div style={{ marginTop: 6, fontSize: 9, color: "#666" }}>Container: {s.qty_container}</div>}
              <div style={{ marginTop: 8, fontStyle: "italic", color: "#a00", fontSize: 9 }}>
                ** "FREIGHT {s.freight_term || "PREPAID"}" **
              </div>
            </div>
            <div className="bl-cell" style={{ flex: 0.7, textAlign: "right" }}>
              {(s.weight || totalWt) ? (s.weight || totalWt.toFixed(2)) : "—"}
            </div>
            <div className="bl-cell" style={{ flex: 0.7, textAlign: "right" }}>
              {(s.volume || totalVol) ? (s.volume || totalVol.toFixed(3)) : "—"}
            </div>
          </div>

          {/* Row 8: Total */}
          <div className="bl-row" style={{ background: "#fafafa", fontWeight: 700 }}>
            <div className="bl-cell" style={{ flex: 1 }}>
              <span style={{ fontSize: 9 }}>TOTAL / 合计</span>
            </div>
            <div className="bl-cell" style={{ flex: 0.6, textAlign: "center" }}>
              {(s.qty_packages || totalPkg) || "—"}
            </div>
            <div className="bl-cell" style={{ flex: 1.8, fontStyle: "italic", fontSize: 9 }}>
              SAY TOTAL: {chineseNum(s.qty_packages || totalPkg)} PACKAGES ONLY
            </div>
            <div className="bl-cell" style={{ flex: 0.7, textAlign: "right" }}>
              {(s.weight || totalWt) ? (s.weight || totalWt.toFixed(2)) : "—"}
            </div>
            <div className="bl-cell" style={{ flex: 0.7, textAlign: "right" }}>
              {(s.volume || totalVol) ? (s.volume || totalVol.toFixed(3)) : "—"}
            </div>
          </div>

          {/* Row 9: Freight & Charges | Number of Original B/L */}
          <div className="bl-row">
            <div className="bl-cell" style={{ flex: 1.5 }}>
              <div className="bl-label">Freight &amp; Charges / 运费及费用</div>
              <div className="bl-value">{s.freight_term || "PREPAID"}</div>
            </div>
            <div className="bl-cell" style={{ flex: 1 }}>
              <div className="bl-label">Service Type / 服务类型</div>
              <div className="bl-value">{s.carrier_service || "CY-CY"}</div>
            </div>
            <div className="bl-cell" style={{ flex: 1 }}>
              <div className="bl-label">No. of Original B/L</div>
              <div className="bl-value">{s.bl_type === "电放" ? "TELEX RELEASE" : "THREE (3)"}</div>
            </div>
          </div>

          {/* Row 10: Place / Date of Issue | Signature */}
          <div className="bl-row">
            <div className="bl-cell" style={{ flex: 1 }}>
              <div className="bl-label">Place of Issue / 签发地</div>
              <div className="bl-value">{s.pol || "NINGBO, CHINA"}</div>
            </div>
            <div className="bl-cell" style={{ flex: 1 }}>
              <div className="bl-label">Date of Issue / 签发日期</div>
              <div className="bl-value">{s.etd || new Date().toLocaleDateString("en-CA")}</div>
            </div>
            <div className="bl-cell" style={{ flex: 1.5, position: "relative", minHeight: 50 }}>
              <div className="bl-label">Signed by / 签发人</div>
              <div className="bl-value" style={{ fontStyle: "italic", color: "#999" }}>
                For and on behalf of {co.name_en || co.name_zh}
              </div>
              {co.stamp_url && (
                <img src={co.stamp_url} alt="stamp"
                     style={{ position: "absolute", right: 8, bottom: 8, height: 50, opacity: 0.85 }} />
              )}
            </div>
          </div>
        </div>

        {/* 页脚说明 */}
        <div style={{
          marginTop: 8, fontSize: 8, color: "#666", lineHeight: 1.4,
          padding: 6, border: "1px dashed #ccc", position: "relative", zIndex: 2,
        }}>
          <b>NOTICE:</b> This is a DRAFT B/L for client confirmation only. It is NOT a negotiable
          document and shall not be used for any commercial or legal purpose.
          Please review all details carefully and confirm in writing. Once confirmed,
          the original B/L will be issued accordingly.
          <br/>
          <b>注意：</b>本单据仅为提单草稿，供客户核对内容使用，<b>不具备任何法律效力</b>。
          请仔细核对所有信息后书面确认，确认后我司将据此签发正本提单。
        </div>
      </div>
    </div>
  );
}

// 数字 → 简化英文（小写写法："ONE","TWO"...，超过 100 直接返回数字）
function chineseNum(n) {
  const num = parseInt(n);
  if (!num || num <= 0) return "ZERO";
  if (num > 100) return String(num).toUpperCase();
  const ones = ["", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT", "NINE",
                "TEN", "ELEVEN", "TWELVE", "THIRTEEN", "FOURTEEN", "FIFTEEN", "SIXTEEN",
                "SEVENTEEN", "EIGHTEEN", "NINETEEN"];
  const tens = ["", "", "TWENTY", "THIRTY", "FORTY", "FIFTY", "SIXTY", "SEVENTY", "EIGHTY", "NINETY"];
  if (num < 20) return ones[num];
  if (num < 100) return tens[Math.floor(num/10)] + (num % 10 ? "-" + ones[num % 10] : "");
  return "ONE HUNDRED";
}

const mono = { fontFamily: "'Consolas','Microsoft YaHei',monospace" };
const btn = {
  padding: "5px 14px", background: "#fff",
  border: "1px solid #d9d9d9", borderRadius: 3,
  fontSize: 12, cursor: "pointer",
};
const btnPrimary = { ...btn, background: "#1890ff", color: "#fff", border: "1px solid #1890ff" };
