// ============================================================================
// BLLayout.jsx v3 — 完全按 Fast Freight 风格重做
// 改动 (v2 → v3):
//   - 删除字段编号 1-28（跟 Fast Freight 一致）
//   - 严格 50/50 CSS Grid 布局
//   - 集装箱信息合并到货物表（Container No./Seal No./Marks 第一列）
//   - 法律条款移到签章区左侧
//   - 删除中文公司名（顶部抬头只剩英文+logo）
//   - 字号统一：B/L No. 11px、英文名 14px nowrap
//   - 印章左挪 28px（不贴右边缘）
//   - 加 destination_agent 字段（For delivery of goods please apply to）
//   - 第二页 TERMS AND CONDITIONS 默认追加（23 条二栏）
// 多页支持：货物 >5 行自动分页（continuation sheet）
// ============================================================================

import { useEffect, useState } from "react";
import { supabase } from "../../supabase.js";

const BRAND = "#1f3864";
const BRAND_BG = "#f5f8fc";
const BRAND_BORDER = "#cdd9ec";
const STAMP_RED = "#c00";
const ROWS_PER_PAGE = 5;

export default function BLLayout({ shipmentId, onBack, mode }) {
  const [shipment, setShipment] = useState(null);
  const [company, setCompany]   = useState(null);
  const [cargoItems, setCargo]  = useState([]);
  const [containers, setContainers] = useState([]);  // shipment_containers 关联表
  const [loading, setLoading]   = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [{ data: s, error: e1 }, { data: c }, { data: ctn }] = await Promise.all([
        supabase.from("shipments").select("*").eq("id", shipmentId).single(),
        supabase.from("company_settings").select("*").eq("id", 1).single(),
        supabase.from("shipment_containers").select("*").eq("shipment_id", shipmentId).order("sort_order"),
      ]);
      if (e1) { alert("加载票号失败: " + e1.message); setLoading(false); return; }
      setShipment(s);
      setCompany(c || {});
      setContainers(ctn || []);
      const { data: ci } = await supabase
        .from("cargo_items").select("*").eq("shipment_id", shipmentId).order("sort_order");
      setCargo(ci || []);
      setLoading(false);
    })();
  }, [shipmentId]);

  const print = () => {
    // 文件名规则: {MBL号}+BL_{DRAFT/COPY/TELEX}
    // 例如: OOLU2168454750+BL_DRAFT
    const blNo = shipment?.mbl_no || shipment?.booking_no || shipment?.hbl_no || shipment?.order_no || "BL";
    const tag = mode === "draft" ? "DRAFT"
              : mode === "copy"  ? "COPY"
              : mode === "telex" ? "TELEX"
              : "DRAFT";
    const filename = `${blNo}+BL_${tag}`;
    const oldTitle = document.title;
    document.title = filename;
    window.print();
    setTimeout(() => { document.title = oldTitle; }, 1000);
  };

  if (loading) return <div style={{ padding: 24 }}>加载中...</div>;
  if (!shipment) return <div style={{ padding: 24 }}>票号不存在</div>;

  const s = shipment;
  const co = company || {};

  // 货物数据：优先用 shipment_containers 关联表，没有时 fallback 到 shipments 单字段
  const containerNos = containers.length > 0
    ? containers.map(c => c.container_no).filter(Boolean)
    : (s.container_no || "").split(/[\/,;\n]/).map(x => x.trim()).filter(Boolean);
  const sealNos = containers.length > 0
    ? containers.map(c => c.seal_no).filter(Boolean)
    : (s.seal_no || "").split(/[\/,;\n]/).map(x => x.trim()).filter(Boolean);
  // 集装箱箱型箱量汇总（如 "1x40HQ"）
  const qtyContainerStr = (() => {
    if (containers.length === 0) return s.qty_container || "";
    const map = {};
    for (const c of containers) {
      const key = `${c.container_size}${c.container_type}`;
      map[key] = (map[key] || 0) + (parseInt(c.qty) || 0);
    }
    return Object.entries(map).sort(([a], [b]) => a.localeCompare(b))
      .map(([k, q]) => `${q}x${k}`).join(",");
  })();

  // 集装箱信息块多行格式（业内标准）：
  //   BEAU6236829
  //   1x40'HQ
  //   OOLJPJ6360
  //   FCL/CY-CY
  // 多箱子时多组重复
  const isFCL = (s.shipment_type || "").toUpperCase().includes("FCL") || (s.shipment_type || "") === "整箱";
  // 自拼分票（Console + 带 -N 后缀）跟普通 LCL 一样，对客户而言都是拼箱
  const isLCL = (s.shipment_type || "").toUpperCase() === "LCL"
    || (s.shipment_type === "Console" && /-\d+$/.test(s.order_no || ""));
  const fclTag = isFCL ? "FCL/" : (isLCL ? "LCL/" : "");
  const buildContainerBlock = () => {
    if (containers.length === 0) {
      // 没有关联表数据时 fallback 到旧字段
      const lines = [];
      if (containerNos.length > 0) {
        containerNos.forEach((cn, i) => {
          if (cn) lines.push(cn);
          if (i === 0 && qtyContainerStr) lines.push(formatQty(qtyContainerStr));
          if (sealNos[i]) lines.push(sealNos[i]);
        });
        lines.push(`${fclTag}${s.service_type || "CY-CY"}`);
      } else if (qtyContainerStr) {
        lines.push(formatQty(qtyContainerStr));
        lines.push(`${fclTag}${s.service_type || "CY-CY"}`);
      }
      return lines.join("\n");
    }
    // 有关联表：每个箱子一组（箱号 / 箱型 / 封号）
    const lines = [];
    containers.forEach((c, i) => {
      if (c.container_no) lines.push(c.container_no);
      lines.push(`${c.qty || 1}x${c.container_size}'${c.container_type}`);
      if (c.seal_no) lines.push(c.seal_no);
      if (i < containers.length - 1) lines.push("");  // 多箱之间空行分隔
    });
    lines.push(`${fclTag}${s.service_type || "CY-CY"}`);
    return lines.join("\n");
  };
  // 把 "1x40HQ" → "1x40'HQ"（业内习惯加引号）
  function formatQty(str) {
    return str.replace(/(\d+x\d+)([A-Z]+)/g, "$1'$2");
  }

  // 同品名 + 同 HS + 同箱号 + 同唛头的多条 cargo_items 自动合并成一行
  //（仓库进仓批次拆分不该体现在提单上，但每个箱仍独立一行以显示箱号 / 件毛体）
  const mergedCargo = (() => {
    if (!cargoItems || cargoItems.length === 0) return [];
    const order = [];
    const map = new Map();
    for (const it of cargoItems) {
      const key = [it.product_name_en || "", it.hs_code || "", it.container_no || "", it.marks || ""].join("|");
      if (!map.has(key)) {
        map.set(key, {
          ...it,
          qty: 0,
          gross_weight: 0,
          volume: 0,
        });
        order.push(key);
      }
      const g = map.get(key);
      g.qty += parseInt(it.qty) || 0;
      g.gross_weight += parseFloat(it.gross_weight) || 0;
      g.volume += parseFloat(it.volume) || 0;
    }
    return order.map(k => map.get(k));
  })();

  // 每行的"集装箱块"按行的 container_no 单独构建 —— 之前所有行都塞 buildContainerBlock()
  // 整列（N 个柜子全列出），N 行就重复 N 次，把单页撑爆。改为每行只显示该行那只柜子。
  // FCL/CY-CY 标记只挂在最后一行，避免每行都尾随。
  const ctnByNo = {};
  for (const c of containers) {
    const k = (c.container_no || "").trim();
    if (k) ctnByNo[k] = c;
  }
  const buildSingleCtnBlock = (containerNo, isLastRow) => {
    const lines = [];
    const k = (containerNo || "").trim();
    const c = ctnByNo[k];
    if (c) {
      if (c.container_no) lines.push(c.container_no);
      lines.push(`${c.qty || 1}x${c.container_size}'${c.container_type}`);
      if (c.seal_no) lines.push(c.seal_no);
    } else if (k) {
      lines.push(k);
    }
    if (isLastRow) lines.push(`${fclTag}${s.service_type || "CY-CY"}`);
    return lines.join("\n");
  };

  let rows = mergedCargo.length > 0
    ? mergedCargo.map((it, i) => ({
        cnInfo: buildSingleCtnBlock(it.container_no, i === mergedCargo.length - 1),
        marks: it.marks || s.marks || "N/M",
        pkgs: it.qty || 0,
        unit: it.package_unit || "CARTONS",
        desc: [it.product_name_en || s.desc_en || s.cargo_type || "GENERAL CARGO",
               s.po ? `PO-${s.po}` : null,
              ].filter(Boolean).join("\n"),
        gw: parseFloat(it.gross_weight) || 0,
        cbm: parseFloat(it.volume) || 0,
      }))
    : [{
        // 无 cargo_items 时回退：单行显示所有柜子的汇总块（旧行为）
        cnInfo: buildContainerBlock(),
        marks: s.marks || "N/M",
        pkgs: parseInt(s.qty_packages) || 0,
        unit: s.pkg_unit || "CARTONS",
        desc: [s.desc_en || s.description || s.cargo_type || "GENERAL CARGO",
               s.po ? `PO-${s.po}` : null,
              ].filter(Boolean).join("\n"),
        gw: parseFloat(s.weight) || 0,
        cbm: parseFloat(s.volume) || 0,
      }];

  const totalPkg = rows.reduce((sum, r) => sum + (r.pkgs || 0), 0);
  const totalWt  = rows.reduce((sum, r) => sum + (r.gw || 0), 0);
  const totalCbm = rows.reduce((sum, r) => sum + (r.cbm || 0), 0);
  // TOTAL 行里加一行品名汇总（多个不同品名用 " / " 连接）
  const distinctProducts = mergedCargo.length > 0
    ? [...new Set(mergedCargo.map(it => it.product_name_en).filter(Boolean))]
    : (s.desc_en ? [s.desc_en] : []);

  // 分页
  const cargoPages = [];
  for (let i = 0; i < rows.length; i += ROWS_PER_PAGE) {
    cargoPages.push(rows.slice(i, i + ROWS_PER_PAGE));
  }
  if (cargoPages.length === 0) cargoPages.push([]);
  const totalCargoPages = cargoPages.length;
  const totalPages = totalCargoPages + 1; // +1 是 Terms 页

  const blNo = s.hbl_no || `BSNR${(s.order_no || "").replace(/^BSO/, "")}` || "—";
  const onBoardDate = s.atd ? formatDateLong(s.atd) : (s.etd ? formatDateLong(s.etd) : "—");
  const issueDate = mode === "copy"
    ? formatDateLong(s.obl_issued_at || s.atd || s.etd || new Date())
    : formatDateLong(new Date());

  const isDraft = mode === "draft";
  const isCopy  = mode === "copy";
  const isTelex = mode === "telex";

  const freightTermStr = String(s.freight_terms || "").toUpperCase();
  const isPrepaid = freightTermStr.includes("PREPAID") || (s.freight_terms || "").includes("预付");
  const isCollect = freightTermStr.includes("COLLECT") || (s.freight_terms || "").includes("到付");

  const blType = s.bl_type || "正本提单";
  const numOriginals = blType === "电放" ? "ZERO (TELEX RELEASE)"
                     : blType === "海运单" ? "ZERO (SEAWAY BILL)"
                     : "THREE (3)";

  const carrierName = s.carrier_name || s.carrier || s.shipping_line || "";

  return (
    <div className="doc-page">
      <style>{`
        .doc-page { background: #f0f0f0; min-height: 100vh; }
        .hbl-page {
          width: 210mm; min-height: 297mm; padding: 12mm 12mm;
          margin: 16px auto; background: #fff;
          box-shadow: 0 2px 12px rgba(0,0,0,0.12);
          font-family: 'Segoe UI','Microsoft YaHei',sans-serif;
          color: #000; font-size: 10px; line-height: 1.4;
          position: relative;
          page-break-after: always;
        }
        .hbl-page:last-child { page-break-after: auto; }

        .hbl-watermark {
          position: absolute; top: 38%; left: 50%;
          transform: translate(-50%, -50%) rotate(-22deg);
          font-size: 130px; font-weight: 900;
          color: rgba(192, 0, 0, 0.07);
          letter-spacing: 12px;
          pointer-events: none; z-index: 1; user-select: none;
        }

        .bl-grid { display: grid; grid-template-columns: 1fr 1fr; border: 1px solid #555; }
        .bl-cell {
          padding: 6px 10px;
          border-right: 1px solid #555;
          border-bottom: 1px solid #555;
        }
        .bl-cell:last-child { border-right: 0; }
        .bl-cell-label {
          font-size: 9px; color: #444; margin-bottom: 4px;
        }
        .bl-cell-val {
          font-size: 10.5px; line-height: 1.5; white-space: pre-wrap; font-weight: 600;
        }

        .chk {
          display: inline-block;
          width: 11px; height: 11px;
          border: 1.2px solid #000;
          margin-right: 5px;
          vertical-align: -2px;
          position: relative;
          background: #fff;
        }
        .chk.checked::after {
          content: "✓";
          position: absolute;
          top: -3px; left: 1px;
          font-size: 13px; font-weight: 900;
          color: #000;
        }

        .terms-col { column-count: 2; column-gap: 14px; column-rule: 0.5px solid #ccc; text-align: justify; }
        .term-item { break-inside: avoid; margin-bottom: 7px; }
        .term-num { font-weight: 700; color: ${BRAND}; font-size: 9px; margin-bottom: 2px; }

        @media print {
          @page { size: A4; margin: 0; }
          body { background: #fff !important; }
          .no-print { display: none !important; }
          .doc-page { background: #fff; }
          .hbl-page { margin: 0; box-shadow: none; }
        }
      `}</style>

      {/* 工具条 */}
      <div className="no-print" style={{
        position: "sticky", top: 0, zIndex: 100,
        padding: "10px 16px", background: "#f5f5f5", borderBottom: "1px solid #ddd",
        display: "flex", alignItems: "center", gap: 12,
      }}>
        <button onClick={onBack} style={btn}>← 返回</button>
        <span style={{ fontSize: 13, color: "#666" }}>
          {isDraft ? "提单确认件 Draft B/L" :
           isTelex ? "电放件 Telex Release" :
           "提单副本 B/L Copy"} · {s.order_no} · {blNo}
          <span style={{ marginLeft: 8, color: "#999" }}>· 共 {totalPages} 页</span>
        </span>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 12, color: "#999" }}>
          点 🖨 → "目标"选 <b>"另存为 PDF"</b> → 文件名已自动生成
        </span>
        <button onClick={print} style={btnPrimary}>🖨 打印 / 另存为 PDF</button>
      </div>

      {/* 渲染所有货物页 */}
      {cargoPages.map((pageRows, pageIdx) => (
        <CargoPage key={pageIdx}
          pageIdx={pageIdx} totalPages={totalPages}
          isFirstPage={pageIdx === 0} isLastCargoPage={pageIdx === totalCargoPages - 1}
          rows={pageRows} totalPkg={totalPkg} totalWt={totalWt} totalCbm={totalCbm}
          distinctProducts={distinctProducts}
          isDraft={isDraft} isCopy={isCopy} isTelex={isTelex}
          s={s} co={co} blNo={blNo} onBoardDate={onBoardDate} issueDate={issueDate}
          isPrepaid={isPrepaid} isCollect={isCollect}
          numOriginals={numOriginals} blType={blType} carrierName={carrierName}
        />
      ))}

      {/* 第二页（最后一页）TERMS AND CONDITIONS */}
      <TermsPage co={co} blNo={blNo} totalPages={totalPages} />
    </div>
  );
}

