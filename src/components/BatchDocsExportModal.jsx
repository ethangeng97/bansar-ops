import { useMemo, useRef, useState } from "react";
import { Modal, Button } from "./ui.jsx";
import BLLayout from "../pages/docs/BLLayout.jsx";
import {
  createDocumentPdfBlob,
  downloadBlob,
  sanitizeFileStem,
} from "../lib/document-download.js";

const DOC_MODES = [
  { value: "copy", label: "提单副本 Copy", tag: "COPY" },
  { value: "telex", label: "电放件 Telex", tag: "TELEX" },
  { value: "draft", label: "提单确认件 Draft", tag: "DRAFT" },
  { value: "original", label: "提单正本 Original", tag: "ORIGINAL" },
];

export default function BatchDocsExportModal({ filteredRows = [], checkedRows = [], onClose }) {
  const [range, setRange] = useState(checkedRows.length > 0 ? "checked" : "filtered");
  const [mode, setMode] = useState("copy");
  const [variant, setVariant] = useState("hbl");
  const [busy, setBusy] = useState(false);
  const [current, setCurrent] = useState(null);
  const [done, setDone] = useState(0);
  const [zipPct, setZipPct] = useState(0);
  const [failures, setFailures] = useState([]);
  const renderRootRef = useRef(null);
  const waiterRef = useRef(null);

  const rows = useMemo(() => {
    const source = range === "checked" ? checkedRows : filteredRows;
    const seen = new Set();
    return (source || []).filter(row => {
      if (!row?.id || seen.has(row.id)) return false;
      seen.add(row.id);
      return true;
    });
  }, [range, checkedRows, filteredRows]);

  const modeMeta = DOC_MODES.find(item => item.value === mode) || DOC_MODES[0];
  const canRun = rows.length > 0 && !busy;

  const run = async () => {
    if (!rows.length) {
      alert(range === "checked" ? "请先勾选要导出的订单" : "当前筛选结果为空");
      return;
    }
    if (rows.length > 50 && !window.confirm(`本次将生成 ${rows.length} 个 PDF，可能需要较长时间。继续导出？`)) return;

    setBusy(true);
    setDone(0);
    setZipPct(0);
    setFailures([]);
    const { default: JSZip } = await import("jszip");
    const failed = [];
    const zip = new JSZip();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        const info = await waitForRendered(row, i);
        await waitForLayout();
        const blob = await createDocumentPdfBlob({
          pageSelector: ".hbl-page",
          root: renderRootRef.current,
          scale: 1.5,
          singlePagePerElement: true,
        });
        zip.file(makePdfFilename(info.shipment || row, variant, modeMeta), blob);
      } catch (e) {
        failed.push({
          order_no: row.order_no || row.id,
          msg: e?.message || String(e),
        });
      } finally {
        setDone(i + 1);
        setFailures([...failed]);
      }
    }

    setCurrent(null);
    if (zip.files && Object.keys(zip.files).length > 0) {
      const zipBlob = await zip.generateAsync(
        { type: "blob", compression: "STORE" },
        meta => setZipPct(Math.round(meta.percent || 0))
      );
      downloadBlob(zipBlob, `${makeZipStem(rows, variant, modeMeta)}.zip`);
    }

    setBusy(false);
    setZipPct(0);
    if (failed.length) {
      alert(`批量导出完成，但有 ${failed.length} 票失败：\n\n${failed.map(f => `· ${f.order_no}: ${f.msg}`).join("\n")}`);
    }
  };

  const waitForRendered = (row, index) => new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      if (waiterRef.current?.rowId === row.id) waiterRef.current = null;
      reject(new Error("渲染超时"));
    }, 60000);
    waiterRef.current = {
      rowId: row.id,
      resolve: (info) => {
        window.clearTimeout(timer);
        waiterRef.current = null;
        resolve(info);
      },
      reject: (error) => {
        window.clearTimeout(timer);
        waiterRef.current = null;
        reject(error);
      },
    };
    setCurrent({ row, index });
  });

  const handleReady = (info) => {
    waiterRef.current?.resolve(info);
  };

  const handleLoadError = (error) => {
    waiterRef.current?.reject(error);
  };

  return (
    <>
      <Modal title="批量导出单证" onClose={() => { if (!busy) onClose(); }} width={700}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <SelectRow label="导出范围">
            <select value={range} onChange={e => setRange(e.target.value)} disabled={busy} style={inputStyle}>
              <option value="checked">已勾选订单（{checkedRows.length}）</option>
              <option value="filtered">当前筛选结果（{filteredRows.length}）</option>
            </select>
          </SelectRow>
          <SelectRow label="单证类型">
            <select value={mode} onChange={e => setMode(e.target.value)} disabled={busy} style={inputStyle}>
              {DOC_MODES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
          </SelectRow>
          <SelectRow label="提单版本">
            <select value={variant} onChange={e => setVariant(e.target.value)} disabled={busy} style={inputStyle}>
              <option value="hbl">HBL 分单</option>
              <option value="mbl">MBL 主单</option>
            </select>
          </SelectRow>
          <SelectRow label="输出格式">
            <input value="ZIP（每票一个 PDF）" disabled style={inputStyle} />
          </SelectRow>
        </div>

        <div style={{ marginTop: 14, padding: 10, background: "#fafafa", border: "1px solid #eee", borderRadius: 6 }}>
          <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>
            将导出 <b style={{ color: "#0050b3" }}>{rows.length}</b> 票，每票生成一个独立 PDF 后打包下载。
          </div>
          <div style={{ maxHeight: 120, overflowY: "auto", fontSize: 12 }}>
            {rows.slice(0, 80).map((row, i) => (
              <div key={row.id} style={{ padding: "2px 0", color: "#333" }}>
                <span style={{ display: "inline-block", width: 28, color: "#888" }}>{i + 1}.</span>
                <b>{row.order_no || "(无号)"}</b>
                <span style={{ color: "#888", marginLeft: 8 }}>
                  {row.vessel || "—"} {row.voyage || ""} · {variant === "mbl" ? (row.mbl_no || row.booking_no || "—") : (row.hbl_no || "—")}
                </span>
              </div>
            ))}
            {rows.length > 80 && <div style={{ color: "#888", paddingTop: 4 }}>还有 {rows.length - 80} 票...</div>}
          </div>
        </div>

        {(busy || done > 0 || failures.length > 0) && (
          <div style={{ marginTop: 12, padding: 10, background: "#f0f5ff", border: "1px solid #adc6ff", borderRadius: 6, fontSize: 12 }}>
            <div>进度：<b>{done}</b> / {rows.length}</div>
            {current && <div style={{ marginTop: 4, color: "#555" }}>当前：{current.row.order_no || current.row.id}</div>}
            {zipPct > 0 && <div style={{ marginTop: 4, color: "#555" }}>压缩 ZIP：{zipPct}%</div>}
            {failures.length > 0 && (
              <div style={{ marginTop: 6, color: "#cf1322" }}>
                失败 {failures.length} 票：{failures.slice(0, 3).map(f => f.order_no).join(", ")}
                {failures.length > 3 ? " ..." : ""}
              </div>
            )}
          </div>
        )}

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 18 }}>
          <Button variant="secondary" onClick={onClose} disabled={busy}>关闭</Button>
          <Button onClick={run} disabled={!canRun}>
            {busy ? "导出中..." : `生成 ZIP（${rows.length} 票）`}
          </Button>
        </div>
      </Modal>

      <div ref={renderRootRef} style={offscreenStyle} aria-hidden="true">
        {current && (
          <BLLayout
            key={`${current.row.id}-${mode}-${variant}-${current.index}`}
            shipmentId={current.row.id}
            mode={mode}
            variant={variant}
            embedded
            onReady={handleReady}
            onLoadError={handleLoadError}
          />
        )}
      </div>
    </>
  );
}

