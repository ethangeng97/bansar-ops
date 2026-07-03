// ============================================================================
// BatchEditModal — 批量修改已勾选订单的字段
//
// 流程：
//   1. 用户在列表勾选 ≥1 票 → 点"批量修改"
//   2. 勾选想改的字段（每个字段前有开关），填新值
//   3. 确认 → 只把「勾选启用」的字段写到每票（未启用的字段一律不动）
//
// 设计要点：
//   · 只更新用户显式启用的字段，避免误清空其它字段（对比整表 update 的坑）
//   · 逐票 update + 收集失败清单，跟 MergeOrdersModal 同一套反馈风格
//   · 所有写入过 filterShipmentPayload 白名单（防 ghost field 导致 schema 报错）
// ============================================================================
import { useState } from "react";
import { supabase } from "../supabase.js";
import { Modal, Button, ComboBox } from "./ui.jsx";
import { filterShipmentPayload } from "../lib/shipment-fields.js";
import { COMMON_CARRIERS } from "../lib/carriers.js";

// 可批量修改的字段清单。type: date | text | select
// value 为空字符串时写入 null（即批量清空该字段）。
const FIELDS = [
  { key: "atd",            label: "实际开航日", type: "date" },
  { key: "etd",            label: "预计开航时间", type: "date" },
  { key: "eta",            label: "预计到港", type: "date" },
  { key: "carrier",        label: "船东", type: "combo", options: COMMON_CARRIERS, upper: true },
  { key: "vessel",         label: "船名", type: "text", upper: true },
  { key: "voyage",         label: "航次", type: "text", upper: true },
  { key: "pol",            label: "起运港", type: "text" },
  { key: "pod",            label: "卸货港", type: "text" },
  { key: "destination",    label: "目的地", type: "text" },
  { key: "overseas_agent", label: "海外代理", type: "text" },
  { key: "space_status",   label: "出运状态", type: "select", options: ["未订舱", "已订舱"] },
  { key: "si_cutoff",      label: "SI 截止", type: "date" },
  { key: "vgm_cutoff",     label: "VGM 截止", type: "date" },
  { key: "cy_cutoff",      label: "进港截止", type: "date" },
  { key: "customs_cutoff", label: "报关截止", type: "date" },
];

