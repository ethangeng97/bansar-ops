// ============================================================================
// BLImportModal — 解析提单 PDF 文本，提取关键字段填到当前作业
// MVP 版：用户粘贴 PDF 文本（从 PDF 阅读器复制），按规则提取字段供审核
// 适配格式：Maersk 海运提单（其他公司格式后续按需扩展）
//
// 写入路径：通过 onApply(fields, extras) 回调把字段交给父组件
//   - fields: shipments 主字段（mbl_no/booking_no/vessel/voyage/pol/...）
//   - extras: { container, cargoItem } 让父组件写 shipment_containers
//     和 cargo_items（可选，第二阶段可启用）
// ============================================================================
import { useState } from "react";

// ───────────────────────────────────────────────────────────────
// 解析器：把 PDF 文本结构化提取
// 现版本针对 Maersk B/L（包含 SCAC MAEU / B/L No. / Vessel / Container No./Seal No. 等）
// 若文本不是 Maersk 格式，返回值字段会大量为空，用户可手动补
// ───────────────────────────────────────────────────────────────
function parseMaerskBL(text) {
  const out = {};
  const t = text || "";

  // —— 单号 ——
  const blNo = t.match(/B\/L\s*No\.?\s*\n?\s*([A-Z0-9]{6,})/i);
  if (blNo) { out.mbl_no = blNo[1]; out.booking_no = blNo[1]; }

  const booking = t.match(/Booking\s*No\.?\s*\n?\s*([A-Z0-9]{6,})/i);
  if (booking) out.booking_no = booking[1];

  // —— 船名 + 航次 ——
  const voyage = t.match(/Voyage\s*No\.?\s*\n?\s*(\S+)/i);
  if (voyage) out.voyage = voyage[1];

  // 船名通常在 Voyage 上方一行；Maersk 文本里 "Vessel ... \n EMMA MAERSK \n 619W"
  const vessel = t.match(/Vessel[^\n]*\n([A-Z][A-Z\s\d-]+?)\n/);
  if (vessel) out.vessel = vessel[1].trim();

  // —— 港口 ——
  const pol = t.match(/Port\s*of\s*Loading\s*\n([^\n]+)/i);
  if (pol) out.pol = pol[1].trim();
  const pod = t.match(/Port\s*of\s*Discharge\s*\n([^\n]+)/i);
  if (pod) out.pod = pod[1].trim();

  // —— 日期 ——
  const etd = t.match(/Shipped\s*on\s*Board\s*Date[^\n]*\n[^\n]*?(\d{4}-\d{2}-\d{2})/i);
  if (etd) out.etd = etd[1];

  const issue = t.match(/Date\s*of\s*Issue\s*of\s*B\/L[^\n]*\n[^\n]*?(\d{4}-\d{2}-\d{2})/i);
  if (issue) out.date_of_issue = issue[1];

  // —— PO ——
  const po = t.match(/PO\s*[:：]\s*(\d+)/i);
  if (po) out.po = po[1];

  // —— 件 / 毛 / 体 ——
  // 形如 "1590 CARTONS  13487.490 KGS  64.7900 CBM"
  const qwc = t.match(/(\d+)\s*CARTONS[^\d]*([\d,]+\.\d+)\s*KGS[^\d]*([\d,]+\.\d+)\s*CBM/i);
  if (qwc) {
    out.qty_packages = parseInt(qwc[1]);
    out.weight = parseFloat(qwc[2].replace(/,/g, ""));
    out.volume = parseFloat(qwc[3].replace(/,/g, ""));
    out.pkg_unit = "CARTONS";
  } else {
    // 兜底：单独抓"X CARTONS"
    const qm = t.match(/(\d+)\s*CARTONS/i);
    if (qm) { out.qty_packages = parseInt(qm[1]); out.pkg_unit = "CARTONS"; }
  }

  // —— 集装箱 / 封号 / 箱型 ——
  // Maersk 行示例: "UETU8018712 ML-CN6393495 40 DRY 9'6"
  const ctn = t.match(/([A-Z]{4}\d{7})\s+([A-Z0-9-]+)\s+(\d{2})\s*(DRY|HC|GP|HQ|RF|OT|FR|TK)/i);
  if (ctn) {
    out.container_no = ctn[1];
    out.seal_no = ctn[2];
    out._container_size = ctn[3];
    // Maersk "40 DRY 9'6" 实际为 40HC
    const typeRaw = ctn[4].toUpperCase();
    const isHighCube = /9'6|HIGH/.test(t.slice(ctn.index, ctn.index + 80));
    out._container_type = (typeRaw === "DRY" && isHighCube) ? "HC" : (typeRaw === "DRY" ? "GP" : typeRaw);
    out.qty_container = `1x${out._container_size}${out._container_type}`;
  }

  // —— 品名（取容器行的 "Said to Contain" 后那行）——
  const desc = t.match(/Said\s*to\s*Contain[^\n]*\n([^\n]+)/i);
  if (desc) out.description = desc[1].trim();

  // —— 付款 ——
  if (/FREIGHT\s*COLLECT/i.test(t)) out.carrier_payment_term = "到付";
  else if (/FREIGHT\s*PREPAID/i.test(t)) out.carrier_payment_term = "预付";

  // —— 服务类型 ——
  if (/\bCY\s*\/\s*CY\b/i.test(t)) out.service_type = "CY-CY";

  // —— 承运人 ——
  if (/\bSCAC\s+MAEU\b|MAERSK\s*A\/S/i.test(t)) out.carrier = "Maersk";

  // —— 收发货人（粗抓，让用户审核）——
  const shipper = t.match(/Shipper[^\n]*\n([\s\S]+?)(?=\nBooking\s*No\.|\nNotify|\nConsignee)/i);
  if (shipper) out.shipper = shipper[1].trim().replace(/\n+/g, "\n");
  const consignee = t.match(/Consignee[^\n]*\n([\s\S]+?)(?=\nVoyage\s*No\.|\nNotify)/i);
  if (consignee) out.consignee = consignee[1].trim().replace(/\n+/g, "\n");

  return out;
}

