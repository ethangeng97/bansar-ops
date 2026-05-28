// ============================================================================
// MergeOrdersModal — 批量合并订单为自拼柜
//
// 流程：
//   1. 用户在列表勾选 ≥2 票 → 点"合并订单"
//   2. 选模式：
//      a) 新建母拼：从第一票预填 booking 级字段，用户可改；新建 Console 母单
//      b) 并入已有母拼：搜已有 Console 母单挑一个
//   3. 把每个勾选的订单按 master.order_no-1, -2, ... 改名，对齐 booking 级字段
//
// 数据模型完全沿用现有自拼柜（SubTicketModals.jsx 同一套约定）：
//   · 母拼 order_no = X, 分票 = X-1/X-2/...
//   · shipment_type = "Console", 共用 booking_no
//   · 同步字段：船名/航次/POL/POD/destination/ETD/承运人/海外代理
//   · 不动字段：customer/shipper/consignee/HBL/MBL/费用/货物
// ============================================================================
import { useState, useEffect, useMemo } from "react";
import { supabase } from "../supabase.js";
import { Modal, Button, Input, ComboBox } from "./ui.jsx";
import { filterShipmentPayload } from "../lib/shipment-fields.js";
import { getCachedRef } from "../lib/ref-cache.js";

export default function MergeOrdersModal({ selected, onClose, onMerged }) {
  // 模式："new" = 新建母拼, "existing" = 并入已有
  const [mode, setMode] = useState("new");

  // 新建母拼 — form 状态，默认从第一票带
  // order_no 不在 form 里：交给 DB 触发器 gen_order_no_main('Console') 自动生成 (BSOEC+YYMM+5位流水)
  const first = selected[0] || {};
  const [form, setForm] = useState({
    customer: first.customer || "",
    booking_no: first.booking_no || "",
    mbl_no: first.mbl_no || "",
    vessel: first.vessel || "",
    voyage: first.voyage || "",
    pol: first.pol || "",
    pod: first.pod || "",
    destination: first.destination || "",
    etd: first.etd || "",
    carrier: first.carrier || "",
    overseas_agent: first.overseas_agent || "",
  });
  const setF = (k, v) => setForm(p => ({ ...p, [k]: v }));

  // 委托单位列表（用于 ComboBox）
  const [customers, setCustomers] = useState([]);
  useEffect(() => {
    getCachedRef("customers").then(setCustomers).catch(() => {});
  }, []);

  // 并入已有 — 搜索状态
  const [q, setQ] = useState("");
  const [candidates, setCandidates] = useState([]);
  const [searching, setSearching] = useState(false);
  const [picked, setPicked] = useState(null);

  useEffect(() => {
    if (mode !== "existing") return;
    let cancel = false;
    setSearching(true);
    (async () => {
      const term = q.trim();
      // 候选：Console 类型 + order_no 不带 -N 后缀（是母单而非分票）
      let qb = supabase.from("shipments")
        .select("id, order_no, mbl_no, booking_no, customer, etd, vessel, voyage, pol, pod, destination, carrier, overseas_agent")
        .eq("shipment_type", "Console")
        .order("created_at", { ascending: false })
        .limit(30);
      if (term) qb = qb.or(`order_no.ilike.*${term}*,mbl_no.ilike.*${term}*,booking_no.ilike.*${term}*`);
      const { data } = await qb;
      if (cancel) return;
      // 客户端去掉分票（带 -数字 后缀的）
      const masters = (data || []).filter(s => !/-\d+$/.test(s.order_no || ""));
      setCandidates(masters);
      setSearching(false);
    })();
    return () => { cancel = true; };
  }, [q, mode]);

  // 预览：每个被选订单合并后的新 order_no
  // 新建母拼模式下 base 未知（DB 触发器生成），不做 from→to 预览
  const preview = useMemo(() => {
    if (mode === "new") return [];
    const base = picked?.order_no || "";
    if (!base) return [];
    return selected.map((s, i) => ({
      id: s.id,
      from: s.order_no || "(无号)",
      to: `${base}-${i + 1}`,  // 简化版：1..N。下面 submit 时再做实际避让
    }));
  }, [mode, picked, selected]);

  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (selected.length < 2) { alert("至少选两个订单"); return; }

    let master;
    let isNew = false;

    if (mode === "new") {
      if (!window.confirm(
        `确认合并 ${selected.length} 个订单为自拼柜？\n\n` +
        `· 新建一张母拼（作业号系统自动生成，格式 BSOEC+YYMM+5位流水）\n` +
        `· 每个订单 order_no 变为 母拼号-1, -2, ...\n` +
        `· shipment_type → Console\n` +
        `· booking_no/船名/航次/POL/POD/ETD/承运人/海外代理 跟母拼对齐\n\n` +
        `customer/shipper/consignee/HBL/费用/货物 全部保留不变。`
      )) return;

      setSubmitting(true);
      // 不传 order_no，触发器 trg_shipments_auto_order_no 会自动生成
      const newRow = {
        shipment_type: "Console",
        customer: form.customer.trim() || null,
        booking_no: form.booking_no.trim() || null,
        mbl_no: form.mbl_no.trim() || null,
        vessel: form.vessel.trim() || null,
        voyage: form.voyage.trim() || null,
        pol: form.pol.trim() || null,
        pod: form.pod.trim() || null,
        destination: form.destination.trim() || null,
        etd: form.etd || null,
        carrier: form.carrier.trim() || null,
        overseas_agent: form.overseas_agent.trim() || null,
        lifecycle: "处理中",
      };
      const { data: created, error } = await supabase.from("shipments")
        .insert(filterShipmentPayload(newRow)).select().single();
      if (error) { setSubmitting(false); alert("新建母拼失败：" + error.message); return; }
      if (!created?.order_no) { setSubmitting(false); alert("母拼已建但读取作业号失败"); return; }
      master = created;
      isNew = true;
    } else {
      if (!picked) { alert("请先选一个已有母拼"); return; }
      if (selected.some(s => s.id === picked.id)) {
        alert("被合并的订单里包含了所选母拼，不能合并到自己");
        return;
      }
      if (!window.confirm(
        `确认把 ${selected.length} 个订单并入已有母拼 ${picked.order_no} ？\n\n` +
        `· 每个订单 order_no 变为 ${picked.order_no}-N\n` +
        `· shipment_type → Console，booking_no/船名/航次/POL/POD/ETD 跟母拼对齐\n\n` +
        `customer/shipper/consignee/HBL/费用/货物 全部保留不变。`
      )) return;
      setSubmitting(true);
      master = picked;
    }

    // 找母拼已有分票的尾数（避免冲突）
    const { data: siblings } = await supabase.from("shipments")
      .select("order_no").like("order_no", master.order_no + "-%");
    const used = new Set((siblings || []).map(s => {
      const m = (s.order_no || "").match(/-(\d+)$/);
      return m ? parseInt(m[1]) : null;
    }).filter(Boolean));

    // 给每个被选订单分配下一个空位尾数
    const failed = [];
    let nextTail = 1;
    for (const s of selected) {
      while (used.has(nextTail)) nextTail++;
      used.add(nextTail);
      const newOrderNo = `${master.order_no}-${nextTail}`;
      const payload = filterShipmentPayload({
        order_no: newOrderNo,
        shipment_type: "Console",
        booking_no: master.booking_no || null,
        vessel: master.vessel || null,
        voyage: master.voyage || null,
        pol: master.pol || null,
        pol_code: master.pol_code || null,
        pod: master.pod || null,
        pod_code: master.pod_code || null,
        destination: master.destination || null,
        destination_code: master.destination_code || null,
        etd: master.etd || null,
        carrier: master.carrier || null,
        overseas_agent: master.overseas_agent || null,
      });
      const { error } = await supabase.from("shipments").update(payload).eq("id", s.id);
      if (error) failed.push({ order_no: s.order_no, msg: error.message });
      nextTail++;
    }

    setSubmitting(false);

    if (failed.length) {
      alert(
        `部分合并失败（${failed.length}/${selected.length}）：\n\n` +
        failed.map(f => `· ${f.order_no}: ${f.msg}`).join("\n") +
        `\n\n成功的已并入。`
      );
    } else {
      alert(`✓ ${selected.length} 个订单已${isNew ? "合并到新母拼" : "并入"} ${master.order_no}`);
    }

    onMerged && onMerged(master);
    onClose();
  };

  return (
    <Modal title={`合并订单 — 已选 ${selected.length} 个`} onClose={onClose} width={820}>
      {/* 已选列表 */}
      <div style={{ marginBottom: 12, padding: 10, background: "#fafafa", borderRadius: 4, maxHeight: 120, overflowY: "auto" }}>
        <div style={{ fontSize: 11, color: "#666", marginBottom: 6 }}>合并对象（按下面顺序分配尾数 -1, -2, ...）：</div>
        {selected.map((s, i) => (
          <div key={s.id} style={{ fontSize: 12, padding: "2px 0" }}>
            <span style={{ display: "inline-block", width: 22, color: "#888" }}>{i + 1}.</span>
            <b>{s.order_no || "(无号)"}</b>
            <span style={{ color: "#888", marginLeft: 8 }}>
              {s.customer || "—"} · {s.mbl_no || s.booking_no || "—"} · {s.pol || "—"} → {s.pod || "—"}
            </span>
          </div>
        ))}
      </div>

      {/* 模式切换 */}
      <div style={{ display: "flex", gap: 0, marginBottom: 12, borderBottom: "1px solid #e0e0e0" }}>
        <ModeTab active={mode === "new"} onClick={() => setMode("new")}>新建母拼</ModeTab>
        <ModeTab active={mode === "existing"} onClick={() => setMode("existing")}>并入已有母拼</ModeTab>
      </div>

      {mode === "new" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <div style={{ gridColumn: "1 / -1", fontSize: 12, padding: "8px 10px", background: "#e6f7ff", border: "1px solid #91d5ff", borderRadius: 4, color: "#0050b3" }}>
            母拼作业号由系统自动生成（格式 <code>BSOEC + YYMM + 5位流水</code>），无需填写。
          </div>
          <FormField label="委托单位">
            <ComboBox value={form.customer} onChange={v => setF("customer", v)} options={customers} placeholder="选填，可空" />
          </FormField>
          <FormField label="Booking No.">
            <Input value={form.booking_no} onChange={e => setF("booking_no", e.target.value)} />
          </FormField>
          <FormField label="MBL No.">
            <Input value={form.mbl_no} onChange={e => setF("mbl_no", e.target.value)} />
          </FormField>
          <FormField label="船公司">
            <Input value={form.carrier} onChange={e => setF("carrier", e.target.value)} />
          </FormField>
          <FormField label="船名">
            <Input value={form.vessel} onChange={e => setF("vessel", e.target.value)} />
          </FormField>
          <FormField label="航次">
            <Input value={form.voyage} onChange={e => setF("voyage", e.target.value)} />
          </FormField>
          <FormField label="POL">
            <Input value={form.pol} onChange={e => setF("pol", e.target.value)} />
          </FormField>
          <FormField label="POD">
            <Input value={form.pod} onChange={e => setF("pod", e.target.value)} />
          </FormField>
          <FormField label="目的地">
            <Input value={form.destination} onChange={e => setF("destination", e.target.value)} />
          </FormField>
          <FormField label="ETD">
            <input type="date" value={form.etd} onChange={e => setF("etd", e.target.value)}
              style={{ width: "100%", padding: "5px 8px", border: "1px solid #d9d9d9", borderRadius: 3, fontSize: 12 }} />
          </FormField>
          <FormField label="海外代理">
            <Input value={form.overseas_agent} onChange={e => setF("overseas_agent", e.target.value)} />
          </FormField>
          <div style={{ gridColumn: "1 / -1", fontSize: 11, color: "#888", marginTop: 4 }}>
            上面字段已从第一票预填，按需修改。母拼建好后这些会同步到每个分票。
          </div>
        </div>
      )}

      {mode === "existing" && (
        <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 12 }}>
          <div>
            <Input placeholder="搜索作业号 / MBL / Booking" value={q} onChange={e => setQ(e.target.value)} />
            <div style={{ marginTop: 8, maxHeight: 280, overflowY: "auto", border: "1px solid #eee", borderRadius: 4 }}>
              {searching && <div style={{ padding: 10, fontSize: 12, color: "#888" }}>搜索中…</div>}
              {!searching && candidates.length === 0 && <div style={{ padding: 10, fontSize: 12, color: "#999" }}>无母拼候选</div>}
              {candidates.map(c => {
                const active = picked?.id === c.id;
                return (
                  <div key={c.id} onClick={() => setPicked(c)}
                    style={{ padding: "6px 10px", cursor: "pointer", fontSize: 12,
                             borderBottom: "1px solid #f5f5f5", background: active ? "#e6f7ff" : "#fff" }}>
                    <div style={{ fontWeight: 600 }}>{c.order_no}</div>
                    <div style={{ color: "#888", fontSize: 11 }}>
                      {c.mbl_no || c.booking_no || "—"} · {c.vessel || "—"} · {c.etd || "—"}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <div>
            {!picked && <div style={{ padding: 20, color: "#999", fontSize: 12, textAlign: "center" }}>← 先选一个母拼</div>}
            {picked && (
              <div style={{ fontSize: 12, padding: 10, background: "#fafafa", borderRadius: 4 }}>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>选中母拼：{picked.order_no}</div>
                <div style={{ color: "#666" }}>
                  Booking: {picked.booking_no || "—"}<br/>
                  MBL: {picked.mbl_no || "—"}<br/>
                  船名/航次: {picked.vessel || "—"} / {picked.voyage || "—"}<br/>
                  POL → POD: {picked.pol || "—"} → {picked.pod || "—"}<br/>
                  ETD: {picked.etd || "—"}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* 预览（合并后 order_no） */}
      {preview.some(p => p.to) && (
        <div style={{ marginTop: 14, padding: 10, background: "#fffbe6", border: "1px solid #ffe58f", borderRadius: 4 }}>
          <div style={{ fontSize: 11, color: "#666", marginBottom: 4 }}>预览（实际尾数会避开已被占用的）：</div>
          {preview.map(p => (
            <div key={p.id} style={{ fontSize: 12, fontFamily: "monospace" }}>
              {p.from} → {p.to}
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
        <Button variant="secondary" onClick={onClose} disabled={submitting}>取消</Button>
        <Button onClick={submit} disabled={submitting || (mode === "existing" && !picked)}>
          {submitting ? "合并中…" : "确认合并"}
        </Button>
      </div>
    </Modal>
  );
}

// ── 辅助 ─────────────────────────────────────────────────────────
function ModeTab({ active, onClick, children }) {
  return (
    <button onClick={onClick}
      style={{
        padding: "8px 16px", fontSize: 13, fontWeight: active ? 700 : 400,
        border: "none", background: "transparent", cursor: "pointer",
        color: active ? "#1990ff" : "#666",
        borderBottom: active ? "2px solid #1990ff" : "2px solid transparent",
        marginBottom: -1,
      }}>{children}</button>
  );
}

function FormField({ label, children }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: "#666", marginBottom: 3 }}>{label}</div>
      {children}
    </div>
  );
}