// ============================================================================
// 货物页（提单正面）
// ============================================================================
function CargoPage({
  pageIdx, totalPages, isFirstPage, isLastCargoPage,
  rows, totalPkg, totalWt, totalCbm, distinctProducts = [],
  isDraft, isCopy, isTelex,
  s, co, blNo, onBoardDate, issueDate,
  isPrepaid, isCollect, numOriginals, blType, carrierName,
}) {
  return (
    <div className="hbl-page">
      {isDraft && <div className="hbl-watermark">DRAFT</div>}
      {isCopy && <div className="hbl-watermark">COPY</div>}
      {isTelex && <div className="hbl-watermark" style={{ fontSize: 70, letterSpacing: 8 }}>TELEX RELEASE</div>}

      {/* 顶部抬头 */}
      <header style={{ display: "flex", alignItems: "center", gap: 12, paddingBottom: 8, position: "relative", zIndex: 2 }}>
        <div style={{ display: "flex", gap: 12, flex: 1, alignItems: "center", minWidth: 0 }}>
          <div style={{ flex: "0 0 auto", width: 75 }}>
            {co.logo_url
              ? <img src={co.logo_url} alt="logo" style={{ maxWidth: 75, maxHeight: 60 }} />
              : <div style={{ width: 75, height: 60, border: "1px dashed #ccc",
                              display: "flex", alignItems: "center", justifyContent: "center",
                              color: "#999", fontSize: 9 }}>LOGO</div>}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 800, color: BRAND, letterSpacing: 0.2, lineHeight: 1.25, whiteSpace: "nowrap" }}>
              {(co.name_en || "BANSAR (NINGBO) INT'L TRANSPORTATION CO., LTD.").toUpperCase()}
            </div>
          </div>
        </div>
        <div style={{ flex: "0 0 auto", textAlign: "right", paddingLeft: 8 }}>
          <div style={{ fontSize: 8, color: "#444" }}>B/L No.</div>
          <div style={{ fontSize: 9.5, fontWeight: 700, fontFamily: "'Consolas',monospace", color: "#000", letterSpacing: 0.3 }}>
            {blNo}
          </div>
          {s.booking_no && (
            <>
              <div style={{ fontSize: 8, color: "#444", marginTop: 6 }}>Booking No.</div>
              <div style={{ fontSize: 9.5, fontWeight: 700, fontFamily: "'Consolas',monospace", color: "#000", letterSpacing: 0.3 }}>
                {s.booking_no}
              </div>
            </>
          )}
        </div>
      </header>

      {/* 主网格 */}
      <div className="bl-grid" style={{ position: "relative", zIndex: 2 }}>

        {/* Row 1: Shipper | 标题区 */}
        <div className="bl-cell" style={{ minHeight: 110 }}>
          <div className="bl-cell-label">Shipper</div>
          <div className="bl-cell-val" style={{ fontWeight: 600 }}>{s.shipper || "—"}</div>
        </div>
        <div style={{
          padding: "14px 10px 8px", textAlign: "center", borderBottom: "1px solid #555",
          display: "flex", flexDirection: "column", justifyContent: "center",
        }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: BRAND, letterSpacing: 2, lineHeight: 1 }}>
            BILL OF LADING
          </div>
          <div style={{ fontSize: 10, color: "#444", marginTop: 4, letterSpacing: 1 }}>
            (COMBINED TRANSPORT / PORT TO PORT)
          </div>
          <div style={{ marginTop: 8 }}>
            {isDraft && (
              <div style={{ display: "inline-block", padding: "3px 14px",
                            border: `2px solid ${STAMP_RED}`, color: STAMP_RED,
                            fontSize: 12, fontWeight: 800, letterSpacing: 3 }}>
                DRAFT — Subject to Confirmation
              </div>
            )}
            {isCopy && (
              <div style={{ display: "inline-block", padding: "3px 14px",
                            background: STAMP_RED, color: "#fff",
                            fontSize: 12, fontWeight: 800, letterSpacing: 3 }}>
                COPY NON-NEGOTIABLE
              </div>
            )}
            {isTelex && (
              <div style={{ display: "inline-block", padding: "3px 14px",
                            background: STAMP_RED, color: "#fff",
                            fontSize: 12, fontWeight: 800, letterSpacing: 3 }}>
                TELEX RELEASE
              </div>
            )}
          </div>
        </div>

        {/* Row 2: Consignee | For delivery of goods */}
        <div className="bl-cell" style={{ minHeight: 110 }}>
          <div className="bl-cell-label">Consignee (if "To Order" so indicate)</div>
          <div className="bl-cell-val">{s.consignee || "—"}</div>
        </div>
        <div className="bl-cell" style={{ minHeight: 110 }}>
          <div className="bl-cell-label">For delivery of goods please apply to:</div>
          <div className="bl-cell-val" style={{ fontSize: 10 }}>
            {s.destination_agent || s.overseas_agent || <span style={{ color: "#999", fontStyle: "italic" }}>—</span>}
          </div>
        </div>

        {/* Row 3: Notify | TELEX RELEASE 印章 */}
        <div className="bl-cell" style={{ minHeight: 90 }}>
          <div className="bl-cell-label">Notify Party (No claim shall attach for failure to notify)</div>
          <div className="bl-cell-val">{s.notify_party || "SAME AS CONSIGNEE"}</div>
        </div>
        <div style={{
          padding: "6px 10px", borderBottom: "1px solid #555",
          minHeight: 90,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          {blType === "电放" && !isTelex && (
            <div style={{
              border: `2.5px solid ${STAMP_RED}`, color: STAMP_RED,
              padding: "6px 22px", fontSize: 18, fontWeight: 800, letterSpacing: 3,
              transform: "rotate(-3deg)", background: "rgba(255, 240, 240, 0.5)",
            }}>
              TELEX RELEASE
            </div>
          )}
        </div>

        {/* Row 4: Pre-carriage | Place of Receipt */}
        <div className="bl-cell" style={{ padding: "4px 10px" }}>
          <div className="bl-cell-label">Pre-Carriage by</div>
          <div className="bl-cell-val">—</div>
        </div>
        <div className="bl-cell" style={{ padding: "4px 10px" }}>
          <div className="bl-cell-label">Place of Receipt</div>
          <div className="bl-cell-val">{s.pol || "—"}</div>
        </div>

        {/* Row 5: Vessel/Voy | POL */}
        <div className="bl-cell" style={{ padding: "4px 10px" }}>
          <div className="bl-cell-label">Vessel and Voyage No.</div>
          <div className="bl-cell-val" style={{ fontWeight: 600 }}>
            {s.vessel || "—"}{s.voyage ? `    ${s.voyage}` : ""}
          </div>
        </div>
        <div className="bl-cell" style={{ padding: "4px 10px" }}>
          <div className="bl-cell-label">Port of Loading</div>
          <div className="bl-cell-val">{s.pol || "—"}</div>
        </div>

        {/* Row 6: POD | Place of Delivery + Final destination */}
        <div className="bl-cell" style={{ padding: "4px 10px" }}>
          <div className="bl-cell-label">Port of Discharge</div>
          <div className="bl-cell-val">{s.pod || "—"}</div>
        </div>
        <div style={{ padding: "4px 10px", borderBottom: "1px solid #555", display: "flex", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <div className="bl-cell-label">Place of Delivery</div>
            <div className="bl-cell-val">{s.pod || "—"}</div>
          </div>
          <div style={{ flex: 1 }}>
            <div className="bl-cell-label">Final destination</div>
            <div className="bl-cell-val">{s.pod || "—"}</div>
          </div>
        </div>

        {/* PARTICULARS DECLARED BY SHIPPER 横通栏 */}
        <div style={{
          gridColumn: "1 / -1",
          background: BRAND, color: "#fff",
          padding: "5px 10px", textAlign: "center",
          fontSize: 10.5, fontWeight: 700, letterSpacing: 2,
          borderBottom: "1px solid #555",
        }}>
          PARTICULARS DECLARED BY SHIPPER
        </div>

        {/* 续页提示（非首页） */}
        {!isFirstPage && (
          <div style={{
            gridColumn: "1 / -1",
            padding: 10, textAlign: "center",
            background: BRAND_BG, color: "#666",
            fontSize: 10, fontStyle: "italic",
            borderBottom: "1px solid #555",
          }}>
            ── CONTINUATION SHEET / 续页 (Page {pageIdx + 1} of {totalPages}) ──
          </div>
        )}

        {/* 货物表 */}
        <div style={{ gridColumn: "1 / -1", borderBottom: "1px solid #555" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: BRAND_BG }}>
                <th style={thStyle(22, "left")}>Container No. / Seal No. /<br/>Marks and Nos.</th>
                <th style={thStyle(13, "left")}>No. of Containers<br/>or Packages</th>
                <th style={thStyle(35, "left")}>Description of Packages and Goods</th>
                <th style={thStyle(15, "right")}>Gross Weight (KGS)</th>
                <th style={{ ...thStyle(15, "right"), borderRight: 0 }}>Measurement (CBM)</th>
              </tr>
            </thead>
            <tbody>
              {/* 首页 cargo 表顶部加 SUMMARY 横条，一眼能看到本票总件/毛/体 + 品名。
                  只有 1 行 cargo 时跳过——那行本身就是合计，再加 SUMMARY 是重复 */}
              {isFirstPage && rows.length > 1 && totalPkg > 0 && (
                <tr style={{ background: "#fff8e1" }}>
                  <td style={{ ...tdStyle({ bold: true, fontSize: 10 }), color: "#874d00" }}>SUMMARY</td>
                  <td style={tdStyle({ bold: true })}>
                    {totalPkg} {rows[0]?.unit || "CARTONS"}
                  </td>
                  <td style={tdStyle({ bold: true })}>
                    {totalPkg} {rows[0]?.unit || "CARTONS"}    {totalWt ? `${totalWt.toFixed(3)}KGS` : ""}    {totalCbm ? `${totalCbm.toFixed(3)}CBM` : ""}
                    {distinctProducts.length > 0 && (
                      <>
                        {"\n"}
                        {distinctProducts.join(" / ")}
                      </>
                    )}
                  </td>
                  <td style={{ ...tdStyle({ mono: true, align: "right", bold: true }) }}>
                    {totalWt ? totalWt.toFixed(3) : "—"}
                  </td>
                  <td style={{ ...tdStyle({ mono: true, align: "right", bold: true }), borderRight: 0 }}>
                    {totalCbm ? totalCbm.toFixed(3) : "—"}
                  </td>
                </tr>
              )}
              {rows.length === 0 ? (
                <tr><td colSpan={5} style={{ padding: 24, textAlign: "center", color: "#999",
                                              border: "1px solid #555", borderTop: 0 }}>
                  No cargo data
                </td></tr>
              ) : rows.map((r, i) => (
                <tr key={i}>
                  <td style={tdStyle({ mono: true, fontSize: 9.5 })}>
                    {r.cnInfo ? `${r.cnInfo}\n\n` : ""}{r.marks}
                  </td>
                  <td style={tdStyle({ bold: true })}>
                    {r.pkgs ? `${r.pkgs} ${r.unit}` : "—"}
                  </td>
                  <td style={tdStyle()}>
                    {i === 0 && (
                      <div style={{ fontWeight: 600, fontSize: 9.5, marginBottom: 4 }}>
                        SHIPPER'S LOAD COUNT &amp; SEAL S.T.C.
                      </div>
                    )}
                    {r.pkgs} {r.unit}    {r.gw ? `${r.gw.toFixed(3)}KGS` : ""}    {r.cbm ? `${r.cbm.toFixed(3)}CBM` : ""}
                    {"\n"}
                    {"\n"}
                    <span style={{ fontWeight: 600 }}>═══════</span>
                    {"\n"}
                    {r.desc}
                  </td>
                  <td style={{ ...tdStyle({ mono: true, align: "right" }) }}>
                    {r.gw ? r.gw.toFixed(3) : "—"}
                  </td>
                  <td style={{ ...tdStyle({ mono: true, align: "right" }), borderRight: 0 }}>
                    {r.cbm ? r.cbm.toFixed(3) : "—"}
                  </td>
                </tr>
              ))}
              {/* 末页底部：TOTAL 合计行（多于 1 条 cargo line 时显示）+ FREIGHT 类型 + Shipped on Board */}
              {isLastCargoPage && rows.length > 1 && (
                <tr style={{ background: BRAND_BG }}>
                  <td style={tdStyle({ bold: true, fontSize: 10 })}>TOTAL</td>
                  <td style={tdStyle({ bold: true })}>
                    {totalPkg} {rows[0]?.unit || "CARTONS"}
                  </td>
                  <td style={tdStyle({ bold: true })}>
                    <span>═══════</span>
                    {"\n"}
                    {totalPkg} {rows[0]?.unit || "CARTONS"}    {totalWt ? `${totalWt.toFixed(3)}KGS` : ""}    {totalCbm ? `${totalCbm.toFixed(3)}CBM` : ""}
                    {distinctProducts.length > 0 && (
                      <>
                        {"\n"}
                        {distinctProducts.join(" / ")}
                      </>
                    )}
                  </td>
                  <td style={{ ...tdStyle({ mono: true, align: "right", bold: true }) }}>
                    {totalWt ? totalWt.toFixed(3) : "—"}
                  </td>
                  <td style={{ ...tdStyle({ mono: true, align: "right", bold: true }), borderRight: 0 }}>
                    {totalCbm ? totalCbm.toFixed(3) : "—"}
                  </td>
                </tr>
              )}
              {isLastCargoPage && (
                <tr>
                  <td colSpan={5} style={{ padding: "60px 8px", verticalAlign: "bottom",
                                            border: "1px solid #555", borderTop: 0,
                                            borderRight: 0, borderLeft: 0 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10 }}>
                      <div><b>{(s.freight_terms || "FREIGHT AS ARRANGED").toUpperCase()}</b></div>
                      <div><b>SHIPPED ON BOARD: {onBoardDate}</b></div>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* 末页底部 24-28 区域 */}
        {isLastCargoPage && (
          <>
            {/* Total in words | (空) */}
            <div className="bl-cell" style={{ padding: "4px 10px" }}>
              <div className="bl-cell-label">Total No. of Containers or Packages (in words)</div>
              <div className="bl-cell-val" style={{ fontWeight: 600 }}>
                SAY {chineseNum(totalPkg)} ({totalPkg}) {rows[0]?.unit || "PACKAGES"} ONLY
              </div>
            </div>
            <div className="bl-cell" style={{ padding: "4px 10px" }}>&nbsp;</div>

            {/* Freight | Rate | Prepaid | Collect (4 栏，跨整宽) */}
            <div style={{ gridColumn: "1 / -1", display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", borderBottom: "1px solid #555" }}>
              <div style={{ padding: "4px 10px", borderRight: "1px solid #555" }}>
                <div className="bl-cell-label">Freight and Charges</div>
                <div className="bl-cell-val" style={{ fontWeight: 600 }}>FREIGHT AS ARRANGED</div>
              </div>
              <div style={{ padding: "4px 10px", borderRight: "1px solid #555" }}>
                <div className="bl-cell-label">Rate</div>
              </div>
              <div style={{ padding: "4px 10px", borderRight: "1px solid #555" }}>
                <div className="bl-cell-label">Prepaid</div>
                <div style={{ paddingTop: 2 }}>
                  <span className={`chk ${isPrepaid ? "checked" : ""}`}></span>
                </div>
              </div>
              <div style={{ padding: "4px 10px" }}>
                <div className="bl-cell-label">Collect</div>
                <div style={{ paddingTop: 2 }}>
                  <span className={`chk ${isCollect ? "checked" : ""}`}></span>
                </div>
              </div>
            </div>

            {/* Ex.Rate | Prepaid at | Payable at */}
            <div style={{ gridColumn: "1 / -1", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", borderBottom: "1px solid #555" }}>
              <div style={{ padding: "4px 10px", borderRight: "1px solid #555" }}>
                <div className="bl-cell-label">Ex. Rate</div>
              </div>
              <div style={{ padding: "4px 10px", borderRight: "1px solid #555" }}>
                <div className="bl-cell-label">Prepaid at</div>
              </div>
              <div style={{ padding: "4px 10px" }}>
                <div className="bl-cell-label">Payable at</div>
                <div className="bl-cell-val" style={{ fontWeight: 600 }}>
                  {isCollect ? "DESTINATION" : isPrepaid ? "ORIGIN" : ""}
                </div>
              </div>
            </div>

            {/* Place&Date Issue | No. of OBL */}
            <div className="bl-cell" style={{ padding: "4px 10px" }}>
              <div className="bl-cell-label">Place and date of issue</div>
              <div className="bl-cell-val" style={{ fontWeight: 600 }}>
                {s.pol || "NINGBO"} &nbsp;&nbsp;&nbsp;&nbsp; {issueDate}
              </div>
            </div>
            <div className="bl-cell" style={{ padding: "4px 10px" }}>
              <div className="bl-cell-label">No. of Original B(s) / L</div>
              <div className="bl-cell-val" style={{ fontWeight: 600 }}>{numOriginals}</div>
            </div>

            {/* 法律条款 | 签章区 */}
            <div style={{ padding: "6px 10px", borderRight: "1px solid #555",
                          fontSize: 7.5, color: "#555", lineHeight: 1.45, textAlign: "justify" }}>
              <p style={{ margin: "0 0 4px" }}>RECEIVED in apparent good order and condition except as otherwise noted the total number of containers or other packages or units enumerated below for transportation from the place of receipt of delivery subject to the terms hereof.</p>
              <p style={{ margin: "0 0 4px" }}>One of the original Bill of Lading must be surrendered duly endorsed in exchange for the Goods Delivery Order.</p>
              <p style={{ margin: "0 0 4px" }}>On presentation of this document (duly endorsed) to the Carrier by or on behalf of the holders the rights and liabilities arising in according with the terms hereof shall (without prejudice to any rule of common law or statute rendering them binding on the Merchant) become binding all respects between the Carrier and the Holder as thought the contract evidenced hereby had been made between them.</p>
              <p style={{ margin: "0 0 4px" }}>IN WITNESS whereof the number of original Bill of Lading stated below have been signed, one of which being accomplished, the other(s) to be void.</p>
              <p style={{ margin: 0 }}>(Terms of Bill of Lading continued on the back hereof).</p>
            </div>
            <div style={{ padding: "6px 10px", position: "relative", minHeight: 170 }}>
              <div style={{ fontSize: 9, color: "#000", marginBottom: 4 }}>For and on behalf of</div>
              <div style={{ fontSize: 11, fontWeight: 700 }}>
                {(co.name_en || "BANSAR (NINGBO) INT'L TRANSPORTATION CO., LTD.").toUpperCase()}
              </div>

              <div style={{ position: "relative", marginTop: 14, minHeight: 110 }}>
                {/* 印章：左挪 28px，不贴右边缘 */}
                {co.stamp_url ? (
                  <img src={co.stamp_url} alt="stamp"
                       style={{ position: "absolute", right: 28, top: -10,
                                maxWidth: 160, maxHeight: 120, opacity: 0.9 }} />
                ) : (
                  <div style={{
                    position: "absolute", right: 28, top: -10,
                    width: 130, height: 100, border: "1.5px dashed #bbb",
                    borderRadius: "50%",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: "#aaa", fontSize: 9, textAlign: "center", lineHeight: 1.3,
                  }}>
                    Company<br/>Stamp
                  </div>
                )}

                {/* 签名（如有） */}
                {co.signature_url && (
                  <img src={co.signature_url} alt="signature"
                       style={{ position: "absolute", left: 0, top: 30,
                                maxWidth: 160, maxHeight: 50, opacity: 0.9 }} />
                )}

                {/* dotted line */}
                <div style={{ position: "absolute", left: 0, bottom: 24, right: 0,
                              borderBottom: "1.5px dotted #555" }}></div>
                <div style={{ position: "absolute", left: 0, bottom: 6, right: 0,
                              fontSize: 9.5, fontStyle: "italic", color: "#444", textAlign: "center" }}>
                  <b>Authorized Signature(s)</b>
                </div>
              </div>

              <div style={{ marginTop: 4, fontSize: 9 }}>
                <span style={{ color: "#444" }}>As Agent for the Carrier</span>
                {carrierName && <span style={{ fontWeight: 600, marginLeft: 12 }}>{carrierName.toUpperCase()}</span>}
              </div>
            </div>
          </>
        )}
      </div>

      {/* 页脚 */}
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6,
                    fontSize: 8, color: "#888", position: "relative", zIndex: 2 }}>
        <div>TERMS AND CONDITIONS OVERLEAF</div>
        <div>Form BNSR-HBL · Page {pageIdx + 1} of {totalPages}</div>
      </div>
    </div>
  );
}

// ============================================================================
// 第二页 TERMS AND CONDITIONS
// ============================================================================
function TermsPage({ co, blNo, totalPages }) {
  const terms = TERMS_LIST;
  return (
    <div className="hbl-page">
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, paddingBottom: 10,
                    borderBottom: `2px solid ${BRAND}`, marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 12, flex: 1, alignItems: "center", minWidth: 0 }}>
          <div style={{ flex: "0 0 auto", width: 75 }}>
            {co.logo_url
              ? <img src={co.logo_url} alt="logo" style={{ maxWidth: 75, maxHeight: 60 }} />
              : <div style={{ width: 75, height: 60, border: "1px dashed #ccc",
                              display: "flex", alignItems: "center", justifyContent: "center",
                              color: "#999", fontSize: 9 }}>LOGO</div>}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13.5, fontWeight: 800, color: BRAND,
                          letterSpacing: 0.2, lineHeight: 1.25, whiteSpace: "nowrap" }}>
              {(co.name_en || "BANSAR (NINGBO) INT'L TRANSPORTATION CO., LTD.").toUpperCase()}
            </div>
          </div>
        </div>
        <div style={{ flex: "0 0 auto", textAlign: "right", paddingLeft: 8 }}>
          <div style={{ fontSize: 8, color: "#444" }}>B/L No.</div>
          <div style={{ fontSize: 9.5, fontWeight: 700, fontFamily: "'Consolas',monospace", color: "#000", letterSpacing: 0.3 }}>
            {blNo}
          </div>
          <div style={{ fontSize: 8.5, color: "#888", marginTop: 10, letterSpacing: 0.4 }}>
            TERMS AND CONDITIONS
          </div>
        </div>
      </div>

      <div style={{ fontSize: 9, lineHeight: 1.5, color: "#444",
                    padding: "6px 10px", background: BRAND_BG,
                    border: `0.5px solid ${BRAND_BORDER}`, marginBottom: 10 }}>
        This Bill of Lading is issued subject to the terms and conditions on the face and reverse side hereof, the Company's Standard Trading Conditions, and the actual Carrier's applicable bill of lading, tariff and service terms, all of which are incorporated herein.
      </div>

      <div className="terms-col" style={{ fontSize: 8.5, lineHeight: 1.45, color: "#000" }}>
        {terms.map((t, i) => (
          <div key={i} className="term-item">
            <div className="term-num">{i + 1}. {t.title}</div>
            <div>{t.body}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10,
                    paddingTop: 6, borderTop: `1px solid ${BRAND}`,
                    fontSize: 8, color: "#666" }}>
        <div>{(co.name_en || "BANSAR").toUpperCase()} — Bill of Lading Terms and Conditions</div>
        <div>Page {totalPages} of {totalPages} · Form BNSR-HBL</div>
      </div>
    </div>
  );
}

// ============================================================================
// 23 条款数据
// ============================================================================
const TERMS_LIST = [
  { title: "Definitions", body: "\"Carrier\" means the actual ocean carrier, vessel operator or any other carrier or transportation provider. \"Company\" means BANSAR (NINGBO) INT'L TRANSPORTATION CO., LTD. \"Merchant\" means the shipper, consignee, notify party, holder, owner, receiver of the Goods and all persons acting on their behalf. The Merchant shall be jointly and severally liable." },
  { title: "Capacity of the Company", body: "The Company issues this Bill of Lading as freight forwarder and/or agent only unless expressly stated otherwise. The Company is not liable as an ocean carrier for any acts, omissions, defaults or errors of the actual carrier, vessel owners, terminal operators, customs authorities, truckers, warehouses, depots or any other subcontractors or third parties." },
  { title: "Incorporation of Carrier's Terms", body: "The carriage of Goods is subject to the terms and conditions of the actual ocean carrier's bill of lading, tariff, booking note, service contract and all applicable rules and regulations, which are hereby incorporated herein by reference." },
  { title: "Merchant's Warranty", body: "The Merchant warrants that all particulars supplied for this Bill of Lading, including description, quantity, weight, measurement, value, HS code, dangerous nature, temperature requirements and packing condition of the Goods, are true, accurate and complete." },
  { title: "Particulars Furnished by Shipper", body: "All information inserted in this Bill of Lading is furnished by the Merchant and the Company acts in reliance thereon without independent verification." },
  { title: "Apparent Good Order and Condition", body: "Receipt of the Goods in apparent good order and condition refers only to the external and visible condition of the packages or units and not to the internal condition, quality, quantity, value or suitability of the Goods." },
  { title: "Packing, Loading and Sealing", body: "Where the Goods are packed, stuffed, loaded, counted or sealed by or on behalf of the Merchant, the Company shall not be liable for any shortage, damage, leakage, condensation, mis-stowage, incorrect seal, overweight or any related consequences." },
  { title: "Dangerous, Restricted or Special Cargo", body: "Dangerous, restricted or special cargo must be declared in writing with full details before booking. If such cargo is not declared, the Goods may be rejected, discharged, stored, destroyed or otherwise dealt with at the Merchant's risk and expense." },
  { title: "Liberty of Route, Transshipment and Storage", body: "The Company and the actual carrier may use any route, vessel, feeder vessel, terminal, warehouse or other means of transport and may transship, store, reload, forward, omit or call at any port or place without such action being deemed a deviation or breach of contract." },
  { title: "Delay and Schedule", body: "All sailing dates, arrival dates, transit times, cut-off times and delivery dates are estimates only and not guaranteed." },
  { title: "Force Majeure and Extraordinary Events", body: "The Company shall not be liable for loss, damage, delay or failure in performance resulting from events beyond its reasonable control, including act of God, war, piracy, terrorism, sanctions, epidemic, quarantine, port closure, congestion, strike, fire, flood, storm, breakdown, equipment shortage, cyber incident, government action, customs action or insolvency of the carrier." },
  { title: "Freight, Charges and Additional Costs", body: "All freight, local charges, destination charges, demurrage, detention, storage, port charges, customs charges, inspection fees and surcharges shall be payable by the Merchant on demand whether prepaid, collect or payable by third party." },
  { title: "Lien on Goods and Documents", body: "The Company has a general and particular lien over the Goods, containers and all documents in its possession or control for all sums due from the Merchant." },
  { title: "Delivery and Release of Goods", body: "Delivery of the Goods is made against proper presentation of original bills of lading unless the Goods are released under sea waybill, telex release, express release, electronic release, carrier instruction, court order, customs instruction or written authorization accepted by the Company." },
  { title: "Telex Release / Surrender / Express Release", body: "When the Merchant requests the Company to effect any telex release, surrender, express release or similar release, the Merchant warrants that it is duly authorized to do so and shall indemnify the Company against all claims, disputes, liabilities, losses, costs and expenses." },
  { title: "Customs, Compliance and Sanctions", body: "The Merchant is solely responsible for compliance with all customs, import/export licensing, security, sanctions, anti-bribery, anti-money laundering and trade control laws and regulations." },
  { title: "Limitation of Liability", body: "Unless compulsory law provides otherwise, the Company's liability shall not exceed the lower of the limitation available to the actual carrier or subcontractor, SDR 2 per kilogram of gross weight of the Goods lost or damaged, or the freight actually earned." },
  { title: "Higher Value Declaration", body: "The value of the Goods is not declared unless expressly stated on the face of this Bill of Lading and accepted in writing by the Company with any required extra charges." },
  { title: "Notice of Claim and Time Bar", body: "Any claim for loss, damage or delay must be notified in writing to the Company immediately and within three (3) days after delivery. Any suit against the Company is time-barred unless commenced within nine (9) months after delivery." },
  { title: "Himalaya Clause", body: "All defenses, exemptions, liberties, limitations and rights available to the Company under this Bill of Lading shall also extend to its directors, officers, employees, agents, subcontractors, carriers, terminal operators, warehouses, truckers and depots." },
  { title: "Insurance", body: "No insurance is effected unless expressly requested and accepted in writing by the Company. Any insurance arranged by the Company shall be subject to the terms, exclusions and limits of the insurer." },
  { title: "No Set-off", body: "The Merchant shall pay all freight, charges and other sums due to the Company without deduction, withholding, counterclaim or set-off." },
  { title: "Law and Jurisdiction", body: "This Bill of Lading shall be governed by and construed in accordance with the laws of the People's Republic of China. Any dispute arising out of or in connection with this Bill of Lading shall be submitted to the competent court at the place where the Company is registered." },
];

// ============================================================================
// 工具函数
// ============================================================================
function formatDateLong(d) {
  if (!d) return "—";
  const date = new Date(d);
  if (isNaN(date.getTime())) return "—";
  const months = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
  return `${date.getDate().toString().padStart(2, "0")} ${months[date.getMonth()]} ${date.getFullYear()}`;
}

function chineseNum(n) {
  const num = parseInt(n);
  if (!num || num <= 0) return "ZERO";
  if (num > 9999) return String(num);
  const ones = ["","ONE","TWO","THREE","FOUR","FIVE","SIX","SEVEN","EIGHT","NINE",
                "TEN","ELEVEN","TWELVE","THIRTEEN","FOURTEEN","FIFTEEN","SIXTEEN",
                "SEVENTEEN","EIGHTEEN","NINETEEN"];
  const tens = ["","","TWENTY","THIRTY","FORTY","FIFTY","SIXTY","SEVENTY","EIGHTY","NINETY"];
  function under1k(x) {
    if (x < 20) return ones[x];
    if (x < 100) return tens[Math.floor(x/10)] + (x % 10 ? "-" + ones[x % 10] : "");
    const h = Math.floor(x / 100);
    const r = x % 100;
    return ones[h] + " HUNDRED" + (r ? " AND " + under1k(r) : "");
  }
  if (num < 1000) return under1k(num);
  const t = Math.floor(num / 1000);
  const r = num % 1000;
  return under1k(t) + " THOUSAND" + (r ? " " + under1k(r) : "");
}

function thStyle(widthPct, align) {
  return {
    textAlign: align, padding: "4px 8px",
    borderRight: "1px solid #555", borderBottom: "1px solid #555",
    fontSize: 9, fontWeight: 700,
    width: widthPct + "%",
  };
}

function tdStyle(opts = {}) {
  const o = opts || {};
  return {
    verticalAlign: "top", padding: "6px 8px",
    borderRight: "1px solid #555", borderBottom: "1px solid #555",
    fontSize: o.fontSize || 10,
    fontWeight: o.bold ? 600 : 400,
    fontFamily: o.mono ? "'Consolas','Microsoft YaHei',monospace" : "inherit",
    textAlign: o.align || "left",
    whiteSpace: "pre-wrap",
    lineHeight: 1.5,
  };
}

const btn = {
  padding: "5px 14px", background: "#fff",
  border: "1px solid #d9d9d9", borderRadius: 3,
  fontSize: 12, cursor: "pointer",
};
const btnPrimary = { ...btn, background: "#1890ff", color: "#fff", border: "1px solid #1890ff" };
