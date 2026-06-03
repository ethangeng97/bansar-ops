// ============================================================================
// Statement.jsx — 对账单
// 两种模式：
//   A. 单票 (mode="single")：从订单详情"凭证"tab 进入，shipmentId 必填
//      自动取该 shipment 的所有 charges 渲染明细，无 statementId
//   B. 多票合并 (mode="batch")：从 #/statements/:id 进入，statementId 必填
//      取关联的所有 bills + charges，按票分组渲染
// ============================================================================

import { useEffect, useRef, useState } from "react";
import { supabase } from "../../supabase.js";

const BRAND = "#1f3864";
const STAMP_RED = "#c00";

// embedded：在订单详情「代理对账单」tab 内嵌渲染时为 true。
//   此时不能直接 window.print()——会把整个订单详情大页面一起送去打印排版，非常卡，
//   且打印结果混入订单页内容。改为打开独立干净页面 #/docs/stmt/:id?print=1 自动打印。
// autoPrint：独立页加载完成后自动调起打印（配合上面的下载入口）。
export default function Statement({ shipmentId, statementId, mode, embedded, autoPrint, onBack }) {
  const [statement, setStatement] = useState(null);  // batch 模式才有
  const [shipments, setShipments] = useState([]);    // 关联的票（单票=1，多票=N）
  const [chargesByShip, setChargesByShip] = useState({}); // ship_id => charges[]
  const [containersByShip, setContainersByShip] = useState({}); // ship_id => shipment_containers[]
  const [chargeItemMap, setChargeItemMap] = useState({}); // charge_item_id => name
  const [partnerMap, setPartnerMap] = useState({});  // partner_id => name
  const [company, setCompany] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const isSingle = mode === "single";
  const isBatch = mode === "batch";

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        // 无依赖的字典查询先并发发起，与下面解析 shipIds 的查询重叠，减少串行往返
        const dictsP = Promise.all([
          supabase.from("company_settings").select("*").eq("id", 1).single(),
          supabase.from("charge_items").select("id,name_zh"),
        ]);

        let shipIds = [];
        let stmt = null;

        if (isSingle) {
          if (!shipmentId) throw new Error("缺少 shipmentId");
          shipIds = [shipmentId];
        } else if (isBatch) {
          if (!statementId) throw new Error("缺少 statementId");
          // statement 与其 bills 都只依赖 statementId → 并发
          const [{ data: st, error: e1 }, { data: bs }] = await Promise.all([
            supabase.from("statements").select("*").eq("id", statementId).single(),
            supabase.from("bills").select("shipment_id").eq("statement_id", statementId),
          ]);
          if (e1) throw new Error("加载对账单失败: " + e1.message);
          stmt = st;
          setStatement(st);
          shipIds = [...new Set((bs || []).map(b => b.shipment_id))];
        } else {
          throw new Error("mode 必须是 single 或 batch");
        }

        // 字典结果落地
        const [{ data: c }, { data: items }] = await dictsP;
        setCompany(c || {});
        const im = {};
        (items || []).forEach(i => { im[i.id] = i.name_zh; });
        setChargeItemMap(im);

        if (shipIds.length === 0) throw new Error("找不到关联的票");

        // shipments / cargo_items / charges 都只依赖 shipIds、彼此独立 → 并发拉取
        let chargeQuery = supabase.from("charges").select("*").in("shipment_id", shipIds);
        if (isSingle) chargeQuery = chargeQuery.eq("direction", "应收");
        const [{ data: ships }, { data: ciRows }, { data: chargesAll }] = await Promise.all([
          supabase.from("shipments").select("*").in("id", shipIds),
          supabase.from("cargo_items").select("shipment_id, container_no, qty, gross_weight, volume").in("shipment_id", shipIds),
          chargeQuery,
        ]);
        setShipments(ships || []);

        // 3b. 自拼分票 (Console + 带 -N 后缀) 借母单的 container/qty_container
        // 分票自己的 shipments 行只有票级 qty/weight/volume，箱子是绑在母单上的
        const subShips = (ships || []).filter(
          s => s.shipment_type === "Console" && /-\d+$/.test(s.order_no || "")
        );
        const masterOrderNos = [...new Set(
          subShips.map(s => s.order_no.replace(/-\d+$/, "")).filter(Boolean)
        )];
        const subToMasterId = {};   // sub.id -> master.id
        const masterById = {};      // master.id -> master row (qty_container 兜底)
        if (masterOrderNos.length > 0) {
          const { data: masters } = await supabase.from("shipments")
            .select("id, order_no, qty_container, container_no, etd")
            .in("order_no", masterOrderNos);
          const masterByOrderNo = Object.fromEntries((masters || []).map(m => [m.order_no, m]));
          for (const sub of subShips) {
            const masterNo = sub.order_no.replace(/-\d+$/, "");
            const m = masterByOrderNo[masterNo];
            if (m) {
              subToMasterId[sub.id] = m.id;
              masterById[m.id] = m;
              if (!sub.etd && m.etd) sub.etd = m.etd;  // 分票 etd 空 → 借母单的
            }
          }
        }

        // 3c. 件毛体 cargo_items 优先：所有票（含主单/分票/独立票），只要有 cargo_items 行，
        // 就用合计覆盖票级 qty_packages/weight/volume，确保操作员后续更新 cargo_items 能反映出来。
        // 历史教训：BSOEC260400013-2 票级 volume=24.08 是旧值，cargo_items 合计 39.266 才是准的。
        // 若票没有 cargo_items 行（agg 取不到），保留原票级值不动。
        if (ships && ships.length > 0) {
          const agg = {};  // ship_id → {qty, weight, volume}（ciRows 已在上面并发取回）
          (ciRows || []).forEach(r => {
            const a = agg[r.shipment_id] || (agg[r.shipment_id] = { qty: 0, weight: 0, volume: 0 });
            a.qty += parseInt(r.qty) || 0;
            a.weight += parseFloat(r.gross_weight) || 0;
            a.volume += parseFloat(r.volume) || 0;
          });
          for (const sh of ships) {
            const a = agg[sh.id];
            if (!a) continue;
            if (a.qty) sh.qty_packages = a.qty;
            if (a.weight) sh.weight = Number(a.weight.toFixed(3));
            if (a.volume) sh.volume = Number(a.volume.toFixed(4));
          }
        }

        // 4a. 取 shipment_containers（包括借的母单）
        const containerLookupIds = [
          ...shipIds,
          ...Object.values(subToMasterId),
        ];
        const { data: ctnRows } = await supabase.from("shipment_containers")
          .select("shipment_id, container_no, seal_no, container_size, container_type, qty")
          .in("shipment_id", [...new Set(containerLookupIds)]);
        const ctnByShip = {};
        (ctnRows || []).forEach(c => {
          if (!ctnByShip[c.shipment_id]) ctnByShip[c.shipment_id] = [];
          ctnByShip[c.shipment_id].push(c);
        });
        // 分票：取「自己」占用的箱，而不是整借母单的全部箱。
        // 母单 4 个箱全挂在母单上，分票自己的 shipment_containers 是空的，但分票
        // cargo_items 里记了它装在哪几个箱号(container_no)。据此从母单 shipment_containers
        // 里筛出本票自己的那几个箱 → 拿到 size/type/seal → 算出本票自己的「箱型箱量」(如 2x40HC)
        // 与箱号，不再回退显示母单的 4x40HC。
        const ctnMap = { ...ctnByShip };
        // 每张分票自己 cargo_items 引用到的箱号集合
        const subCtnNos = {};  // sub.id -> Set(container_no)
        (ciRows || []).forEach(r => {
          if (!r.container_no) return;
          (subCtnNos[r.shipment_id] || (subCtnNos[r.shipment_id] = new Set())).add(r.container_no);
        });
        for (const sub of subShips) {
          const masterId = subToMasterId[sub.id];
          if (!masterId) continue;
          const masterCtns = ctnByShip[masterId] || [];
          const myNos = subCtnNos[sub.id];
          // 本票已有自己的箱行就用自己的；否则按 cargo_items 的箱号从母单里筛
          let ownCtns = (ctnByShip[sub.id] && ctnByShip[sub.id].length > 0)
            ? ctnByShip[sub.id]
            : (myNos ? masterCtns.filter(c => myNos.has(c.container_no)) : []);
          // 老数据 cargo_items 没填箱号、实在筛不出 → 整借母单，保持旧行为不回归
          if (ownCtns.length === 0) ownCtns = masterCtns;
          ctnMap[sub.id] = ownCtns;
          // 「箱型箱量」按本票自己的箱子算；只有筛不出箱时才兜底母单的 qty_container
          const computed = formatQtyContainer(ownCtns);
          if (computed) sub.qty_container = computed;
          else if (!sub.qty_container && masterById[masterId]?.qty_container) {
            sub.qty_container = masterById[masterId].qty_container;
          }
        }
        setContainersByShip(ctnMap);

        // 4b. charges（单票只取应收，已在上面并发取回 chargesAll）
        const map = {};
        (chargesAll || []).forEach(ch => {
          if (!map[ch.shipment_id]) map[ch.shipment_id] = [];
          map[ch.shipment_id].push(ch);
        });
        setChargesByShip(map);

        // 5. 取所有 partners 名字
        const partnerIds = [...new Set((chargesAll || []).map(ch => ch.partner_id).filter(Boolean))];
        if (partnerIds.length > 0) {
          const { data: ps } = await supabase
            .from("customers").select("id,name").in("id", partnerIds);
          const pm = {};
          (ps || []).forEach(p => { pm[p.id] = p.name; });
          setPartnerMap(pm);
        }
      } catch (err) {
        setError(err.message);
      }
      setLoading(false);
    })();
  }, [shipmentId, statementId, mode]);

  // autoPrint：独立页数据 + 图片(logo/公章)就绪后自动调起打印，避免章/抬头还没解码就出 PDF
  const printedRef = useRef(false);
  useEffect(() => {
    if (!autoPrint || embedded || loading || shipments.length === 0 || printedRef.current) return;
    printedRef.current = true;
    const imgs = [...document.images].filter(i => !i.complete);
    Promise.all(imgs.map(i => new Promise(res => { i.onload = i.onerror = res; })))
      .then(() => window.print());
  }, [autoPrint, embedded, loading, shipments]);

  // 把浏览器 tab/打印另存为的默认文件名设成「主单号-对账单」
  useEffect(() => {
    if (shipments.length === 0) return;
    const prev = document.title;
    const fs = shipments[0];
    const mainNo = (isBatch && statement)
      ? statement.statement_no
      : (fs.mbl_no || fs.booking_no || fs.order_no || "");
    if (mainNo) document.title = `${mainNo}-对账单`;
    return () => { document.title = prev; };
  }, [shipments, statement, isBatch]);

  if (loading) return <div style={{ padding: 24 }}>加载中...</div>;
  if (error) return <div style={{ padding: 24, color: "red" }}>{error}</div>;
  if (shipments.length === 0) return <div style={{ padding: 24 }}>无数据</div>;

  const co = company || {};
  // 内嵌在订单详情里时，直接 window.print() 会连同整个订单大页面一起排版（非常卡）。
  // 改为打开独立干净页面并自动打印；独立页本身则直接打印。
  const print = () => {
    if (embedded) {
      const url = isBatch
        ? `#/docs/stmt_batch/${statementId}?print=1`
        : `#/docs/stmt/${shipmentId}?print=1`;
      window.open(url, "_blank");
    } else {
      window.print();
    }
  };
  const issueDate = formatDate(new Date());

  // 单票模式：直接用第一票
  // 多票模式：取 statement 上的 partner_name 作为收件人
  const firstShip = shipments[0];

  // 单票模式：所有 charges 必须是同一个 partner（应收方），用第一个 charge 的 partner_id
  const allCharges = Object.values(chargesByShip).flat();
  let toPartnerName = "";
  let currency = "CNY";
  if (isBatch && statement) {
    toPartnerName = statement.partner_name || "—";
    currency = statement.currency || "CNY";
  } else {
    // 单票：取应收方的 charges（partner_id 就是收款对象）
    const firstCharge = allCharges[0];
    if (firstCharge) {
      toPartnerName = partnerMap[firstCharge.partner_id] || "—";
      currency = firstCharge.currency || "CNY";
    }
  }

  // 计算合计
  const totalsByCcy = {}; // ccy => sum
  let totalCny = 0;
  allCharges.forEach(ch => {
    const amt = Number(ch.quantity || 0) * Number(ch.unit_price || 0)
              * (1 + Number(ch.tax_rate || 0) / 100);
    const cny = amt * Number(ch.exchange_rate || 1);
    if (!totalsByCcy[ch.currency]) totalsByCcy[ch.currency] = 0;
    totalsByCcy[ch.currency] += amt;
    totalCny += cny;
  });

  return (
    <div className="doc-page" style={{ background: "#f0f0f0", minHeight: "100vh" }}>
      <style>{`
        @media print {
          @page { size: A4; margin: 0; }
          body { background: #fff !important; }
          .no-print { display: none !important; }
          .doc-page { background: #fff; }
          .stm-page { margin: 0 !important; box-shadow: none !important; }
        }
      `}</style>

      <div className="no-print" style={{
        position: "sticky", top: 0, zIndex: 100,
        padding: "10px 16px", background: "#f5f5f5", borderBottom: "1px solid #ddd",
        display: "flex", alignItems: "center", gap: 12,
      }}>
        <button onClick={onBack} style={btn}>← 返回</button>
        <span style={{ fontSize: 13, color: "#666" }}>
          对账单 · {isBatch && statement ? statement.statement_no : firstShip.order_no}
          {isBatch && <span style={{ marginLeft: 8, color: "#999" }}>· 多票合并 ({shipments.length} 票)</span>}
        </span>
        <div style={{ flex: 1 }} />
        <button onClick={print} style={btnPrimary}>
          {embedded ? "🖨 打印 / 下载 PDF（独立窗口）" : "🖨 打印 / 另存为 PDF"}
        </button>
      </div>

      <div className="stm-page" style={{
        width: "210mm", minHeight: "297mm", padding: "14mm 14mm",
        margin: "16px auto", background: "#fff",
        boxShadow: "0 2px 12px rgba(0,0,0,0.12)",
        fontFamily: "'Segoe UI','Microsoft YaHei',sans-serif",
        color: "#000", fontSize: 11, lineHeight: 1.5,
      }}>
        {/* 顶部抬头 */}
        <header style={{ display: "flex", alignItems: "center", gap: 12, paddingBottom: 10,
                          borderBottom: `2px solid ${BRAND}`, marginBottom: 16 }}>
          <div style={{ flex: "0 0 auto", width: 80 }}>
            {co.logo_url
              ? <img src={co.logo_url} alt="logo" style={{ maxWidth: 80, maxHeight: 64 }} />
              : <div style={{ width: 80, height: 64, border: "1px dashed #ccc",
                              display: "flex", alignItems: "center", justifyContent: "center",
                              color: "#999", fontSize: 9 }}>LOGO</div>}
          </div>
          <div style={{ flex: 1, textAlign: "center" }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: BRAND, letterSpacing: 4 }}>
              {co.name_zh || "班萨（宁波）国际货运代理有限公司"}
            </div>
          </div>
          <div style={{ width: 80 }}></div>
        </header>

        {/* 大标题 */}
        <div style={{ textAlign: "center", margin: "0 0 18px" }}>
          <div style={{ fontSize: 28, fontWeight: 800, color: "#000", letterSpacing: 16, paddingLeft: 16 }}>
            对 账 单
          </div>
        </div>

        {/* TO + 日期 + 对账单号 */}
        <div style={{ display: "flex", justifyContent: "space-between",
                      marginBottom: 12, fontSize: 11, fontWeight: 700 }}>
          <div>TO: {toPartnerName}</div>
          <div>日期: {issueDate}
            {isBatch && statement && (
              <span style={{ marginLeft: 16, fontFamily: "'Consolas',monospace", color: BRAND }}>
                对账单号: {statement.statement_no}
              </span>
            )}
          </div>
        </div>

        {/* 渲染每一票 */}
        {shipments.map((ship, shipIdx) => {
          const shipCharges = chargesByShip[ship.id] || [];
          return (
            <div key={ship.id} style={{ marginBottom: shipIdx === shipments.length - 1 ? 0 : 24 }}>
              {/* 票级信息 */}
              <ShipHeader ship={ship} containers={containersByShip[ship.id] || []} />

              {/* 费用明细表 */}
              <ChargeTable charges={shipCharges} chargeItemMap={chargeItemMap} />
            </div>
          );
        })}

        {/* 合计 */}
        <div style={{ marginTop: 8, marginBottom: 16 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
            <tbody>
              <tr>
                <td style={{ padding: "8px 12px", border: "1px solid #888",
                              background: "#f5f8fc", textAlign: "right",
                              fontWeight: 700, width: "30%" }}>
                  合计:
                </td>
                <td style={{ padding: "8px 12px", border: "1px solid #888",
                              fontWeight: 700, fontFamily: "'Consolas',monospace" }}>
                  {Object.entries(totalsByCcy).map(([ccy, amt]) =>
                    `${ccy} ${amt.toFixed(2)}`
                  ).join(" ; ")}
                </td>
              </tr>
              <tr>
                <td style={{ padding: "8px 12px", border: "1px solid #888",
                              background: "#f5f8fc", textAlign: "right",
                              fontWeight: 700 }}>
                  折本币合计:
                </td>
                <td style={{ padding: "8px 12px", border: "1px solid #888",
                              fontWeight: 800, color: STAMP_RED,
                              fontFamily: "'Consolas',monospace", fontSize: 12 }}>
                  CNY {totalCny.toFixed(2)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* 付款信息 + 印章 */}
        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 12, fontSize: 10 }}>
          <thead>
            <tr style={{ background: "#f5f8fc" }}>
              <th style={{ padding: "6px 10px", border: "1px solid #888",
                            textAlign: "left", fontWeight: 700, width: "60%" }}>
                付款信息:
              </th>
              <th style={{ padding: "6px 10px", border: "1px solid #888",
                            textAlign: "left", fontWeight: 700 }}>
                注释
              </th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ padding: "8px 10px", border: "1px solid #888",
                            verticalAlign: "top", lineHeight: 1.7 }}>
                开户公司：{co.name_zh || "班萨（宁波）国际货运代理有限公司"}<br/>
                CNY 开户行：上海浦东发展银行股份有限公司宁波东部新城支行<br/>
                CNY 账号：94160078801900001487<br/>
                USD 开户行：上海浦东发展银行股份有限公司宁波东部新城支行<br/>
                USD 账号：94160078814500001489
              </td>
              <td style={{ padding: "8px 10px", border: "1px solid #888",
                            verticalAlign: "top", position: "relative", minHeight: 130 }}>
                {(isBatch && statement?.notes) && (
                  <div style={{ marginBottom: 8 }}>{statement.notes}</div>
                )}
                <div style={{ position: "relative", minHeight: 100 }}>
                  {co.seal_url ? (
                    <img src={co.seal_url} alt="seal"
                         style={{ position: "absolute", right: 4, top: 4,
                                  maxWidth: 130, maxHeight: 100, opacity: 0.9 }} />
                  ) : (
                    <div style={{ position: "absolute", right: 4, top: 4,
                                  width: 110, height: 90, border: "2px dashed #cdd9ec",
                                  borderRadius: "50%",
                                  display: "flex", alignItems: "center", justifyContent: "center",
                                  color: "#888", fontSize: 9, textAlign: "center" }}>
                      公章<br/>Company<br/>Seal
                    </div>
                  )}
                </div>
              </td>
            </tr>
            <tr>
              <td colSpan={2} style={{ padding: "6px 10px", border: "1px solid #888",
                                        textAlign: "right", fontSize: 10, fontWeight: 600 }}>
                ISSUED BY: {(isBatch && statement?.issued_by) || "—"}
              </td>
            </tr>
          </tbody>
        </table>

        {/* 页脚 */}
        <div style={{ display: "flex", justifyContent: "space-between",
                      marginTop: 8, paddingTop: 4, borderTop: "1px solid #ddd",
                      fontSize: 8, color: "#888" }}>
          <div>{co.name_zh || "班萨（宁波）国际货运代理有限公司"}</div>
          <div>Form BNSR-STM</div>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// 单票字段表