function SelectRow({ label, children }) {
  return (
    <label style={{ display: "block", fontSize: 12, color: "#555" }}>
      <div style={{ marginBottom: 4, fontWeight: 600 }}>{label}</div>
      {children}
    </label>
  );
}

function waitForLayout() {
  return new Promise(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
}

function makePdfFilename(shipment, variant, modeMeta) {
  const blNo = variant === "mbl"
    ? (shipment.mbl_no || shipment.booking_no || shipment.order_no || "MBL")
    : (shipment.hbl_no || shipment.order_no || "HBL");
  return `${sanitizeFileStem(`${shipment.order_no || blNo}-${blNo}-${variant.toUpperCase()}-${modeMeta.tag}`)}.pdf`;
}

function makeZipStem(rows, variant, modeMeta) {
  const first = rows[0] || {};
  const vessel = [first.vessel, first.voyage].filter(Boolean).join("-");
  const scope = vessel || first.etd || new Date().toISOString().slice(0, 10);
  return sanitizeFileStem(`Bansar-${scope}-${variant.toUpperCase()}-${modeMeta.tag}`);
}

const inputStyle = {
  width: "100%",
  padding: "6px 8px",
  border: "1px solid #d9d9d9",
  borderRadius: 4,
  boxSizing: "border-box",
  fontSize: 12,
  background: "#fff",
};

const offscreenStyle = {
  position: "fixed",
  left: 0,
  top: 0,
  width: "230mm",
  background: "#fff",
  opacity: 0,
  pointerEvents: "none",
  zIndex: 0,
};
