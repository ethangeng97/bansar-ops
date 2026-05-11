// ============================================================================
// Statement.jsx — 对账单
// 两种模式：
//   A. 单票 (mode="single")：从订单详情"凭证"tab 进入，shipmentId 必填
//      自动取该 shipment 的所有 charges 渲染明细，无 statementId
//   B. 多票合并 (mode="batch")：从 #/statements/:id 进入，statementId 必填
//      取关联的所有 bills + charges，按票分组渲染
// ============================================================================

import { useEffect, useState } from "react";
import { supabase } from "../../supabase.js";

const BRAND = "#1f3864";
const STAMP_RED = "#c00";

export default function Statement({ shipmentId, statementId, mode, onBack }) {
  const [statement, setStatement] = useState(null);  // batch 模式才有
  const [shipments, setShipments] = useState([]);    // 关联的票（单票=1，多票=N）
  const [chargesByShip, setChargesByShip] = useState({}); // ship_id => charges[]
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
        // 1. 公司
        const { data: c } = await supabase.from("company_settings").select("*").eq("id", 1).single();
        setCompany(c || {});

        // 2. charge_items 字典
        const { data: items } = await supabase.from("charge_items").select("id,name_zh");
        const im = {};
        (items || []).forEach(i => { im[i.id] = i.name_zh; });
        setChargeItemMap(im);

        let shipIds = [];
        let stmt = null;

        if (isSingle) {
          if (!shipmentId) throw new Error("缺少 shipmentId");
          shipIds = [shipmentId];
        } else if (isBatch) {
          if (!statementId) throw new Error("缺少 statementId");
          // 取 statement
          const { data: st, error: e1 } = await supabase
            .from("statements").select("*").eq("id", statementId).single();
          if (e1) throw new Error("加载对账单失败: " + e1.message);
          stmt = st;
          setStatement(st);
          // 取关联 bills
          const { data: bs } = await supabase
            .from("bills").select("shipment_id").eq("statement_id", statementId);
          shipIds = [...new Set((bs || []).map(b => b.shipment_id))];
        } else {
          throw new Error("mode 必须是 single 或 batch");
        }

        if (shipIds.length === 0) throw new Error("找不到关联的票");

        // 3. 取 shipments
        const { data: ships } = await supabase
          .from("shipments").select("*").in("id", shipIds);
        setShipments(ships || []);

        // 4. 取 charges。单票模式只取应收（对账单是给客户的），多票模式按 bills 已经过滤好的
        let chargeQuery = supabase
          .from("charges").select("*").in("shipment_id", shipIds);
        if (isSingle) chargeQuery = chargeQuery.eq("direction", "应收");
        const { data: chargesAll } = await chargeQuery;

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

  if (loading) return <div style={{ padding: 24 }}>加载中...</div>;
  if (error) return <div style={{ padding: 24, color: "red" }}>{error}</div>;
  if (shipments.length === 0) return <div style={{ padding: 24 }}>无数据</div>;

  const co = company || {};
  const print = () => window.print();
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
        <button onClick={print} style={btnPrimary}>🖨 打印 / 另存为 PDF</button>
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
              <ShipHeader ship={ship} />

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
function ShipHeader({ ship }) {
  const cells = [
    [["客户业务编号", ship.customer_po || ship.po || ""], ["订单编号", ship.order_no || ""]],
    [["主单号", ship.mbl_no || ship.booking_no || ""], ["分单号", ship.hbl_no || ""]],
    [["SO号", ship.booking_no || ""], ["起运港", ship.pol || ""]],
    [["件数", ship.qty_packages || "0"], ["目的港", ship.pod || ""]],
    [["毛重", `${ship.weight || "0"} KGS`], ["船名航次", `${ship.vessel || ""}${ship.voyage ? "/" + ship.voyage : ""}`]],
    [["体积", `${ship.volume || "0"} CBM`], ["ETD", ship.etd ? formatDate(ship.etd) : ""]],
    [["箱型箱量", ship.qty_container || ""], ["箱号", ship.container_no || ""]],
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
                {ch.notes || ""}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
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
