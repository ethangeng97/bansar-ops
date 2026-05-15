// ============================================================================
// SubTicketModals — 自拼母单上"加入分票" / "移除分票" 两个 modal
// 模型说明：
//   · 母拼 order_no = X，分票 order_no = X-1 / X-2 / ...
//   · 分票与母拼共用 booking_no
//   · 加入：把一个独立票（无 booking_no 或不属当前 booking）的字段改写
//          成跟当前母拼一致，order_no 设为 X-N
//   · 移除：把分票的 booking_no 清空、order_no 改成独立号
//          （shipment_type 改回 FCL）
// ============================================================================
import { useState, useEffect, useMemo } from "react";
import { supabase } from "../supabase.js";
import { Modal, Button, Input } from "./ui.jsx";

// ── 加入分票 ─────────────────────────────────────────────────────────
export function JoinSubTicketModal({ master, existingSubTickets, onClose, onJoined }) {
  const [q, setQ] = useState("");
  const [candidates, setCandidates] = useState([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState(null);
  const [tail, setTail] = useState("");

  // 推荐下一个空位尾数
  const suggestedTail = useMemo(() => {
    const used = new Set(existingSubTickets.map(s => {
      const m = (s.order_no || "").match(/-(\d+)$/);
      return m ? parseInt(m[1]) : null;
    }).filter(Boolean));
    let n = 1;
    while (used.has(n)) n++;
    return String(n);
  }, [existingSubTickets]);

  useEffect(() => { if (!tail) setTail(suggestedTail); }, [suggestedTail]);

  // 搜独立票：booking_no IS NULL，或 booking_no != master.booking_no
  // 排除母拼本身和已是分票的（order_no 含 -N 后缀且 booking_no = master.booking_no 已被服务端过滤）
  useEffect(() => {
    let cancel = false;
    setSearching(true);
    (async () => {
      const term = q.trim();
      let qb = supabase.from("shipments")
        .select("id, order_no, mbl_no, customer, booking_no, etd, vessel, voyage, pol, pod, shipment_type, qty_container")
        .neq("id", master.id)
        .neq("booking_no", master.booking_no || "__none__")
        .order("created_at", { ascending: false })
        .limit(30);
      if (term) qb = qb.or(`order_no.ilike.%${term}%,mbl_no.ilike.%${term}%,customer.ilike.%${term}%`);
      const { data } = await qb;
      if (!cancel) {
        setCandidates(data || []);
        setSearching(false);
      }
    })();
    return () => { cancel = true; };
  }, [q, master.id, master.booking_no]);

  const submit = async () => {
    if (!picked) return;
    if (!/^\d+$/.test(tail)) { alert("尾数必须是数字"); return; }
    const newOrderNo = master.order_no + "-" + tail;
    // 检查尾数没被占用
    const conflict = existingSubTickets.some(s => s.order_no === newOrderNo);
    if (conflict) { alert(`${newOrderNo} 已存在，请换一个尾数`); return; }
    // 检查母拼本身
    if (master.order_no === newOrderNo) { alert("尾数不能让分票号 = 母拼号"); return; }

    if (!confirm(
      `把作业 ${picked.order_no || "（无号）"} 加入到母拼 ${master.order_no}\n\n` +
      `· order_no → ${newOrderNo}\n` +
      `· booking_no → ${master.booking_no || "（母拼无 booking_no，会写空）"}\n` +
      `· shipment_type → Console\n` +
      `· 船名/航次/POL/POD/ETD/承运人 → 跟母拼对齐\n\n` +
      `确认操作？`
    )) return;

    const payload = {
      order_no: newOrderNo,
      booking_no: master.booking_no || null,
      shipment_type: "Console",
      vessel: master.vessel,
      voyage: master.voyage,
      pol: master.pol, pol_code: master.pol_code,
      pod: master.pod, pod_code: master.pod_code,
      destination: master.destination, destination_code: master.destination_code,
      etd: master.etd,
      carrier: master.carrier,
      overseas_agent: master.overseas_agent,
    };
    const { error } = await supabase.from("shipments").update(payload).eq("id", picked.id);
    if (error) { alert("加入失败：" + error.message); return; }
    alert(`✓ ${picked.order_no || "原作业"} 已加入为分票 ${newOrderNo}`);
    onJoined && onJoined();
    onClose();
  };

  return (
    <Modal title="加入分票 — 把独立作业并入当前母拼" onClose={onClose} width={760}>
      <div style={{ fontSize: 12, color: "#666", marginBottom: 10 }}>
        当前母拼 <b>{master.order_no}</b>（booking_no: {master.booking_no || "—"}）<br/>
        从下面挑一个独立作业，它的关键字段会被改写跟母拼一致。
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 14 }}>
        <div>
          <Input placeholder="搜索作业号 / MBL / 客户" value={q} onChange={e => setQ(e.target.value)} />
          <div style={{ marginTop: 8, maxHeight: 320, overflowY: "auto", border: "1px solid #eee", borderRadius: 4 }}>
            {searching && <div style={{ padding: 10, fontSize: 12, color: "#888" }}>搜索中…</div>}
            {!searching && candidates.length === 0 && <div style={{ padding: 10, fontSize: 12, color: "#999" }}>无候选作业</div>}
            {candidates.map(s => {
              const active = picked?.id === s.id;
              return (
                <div key={s.id} onClick={() => setPicked(s)}
                  style={{ padding: "6px 10px", cursor: "pointer", fontSize: 12,
                           borderBottom: "1px solid #f5f5f5", background: active ? "#e6f7ff" : "#fff" }}
                  onMouseEnter={e => !active && (e.currentTarget.style.background = "#fafafa")}
                  onMouseLeave={e => !active && (e.currentTarget.style.background = "#fff")}
                >
                  <div style={{ fontWeight: 600 }}>{s.order_no || "（无号）"}</div>
                  <div style={{ color: "#888", fontSize: 11 }}>
                    {s.customer || "—"} · {s.mbl_no || "无 MBL"} · {s.etd || "—"}
                    {s.booking_no && <span style={{ color: "#fa8c16" }}> · 已挂 {s.booking_no}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div>
          {!picked && <div style={{ padding: 20, color: "#999", fontSize: 12, textAlign: "center" }}>← 先在左侧选一个作业</div>}
          {picked && (
            <>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                选中：{picked.order_no || "（无号）"}
              </div>
              <div style={{ fontSize: 11, color: "#666", marginBottom: 8, padding: 8, background: "#fafafa", borderRadius: 3 }}>
                委托单位：{picked.customer || "—"}<br/>
                MBL：{picked.mbl_no || "—"}<br/>
                船名/航次：{picked.vessel || "—"} / {picked.voyage || "—"}<br/>
                {picked.booking_no && (
                  <span style={{ color: "#cf1322" }}>
                    ⚠️ 此票已挂在 booking_no={picked.booking_no}，加入后会被覆盖
                  </span>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                <span style={{ fontSize: 12 }}>分票号：</span>
                <span style={{ fontSize: 12, fontFamily: "monospace" }}>{master.order_no}-</span>
                <input value={tail} onChange={e => setTail(e.target.value.replace(/\D/g, ""))}
                  style={{ width: 50, padding: "4px 6px", border: "1px solid #d9d9d9", borderRadius: 3, fontSize: 12 }} />
              </div>
              <div style={{ fontSize: 11, color: "#999" }}>推荐尾数 {suggestedTail}</div>
            </>
          )}
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
        <Button variant="secondary" onClick={onClose}>取消</Button>
        <Button onClick={submit} disabled={!picked || !tail}>加入</Button>
      </div>
    </Modal>
  );
}

// ── 移除分票 ─────────────────────────────────────────────────────────
export function RemoveSubTicketModal({ master, existingSubTickets, onClose, onRemoved }) {
  const [subId, setSubId] = useState("");
  const [newOrderNo, setNewOrderNo] = useState("");
  const [shipmentType, setShipmentType] = useState("FCL");

  const sub = existingSubTickets.find(s => s.id === subId);

  // 默认新作业号：去掉 -N 后缀；若母拼号本身已存在（必然存在）则加 -RM 后缀
  useEffect(() => {
    if (!sub) { setNewOrderNo(""); return; }
    const stripped = (sub.order_no || "").replace(/-\d+$/, "");
    const fallback = stripped + "-RM-" + Date.now().toString(36).slice(-4);
    // 默认推荐：移除后用一个不冲突的号；用户可改
    setNewOrderNo(fallback);
  }, [sub?.id]);

  const submit = async () => {
    if (!sub) return;
    if (!newOrderNo.trim()) { alert("请填新作业号"); return; }
    if (newOrderNo === master.order_no) { alert("不能跟母拼号一样"); return; }
    // 检查冲突
    const { data: clash } = await supabase.from("shipments")
      .select("id").eq("order_no", newOrderNo.trim()).neq("id", sub.id).limit(1);
    if (clash && clash.length) { alert(`新作业号 ${newOrderNo} 已被占用`); return; }

    if (!confirm(
      `把分票 ${sub.order_no} 从母拼 ${master.order_no} 移除\n\n` +
      `· order_no: ${sub.order_no} → ${newOrderNo}\n` +
      `· booking_no: ${master.booking_no || "—"} → null\n` +
      `· shipment_type: Console → ${shipmentType}\n\n` +
      `船名/航次/POL/POD/ETD 等保留不动。\n确认移除？`
    )) return;

    const { error } = await supabase.from("shipments").update({
      order_no: newOrderNo.trim(),
      booking_no: null,
      shipment_type: shipmentType,
    }).eq("id", sub.id);
    if (error) { alert("移除失败：" + error.message); return; }
    alert(`✓ ${sub.order_no} 已移除，现独立为 ${newOrderNo}`);
    onRemoved && onRemoved();
    onClose();
  };

  return (
    <Modal title="移除分票 — 把分票从当前母拼解绑成独立作业" onClose={onClose} width={560}>
      <div style={{ fontSize: 12, color: "#666", marginBottom: 10 }}>
        当前母拼 <b>{master.order_no}</b>，下挂 {existingSubTickets.length} 个分票
      </div>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>选要移除的分票</div>
        <select value={subId} onChange={e => setSubId(e.target.value)}
          style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #e2e8f0", fontSize: 12.5 }}>
          <option value="">— 选择 —</option>
          {existingSubTickets.map(s => (
            <option key={s.id} value={s.id}>
              {s.order_no} · {s.customer || "—"} · {s.mbl_no || ""}
            </option>
          ))}
        </select>
      </div>
      {sub && (
        <>
          <div style={{ marginBottom: 12 }}>
            <Input label="移除后的新作业号" value={newOrderNo} onChange={e => setNewOrderNo(e.target.value)} />
            <div style={{ fontSize: 11, color: "#999", marginTop: 4 }}>
              默认生成一个临时号，建议改成正式独立作业号
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>移除后类型</div>
            <select value={shipmentType} onChange={e => setShipmentType(e.target.value)}
              style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid #e2e8f0", fontSize: 12.5 }}>
              <option value="FCL">FCL 整柜</option>
              <option value="LCL">LCL 拼箱</option>
            </select>
          </div>
        </>
      )}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
        <Button variant="secondary" onClick={onClose}>取消</Button>
        <Button onClick={submit} disabled={!sub}>移除</Button>
      </div>
    </Modal>
  );
}
