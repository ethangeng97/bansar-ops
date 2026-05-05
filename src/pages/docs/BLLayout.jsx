// ============================================================================
// BLLayout.jsx — 提单共享布局（风格 A：经典船公司格式）
// 用途：被 DraftBL 和 BLCopy 共用，只通过 mode 区分水印/印章/页脚声明
// 风格 A：
//   - 顶部深蓝色横栏 (BANSAR — BILL OF LADING)
//   - 浅蓝填充字段块 (#f5f8fc 背景 + #cdd9ec 边框)
//   - 字段标签深蓝 (#1f3864) 大写
//   - 高对比度，扫描复印清晰，符合 CMA/Maersk 类船公司视觉惯例
// ============================================================================

import { useEffect, useState } from "react";
import { supabase } from "../../supabase.js";

const BRAND = "#1f3864";        // 深蓝主色
const BRAND_BG = "#f5f8fc";     // 浅蓝背景
const BRAND_BORDER = "#cdd9ec"; // 浅蓝边框
const STAMP_RED = "#c00";

export default function BLLayout({ shipmentId, onBack, mode }) {
  // mode: "draft" | "copy"
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

  const blNo = s.hbl_no || s.booking_no || "";
  const desc = cargoItems.length > 0
    ? cargoItems.map(it => it.description || it.cargo_name).filter(Boolean).join("\n")
    : (s.cargo_type || "GENERAL CARGO");

  // 实际开船日（Date of Shipment / On Board Date）：atd 优先，没有 fallback etd
  const onBoardDate = s.atd
    ? new Date(s.atd).toLocaleDateString("en-CA")
    : (s.etd ? new Date(s.etd).toLocaleDateString("en-CA") : "—");

  // Date of Issue：copy 用 obl_issued_at（如有）→ atd → etd → 今天；draft 用今天
  const issueDate = mode === "copy"
    ? (s.obl_issued_at
        ? new Date(s.obl_issued_at).toLocaleDateString("en-CA")
        : (s.atd || s.etd || new Date().toLocaleDateString("en-CA")))
    : new Date().toLocaleDateString("en-CA");

  const isDraft = mode === "draft";
  const isCopy  = mode === "copy";

  return (
    <div className="doc-page">
      <style>{`
        .doc-page { background: #f0f0f0; min-height: 100vh; }
        .bl-a4 {
          width: 210mm; min-height: 297mm; padding: 12mm 10mm;
          margin: 16px auto; background: #fff;
          box-shadow: 0 2px 12px rgba(0,0,0,0.12);
          font-family: 'Segoe UI','Microsoft YaHei',sans-serif;
          color: #000; font-size: 10px; line-height: 1.4;
          position: relative;
        }
        .bl-watermark {
          position: absolute; top: 38%; left: 50%;
          transform: translate(-50%, -50%) rotate(-22deg);
          font-size: 150px; font-weight: 900;
          color: rgba(192, 0, 0, 0.07);
          letter-spacing: 16px;
          pointer-events: none;
          z-index: 1;
          user-select: none;
        }
        .bl-stamp-copy {
          position: absolute; top: 25%; right: 10%;
          transform: rotate(-15deg);
          border: 4px double ${STAMP_RED};
          color: ${STAMP_RED};
          padding: 8px 22px;
          font-size: 26px; font-weight: 900;
          letter-spacing: 4px;
          opacity: 0.5;
          pointer-events: none;
          z-index: 1;
          user-select: none;
          background: rgba(255, 240, 240, 0.4);
          border-radius: 6px;
        }
        .bl-stamp-copy small {
          display: block; font-size: 11px; letter-spacing: 2px; margin-top: 2px;
        }
        .bl-grid { position: relative; z-index: 2; }
        .bl-row { display: flex; gap: 4px; margin-bottom: 4px; }
        .bl-cell {
          background: ${BRAND_BG};
          border: 1px solid ${BRAND_BORDER};
          padding: 5px 7px;
          flex: 1;
        }
        .bl-label {
          font-size: 8px; font-weight: 600;
          color: ${BRAND};
          text-transform: uppercase; letter-spacing: 0.6px;
          margin-bottom: 3px;
        }
        .bl-value {
          font-size: 10px; white-space: pre-wrap; min-height: 12px;
          color: #000;
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
          {isDraft ? "提单确认件 Draft B/L" : "提单副本 B/L Copy"} · {s.order_no} · {blNo}
        </span>
        <div style={{ flex: 1 }} />
        <button onClick={print} style={btnPrimary}>🖨 打印 / 另存为 PDF</button>
      </div>

      {/* A4 单证主体 */}
      <div className="bl-a4">
        {/* 水印 / 印章 */}
        {isDraft && <div className="bl-watermark">DRAFT</div>}
        {isCopy && <div className="bl-stamp-copy">COPY<small>NON-NEGOTIABLE</small></div>}

        {/* 顶部蓝色横栏（包含 logo + 标题） */}
        <div style={{
          background: BRAND, color: "#fff",
          padding: "10px 14px",
          display: "flex", alignItems: "center", gap: 14,
          marginBottom: 6, position: "relative", zIndex: 2,
        }}>
          {/* Logo 区 */}
          <div style={{
            background: "#fff", padding: "4px 8px", borderRadius: 3,
            display: "flex", alignItems: "center", justifyContent: "center",
            minWidth: 70, height: 38,
          }}>
            {co.logo_url
              ? <img src={co.logo_url} alt="logo" style={{ maxHeight: 32, maxWidth: 100 }} />
              : <span style={{ color: BRAND, fontSize: 16, fontWeight: 800, letterSpacing: 1 }}>BANSAR</span>}
          </div>

          {/* 标题区 */}
          <div style={{ flex: 1, textAlign: "center" }}>
            <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: 6 }}>BILL OF LADING</div>
            <div style={{ fontSize: 9, opacity: 0.85, marginTop: 2 }}>
              {co.name_en || co.name_zh}
            </div>
          </div>

          {/* 副标识 */}
          <div style={{
            background: "#fff",
            color: isDraft ? STAMP_RED : "#666",
            padding: "4px 10px", borderRadius: 3,
            fontSize: 10, fontWeight: 700, letterSpacing: 1,
            border: isDraft ? `1px solid ${STAMP_RED}` : "1px solid #999",
          }}>
            {isDraft ? "⚠ DRAFT" : "COPY"}
          </div>
        </div>

        {/* 副标题：只在 Draft 显示警告 */}
        {isDraft && (
          <div style={{
            textAlign: "center", color: STAMP_RED, fontSize: 10, fontWeight: 600,
            marginBottom: 6, position: "relative", zIndex: 2,
          }}>
            Subject to client confirmation · 待客户确认
          </div>
        )}

        {/* 16 框 B/L 主体 */}
        <div className="bl-grid">
          {/* Row 1: Shipper | B/L No. + Booking No. + Reference */}
          <div className="bl-row">
            <div className="bl-cell" style={{ flex: 1.4, minHeight: 70 }}>
              <div className="bl-label">Shipper / 发货人</div>
              <div className="bl-value">{s.shipper_name || "—"}</div>
            </div>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
              <div className="bl-cell">
                <div className="bl-label">B/L No.</div>
                <div className="bl-value" style={mono}>{blNo || "—"}</div>
              </div>
              <div className="bl-cell">
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
            <div className="bl-cell" style={{ minHeight: 60 }}>
              <div className="bl-label">Consignee / 收货人</div>
              <div className="bl-value">{s.consignee_name || "—"}</div>
            </div>
          </div>

          {/* Row 3: Notify Party */}
          <div className="bl-row">
            <div className="bl-cell" style={{ minHeight: 50 }}>
              <div className="bl-label">Notify Party / 通知人</div>
              <div className="bl-value">{s.notify_party || "SAME AS CONSIGNEE"}</div>
            </div>
          </div>

          {/* Row 4: Pre-carriage / Place of Receipt | Vessel / Voyage */}
          <div className="bl-row">
            <div className="bl-cell">
              <div className="bl-label">Pre-carriage by / 前段运输</div>
              <div className="bl-value">—</div>
            </div>
            <div className="bl-cell">
              <div className="bl-label">Place of Receipt / 收货地</div>
              <div className="bl-value">{s.pol || "—"}</div>
            </div>
            <div className="bl-cell" style={{ flex: 1.2 }}>
              <div className="bl-label">Ocean Vessel / 船名</div>
              <div className="bl-value">{s.vessel || "—"}</div>
            </div>
            <div className="bl-cell" style={{ flex: 0.5 }}>
              <div className="bl-label">Voy. No. / 航次</div>
              <div className="bl-value">{s.voyage || "—"}</div>
            </div>
          </div>

          {/* Row 5: POL | POD | Place of Delivery */}
          <div className="bl-row">
            <div className="bl-cell">
              <div className="bl-label">Port of Loading / 装货港</div>
              <div className="bl-value">{s.pol || "—"}</div>
            </div>
            <div className="bl-cell">
              <div className="bl-label">Port of Discharge / 卸货港</div>
              <div className="bl-value">{s.pod || "—"}</div>
            </div>
            <div className="bl-cell" style={{ flex: 1.5 }}>
              <div className="bl-label">Place of Delivery / 交货地</div>
              <div className="bl-value">{s.pod || "—"}</div>
            </div>
          </div>

          {/* Row 6 表头 */}
          <div className="bl-row">
            <div style={{ ...cellHead, flex: 1 }}>Marks &amp; Numbers / 唛头</div>
            <div style={{ ...cellHead, flex: 0.6, textAlign: "center" }}>No. of Pkgs<br/>件数</div>
            <div style={{ ...cellHead, flex: 1.8 }}>Description of Goods / 货物描述</div>
            <div style={{ ...cellHead, flex: 0.7, textAlign: "right" }}>Gross Weight<br/>毛重 (KGS)</div>
            <div style={{ ...cellHead, flex: 0.7, textAlign: "right" }}>Measurement<br/>体积 (CBM)</div>
          </div>

          {/* Row 7 货物明细 body */}
          <div className="bl-row">
            <div className="bl-cell" style={{ flex: 1, whiteSpace: "pre-wrap", minHeight: 180, background: "#fff" }}>
              {s.marks || "N/M"}
            </div>
            <div className="bl-cell" style={{ flex: 0.6, textAlign: "center", background: "#fff" }}>
              {(s.qty_packages || totalPkg) ? `${s.qty_packages || totalPkg}\nPACKAGES` : "—"}
            </div>
            <div className="bl-cell" style={{ flex: 1.8, whiteSpace: "pre-wrap", background: "#fff" }}>
              {desc}
              {s.qty_container && <div style={{ marginTop: 6, fontSize: 9, color: "#444" }}>Container: {s.qty_container}</div>}
              <div style={{ marginTop: 8, fontStyle: "italic", color: STAMP_RED, fontSize: 9 }}>
                ** "FREIGHT {s.freight_term || "PREPAID"}" **
              </div>
            </div>
            <div className="bl-cell" style={{ flex: 0.7, textAlign: "right", background: "#fff" }}>
              {(s.weight || totalWt) ? (s.weight || totalWt.toFixed(2)) : "—"}
            </div>
            <div className="bl-cell" style={{ flex: 0.7, textAlign: "right", background: "#fff" }}>
              {(s.volume || totalVol) ? (s.volume || totalVol.toFixed(3)) : "—"}
            </div>
          </div>

          {/* Row 8 合计 */}
          <div className="bl-row">
            <div className="bl-cell" style={{ flex: 1, fontWeight: 700 }}>
              <span style={{ fontSize: 9 }}>TOTAL / 合计</span>
            </div>
            <div className="bl-cell" style={{ flex: 0.6, textAlign: "center", fontWeight: 700 }}>
              {(s.qty_packages || totalPkg) || "—"}
            </div>
            <div className="bl-cell" style={{ flex: 1.8, fontStyle: "italic", fontSize: 9 }}>
              SAY TOTAL: {chineseNum(s.qty_packages || totalPkg)} PACKAGES ONLY
            </div>
            <div className="bl-cell" style={{ flex: 0.7, textAlign: "right", fontWeight: 700 }}>
              {(s.weight || totalWt) ? (s.weight || totalWt.toFixed(2)) : "—"}
            </div>
            <div className="bl-cell" style={{ flex: 0.7, textAlign: "right", fontWeight: 700 }}>
              {(s.volume || totalVol) ? (s.volume || totalVol.toFixed(3)) : "—"}
            </div>
          </div>

          {/* Row 9 Date of Shipment（实际开船日）— 单独突出一行，黄色背景 */}
          <div className="bl-row">
            <div style={{
              flex: 1,
              background: "#fffbe6",
              border: `1.5px solid #faad14`,
              padding: "6px 10px",
              display: "flex", alignItems: "center", gap: 14,
            }}>
              <div style={{
                fontSize: 9, fontWeight: 700, color: "#874d00",
                textTransform: "uppercase", letterSpacing: 1,
              }}>
                Shipped on Board Date / 实际开船日：
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#000", ...mono }}>
                {onBoardDate}
              </div>
              {!s.atd && (
                <div style={{ fontSize: 9, color: "#999", fontStyle: "italic" }}>
                  （基于 ETD，待实际确认）
                </div>
              )}
            </div>
          </div>

          {/* Row 10 Freight & Charges | Service | No. of OBL */}
          <div className="bl-row">
            <div className="bl-cell" style={{ flex: 1.5 }}>
              <div className="bl-label">Freight &amp; Charges / 运费及费用</div>
              <div className="bl-value">{s.freight_term || "PREPAID"}</div>
            </div>
            <div className="bl-cell" style={{ flex: 1 }}>
              <div className="bl-label">Service Type</div>
              <div className="bl-value">{s.carrier_service || "CY-CY"}</div>
            </div>
            <div className="bl-cell" style={{ flex: 1 }}>
              <div className="bl-label">No. of Original B/L</div>
              <div className="bl-value">{s.bl_type === "电放" ? "TELEX RELEASE" : "THREE (3)"}</div>
            </div>
          </div>

          {/* Row 11 Place / Date of Issue | Signature 区 */}
          <div className="bl-row">
            <div className="bl-cell" style={{ flex: 1 }}>
              <div className="bl-label">Place of Issue / 签发地</div>
              <div className="bl-value">{s.pol || "NINGBO, CHINA"}</div>
            </div>
            <div className="bl-cell" style={{ flex: 1 }}>
              <div className="bl-label">Date of Issue / 签发日期</div>
              <div className="bl-value">{issueDate}</div>
            </div>
            <div className="bl-cell" style={{ flex: 1.8, position: "relative", minHeight: 70 }}>
              <div className="bl-label">Signed by / 签发人</div>
              <div className="bl-value" style={{ fontStyle: "italic", color: "#666" }}>
                For and on behalf of<br/>
                <b>{co.name_en || co.name_zh}</b>
              </div>
              {/* 单证章占位区 */}
              <div style={{
                position: "absolute", right: 8, bottom: 6,
                width: 90, height: 60,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {co.stamp_url ? (
                  <img src={co.stamp_url} alt="stamp"
                       style={{ maxWidth: "100%", maxHeight: "100%", opacity: 0.85 }} />
                ) : (
                  <div style={{
                    width: "100%", height: "100%",
                    border: "1.5px dashed #bbb", borderRadius: 4,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: "#999", fontSize: 9, textAlign: "center", lineHeight: 1.3,
                  }}>
                    单证章<br/>Stamp Here
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* 页脚说明 */}
        <div style={{
          marginTop: 8, fontSize: 8, color: "#666", lineHeight: 1.4,
          padding: 6, border: "1px dashed #ccc", position: "relative", zIndex: 2,
        }}>
          {isDraft ? (
            <>
              <b>NOTICE:</b> This is a DRAFT B/L for client confirmation only. It is NOT a negotiable
              document and shall not be used for any commercial or legal purpose.
              Please review all details carefully and confirm in writing.
              <br/>
              <b>注意：</b>本单据仅为提单草稿，供客户核对内容使用，<b>不具备任何法律效力</b>。
              请仔细核对所有信息后书面确认。
            </>
          ) : (
            <>
              <b>NOTICE:</b> This is a NON-NEGOTIABLE COPY of the Bill of Lading for record purposes only.
              It cannot be used to claim delivery of goods. The original B/L (where applicable) shall
              prevail in case of any discrepancy.
              <br/>
              <b>注意：</b>本单据为提单副本，<b>不可议付，不可用于提货</b>，仅供存档。
              如有差异，以正本提单为准（适用时）。
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// 数字 → 英文
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
const cellHead = {
  background: BRAND, color: "#fff",
  padding: "5px 7px",
  fontWeight: 600, fontSize: 9,
  letterSpacing: 0.4, lineHeight: 1.3,
};
const btn = {
  padding: "5px 14px", background: "#fff",
  border: "1px solid #d9d9d9", borderRadius: 3,
  fontSize: 12, cursor: "pointer",
};
const btnPrimary = { ...btn, background: "#1890ff", color: "#fff", border: "1px solid #1890ff" };
