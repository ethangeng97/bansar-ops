// ============================================================================
// ContainerEditor.jsx — 集装箱多行批量编辑器
// 替代旧的 qty_container 字符串字段，写入 shipment_containers 关联表
//
// Props:
//   shipmentId        - shipment.id（必填，新建时父组件先存主单拿到 id）
//   readOnly          - 是否只读
//   onChange          - 数据变化时回调（父组件可用于汇总显示）
// ============================================================================

import { useEffect, useState } from "react";
import { supabase } from "../supabase.js";
import { liveUpper } from "../lib/validators.js";

const SIZE_OPTIONS = ["20", "40", "45", "53"];
const TYPE_OPTIONS = ["GP", "HQ", "RF", "OT", "FR", "TK", "HC", "BU"];

// 按箱合计的货重/体积只读显示：四舍五入到 dp 位再去掉尾部 0，空/0 显示 "—"
const fmtAgg = (v, dp) => {
  if (v == null || !(v > 0)) return "—";
  return String(Number(v.toFixed(dp)));
};

const TYPE_LABELS = {
  GP: "GP - 普通箱",
  HQ: "HQ - 高箱",
  RF: "RF - 冷藏箱",
  OT: "OT - 开顶箱",
  FR: "FR - 框架箱",
  TK: "TK - 罐式箱",
  HC: "HC - 高箱(同 HQ)",
  BU: "BU - 散货箱",
};

