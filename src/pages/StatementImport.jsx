// ============================================================================
// StatementImport — 对账单批量导入页面
// 流程：用户粘贴整份对账单文本 → 按票切段 → 用 PO/Booking 自动匹配 ops 票
//   → 显示预览（每票费用列表）→ 用户审核 → 一键批量插 charges
//
// 第一版：针对 Yusen Logistics（日邮）"费用确认单 (NBO)" 格式
// 后续按需扩展其他船公司
// ============================================================================
import { useState, useEffect, useMemo } from "react";
import { supabase } from "../supabase.js";
import { TmsTitle, Mi } from "../components/tms.jsx";

// ───────────────────────────────────────────────────────────────
// 解析器：Yusen 对账单文本切段 + 费用列表提取
// ───────────────────────────────────────────────────────────────
function parseYusenStatement(text) {
  const t = text || "";
  // 按"分单小计"切段（每票末尾一行小计）
  // 也可以按 "DARNB..." 单号切，但小计后空白更可靠
  const segments = t.split(/分单小计/);
  const tickets = [];
  for (let i = 0; i < segments.length - 1; i++) {  // 最后一段是合计区，不要
    const seg = segments[i] + "分单小计";  // 把小计行接回去（方便提取金额合计）
    const ticket = parseYusenTicket(seg);
    if (ticket) tickets.push(ticket);
  }
  return tickets;
}

function parseYusenTicket(seg) {
  const out = { rawText: seg, charges: [] };

  // 账单号 DARNBO...
  const billNo = seg.match(/(DARNB[O0-9]{10,})/);
  if (billNo) out.bill_no = billNo[1];

  // SO# (WMMNBO 开头) / PO# / 船名/航次 / 提单号
  const so = seg.match(/(WMMNBO\d{4,})/);
  if (so) out.so_no = so[1];

  // 第一个 8 位以上数字（在 SO# 之后）视为 PO#
  const po = seg.match(/WMMNBO\d+\s*\n*\s*(\d{8,})/);
  if (po) out.po = po[1];

  // 船名航次（包含字母+斜杠+数字+字母组合）
  const vessel = seg.match(/([A-Z][A-Z\s]+?)\/(\d{3}[A-Z])/);
  if (vessel) { out.vessel = vessel[1].trim(); out.voyage = vessel[2]; }

  // 提单号（一般跟 SO# 同一行附近）
  const bl = seg.match(/(WMM[-\w]+|NGB\d+)/);
  if (bl) out.bl_no = bl[1];

  // 体积
  const cbm = seg.match(/(\d{1,3}\.\d{1,4})\s*$/m);

  // 小计：RMB:N; USD:M
  const total = seg.match(/分单小计[：:]\s*RMB[：:]?(\d+(?:\.\d+)?)\s*;?\s*USD[：:]?(\d+(?:\.\d+)?)/);
  if (total) { out.total_rmb = parseFloat(total[1]); out.total_usd = parseFloat(total[2]); }

  // 费用明细：每行形如 "代理 单传输费 200.00 RMB 0"
  // 抓取 中文费目 + 金额 + 币种 + 税率
  const chargeRe = /^([一-龥 ]+?)\s+([\d,]+\.\d{2})\s+(RMB|USD|EUR|CNY)\s+(\d+(?:\.\d+)?)\s*$/gm;
  let m;
  while ((m = chargeRe.exec(seg)) !== null) {
    out.charges.push({
      name: m[1].trim().replace(/\s+/g, ""),  // 去掉中间空格："代理 单传输费" → "代理单传输费"
      amount: parseFloat(m[2].replace(/,/g, "")),
      currency: m[3] === "RMB" ? "CNY" : m[3],
      tax_rate: parseFloat(m[4]),
    });
  }

  if (!out.bill_no && out.charges.length === 0) return null;  // 不像有效票
  return out;
}