export default function BatchEditModal({ selected, onClose, onSaved }) {
  // enabled: 哪些字段被勾选启用   values: 各字段填入的新值
  const [enabled, setEnabled] = useState({});
  const [values, setValues] = useState({});
  const [submitting, setSubmitting] = useState(false);

  const toggle = (k) => setEnabled(p => ({ ...p, [k]: !p[k] }));
  const setVal = (k, v) => setValues(p => ({ ...p, [k]: v }));

  const activeFields = FIELDS.filter(f => enabled[f.key]);

  const submit = async () => {
    if (!selected.length) { alert("请先勾选订单"); return; }
    if (!activeFields.length) { alert("请至少勾选一个要修改的字段"); return; }

    // 组装 payload：空字符串 → null（批量清空）
    const raw = {};
    for (const f of activeFields) {
      let v = values[f.key];
      if (typeof v === "string") v = v.trim();
      if (f.upper && v) v = v.toUpperCase();
      raw[f.key] = v === "" || v == null ? null : v;
    }
    const payload = filterShipmentPayload(raw);

    const emptied = activeFields.filter(f => raw[f.key] == null).map(f => f.label);
    const confirmMsg =
      `确认把以下 ${activeFields.length} 个字段批量写入 ${selected.length} 个订单？\n\n` +
      activeFields.map(f => `· ${f.label}：${raw[f.key] == null ? "（清空）" : raw[f.key]}`).join("\n") +
      (emptied.length ? `\n\n⚠ 标记「清空」的字段会把选中订单的该字段清空。` : "") +
      `\n\n其它字段不受影响。`;
    if (!window.confirm(confirmMsg)) return;

    setSubmitting(true);
    const failed = [];
    let ok = 0;
    const updatedRows = [];
    for (const s of selected) {
      const { data, error } = await supabase.from("shipments")
        .update(payload).eq("id", s.id).select().single();
      if (error) failed.push({ order_no: s.order_no || s.id, msg: error.message });
      else { ok++; if (data) updatedRows.push(data); }
    }
    setSubmitting(false);

    if (failed.length) {
      alert(
        `部分修改失败（${failed.length}/${selected.length}）：\n\n` +
        failed.map(f => `· ${f.order_no}: ${f.msg}`).join("\n") +
        (ok ? `\n\n成功的 ${ok} 个已保存。` : "")
      );
    } else {
      alert(`✓ 已更新 ${ok} 个订单`);
    }

    onSaved && onSaved(updatedRows);
    onClose();
  };

  return (
    <Modal title={`批量修改 — 已选 ${selected.length} 个订单`} onClose={onClose} width={640}>
      {/* 已选列表 */}
      <div style={{ marginBottom: 14, padding: 10, background: "#fafafa", borderRadius: 6, maxHeight: 110, overflowY: "auto" }}>
        <div style={{ fontSize: 11, color: "#666", marginBottom: 6 }}>将修改以下订单：</div>
        {selected.map((s, i) => (
          <div key={s.id} style={{ fontSize: 12, padding: "2px 0" }}>
            <span style={{ display: "inline-block", width: 22, color: "#888" }}>{i + 1}.</span>
            <b>{s.order_no || "(无号)"}</b>
            <span style={{ color: "#888", marginLeft: 8 }}>
              {s.customer || "—"} · {s.vessel || "—"} {s.voyage || ""} · ETD {s.etd || "—"}
            </span>
          </div>
        ))}
      </div>

      <div style={{ fontSize: 11, color: "#888", marginBottom: 10 }}>
        勾选左侧开关来启用要修改的字段——<b>只有勾选的字段</b>会写入选中订单，其它字段保持不变。
        留空并勾选表示<b>批量清空</b>该字段。
      </div>

      {/* 字段编辑区 */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {FIELDS.map(f => {
          const on = !!enabled[f.key];
          const val = values[f.key] ?? "";
          return (
            <div key={f.key} style={{
              display: "flex", alignItems: "center", gap: 8, padding: "6px 8px",
              border: "1px solid " + (on ? "#91d5ff" : "#eee"), borderRadius: 6,
              background: on ? "#e6f7ff" : "#fff",
            }}>
              <input type="checkbox" checked={on} onChange={() => toggle(f.key)} style={{ flexShrink: 0 }} />
              <label onClick={() => toggle(f.key)} style={{
                fontSize: 12, color: on ? "#0050b3" : "#666", width: 74, flexShrink: 0,
                cursor: "pointer", fontWeight: on ? 600 : 400,
              }}>{f.label}</label>
              <div style={{ flex: 1, minWidth: 0 }}>
                {f.type === "date" && (
                  <input type="date" value={val} disabled={!on}
                    onChange={e => setVal(f.key, e.target.value)}
                    style={inputStyle(on)} />
                )}
                {f.type === "text" && (
                  <input value={val} disabled={!on}
                    onChange={e => setVal(f.key, e.target.value)}
                    style={inputStyle(on)} />
                )}
                {f.type === "select" && (
                  <select value={val} disabled={!on}
                    onChange={e => setVal(f.key, e.target.value)}
                    style={inputStyle(on)}>
                    <option value="">（清空）</option>
                    {f.options.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                )}
                {f.type === "combo" && (
                  <ComboBox value={val} options={f.options}
                    onChange={v => on && setVal(f.key, v)}
                    placeholder={on ? "" : "先勾选启用"} />
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 18 }}>
        <div style={{ fontSize: 11, color: "#888" }}>
          已启用 <b style={{ color: "#0050b3" }}>{activeFields.length}</b> 个字段
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>取消</Button>
          <Button onClick={submit} disabled={submitting || !activeFields.length}>
            {submitting ? "保存中…" : `应用到 ${selected.length} 个订单`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function inputStyle(on) {
  return {
    width: "100%", padding: "5px 8px", border: "1px solid #d9d9d9", borderRadius: 3,
    fontSize: 12, boxSizing: "border-box",
    background: on ? "#fff" : "#f5f5f5", color: on ? "#222" : "#aaa",
  };
}