export default function ContainerEditor({ shipmentId, readOnly, onChange, cargoAggByContainerNo = {} }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [savingRows, setSavingRows] = useState(new Set()); // id 集合

  const reload = async () => {
    if (!shipmentId) { setRows([]); setLoading(false); return; }
    setLoading(true);
    const { data, error } = await supabase.from("shipment_containers")
      .select("*")
      .eq("shipment_id", shipmentId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (!error) setRows(data || []);
    setLoading(false);
  };

  useEffect(() => { reload(); /* eslint-disable-next-line */ }, [shipmentId]);

  useEffect(() => { onChange?.(rows); /* eslint-disable-next-line */ }, [rows]);

  // 把 rows 聚合成 V4 旧字段 qty_container 字符串（如 "1x40HQ" 或 "2x20GP,1x40HQ"）
  // 同时更新 shipments.qty_container，让托单信息 tab / 列表页等老代码正常显示
  const syncQtyContainer = async (currentRows) => {
    if (!shipmentId) return;
    // 按 size+type 分组累计 qty
    const map = {};
    for (const r of currentRows) {
      const key = `${r.container_size}${r.container_type}`;
      map[key] = (map[key] || 0) + (parseInt(r.qty) || 0);
    }
    // 拼字符串：按 size 升序
    const parts = Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, q]) => `${q}x${k}`);
    const text = parts.join(",");
    await supabase.from("shipments").update({ qty_container: text || null }).eq("id", shipmentId);
  };

  const addRow = async () => {
    if (!shipmentId) { alert("请先保存主单获得 ID 后再加集装箱"); return; }
    const newRow = {
      shipment_id: shipmentId,
      container_size: "40",
      container_type: "HQ",
      qty: 1,
      sort_order: rows.length,
    };
    const { data, error } = await supabase.from("shipment_containers")
      .insert([newRow]).select().single();
    if (error) { alert("添加失败: " + error.message); return; }
    const newRows = [...rows, data];
    setRows(newRows);
    syncQtyContainer(newRows);
  };

  const updateRow = async (id, patch) => {
    setSavingRows(prev => new Set(prev).add(id));
    const newRows = rows.map(r => r.id === id ? { ...r, ...patch } : r);
    setRows(newRows);
    const { error } = await supabase.from("shipment_containers")
      .update(patch).eq("id", id);
    setSavingRows(prev => {
      const next = new Set(prev); next.delete(id); return next;
    });
    if (error) {
      alert("保存失败: " + error.message);
      reload();
      return;
    }
    // qty / size / type 改了才需要同步，notes / sort_order 不影响汇总
    if ("qty" in patch || "container_size" in patch || "container_type" in patch) {
      syncQtyContainer(newRows);
    }
  };

  const deleteRow = async (id) => {
    if (!confirm("确认删除这一行集装箱？")) return;
    const { error } = await supabase.from("shipment_containers")
      .delete().eq("id", id);
    if (error) { alert("删除失败: " + error.message); return; }
    const newRows = rows.filter(r => r.id !== id);
    setRows(newRows);
    syncQtyContainer(newRows);
  };

  // 汇总（每个 size×type 多少个）
  const summary = rows.reduce((acc, r) => {
    const key = `${r.qty}x${r.container_size}${r.container_type}`;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const summaryText = rows.length > 0
    ? rows.map(r => `${r.qty}x${r.container_size}'${r.container_type}`).join(", ")
    : "暂无集装箱";

  if (loading) {
    return <div style={{ padding: 20, textAlign: "center", color: "#888", fontSize: 12 }}>加载中...</div>;
  }

  return (
    <div>
      {/* 汇总条 */}
      <div style={{
        padding: "8px 12px", background: "#fafafa",
        border: "1px solid #f0f0f0", borderRadius: 3,
        marginBottom: 8, fontSize: 12,
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <span>
          <span style={{ color: "#888" }}>箱型箱量汇总：</span>
          <b style={{ color: "#1f3864", fontFamily: "Consolas,monospace" }}>{summaryText}</b>
          <span style={{ color: "#888", marginLeft: 12 }}>
            （共 {rows.reduce((s, r) => s + Number(r.qty || 0), 0)} 个箱）
          </span>
        </span>
        {!readOnly && (
          <button onClick={addRow} style={btnPrimary}>+ 加箱</button>
        )}
      </div>

      {/* 表格 */}
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ background: "#fafafa", color: "#444" }}>
            <th style={th}>箱型</th>
            <th style={th}>类型</th>
            <th style={{ ...th, textAlign: "right" }}>箱量</th>
            <th style={th}>箱号</th>
            <th style={th}>铅封号</th>
            <th style={{ ...th, textAlign: "right" }}>件数</th>
            <th style={{ ...th, textAlign: "right" }}>货重(KG)</th>
            <th style={{ ...th, textAlign: "right" }}>体积(CBM)</th>
            <th style={th}>备注</th>
            {!readOnly && <th style={{ ...th, textAlign: "center", width: 60 }}>操作</th>}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={readOnly ? 9 : 10}
                  style={{ padding: 30, textAlign: "center", color: "#999" }}>
                暂无集装箱{!readOnly && "，点击右上角"}<b>{!readOnly && " + 加箱 "}</b>{!readOnly && "添加"}
              </td>
            </tr>
          )}
          {rows.map(r => {
            const saving = savingRows.has(r.id);
            return (
              <tr key={r.id} style={{ borderTop: "1px solid #f5f5f5",
                                       background: saving ? "#fffbe6" : "#fff" }}>
                <td style={td}>
                  {readOnly ? r.container_size :
                    <select value={r.container_size}
                            onChange={e => updateRow(r.id, { container_size: e.target.value })}
                            style={selStyle}>
                      {SIZE_OPTIONS.map(s => <option key={s} value={s}>{s}'</option>)}
                    </select>}
                </td>
                <td style={td}>
                  {readOnly ? r.container_type :
                    <select value={r.container_type}
                            onChange={e => updateRow(r.id, { container_type: e.target.value })}
                            style={selStyle} title={TYPE_LABELS[r.container_type]}>
                      {TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>}
                </td>
                <td style={{ ...td, textAlign: "right" }}>
                  {readOnly ? r.qty :
                    <input type="number" min="1" value={r.qty}
                           onChange={e => updateRow(r.id, { qty: Number(e.target.value) || 1 })}
                           style={{ ...inpStyle, textAlign: "right", width: 50 }} />}
                </td>
                <td style={td}>
                  {readOnly ? (r.container_no || "—") :
                    <input value={r.container_no || ""}
                           onChange={e => setRows(prev => prev.map(x => x.id === r.id ? { ...x, container_no: liveUpper(e.target.value) } : x))}
                           onBlur={e => updateRow(r.id, { container_no: liveUpper(e.target.value) || null })}
                           placeholder="如 ABCD1234567"
                           style={{ ...inpStyle, fontFamily: "Consolas,monospace", width: "100%" }} />}
                </td>
                <td style={td}>
                  {readOnly ? (r.seal_no || "—") :
                    <input value={r.seal_no || ""}
                           onChange={e => setRows(prev => prev.map(x => x.id === r.id ? { ...x, seal_no: liveUpper(e.target.value) } : x))}
                           onBlur={e => updateRow(r.id, { seal_no: liveUpper(e.target.value) || null })}
                           style={{ ...inpStyle, fontFamily: "Consolas,monospace", width: "100%" }} />}
                </td>
                <td style={{ ...td, textAlign: "right", color: "#666", fontFamily: "Consolas,monospace" }}
                    title="按箱合计自动算（cargo_items.qty）">
                  {cargoAggByContainerNo[r.container_no]?.qty || "—"}
                </td>
                <td style={{ ...td, textAlign: "right", color: "#666", fontFamily: "Consolas,monospace" }}
                    title="按箱合计自动算（cargo_items.gross_weight），请在「货物明细」里修改">
                  {fmtAgg(cargoAggByContainerNo[r.container_no]?.weight, 3)}
                </td>
                <td style={{ ...td, textAlign: "right", color: "#666", fontFamily: "Consolas,monospace" }}
                    title="按箱合计自动算（cargo_items.volume），请在「货物明细」里修改">
                  {fmtAgg(cargoAggByContainerNo[r.container_no]?.volume, 4)}
                </td>
                <td style={td}>
                  {readOnly ? (r.remark || "—") :
                    <input value={r.remark || ""}
                           onChange={e => setRows(prev => prev.map(x => x.id === r.id ? { ...x, remark: e.target.value } : x))}
                           onBlur={e => updateRow(r.id, { remark: e.target.value || null })}
                           style={{ ...inpStyle, width: "100%" }} />}
                </td>
                {!readOnly && (
                  <td style={{ ...td, textAlign: "center" }}>
                    <a onClick={() => deleteRow(r.id)}
                       style={{ color: "#ff4d4f", cursor: "pointer", fontSize: 11 }}>删除</a>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const th = { padding: "7px 6px", textAlign: "left", borderBottom: "1px solid #e8e8e8", fontWeight: 600, fontSize: 11.5 };
const td = { padding: 6 };
const inpStyle = { padding: "3px 6px", border: "1px solid #d9d9d9", borderRadius: 3, fontSize: 11.5, boxSizing: "border-box" };
const selStyle = { padding: "3px 6px", border: "1px solid #d9d9d9", borderRadius: 3, fontSize: 11.5 };
const btnPrimary = { padding: "4px 12px", background: "#1990ff", color: "#fff", border: "1px solid #1990ff",
                     borderRadius: 3, fontSize: 12, cursor: "pointer", fontWeight: 600 };
