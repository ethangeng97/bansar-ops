// ============================================================================
// AttachmentsPanel — 作业附件管理
// 文件上传到 Supabase Storage bucket "shipment-attachments"
// 元信息存表 shipment_attachments
// 点击文件名打开 signed URL（带备注）
// ============================================================================
import { useState, useEffect, useRef } from "react";
import { supabase } from "../supabase.js";

const BUCKET = "shipment-attachments";

export default function AttachmentsPanel({ shipmentId, user }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef(null);

  const load = async () => {
    if (!shipmentId) return;
    setLoading(true);
    const { data } = await supabase.from("shipment_attachments")
      .select("*").eq("shipment_id", shipmentId)
      .order("uploaded_at", { ascending: false });
    setItems(data || []);
    setLoading(false);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [shipmentId]);

  const uploadFile = async (file) => {
    if (!file || !shipmentId) return;
    setUploading(true);
    try {
      // 文件路径: <shipment_id>/<uuid>-<original_name>（保留原文件名 + uuid 避免重名）
      const uuid = crypto.randomUUID();
      const safeName = file.name.replace(/[^\w.\-一-龥()（）]/g, "_");
      const path = `${shipmentId}/${uuid}-${safeName}`;
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file);
      if (upErr) { alert("上传失败：" + upErr.message); return; }
      // 写入元信息
      const { error: dbErr } = await supabase.from("shipment_attachments").insert({
        shipment_id: shipmentId,
        filename: file.name,
        storage_path: path,
        mime_type: file.type || null,
        file_size: file.size,
        uploaded_by: user?.id || null,
      });
      if (dbErr) {
        // DB 插入失败，回滚 storage
        await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
        alert("保存附件元信息失败：" + dbErr.message);
        return;
      }
      await load();
    } finally {
      setUploading(false);
    }
  };

  const handleFiles = async (files) => {
    if (!files || files.length === 0) return;
    for (const f of files) await uploadFile(f);
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    handleFiles(e.dataTransfer?.files);
  };

  const openFile = async (att) => {
    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(att.storage_path, 3600);
    if (error) { alert("打开失败：" + error.message); return; }
    window.open(data.signedUrl, "_blank");
  };

  const updateNote = async (att, note) => {
    await supabase.from("shipment_attachments").update({ note }).eq("id", att.id);
    setItems(p => p.map(x => x.id === att.id ? { ...x, note } : x));
  };

  const remove = async (att) => {
    if (!confirm(`删除附件 "${att.filename}"？此操作不可恢复。`)) return;
    await supabase.storage.from(BUCKET).remove([att.storage_path]).catch(() => {});
    await supabase.from("shipment_attachments").delete().eq("id", att.id);
    await load();
  };

  const fmtSize = (n) => {
    if (!n) return "—";
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
    return (n / 1024 / 1024).toFixed(1) + " MB";
  };
  const fmtDate = (s) => s ? new Date(s).toLocaleString("zh-CN", { hour12: false }).replace(/\//g, "-") : "—";

  if (!shipmentId) {
    return <div style={{ padding: 20, color: "#888", textAlign: "center" }}>请先保存订单再上传附件</div>;
  }

  return (
    <div style={{ padding: 16 }}>
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        style={{
          border: `2px dashed ${dragOver ? "#1990ff" : "#bbb"}`,
          background: dragOver ? "#e6f4ff" : "#fafafa",
          borderRadius: 6, padding: "30px 20px", textAlign: "center",
          cursor: "pointer", color: "#555", fontSize: 13, marginBottom: 16,
        }}
      >
        {uploading ? "上传中…" : "📎 拖入文件或点击选择（支持多文件）"}
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        style={{ display: "none" }}
        onChange={e => { handleFiles(e.target.files); e.target.value = ""; }}
      />

      {loading ? (
        <div style={{ padding: 20, textAlign: "center", color: "#888" }}>加载中…</div>
      ) : items.length === 0 ? (
        <div style={{ padding: 20, textAlign: "center", color: "#888" }}>暂无附件</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: "#f5f5f5" }}>
              <th style={th}>文件名</th>
              <th style={th}>大小</th>
              <th style={th}>备注</th>
              <th style={th}>上传时间</th>
              <th style={{ ...th, width: 80 }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map(att => (
              <tr key={att.id}>
                <td style={td}>
                  <a onClick={(e) => { e.preventDefault(); openFile(att); }} href="#"
                     style={{ color: "#1990ff", textDecoration: "none" }}>
                    📄 {att.filename}
                  </a>
                </td>
                <td style={{ ...td, fontFamily: "Consolas,monospace", color: "#666" }}>{fmtSize(att.file_size)}</td>
                <td style={td}>
                  <input
                    value={att.note || ""}
                    onChange={e => setItems(p => p.map(x => x.id === att.id ? { ...x, note: e.target.value } : x))}
                    onBlur={e => updateNote(att, e.target.value)}
                    placeholder="如：订舱委托书 / 提单 / 报关单"
                    style={{ width: "100%", padding: "3px 6px", fontSize: 12, border: "1px solid #ddd", borderRadius: 3, boxSizing: "border-box" }}
                  />
                </td>
                <td style={{ ...td, color: "#888" }}>{fmtDate(att.uploaded_at)}</td>
                <td style={td}>
                  <button onClick={() => remove(att)} style={{ padding: "3px 8px", border: "1px solid #ddd", background: "#fff", borderRadius: 3, cursor: "pointer", color: "#c00", fontSize: 11 }}>删除</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const th = { padding: 8, border: "1px solid #ddd", textAlign: "left", fontWeight: 600, color: "#444" };
const td = { padding: 6, border: "1px solid #eee", verticalAlign: "middle" };
