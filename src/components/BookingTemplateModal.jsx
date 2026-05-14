// ============================================================================
// BookingTemplateModal — 订舱模板
// 2 个 tab：
//   1) 从模板创建 — 列出已有模板，点击 apply 把字段合并到当前作业
//   2) 存为模板 — 把当前作业的关键字段保存成新模板
// ============================================================================
import { useState, useEffect } from "react";
import { supabase } from "../supabase.js";

// 模板里包含的字段（其他字段如单号 / 件数 / 日期等不进模板）
const TEMPLATE_FIELDS = [
  "shipment_type",
  "vessel", "voyage",
  "carrier", "carrier_agent", "overseas_agent",
  "pol", "pol_code", "pod", "pod_code", "destination", "destination_code",
  "transit_port_code", "transit_port_name",
  "terminal",
  "freight_terms", "incoterms", "service_type", "transport_terms",
  "bl_type", "has_hbl",
  "shipper", "consignee", "notify_party",
  "solicit_type", "solicitation_agent",
];

export default function BookingTemplateModal({ open, onClose, shipment, onApply }) {
  const [mode, setMode] = useState("apply");   // "apply" | "save"
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [saveDesc, setSaveDesc] = useState("");

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    supabase.from("booking_templates").select("*").eq("active", true)
      .order("use_count", { ascending: false }).order("name")
      .then(({ data }) => { setTemplates(data || []); setLoading(false); });
  }, [open]);

  if (!open) return null;

  const apply = async (t) => {
    onApply?.(t.snapshot || {});
    // bump use_count
    supabase.from("booking_templates").update({ use_count: (t.use_count || 0) + 1 })
      .eq("id", t.id).catch(() => {});
    onClose();
  };

  const save = async () => {
    if (!saveName.trim()) { alert("请填模板名"); return; }
    const snapshot = {};
    for (const f of TEMPLATE_FIELDS) {
      if (shipment?.[f] != null && shipment[f] !== "") snapshot[f] = shipment[f];
    }
    const { error } = await supabase.from("booking_templates").insert({
      name: saveName.trim(),
      description: saveDesc.trim() || null,
      shipment_type: shipment?.shipment_type || null,
      snapshot,
    });
    if (error) { alert("保存失败：" + error.message); return; }
    alert("模板已保存");
    setSaveName(""); setSaveDesc("");
    onClose();
  };

  const remove = async (t) => {
    if (!confirm(`删除模板 "${t.name}"？`)) return;
    await supabase.from("booking_templates").delete().eq("id", t.id);
    setTemplates(p => p.filter(x => x.id !== t.id));
  };

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", padding: "10px 16px", borderBottom: "1px solid #eee" }}>
          <div style={{ fontSize: 14, fontWeight: 700 }}>📋 订舱模板</div>
          <div style={{ flex: 1 }} />
          <div style={{ display: "flex", gap: 6, marginRight: 12 }}>
            <button onClick={() => setMode("apply")} style={{ ...tab, ...(mode === "apply" ? tabAct : {}) }}>从模板创建</button>
            <button onClick={() => setMode("save")} style={{ ...tab, ...(mode === "save" ? tabAct : {}) }}>存为模板</button>
          </div>
          <button onClick={onClose} style={{ padding: "4px 12px" }}>关闭</button>
        </div>

        <div style={{ padding: 16, overflow: "auto", flex: 1 }}>
          {mode === "apply" ? (
            loading ? (
              <div style={{ padding: 24, textAlign: "center", color: "#888" }}>加载中…</div>
            ) : templates.length === 0 ? (
              <div style={{ padding: 24, textAlign: "center", color: "#888" }}>
                还没有模板。先去任一作业详情页点 <b>「订舱模板 → 存为模板」</b> 创建。
              </div>
            ) : (
              <table style={tableStyle}>
                <thead><tr>
                  <th style={th}>模板名</th><th style={th}>类型</th><th style={th}>关键字段</th>
                  <th style={th}>使用次数</th><th style={{ ...th, width: 160 }}>操作</th>
                </tr></thead>
                <tbody>
                  {templates.map(t => (
                    <tr key={t.id}>
                      <td style={td}>
                        <div style={{ fontWeight: 600 }}>{t.name}</div>
                        {t.description && <div style={{ fontSize: 11, color: "#888" }}>{t.description}</div>}
                      </td>
                      <td style={td}>{t.shipment_type || "—"}</td>
                      <td style={{ ...td, fontSize: 11, color: "#666" }}>{summarize(t.snapshot)}</td>
                      <td style={{ ...td, textAlign: "right", fontFamily: "Consolas,monospace" }}>{t.use_count || 0}</td>
                      <td style={td}>
                        <button onClick={() => apply(t)} style={btnPrimary}>✓ 应用</button>
                        <button onClick={() => remove(t)} style={{ ...btn, marginLeft: 6, color: "#c00" }}>删除</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          ) : (
            <div>
              <div style={{ fontSize: 12, color: "#666", marginBottom: 8 }}>
                把当前作业的航线/承运人/付款方式/收发通等字段保存成模板，下次新建作业一键带出。
                单号 / 件数 / 日期等字段<b>不进模板</b>。
              </div>
              <div style={{ marginBottom: 10 }}>
                <label style={lbl}>模板名 *</label>
                <input value={saveName} onChange={e => setSaveName(e.target.value)}
                       placeholder='如 "Keplin 宁波→Felixstowe 周一线"'
                       style={input} />
              </div>
              <div style={{ marginBottom: 10 }}>
                <label style={lbl}>说明（可选）</label>
                <input value={saveDesc} onChange={e => setSaveDesc(e.target.value)}
                       placeholder="备注，比如适用场景"
                       style={input} />
              </div>
              <div style={{ marginBottom: 10, fontSize: 11, color: "#666" }}>
                <div style={{ marginBottom: 4 }}>将保存以下字段（仅非空字段）：</div>
                <div style={{ padding: 8, background: "#fafafa", border: "1px solid #eee", borderRadius: 4, fontFamily: "Consolas,monospace", fontSize: 11 }}>
                  {previewSnapshot(shipment)}
                </div>
              </div>
              <button onClick={save} style={btnPrimary}>💾 保存模板</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function summarize(snap) {
  if (!snap) return "";
  const parts = [];
  if (snap.carrier) parts.push(`船东:${snap.carrier}`);
  if (snap.vessel) parts.push(snap.vessel);
  if (snap.pol && snap.pod) parts.push(`${snap.pol}→${snap.pod}`);
  if (snap.overseas_agent) parts.push(`代理:${snap.overseas_agent}`);
  return parts.join(" · ") || "—";
}

function previewSnapshot(shipment) {
  if (!shipment) return "(请先选/保存作业)";
  const lines = [];
  for (const f of TEMPLATE_FIELDS) {
    const v = shipment[f];
    if (v != null && v !== "") {
      const s = typeof v === "string" ? v : JSON.stringify(v);
      lines.push(`${f}: ${s.length > 50 ? s.slice(0, 50) + "…" : s}`);
    }
  }
  return lines.length === 0 ? "(没有可保存的字段)" : lines.join("\n");
}

const overlayStyle = {
  position: "fixed", inset: 0, background: "rgba(0,0,0,.4)",
  display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
};
const modalStyle = {
  width: "min(820px, 95vw)", maxHeight: "90vh", background: "#fff", borderRadius: 6,
  boxShadow: "0 6px 30px rgba(0,0,0,.2)", display: "flex", flexDirection: "column",
};
const tab = { padding: "4px 12px", cursor: "pointer", border: "1px solid #d9d9d9", background: "#fff", borderRadius: 3, fontSize: 12 };
const tabAct = { background: "#1990ff", color: "#fff", border: "1px solid #1990ff", fontWeight: 600 };
const btn = { padding: "3px 10px", cursor: "pointer", border: "1px solid #d9d9d9", background: "#fff", borderRadius: 3, fontSize: 11 };
const btnPrimary = { ...btn, background: "#1990ff", color: "#fff", border: "1px solid #1990ff", fontWeight: 600 };
const tableStyle = { width: "100%", borderCollapse: "collapse", fontSize: 12, border: "1px solid #eee" };
const th = { padding: 6, background: "#f5f5f5", border: "1px solid #eee", textAlign: "left", fontWeight: 600 };
const td = { padding: 6, border: "1px solid #f0f0f0", verticalAlign: "top" };
const lbl = { display: "block", fontSize: 11, fontWeight: 600, color: "#444", marginBottom: 3 };
const input = { width: "100%", padding: "5px 8px", fontSize: 12, border: "1px solid #ddd", borderRadius: 3, boxSizing: "border-box" };