// ============================================================================
function ShipHeader({ ship, containers = [] }) {
  // 箱号：从 shipment_containers 拼接（fallback 到 shipments.container_no 字符串字段）
  const containerNos = containers
    .map(c => c.container_no)
    .filter(Boolean)
    .join(", ");
  const sealNos = containers
    .map(c => c.seal_no)
    .filter(Boolean)
    .join(", ");

  const cells = [
    [["客户编号", ship.customer_po || ship.po || ""], ["订单编号", ship.order_no || ""]],
    [["主单号", ship.mbl_no || ship.booking_no || ""], ["分单号", ship.hbl_no || ""]],
    [["SO号", ship.booking_no || ""], ["起运港", ship.pol || ""]],
    [["件数", ship.qty_packages || "0"], ["目的港", ship.pod || ""]],
    [["毛重", `${ship.weight || "0"} KGS`], ["船名航次", `${ship.vessel || ""}${ship.voyage ? "/" + ship.voyage : ""}`]],
    [["体积", `${ship.volume || "0"} CBM`], ["ETD", ship.etd ? formatDate(ship.etd) : ""]],
    [["箱型箱量", ship.qty_container || ""], ["箱号", containerNos || ship.container_no || ""]],
    [["封号", sealNos || ""], ["客户名", ship.customer || ""]],
  ];
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 8, fontSize: 10.5 }}>
      <tbody>
        {cells.map((row, i) => (
          <tr key={i}>
            {row.map(([label, val], j) => [
              <td key={`l${j}`} style={{
                padding: "5px 10px", border: "1px solid #888",
                background: "#f5f8fc", fontWeight: 700, color: "#1f3864",
                width: "16%",
              }}>{label}:</td>,
              <td key={`v${j}`} style={{
                padding: "5px 10px", border: "1px solid #888",
                whiteSpace: "pre-wrap", width: "34%",
              }}>{val}</td>,
            ])}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ============================================================================
// 费用明细表
// ============================================================================
function ChargeTable({ charges, chargeItemMap }) {
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 0, fontSize: 10 }}>
      <thead>
        <tr style={{ background: "#1f3864", color: "#fff" }}>
          {["费用名称","单价","数量","单位","币种","金额","汇率","折本币总计","备注"].map((h, i) => (
            <th key={i} style={{ padding: "5px 6px", border: "1px solid #555",
                                  textAlign: i === 0 ? "left" : i === 8 ? "left" : "center",
                                  fontSize: 9.5, fontWeight: 700, fontFamily: "inherit" }}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {charges.length === 0 ? (
          <tr><td colSpan={9} style={{ padding: 12, textAlign: "center",
                                        color: "#999", border: "1px solid #888" }}>
            无费用明细
          </td></tr>
        ) : charges.map((ch, i) => {
          const amt = Number(ch.quantity || 0) * Number(ch.unit_price || 0)
                    * (1 + Number(ch.tax_rate || 0) / 100);
          const cny = amt * Number(ch.exchange_rate || 1);
          return (
            <tr key={i}>
              <td style={{ padding: "4px 6px", border: "1px solid #888" }}>
                {chargeItemMap[ch.charge_item_id] || ch.notes_charge || "—"}
              </td>
              <td style={{ padding: "4px 6px", border: "1px solid #888",
                            textAlign: "right", fontFamily: "'Consolas',monospace" }}>
                {Number(ch.unit_price || 0).toFixed(2)}
              </td>
              <td style={{ padding: "4px 6px", border: "1px solid #888",
                            textAlign: "center", fontFamily: "'Consolas',monospace" }}>
                {ch.quantity || 0}
              </td>
              <td style={{ padding: "4px 6px", border: "1px solid #888", textAlign: "center" }}>
                {ch.unit || "票"}
              </td>
              <td style={{ padding: "4px 6px", border: "1px solid #888",
                            textAlign: "center", fontFamily: "'Consolas',monospace" }}>
                {ch.currency || "CNY"}
              </td>
              <td style={{ padding: "4px 6px", border: "1px solid #888",
                            textAlign: "right", fontFamily: "'Consolas',monospace" }}>
                {amt.toFixed(2)}
              </td>
              <td style={{ padding: "4px 6px", border: "1px solid #888",
                            textAlign: "center", fontFamily: "'Consolas',monospace" }}>
                {Number(ch.exchange_rate || 1)}
              </td>
              <td style={{ padding: "4px 6px", border: "1px solid #888",
                            textAlign: "right", fontFamily: "'Consolas',monospace" }}>
                {cny.toFixed(2)}
              </td>
              <td style={{ padding: "4px 6px", border: "1px solid #888", fontSize: 9 }}>
                {ch.remark || ""}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// 把一组 shipment_containers 按 箱型 汇总成「箱型箱量」字符串，如 [40HC,40HC] => "2x40HC"
function formatQtyContainer(ctns) {
  const counts = {};
  (ctns || []).forEach(c => {
    const key = `${c.container_size || ""}${c.container_type || ""}`.trim();
    if (!key) return;
    counts[key] = (counts[key] || 0) + (Number(c.qty) || 1);
  });
  return Object.entries(counts).map(([k, n]) => `${n}x${k}`).join("+");
}

function formatDate(d) {
  if (!d) return "—";
  const date = new Date(d);
  if (isNaN(date.getTime())) return "—";
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const btn = { padding: "5px 14px", background: "#fff", border: "1px solid #d9d9d9",
              borderRadius: 3, fontSize: 12, cursor: "pointer" };
const btnPrimary = { ...btn, background: "#1890ff", color: "#fff", border: "1px solid #1890ff" };