const FIELD_LABELS = {
  mbl_no: "MB/L No.", booking_no: "Booking No.",
  carrier: "船东", vessel: "船名", voyage: "航次",
  etd: "实际开航(ETD)", date_of_issue: "签发日期",
  pol: "起运港", pod: "卸货港", destination: "目的地",
  po: "PO#",
  qty_packages: "件数", pkg_unit: "包装", weight: "毛重(KGS)", volume: "体积(CBM)",
  description: "品名",
  container_no: "箱号", seal_no: "封号", qty_container: "箱型箱量",
  carrier_payment_term: "付款方式", service_type: "服务类型",
  shipper: "发货人", consignee: "收货人",
};

export default function BLImportModal({ open, onClose, onApply }) {
  const [text, setText] = useState("");
  const [parsed, setParsed] = useState(null);
  const [err, setErr] = useState(null);

  if (!open) return null;

  const doParse = () => {
    setErr(null);
    try {
      const fields = parseMaerskBL(text);
      const nonEmpty = Object.values(fields).filter(v => v != null && v !== "").length;
      if (nonEmpty === 0) {
        setErr("没解析出任何字段。确认粘贴的是 Maersk 提单文本？");
        return;
      }
      setParsed(fields);
    } catch (e) {
      setErr("解析失败：" + (e?.message || e));
    }
  };

  const updateField = (k, v) => setParsed(p => ({ ...p, [k]: v }));

  const doApply = () => {
    // 把内部字段 _container_size / _container_type 抽出来，让父组件单独处理 shipment_containers
    const { _container_size, _container_type, ...mainFields } = parsed;
    const extras = {
      container: (_container_size && _container_type) ? {
        container_size: _container_size,
        container_type: _container_type,
        qty: 1,
        container_no: parsed.container_no || null,
        seal_no: parsed.seal_no || null,
        cargo_weight: parsed.weight || null,
        cargo_volume: parsed.volume || null,
        cargo_qty: parsed.qty_packages || null,
      } : null,
      cargoItem: parsed.description ? {
        hbl_no: parsed.mbl_no || parsed.booking_no || null,
        container_no: parsed.container_no || null,
        seal_no: parsed.seal_no || null,
        container_type: (_container_size && _container_type) ? `${_container_size}${_container_type}` : null,
        product_name_en: parsed.description,
        qty: parsed.qty_packages || null,
        package_unit: parsed.pkg_unit || "CARTONS",
        gross_weight: parsed.weight || null,
        volume: parsed.volume || null,
      } : null,
    };
    onApply(mainFields, extras);
    setText("");
    setParsed(null);
    onClose();
  };

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", padding: "10px 16px", borderBottom: "1px solid #eee" }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>📋 导入提单（Maersk B/L 文本）</div>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ padding: "4px 12px" }}>关闭</button>
        </div>

        <div style={{ padding: 16, overflow: "auto", flex: 1 }}>
          {!parsed ? (
            <>
              <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>
                从 PDF 阅读器全选复制提单文本，粘贴下面，点"解析"。
              </div>
              <textarea
                value={text}
                onChange={e => setText(e.target.value)}
                rows={14}
                style={{ width: "100%", fontFamily: "Consolas,monospace", fontSize: 11, padding: 8, boxSizing: "border-box" }}
                placeholder="粘贴 PDF 文本（包括 B/L No.、Vessel、Container No./Seal No.、件毛体、PO 等）..."
              />
              {err && <div style={{ marginTop: 8, color: "#c00", fontSize: 12 }}>⚠ {err}</div>}
              <div style={{ marginTop: 10, display: "flex", gap: 8 }}>
                <button onClick={doParse} style={btnPrimary}>解析</button>
                <button onClick={() => setText("")} style={btn}>清空</button>
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 12, color: "#666", marginBottom: 8 }}>
                字段已自动提取，确认/修改后点"应用到本票"，再回工具栏点"保存"提交。
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <tbody>
                  {Object.entries(FIELD_LABELS).map(([k, label]) => (
                    <tr key={k}>
                      <td style={{ padding: 4, color: "#444", width: 110 }}>{label}</td>
                      <td style={{ padding: 4 }}>
                        {(k === "shipper" || k === "consignee") ? (
                          <textarea
                            value={parsed[k] || ""}
                            onChange={e => updateField(k, e.target.value)}
                            rows={3}
                            style={{ width: "100%", fontSize: 11, fontFamily: "Consolas,monospace", padding: 4, boxSizing: "border-box" }}
                          />
                        ) : (
                          <input
                            value={parsed[k] || ""}
                            onChange={e => updateField(k, e.target.value)}
                            style={{ width: "100%", fontSize: 12, padding: "3px 6px", boxSizing: "border-box" }}
                          />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
                <button onClick={doApply} style={btnPrimary}>应用到本票</button>
                <button onClick={() => setParsed(null)} style={btn}>返回修改文本</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const overlayStyle = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,.4)",
  display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
};
const modalStyle = {
  width: "min(720px, 95vw)", maxHeight: "90vh", background: "#fff", borderRadius: 6,
  boxShadow: "0 6px 30px rgba(0,0,0,.2)", display: "flex", flexDirection: "column",
};
const btn = { padding: "5px 14px", cursor: "pointer", border: "1px solid #d9d9d9", background: "#fff", borderRadius: 3 };
const btnPrimary = { ...btn, background: "#1990ff", color: "#fff", border: "1px solid #1990ff", fontWeight: 600 };