// ───────────────────────────────────────────────────────────────
// 主组件
// ───────────────────────────────────────────────────────────────
export default function StatementImport({ user, onBack }) {
  const [text, setText] = useState("");
  const [tickets, setTickets] = useState(null);  // 解析结果
  const [direction, setDirection] = useState("AP");  // AR=应收 / AP=应付
  const [partners, setPartners] = useState([]);
  const [partnerId, setPartnerId] = useState("");
  const [chargeItems, setChargeItems] = useState([]);
  const [shipmentByKey, setShipmentByKey] = useState({});  // PO/Booking → shipment
  const [importing, setImporting] = useState(false);
  const [parseErr, setParseErr] = useState(null);

  // 拉 partners + charge_items 字典
  useEffect(() => {
    supabase.from("customers").select("id, name, partner_type").order("name")
      .then(({ data }) => setPartners(data || []));
    supabase.from("charge_items").select("id, name_zh, code, sort").eq("active", true).order("sort")
      .then(({ data }) => setChargeItems(data || []));
  }, []);

  // 解析后用 PO/Booking 批量查 shipments 匹配
  const handleParse = async () => {
    setParseErr(null);
    setTickets(null);
    const parsed = parseYusenStatement(text);
    if (parsed.length === 0) {
      setParseErr("没解析出任何票。确认粘贴的是 Yusen 对账单文本？");
      return;
    }
    // 收集所有要查的 key（PO + SO# + BL）
    const pos = parsed.map(t => t.po).filter(Boolean);
    const bls = parsed.map(t => t.bl_no).filter(Boolean);
    const matchMap = {};
    if (pos.length > 0) {
      const { data } = await supabase.from("shipments")
        .select("id, order_no, po, booking_no, mbl_no, vessel, voyage, customer, supplier")
        .in("po", pos);
      (data || []).forEach(s => { if (s.po) matchMap[`po:${s.po}`] = s; });
    }
    if (bls.length > 0) {
      const { data } = await supabase.from("shipments")
        .select("id, order_no, po, booking_no, mbl_no, vessel, voyage, customer, supplier")
        .or(`booking_no.in.(${bls.join(",")}),mbl_no.in.(${bls.join(",")})`);
      (data || []).forEach(s => {
        if (s.booking_no) matchMap[`bl:${s.booking_no}`] = s;
        if (s.mbl_no) matchMap[`bl:${s.mbl_no}`] = s;
      });
    }
    setShipmentByKey(matchMap);
    setTickets(parsed);
  };

  // charge_items 模糊匹配
  const matchChargeItem = (chargeName) => {
    if (!chargeName) return null;
    // 完全匹配
    let hit = chargeItems.find(ci => ci.name_zh === chargeName);
    if (hit) return hit;
    // 包含匹配
    hit = chargeItems.find(ci => ci.name_zh && (chargeName.includes(ci.name_zh) || ci.name_zh.includes(chargeName)));
    return hit || null;
  };

  // 每票匹配的 shipment
  const matchedShipment = (t) => {
    if (t._manualShipmentId) {
      // 用户手动选了某条 shipment
      return Object.values(shipmentByKey).find(s => s.id === t._manualShipmentId) || null;
    }
    return shipmentByKey[`po:${t.po}`] || shipmentByKey[`bl:${t.bl_no}`] || null;
  };

  const updateTicket = (idx, patch) => {
    setTickets(prev => prev.map((t, i) => i === idx ? { ...t, ...patch } : t));
  };

  const toggleTicket = (idx) => updateTicket(idx, { _skip: !tickets[idx]._skip });

  const importable = useMemo(() => {
    if (!tickets) return 0;
    return tickets.filter(t => !t._skip && matchedShipment(t)).length;
  }, [tickets, shipmentByKey]);

  const doImport = async () => {
    if (!partnerId) { alert("请先选择 Partner（对账方）"); return; }
    if (!tickets) return;
    if (!window.confirm(`确认导入 ${importable} 票的费用到 charges 表？`)) return;
    setImporting(true);
    const partnerObj = partners.find(p => p.id === partnerId);
    let totalInserts = 0;
    const errors = [];
    for (const t of tickets) {
      if (t._skip) continue;
      const ship = matchedShipment(t);
      if (!ship) continue;
      const inserts = [];
      t.charges.forEach((c, idx) => {
        const ci = matchChargeItem(c.name);
        inserts.push({
          shipment_id: ship.id,
          charge_item_id: ci?.id || null,
          direction,
          partner_id: partnerId,
          partner_name: partnerObj?.name || null,
          unit: "票",
          quantity: 1,
          unit_price: c.amount,
          tax_rate: c.tax_rate || 0,
          currency: c.currency || "CNY",
          exchange_rate: 1,
          remark: ci ? null : `[未匹配] ${c.name}`,
          status: "草稿",
          sort_order: idx,
          created_by: user?.id || null,
        });
      });
      if (inserts.length === 0) continue;
      const { error } = await supabase.from("charges").insert(inserts);
      if (error) {
        errors.push(`${t.bill_no || "?"}: ${error.message}`);
      } else {
        totalInserts += inserts.length;
      }
    }
    setImporting(false);
    if (errors.length) {
      alert(`导入完成（部分失败）\n成功 ${totalInserts} 行；失败 ${errors.length} 票：\n${errors.join("\n")}`);
    } else {
      alert(`导入成功！共插入 ${totalInserts} 行 charges`);
      onBack();
    }
  };

  return (
    <>
      <h1 className="page-title">导入对账单</h1>

      <div className="page-card">
        {/* 设置区 */}
        <div style={{ display: "flex", gap: 16, alignItems: "center", marginBottom: 12, fontSize: 13 }}>
          <label>方向：
            <select value={direction} onChange={e => setDirection(e.target.value)} style={inp}>
              <option value="AP">应付（船公司收我们）</option>
              <option value="AR">应收（我们收客户）</option>
            </select>
          </label>
          <label>Partner（对账方）：
            <select value={partnerId} onChange={e => setPartnerId(e.target.value)} style={{ ...inp, minWidth: 220 }}>
              <option value="">— 选择 —</option>
              {partners.map(p => <option key={p.id} value={p.id}>{p.name}{p.partner_type ? ` (${p.partner_type})` : ""}</option>)}
            </select>
          </label>
        </div>

        {!tickets && (
          <>
            <div style={{ fontSize: 12, color: "#666", marginBottom: 6 }}>
              在 PDF 阅读器全选复制整份对账单（含所有票的费用明细），粘贴下面：
            </div>
            <textarea
              value={text}
              onChange={e => setText(e.target.value)}
              rows={18}
              style={{ width: "100%", fontFamily: "Consolas,monospace", fontSize: 11, padding: 8, boxSizing: "border-box" }}
              placeholder="粘贴整份 Yusen 对账单文本..."
            />
            {parseErr && <div style={{ marginTop: 8, color: "#c00" }}>⚠ {parseErr}</div>}
            <div style={{ marginTop: 10 }}>
              <Mi onClick={handleParse}>解析</Mi>
              <Mi onClick={() => setText("")}>清空</Mi>
            </div>
          </>
        )}

        {tickets && (
          <>
            <div style={{ marginBottom: 12, padding: 10, background: "#f0f9ff", border: "1px solid #c8dfff", fontSize: 13 }}>
              解析出 <b>{tickets.length}</b> 票，自动匹配到 ops 票 <b>{importable}</b> 票。审核后点"一键导入"。
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
              <thead>
                <tr style={{ background: "#fafafa" }}>
                  <th style={th}>导</th>
                  <th style={th}>账单号</th>
                  <th style={th}>SO#</th>
                  <th style={th}>PO#</th>
                  <th style={th}>船名航次</th>
                  <th style={th}>匹配作业</th>
                  <th style={th}>费用条目</th>
                  <th style={{ ...th, textAlign: "right" }}>RMB</th>
                  <th style={{ ...th, textAlign: "right" }}>USD</th>
                </tr>
              </thead>
              <tbody>
                {tickets.map((t, i) => {
                  const ship = matchedShipment(t);
                  const ok = !!ship;
                  return (
                    <tr key={i} style={{ background: t._skip ? "#fafafa" : (ok ? "#fff" : "#fff7e6") }}>
                      <td style={td}>
                        <input type="checkbox" checked={!t._skip && ok} disabled={!ok} onChange={() => toggleTicket(i)} />
                      </td>
                      <td style={td}>{t.bill_no || "—"}</td>
                      <td style={td}>{t.so_no || "—"}</td>
                      <td style={td}>{t.po || "—"}</td>
                      <td style={td}>{t.vessel}{t.voyage ? `/${t.voyage}` : ""}</td>
                      <td style={td}>
                        {ship ? (
                          <span style={{ color: "#1990ff" }}>{ship.order_no || ship.booking_no || ship.id.slice(0, 8)}</span>
                        ) : (
                          <span style={{ color: "#c66800" }}>⚠ 未匹配</span>
                        )}
                      </td>
                      <td style={td}>{t.charges.length}</td>
                      <td style={{ ...td, textAlign: "right", fontFamily: "Consolas,monospace" }}>{t.total_rmb || "—"}</td>
                      <td style={{ ...td, textAlign: "right", fontFamily: "Consolas,monospace" }}>{t.total_usd || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
              <button onClick={doImport} disabled={importing || importable === 0 || !partnerId} style={btnPrimary}>
                {importing ? "导入中..." : `一键导入 ${importable} 票`}
              </button>
              <button onClick={() => setTickets(null)} style={btn}>返回修改文本</button>
            </div>
            {!partnerId && <div style={{ marginTop: 8, color: "#c00", fontSize: 12 }}>⚠ 请先在上方选择 Partner</div>}
          </>
        )}
      </div>
    </>
  );
}

const th = { padding: "6px 8px", border: "1px solid #e8e8e8", fontWeight: 600, textAlign: "left", whiteSpace: "nowrap" };
const td = { padding: "5px 8px", border: "1px solid #f0f0f0" };
const inp = { marginLeft: 6, padding: "4px 6px", border: "1px solid #d9d9d9", borderRadius: 3, fontSize: 13 };
const btn = { padding: "6px 14px", cursor: "pointer", border: "1px solid #d9d9d9", background: "#fff", borderRadius: 3 };
const btnPrimary = { ...btn, background: "#1990ff", color: "#fff", border: "1px solid #1990ff", fontWeight: 600 };
