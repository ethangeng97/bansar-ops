// ============================================================================
// BLLayout.jsx — 提单共享布局 v2（按 BANSAR HOUSE BILL OF LADING 模板）
// 用途：DraftBL 和 BLCopy 共用，mode 区分水印/印章
// 改动 (v1 → v2)：
//   - 完全重做，按 HOUSE BILL OF LADING 行业标准模板
//   - 抬头独立大区，logo + 公司名 + 联系方式 / 标题在右上
//   - 字段编号 1-28（行业标准）
//   - 单货物表（仅 12-16），自动多行/多页支持
//   - 23 三组勾选框（Freight Payable at / by / Currency）
//   - 28 签章区（Authorized Signature + Name + Date + Company Stamp）
//   - 多品名分页：>8 行自动分到第二页，续页头部简化
// 仍保留：TELEX RELEASE 红框印章 / DRAFT 水印 / COPY 大字
// ============================================================================

import { useEffect, useState } from "react";
import { supabase } from "../../supabase.js";

const BRAND = "#1f3864";
const BRAND_BG = "#f5f8fc";
const BRAND_BORDER = "#cdd9ec";
const STAMP_RED = "#c00";

const ROWS_PER_PAGE = 8;

export default function BLLayout({ shipmentId, onBack, mode }) {
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

  let rows = cargoItems.length > 0
    ? cargoItems.map(it => ({
        marks: it.marks || s.marks || "N/M",
        pkgs: it.qty_packages || 0,
        unit: it.pkg_unit || "CARTONS",
        desc: [it.description || it.cargo_name || s.cargo_type || "GENERAL CARGO",
               it.hs_code ? `HS: ${it.hs_code}` : null,
               s.po ? `PO-${s.po}` : null,
              ].filter(Boolean).join("\n"),
        gw: parseFloat(it.gross_weight) || 0,
        cbm: parseFloat(it.volume) || 0,
      }))
    : [{
        marks: s.marks || "N/M",
        pkgs: parseInt(s.qty_packages) || 0,
        unit: "CARTONS",
        desc: [s.cargo_type || "GENERAL CARGO",
               s.po ? `PO-${s.po}` : null,
               s.qty_container || null,
              ].filter(Boolean).join("\n"),
        gw: parseFloat(s.weight) || 0,
        cbm: parseFloat(s.volume) || 0,
      }];

  const totalPkg = rows.reduce((sum, r) => sum + (r.pkgs || 0), 0);
  const totalWt  = rows.reduce((sum, r) => sum + (r.gw || 0), 0);
  const totalCbm = rows.reduce((sum, r) => sum + (r.cbm || 0), 0);

  const pages = [];
  for (let i = 0; i < rows.length; i += ROWS_PER_PAGE) {
    pages.push(rows.slice(i, i + ROWS_PER_PAGE));
  }
  if (pages.length === 0) pages.push([]);
  const totalPages = pages.length;

  const blNo = s.hbl_no || `BSNR${(s.order_no || "").replace(/^BSO/, "")}` || "—";

  const onBoardDate = s.atd
    ? formatDateLong(s.atd)
    : (s.etd ? formatDateLong(s.etd) : "—");

  const issueDate = mode === "copy"
    ? formatDateLong(s.obl_issued_at || s.atd || s.etd || new Date())
    : formatDateLong(new Date());

  const isDraft = mode === "draft";
  const isCopy  = mode === "copy";

  const freightTermStr = String(s.freight_term || "").toUpperCase();
  const isPrepaid = freightTermStr.includes("PREPAID") || (s.freight_term || "").includes("预付");
  const isCollect = freightTermStr.includes("COLLECT") || (s.freight_term || "").includes("到付");

  const blType = s.bl_type || "正本提单";
  const numOriginals = blType === "电放" ? "ZERO (TELEX RELEASE)"
                     : blType === "海运单" ? "ZERO (SEAWAY BILL)"
                     : "THREE (3) ORIGINAL BILLS";

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
          font-size: 150px; font-weight: 900;
          color: rgba(192, 0, 0, 0.07);
          letter-spacing: 16px;
          pointer-events: none; z-index: 1; user-select: none;
        }

        .fld {
          border: 1px solid #888;
          padding: 4px 8px;
          background: #fff;
          position: relative;
          min-height: 28px;
        }
        .fld-num {
          position: absolute; top: 3px; left: 6px;
          font-size: 8.5px; font-weight: 700; color: #000;
        }
        .fld-label {
          font-size: 9px; font-weight: 700; color: #000;
          margin-left: 14px;
          margin-bottom: 2px;
        }
        .fld-val {
          font-size: 10.5px; color: #000; white-space: pre-wrap;
          padding-left: 14px;
          line-height: 1.5;
        }
        .fld-val-mono { font-family: 'Consolas','Microsoft YaHei',monospace; }

        .cargo-table { width: 100%; border-collapse: collapse; }
        .cargo-table th {
          background: ${BRAND}; color: #fff;
          font-size: 9px; font-weight: 700;
          padding: 5px 6px;
          border: 1px solid ${BRAND};
          letter-spacing: 0.5px;
          line-height: 1.3;
          text-align: left;
          position: relative;
        }
        .cargo-table th .num {
          font-size: 8px; opacity: 0.85;
          margin-right: 4px;
        }
        .cargo-table td {
          padding: 6px;
          border: 1px solid #888;
          background: #fff;
          font-size: 10px;
          vertical-align: top;
          line-height: 1.5;
        }
        .cargo-table tr.total-row td {
          background: ${BRAND_BG};
          font-weight: 700;
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

        @media print {
          @page { size: A4; margin: 0; }
          body { background: #fff !important; }
          .no-print { display: none !important; }
          .doc-page { background: #fff; }
          .hbl-page { margin: 0; box-shadow: none; }
        }
      `}</style>

      <div className="no-print" style={{
        position: "sticky", top: 0, zIndex: 100,
        padding: "10px 16px", background: "#f5f5f5", borderBottom: "1px solid #ddd",
        display: "flex", alignItems: "center", gap: 12,
      }}>
        <button onClick={onBack} style={btn}>← 返回</button>
        <span style={{ fontSize: 13, color: "#666" }}>
          {isDraft ? "提单确认件 Draft B/L" : "提单副本 B/L Copy"} · {s.order_no} · {blNo}
          {totalPages > 1 && <span style={{ marginLeft: 8, color: "#fa8c16" }}>· 多页 ({totalPages} pages)</span>}
        </span>
        <div style={{ flex: 1 }} />
        <button onClick={print} style={btnPrimary}>🖨 打印 / 另存为 PDF</button>
      </div>

      {pages.map((pageRows, pageIdx) => (
        <HBLPage
          key={pageIdx}
          pageIdx={pageIdx}
          totalPages={totalPages}
          isFirstPage={pageIdx === 0}
          isLastPage={pageIdx === totalPages - 1}
          rows={pageRows}
          totalPkg={totalPkg}
          totalWt={totalWt}
          totalCbm={totalCbm}
          isDraft={isDraft}
          isCopy={isCopy}
          s={s}
          co={co}
          blNo={blNo}
          onBoardDate={onBoardDate}
          issueDate={issueDate}
          isPrepaid={isPrepaid}
          isCollect={isCollect}
          numOriginals={numOriginals}
          blType={blType}
        />
      ))}
    </div>
  );
}

function HBLPage({
  pageIdx, totalPages, isFirstPage, isLastPage,
  rows, totalPkg, totalWt, totalCbm,
  isDraft, isCopy,
  s, co, blNo, onBoardDate, issueDate,
  isPrepaid, isCollect, numOriginals, blType,
}) {
  return (
    <div className="hbl-page">
      {isDraft && <div className="hbl-watermark">DRAFT</div>}
      {isCopy && <div className="hbl-watermark" style={{ fontSize: 130, letterSpacing: 12 }}>COPY</div>}

      {/* ─── 顶部抬头区 ─── */}
      <header style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 8, position: "relative", zIndex: 2 }}>
        <div style={{ display: "flex", gap: 12, flex: 1.5, alignItems: "center" }}>
          <div style={{ flex: "0 0 auto", width: 80, paddingTop: 2 }}>
            {co.logo_url
              ? <img src={co.logo_url} alt="logo" style={{ maxWidth: 80, maxHeight: 60 }} />
              : <div style={{ width: 80, height: 60, border: "1px dashed #ccc",
                              display: "flex", alignItems: "center", justifyContent: "center",
                              color: "#999", fontSize: 9 }}>LOGO</div>}
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16, fontWeight: 800, color: BRAND, letterSpacing: 0.5 }}>
              {(co.name_en || "BANSAR (NINGBO) INT'L TRANSPORTATION CO., LTD.").toUpperCase()}
            </div>
            <div style={{ fontSize: 11, fontWeight: 700, color: BRAND, marginTop: 2, letterSpacing: 2 }}>
              {co.name_zh || "班萨（宁波）国际货运代理有限公司"}
            </div>
          </div>
        </div>

        <div style={{ flex: "0 0 220px", textAlign: "right" }}>
          <div style={{ fontSize: 24, fontWeight: 800, color: BRAND, letterSpacing: 2, lineHeight: 1.1 }}>
            BILL OF LADING
          </div>
          <div style={{
            border: `2px solid ${BRAND}`, padding: "5px 10px",
            display: "inline-block", textAlign: "left", marginTop: 8,
          }}>
            <div style={{ fontSize: 9, color: BRAND, fontWeight: 700 }}>B/L No.</div>
            <div style={{ fontSize: 13, fontWeight: 800, fontFamily: "'Consolas',monospace", color: "#000" }}>
              {blNo}
            </div>
          </div>
          {totalPages > 1 && (
            <div style={{ fontSize: 9, color: "#999", marginTop: 4 }}>
              Page {pageIdx + 1} of {totalPages}
            </div>
          )}
        </div>
      </header>

      {isDraft && (
        <div style={{
          textAlign: "center", color: STAMP_RED, fontSize: 11, fontWeight: 700,
          margin: "4px 0 8px", letterSpacing: 1, position: "relative", zIndex: 2,
        }}>
          ⚠ DRAFT — Subject to client confirmation / 待客户确认
        </div>
      )}
      {isCopy && (
        <div style={{ textAlign: "center", margin: "4px 0 8px", position: "relative", zIndex: 2 }}>
          <div style={{
            display: "inline-block", padding: "3px 16px",
            border: `2px solid ${STAMP_RED}`, color: STAMP_RED,
            fontSize: 13, fontWeight: 800, letterSpacing: 4,
            background: "rgba(255, 240, 240, 0.4)",
          }}>
            COPY NON-NEGOTIABLE
          </div>
        </div>
      )}

      {!isFirstPage && (
        <div style={{
          textAlign: "center", padding: 16, color: "#666",
          background: BRAND_BG, border: `1px solid ${BRAND_BORDER}`,
          fontSize: 11, marginBottom: 8, position: "relative", zIndex: 2,
        }}>
          ── CONTINUATION SHEET / 续页 — Cargo Description Continued ──
        </div>
      )}

      {/* ─── 1-11 字段区（仅首页） ─── */}
      {isFirstPage && (
        <div style={{ position: "relative", zIndex: 2 }}>
          <div style={{ display: "flex", gap: 0 }}>
            <div className="fld" style={{ flex: 1.5, minHeight: 70, borderRight: 0 }}>
              <span className="fld-num">1.</span>
              <div className="fld-label">Shipper</div>
              <div className="fld-val">{s.shipper_name || "—"}</div>
            </div>
            <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
              <div className="fld" style={{ borderBottom: 0 }}>
                <span className="fld-num">4.</span>
                <div className="fld-label">Booking No.</div>
                <div className="fld-val fld-val-mono">{s.booking_no || "—"}</div>
              </div>
              <div className="fld" style={{ borderBottom: 0 }}>
                <span className="fld-num">5.</span>
                <div className="fld-label">Export References</div>
                <div className="fld-val fld-val-mono">{s.po || s.customer_po || "—"}</div>
              </div>
              <div className="fld">
                <span className="fld-num">6.</span>
                <div className="fld-label">Forwarder Ref.</div>
                <div className="fld-val fld-val-mono">{s.order_no || "—"}</div>
              </div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 0 }}>
            <div className="fld" style={{ flex: 1.5, minHeight: 70, borderTop: 0, borderRight: 0 }}>
              <span className="fld-num">2.</span>
              <div className="fld-label">Consignee</div>
              <div className="fld-val">{s.consignee_name || "—"}</div>
              {blType === "电放" && (
                <div style={{
                  position: "absolute", right: 10, top: "50%",
                  transform: "translateY(-50%) rotate(-3deg)",
                  border: `2.5px solid ${STAMP_RED}`, color: STAMP_RED,
                  padding: "5px 14px", fontSize: 14, fontWeight: 800, letterSpacing: 2,
                  background: "rgba(255, 240, 240, 0.5)",
                  pointerEvents: "none", whiteSpace: "nowrap",
                }}>
                  TELEX RELEASE
                </div>
              )}
            </div>
            <div className="fld" style={{ flex: 1, borderTop: 0 }}>
              <span className="fld-num">7.</span>
              <div className="fld-label">Ocean Vessel / Voyage</div>
              <div className="fld-val">
                {s.vessel ? `${s.vessel}${s.voyage ? " / " + s.voyage : ""}` : "—"}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 0 }}>
            <div className="fld" style={{ flex: 1.5, borderTop: 0, borderRight: 0 }}>
              <span className="fld-num">8.</span>
              <div className="fld-label">Port of Loading</div>
              <div className="fld-val">{s.pol || "—"}</div>
            </div>
            <div className="fld" style={{ flex: 1, borderTop: 0 }}>
              <span className="fld-num">9.</span>
              <div className="fld-label">Port of Discharge</div>
              <div className="fld-val">{s.pod || "—"}</div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 0 }}>
            <div className="fld" style={{ flex: 1.5, minHeight: 60, borderTop: 0, borderRight: 0 }}>
              <span className="fld-num">3.</span>
              <div className="fld-label">Notify Party</div>
              <div className="fld-val">{s.notify_party || "SAME AS CONSIGNEE"}</div>
            </div>
            <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
              <div className="fld" style={{ borderTop: 0, borderBottom: 0 }}>
                <span className="fld-num">10.</span>
                <div className="fld-label">Place of Receipt</div>
                <div className="fld-val">{s.pol || "—"}</div>
              </div>
              <div className="fld" style={{ borderTop: 0 }}>
                <span className="fld-num">11.</span>
                <div className="fld-label">Place of Delivery</div>
                <div className="fld-val">{s.pod || "—"}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── 12-16 货物表 ─── */}
      <div style={{ position: "relative", zIndex: 2 }}>
        <table className="cargo-table">
          <thead>
            <tr>
              <th style={{ width: "13%" }}><span className="num">12.</span>Marks &amp; Numbers</th>
              <th style={{ width: "13%" }}><span className="num">13.</span>Number and Kind<br/>of Packages</th>
              <th style={{ width: "44%" }}><span className="num">14.</span>Description of Goods</th>
              <th style={{ width: "15%", textAlign: "right" }}><span className="num">15.</span>Gross Weight<br/>(KGS)</th>
              <th style={{ width: "15%", textAlign: "right" }}><span className="num">16.</span>Measurement<br/>(CBM)</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={5} style={{ textAlign: "center", color: "#999", padding: 24 }}>
                No cargo data
              </td></tr>
            ) : rows.map((r, i) => (
              <tr key={i}>
                <td style={{ whiteSpace: "pre-wrap", fontWeight: 600 }}>{r.marks}</td>
                <td>
                  <div style={{ fontWeight: 600 }}>{r.pkgs ? `${r.pkgs} ${r.unit}` : "—"}</div>
                </td>
                <td style={{ whiteSpace: "pre-wrap" }}>
                  {i === 0 && (
                    <div style={{ fontWeight: 600, fontSize: 9.5, marginBottom: 4, letterSpacing: 0.3 }}>
                      SHIPPER'S LOAD COUNT &amp; SEAL S.T.C.
                    </div>
                  )}
                  {r.desc}
                </td>
                <td style={{ textAlign: "right", fontFamily: "'Consolas',monospace" }}>
                  {r.gw ? r.gw.toFixed(3) : "—"}
                </td>
                <td style={{ textAlign: "right", fontFamily: "'Consolas',monospace" }}>
                  {r.cbm ? r.cbm.toFixed(3) : "—"}
                </td>
              </tr>
            ))}
            {isLastPage && (
              <tr className="total-row">
                <td></td>
                <td style={{ fontWeight: 700 }}>{totalPkg ? `${totalPkg}` : "—"}</td>
                <td style={{ fontStyle: "italic", fontSize: 9.5 }}>
                  TOTAL · SAY {chineseNum(totalPkg)} {rows[0]?.unit || "PACKAGES"} ONLY
                </td>
                <td style={{ textAlign: "right", fontFamily: "'Consolas',monospace" }}>
                  {totalWt ? totalWt.toFixed(3) : "—"}
                </td>
                <td style={{ textAlign: "right", fontFamily: "'Consolas',monospace" }}>
                  {totalCbm ? totalCbm.toFixed(3) : "—"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ─── 末页底部 17 集装箱明细 + 22-28 ─── */}
      {isLastPage && (
        <div style={{ position: "relative", zIndex: 2 }}>
          {/* 17. Container No. / Seal No. / Pieces / Wt / CBM */}
          <div className="fld" style={{ borderTop: 0, padding: "5px 8px" }}>
            <span className="fld-num">17.</span>
            <div className="fld-label">Container No. / Seal No. / Size / Pieces / Gross Weight / Measurement</div>
            <div style={{ marginLeft: 14, marginTop: 4 }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10, fontFamily: "'Consolas','Microsoft YaHei',monospace" }}>
                <thead>
                  <tr style={{ background: BRAND_BG }}>
                    <th style={{ padding: "3px 6px", border: `0.5px solid ${BRAND_BORDER}`, fontSize: 9, fontWeight: 700, textAlign: "left" }}>Container No.</th>
                    <th style={{ padding: "3px 6px", border: `0.5px solid ${BRAND_BORDER}`, fontSize: 9, fontWeight: 700, textAlign: "left" }}>Seal No.</th>
                    <th style={{ padding: "3px 6px", border: `0.5px solid ${BRAND_BORDER}`, fontSize: 9, fontWeight: 700, textAlign: "center", width: 60 }}>Size</th>
                    <th style={{ padding: "3px 6px", border: `0.5px solid ${BRAND_BORDER}`, fontSize: 9, fontWeight: 700, textAlign: "right", width: 80 }}>Pieces</th>
                    <th style={{ padding: "3px 6px", border: `0.5px solid ${BRAND_BORDER}`, fontSize: 9, fontWeight: 700, textAlign: "right", width: 90 }}>G.W. (KGS)</th>
                    <th style={{ padding: "3px 6px", border: `0.5px solid ${BRAND_BORDER}`, fontSize: 9, fontWeight: 700, textAlign: "right", width: 80 }}>CBM</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    // 解析集装箱信息：优先用 container_no/seal_no（多个用 / 或换行分隔）
                    // 否则按 qty_container 字段（如 "2x40HQ"）展开成占位行
                    const containerNos = (s.container_no || "").split(/[\/,;\n]/).map(x => x.trim()).filter(Boolean);
                    const sealNos = (s.seal_no || "").split(/[\/,;\n]/).map(x => x.trim()).filter(Boolean);
                    const containerRows = [];

                    if (containerNos.length > 0) {
                      // 有具体箱号：每箱一行
                      const perBoxPkg = totalPkg && containerNos.length ? Math.floor(totalPkg / containerNos.length) : 0;
                      const perBoxWt = totalWt && containerNos.length ? totalWt / containerNos.length : 0;
                      const perBoxCbm = totalCbm && containerNos.length ? totalCbm / containerNos.length : 0;
                      containerNos.forEach((cn, i) => {
                        containerRows.push({
                          cn,
                          seal: sealNos[i] || "",
                          size: s.qty_container || "",
                          pkgs: perBoxPkg ? `${perBoxPkg} CTNS` : "—",
                          gw: perBoxWt ? perBoxWt.toFixed(3) : "—",
                          cbm: perBoxCbm ? perBoxCbm.toFixed(3) : "—",
                        });
                      });
                    } else if (s.qty_container) {
                      // 没箱号但有"2x40HQ"信息：占位一行
                      containerRows.push({
                        cn: "—", seal: "—",
                        size: s.qty_container,
                        pkgs: totalPkg ? `${totalPkg} CTNS` : "—",
                        gw: totalWt ? totalWt.toFixed(3) : "—",
                        cbm: totalCbm ? totalCbm.toFixed(3) : "—",
                      });
                    }

                    if (containerRows.length === 0) {
                      return <tr><td colSpan={6} style={{ padding: 10, textAlign: "center", color: "#999", border: `0.5px solid ${BRAND_BORDER}` }}>—</td></tr>;
                    }
                    return containerRows.map((cr, i) => (
                      <tr key={i}>
                        <td style={{ padding: "3px 6px", border: `0.5px solid ${BRAND_BORDER}` }}>{cr.cn}</td>
                        <td style={{ padding: "3px 6px", border: `0.5px solid ${BRAND_BORDER}` }}>{cr.seal}</td>
                        <td style={{ padding: "3px 6px", border: `0.5px solid ${BRAND_BORDER}`, textAlign: "center" }}>{cr.size}</td>
                        <td style={{ padding: "3px 6px", border: `0.5px solid ${BRAND_BORDER}`, textAlign: "right" }}>{cr.pkgs}</td>
                        <td style={{ padding: "3px 6px", border: `0.5px solid ${BRAND_BORDER}`, textAlign: "right" }}>{cr.gw}</td>
                        <td style={{ padding: "3px 6px", border: `0.5px solid ${BRAND_BORDER}`, textAlign: "right" }}>{cr.cbm}</td>
                      </tr>
                    ));
                  })()}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ display: "flex" }}>
            <div className="fld" style={{ flex: 1.5, borderTop: 0, borderRight: 0, minHeight: 80 }}>
              <span className="fld-num">22.</span>
              <div className="fld-label">Freight &amp; Charges</div>
              <div style={{ marginLeft: 14, marginTop: 2, fontSize: 10 }}>
                <div style={{ marginBottom: 3 }}>Ocean Freight: <b>{s.freight_term || "AS ARRANGED"}</b></div>
                <div>Service Type: <b>{s.carrier_service || "CY-CY"}</b></div>
                <div style={{ fontSize: 9, color: "#666", marginTop: 4 }}>FREIGHT AS ARRANGED</div>
              </div>
            </div>
            <div className="fld" style={{ flex: 1, borderTop: 0, minHeight: 80 }}>
              <span className="fld-num">24.</span>
              <div className="fld-label">Number of Original B/Ls</div>
              <div className="fld-val" style={{ fontWeight: 700, fontSize: 12, marginTop: 4 }}>
                {numOriginals}
              </div>
            </div>
          </div>

          <div className="fld" style={{ borderTop: 0, padding: "6px 8px" }}>
            <span className="fld-num">23.</span>
            <div className="fld-label">Freight Payable at / by / Currency</div>
            <div style={{ marginLeft: 14, marginTop: 2, display: "flex", gap: 24, flexWrap: "wrap", fontSize: 10 }}>
              <div>
                <div style={{ fontSize: 9, color: "#666", marginBottom: 2 }}>Payable at:</div>
                <span className={`chk ${isPrepaid ? "checked" : ""}`}></span>Prepaid
                <span style={{ marginLeft: 12 }}><span className={`chk ${isCollect ? "checked" : ""}`}></span>Collect</span>
              </div>
              <div>
                <div style={{ fontSize: 9, color: "#666", marginBottom: 2 }}>Payable by:</div>
                <span className="chk"></span>Shipper
                <span style={{ marginLeft: 8 }}><span className="chk"></span>Consignee</span>
                <span style={{ marginLeft: 8 }}><span className="chk"></span>Third Party</span>
              </div>
              <div>
                <div style={{ fontSize: 9, color: "#666", marginBottom: 2 }}>Charge Currency:</div>
                <span className="chk"></span>USD
                <span style={{ marginLeft: 8 }}><span className="chk"></span>CNY</span>
                <span style={{ marginLeft: 8 }}><span className="chk"></span>Other: ____</span>
              </div>
            </div>
          </div>

          <div style={{ display: "flex" }}>
            <div className="fld" style={{ flex: 1, borderTop: 0, borderRight: 0 }}>
              <span className="fld-num">25.</span>
              <div className="fld-label">Place and Date of Issue</div>
              <div className="fld-val">{(s.pol || "Ningbo") + ", China / " + issueDate}</div>
            </div>
            <div className="fld" style={{ flex: 1, borderTop: 0, borderRight: 0 }}>
              <span className="fld-num">26.</span>
              <div className="fld-label">Shipped on Board Date</div>
              <div className="fld-val" style={{ fontWeight: 700 }}>
                {onBoardDate}
                {!s.atd && <span style={{ fontSize: 9, color: "#999", fontWeight: 400, marginLeft: 6 }}>
                  (基于 ETD)
                </span>}
              </div>
            </div>
            <div className="fld" style={{ flex: 1.2, borderTop: 0 }}>
              <span className="fld-num">27.</span>
              <div className="fld-label">Declared Value</div>
              <div className="fld-val" style={{ fontSize: 9, color: "#666", lineHeight: 1.4 }}>
                Currency: ____________ Amount: ____________
                <div style={{ marginTop: 3, fontStyle: "italic" }}>
                  If no value is declared, the liability of the carrier is limited as provided in Clause 18.
                </div>
              </div>
            </div>
          </div>

          <div className="fld" style={{ borderTop: 0, padding: "6px 8px", minHeight: 130, position: "relative" }}>
            <span className="fld-num">28.</span>
            <div className="fld-label">Signed for the Carrier / As Agent</div>
            <div style={{ marginLeft: 14, marginTop: 4, fontSize: 10 }}>
              <div style={{ fontWeight: 700, marginBottom: 2 }}>
                {(co.name_en || "BANSAR (NINGBO) INT'L TRANSPORTATION CO., LTD.").toUpperCase()}
              </div>
              <div style={{ fontStyle: "italic", color: "#444", fontSize: 9.5 }}>
                as Agent for and on behalf of the Carrier
              </div>

              <div style={{ position: "relative", marginTop: 16, minHeight: 60, paddingRight: 110 }}>
                {co.signature_url && (
                  <img src={co.signature_url} alt="signature"
                       style={{ position: "absolute", left: 20, top: 0,
                                maxWidth: 180, maxHeight: 50, opacity: 0.9 }} />
                )}
                {co.stamp_url ? (
                  <img src={co.stamp_url} alt="stamp"
                       style={{ position: "absolute", right: 0, top: -6,
                                maxWidth: 100, maxHeight: 80, opacity: 0.85 }} />
                ) : (
                  <div style={{
                    position: "absolute", right: 0, top: -6,
                    width: 90, height: 70, border: "1.5px dashed #bbb",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    color: "#aaa", fontSize: 9, textAlign: "center", lineHeight: 1.3,
                    borderRadius: 4,
                  }}>
                    Company<br/>Stamp
                  </div>
                )}
              </div>

              <div style={{ display: "flex", gap: 16, marginTop: 4, fontSize: 9.5 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ borderBottom: "1px solid #000", height: 14 }}></div>
                  <div style={{ marginTop: 1, color: "#444" }}>Authorized Signature</div>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ borderBottom: "1px solid #000", height: 14 }}></div>
                  <div style={{ marginTop: 1, color: "#444" }}>Name</div>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ borderBottom: "1px solid #000", height: 14, lineHeight: "14px",
                                fontFamily: "'Consolas',monospace", fontSize: 10 }}>
                    {issueDate}
                  </div>
                  <div style={{ marginTop: 1, color: "#444" }}>Date</div>
                </div>
              </div>
            </div>
          </div>

          <div style={{
            border: "1px solid #888", borderTop: 0,
            padding: "6px 10px", fontSize: 8, lineHeight: 1.4, color: "#444",
            textAlign: "justify",
          }}>
            We, {co.name_zh || co.name_en || "BANSAR"}, as Forwarders only, acknowledge receipt of the goods
            in apparent good order and condition unless otherwise noted herein, for transportation as
            mentioned above and we undertake to deliver the same in like good order and condition subject
            to the terms and conditions set forth on the face and reverse hereof, the Company's Standard
            Trading Conditions (available at {co.website || "www.bansargroup.com"}) and the actual Carrier's
            applicable bill of lading, tariff and service terms, all of which are hereby expressly
            incorporated herein. — END OF CLAUSE —
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6,
                        fontSize: 8, color: "#888" }}>
            <div>TERMS AND CONDITIONS OVERLEAF</div>
            <div>Form BNSR-HBL</div>
          </div>
        </div>
      )}
    </div>
  );
}

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

const btn = {
  padding: "5px 14px", background: "#fff",
  border: "1px solid #d9d9d9", borderRadius: 3,
  fontSize: 12, cursor: "pointer",
};
const btnPrimary = { ...btn, background: "#1890ff", color: "#fff", border: "1px solid #1890ff" };
