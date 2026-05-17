// ============================================================================
// draft-bl-xlsx.js — "提单样单 / BL Draft" Excel 版
//
// 严格按照行业通用的 "SI Format" 模板布局生成（参考用户提供的样本：
//   /Users/geng/Downloads/SI Format-*.xlsx，Sheet "Version1.1"）。
// 结构：
//   ┌── 提单样单 / BL Draft（标题）────────────────────────┐
//   │ 标记星号类为必填项                                     │
//   ├── Shipper (A-D 多行) ─┬─ Carrier / BL No.（右侧）      │
//   │                       │  Bkg No. / BL Type             │
//   │                       │  Vsl Name / Voyage             │
//   │                       │  AMS Type / SCAC Code          │
//   ├── Consignee (A-D 多行)─┼─ Payment Term / HBL No.        │
//   │                       │  Delivery Term / HS Code       │
//   │                       │  Contract No. / Contract Holder│
//   │                       │  回填系统 / 显示目的港代理信息  │
//   ├── Notify (A-D 多行) ──┴─ 2nd Notify (E-I 多行)         │
//   ├── POR / POL / T/S / POD / FPOD / Payment Place         │
//   ├── Shipping Marks (A-D)──── Commodity Name (E-I)        │
//   ├── Cntr Type | No. | Seal | Pkg | KGS | CBM | HS | Commodity | Pkg Type
//   ├── ... (one row per container) ...                      │
//   └── Remark / 备注                                        │
//
// 用法：await exportDraftBLToXlsx(shipmentId)
// ============================================================================
import { supabase } from "../supabase.js";

let _xlsxPromise = null;
async function getXLSX() {
  if (!_xlsxPromise) _xlsxPromise = import("xlsx");
  return _xlsxPromise;
}

const fmtN = (v, d = 3) => {
  const n = parseFloat(v);
  if (!isFinite(n) || n === 0) return "";
  return Number(n.toFixed(d));
};
const fmtI = (v) => {
  const n = parseInt(v);
  if (!isFinite(n) || n === 0) return "";
  return n;
};

export async function exportDraftBLToXlsx(shipmentId) {
  if (!shipmentId) { alert("请先保存作业再导出"); return; }
  const XLSX = await getXLSX();

  const [{ data: s }, { data: ctns }, { data: cargo }] = await Promise.all([
    supabase.from("shipments").select("*").eq("id", shipmentId).single(),
    supabase.from("shipment_containers").select("*").eq("shipment_id", shipmentId).order("sort_order"),
    supabase.from("cargo_items").select("*").eq("shipment_id", shipmentId).order("sort_order"),
  ]);
  if (!s) { alert("找不到作业数据"); return; }
  const containers = ctns || [];
  const cargoItems = cargo || [];

  // 容器箱号反查（拿封号 + 箱型）
  const ctnByNo = {};
  for (const c of containers) {
    const k = (c.container_no || "").trim();
    if (k) ctnByNo[k] = c;
  }

  // BL 字段映射
  const blNo = s.mbl_no || s.booking_no || s.hbl_no || s.order_no || "";
  const bkgNo = s.booking_no || "";
  const hblNo = s.hbl_no || "";
  const blType = (s.bl_type || "").toUpperCase() || "ORIGINAL";
  const paymentTerm = (s.payment_terms || "COLLECT").toUpperCase();
  const isFCL = (s.shipment_type || "").toUpperCase().includes("FCL") || (s.shipment_type || "") === "整箱";
  const deliveryTerm = s.service_type || "CY-CY";
  const carrier = s.carrier || "";

  // 用 XLSX.utils.aoa_to_sheet：先做 1 张 9 列的网格，再加 merges
  // 行号从 0 开始；样本里行 1 起 → 这里 0 起
  // 列：0=A 1=B 2=C 3=D 4=E 5=F 6=G 7=H 8=I
  const COLS = 9;
  const grid = []; // grid[r][c] = value
  const merges = [];

  const setCell = (r, c, v) => {
    while (grid.length <= r) grid.push(new Array(COLS).fill(""));
    grid[r][c] = v;
  };
  const merge = (r1, c1, r2, c2) => merges.push({ s: { r: r1, c: c1 }, e: { r: r2, c: c2 } });

  // ── Title 行（R1-R2 合并）
  setCell(0, 0, "提单样单/BL Draft");
  merge(0, 0, 1, COLS - 1);

  // R3: 提示
  setCell(2, 0, "标记星号类为必填项/* field required");
  merge(2, 0, 2, COLS - 1);

  // ── Shipper 区（R4-R11）
  // 左：A4-D4 标签；A5-D11 合并放值（多行文本）
  setCell(3, 0, "*发货人/Shipper");                   merge(3, 0, 3, 3);
  setCell(4, 0, s.shipper || "");                     merge(4, 0, 10, 3);
  // 右：每两行一组 label / value，列 E-F = label 区（合并）/ G-I = value 区（合并）
  // R4: 承运船东 / BL No.
  setCell(3, 4, "承运船东/Carrier");                  merge(3, 4, 3, 5);
  setCell(3, 6, "*提单号/BL No.");                    merge(3, 6, 3, 8);
  setCell(4, 4, carrier);                             merge(4, 4, 4, 5);
  setCell(4, 6, blNo);                                merge(4, 6, 4, 8);
  // R6: 订舱单号 / BL Type
  setCell(5, 4, "*订舱单号/Bkg No.");                 merge(5, 4, 5, 5);
  setCell(5, 6, "*提单类型/BL Type");                 merge(5, 6, 5, 8);
  setCell(6, 4, bkgNo);                               merge(6, 4, 6, 5);
  setCell(6, 6, blType);                              merge(6, 6, 6, 8);
  // R8: 船名 / 航次
  setCell(7, 4, "船名/Vsl Name");                     merge(7, 4, 7, 5);
  setCell(7, 6, "航次/Voyage");                       merge(7, 6, 7, 8);
  setCell(8, 4, s.vessel || "");                      merge(8, 4, 8, 5);
  setCell(8, 6, s.voyage || "");                      merge(8, 6, 8, 8);
  // R10: AMS Type / SCAC Code
  setCell(9, 4, "AMS类型/AMS Type");                  merge(9, 4, 9, 5);
  setCell(9, 6, "SCAC Code");                         merge(9, 6, 9, 8);
  setCell(10, 4, s.ams_type || "");                   merge(10, 4, 10, 5);
  setCell(10, 6, s.scac_code || "");                  merge(10, 6, 10, 8);

  // ── Consignee 区（R12-R19）
  setCell(11, 0, "*收货人/Consignee");                merge(11, 0, 11, 3);
  setCell(12, 0, s.consignee || "");                  merge(12, 0, 18, 3);
  // 右：付款方式 / House BL No.
  setCell(11, 4, "*付款方式/Payment Term");           merge(11, 4, 11, 5);
  setCell(11, 6, "House BL No.");                     merge(11, 6, 11, 8);
  setCell(12, 4, paymentTerm);                        merge(12, 4, 12, 5);
  setCell(12, 6, hblNo);                              merge(12, 6, 12, 8);
  // 承运条款 / HS Code
  setCell(13, 4, "承运条款/Delivery Term");           merge(13, 4, 13, 5);
  setCell(13, 6, "商品编码/HS Code");                  merge(13, 6, 13, 8);
  setCell(14, 4, deliveryTerm);                       merge(14, 4, 14, 5);
  setCell(14, 6, s.hs_code || "");                    merge(14, 6, 14, 8);
  // 合约号 / 签约客户
  setCell(15, 4, "合约号/Contract No.");              merge(15, 4, 15, 5);
  setCell(15, 6, "签约客户/Contract Holder");         merge(15, 6, 15, 8);
  setCell(16, 4, s.contract_no || "");                merge(16, 4, 16, 5);
  setCell(16, 6, s.contract_holder || "");            merge(16, 6, 16, 8);
  // 回填系统 / 显示目的港代理信息
  setCell(17, 4, "回填系统");                          merge(17, 4, 17, 5);
  setCell(17, 6, "*显示目的港代理信息");               merge(17, 6, 17, 8);
  setCell(18, 4, s.feedback_system || "是");          merge(18, 4, 18, 5);
  setCell(18, 6, s.show_destination_agent || "是");   merge(18, 6, 18, 8);

  // ── Notify 区（R20-R26）+ 2nd Notify
  setCell(19, 0, "*通知人/Notify");                   merge(19, 0, 19, 3);
  setCell(19, 4, "第二通知人/2nd Notify");            merge(19, 4, 19, 8);
  setCell(20, 0, s.notify_party || "SAME AS CONSIGNEE");    merge(20, 0, 25, 3);
  setCell(20, 4, s.notify_party_2 || "");                    merge(20, 4, 25, 8);

  // ── 港口提示 R27
  setCell(26, 0, "港口代码请填写UN格式的代码/Pls use UN Port Code");
  merge(26, 0, 26, COLS - 1);

  // ── 航线 R28-R29
  // 列：B=POR C=POL D=T/S E=POD F=FPOD G=Payment Place（H/I 留空）
  setCell(27, 1, "*收货地/POR");
  setCell(27, 2, "*起运港/POL");
  setCell(27, 3, "中转港/T/S");
  setCell(27, 4, "*卸货港/POD");
  setCell(27, 5, "*目的地/FPOD");
  setCell(27, 6, "付款地点/Payment Place");
  setCell(28, 1, s.receipt_place_name || s.pol || "");
  setCell(28, 2, s.pol || "");
  setCell(28, 3, s.transit_port_name || "");
  setCell(28, 4, s.pod || "");
  setCell(28, 5, s.destination || s.pod || "");
  setCell(28, 6, s.payment_place || (paymentTerm === "COLLECT" ? "DESTINATION" : (s.pol || "")));

  // ── 唛头 / 货名 R31-R37
  setCell(30, 0, "*唛头/Shipping Marks");             merge(30, 0, 30, 3);
  setCell(30, 4, "*货名/Commodity Name");             merge(30, 4, 30, COLS - 1);
  const distinctProducts = [...new Set(cargoItems.map(it => it.product_name_en).filter(Boolean))];
  setCell(31, 0, s.marks || "N/M");                   merge(31, 0, 36, 3);
  setCell(31, 4, distinctProducts.join(" / ") || s.desc_en || s.description || "");
  merge(31, 4, 36, COLS - 1);

  // ── 集装箱表 R38 提示 / R39 表头 / R40+ 数据
  setCell(37, 0, "可自行增加行数/The number of rows can be increased ");
  merge(37, 0, 37, COLS - 1);
  setCell(38, 0, "*柜型/Cntr Type");
  setCell(38, 1, "*柜号/Cntr No.");
  setCell(38, 2, "*封签/Seal");
  setCell(38, 3, "*件数/Pkg");
  setCell(38, 4, "*毛重(KGS)");
  setCell(38, 5, "*体积（CBM)");
  setCell(38, 6, "*商编/HS Code");
  setCell(38, 7, "*货名/Commodity");
  setCell(38, 8, "*包装/Pkg Type");

  // 把每条 cargo_item 写一行；没 cargo 时按 container 写一行
  const cntrTypeStr = (c) => {
    if (c && c.container_size && c.container_type) return `${c.container_size}${c.container_type}`;
    return "";
  };
  let dataRow = 39;
  if (cargoItems.length > 0) {
    for (const it of cargoItems) {
      const cno = (it.container_no || "").trim();
      const c = ctnByNo[cno] || {};
      setCell(dataRow, 0, cntrTypeStr(c) || it.container_type || "");
      setCell(dataRow, 1, cno);
      setCell(dataRow, 2, c.seal_no || it.seal_no || "");
      setCell(dataRow, 3, fmtI(it.qty));
      setCell(dataRow, 4, fmtN(it.gross_weight, 3));
      setCell(dataRow, 5, fmtN(it.volume, 3));
      setCell(dataRow, 6, it.hs_code || s.hs_code || "");
      setCell(dataRow, 7, it.product_name_en || "");
      setCell(dataRow, 8, it.package_unit || "CARTONS");
      dataRow += 1;
    }
  } else if (containers.length > 0) {
    for (const c of containers) {
      setCell(dataRow, 0, cntrTypeStr(c));
      setCell(dataRow, 1, c.container_no || "");
      setCell(dataRow, 2, c.seal_no || "");
      setCell(dataRow, 3, fmtI(c.cargo_qty));
      setCell(dataRow, 4, fmtN(c.cargo_weight, 3));
      setCell(dataRow, 5, fmtN(c.cargo_volume, 3));
      setCell(dataRow, 6, s.hs_code || "");
      setCell(dataRow, 7, s.desc_en || s.description || "");
      setCell(dataRow, 8, "CARTONS");
      dataRow += 1;
    }
  } else {
    setCell(dataRow, 0, s.qty_container || "");
    setCell(dataRow, 3, fmtI(s.qty_packages));
    setCell(dataRow, 4, fmtN(s.weight, 3));
    setCell(dataRow, 5, fmtN(s.volume, 3));
    setCell(dataRow, 6, s.hs_code || "");
    setCell(dataRow, 7, s.desc_en || s.description || "");
    setCell(dataRow, 8, "CARTONS");
    dataRow += 1;
  }

  // ── 备注 / Remark（紧跟在数据下方，留 4 行高）
  const remarkRow = Math.max(dataRow + 1, 50);
  setCell(remarkRow, 0, "备注/Remark");                 merge(remarkRow, 0, remarkRow, COLS - 1);
  setCell(remarkRow + 1, 0, s.bl_remark || s.shipping_instruction || "");
  merge(remarkRow + 1, 0, remarkRow + 4, COLS - 1);

  // ── 转 sheet
  const ws = XLSX.utils.aoa_to_sheet(grid);
  ws["!merges"] = merges;
  ws["!cols"] = [
    { wch: 14 }, // A 柜型
    { wch: 18 }, // B 柜号
    { wch: 16 }, // C 封签
    { wch: 10 }, // D 件数
    { wch: 13 }, // E 毛重
    { wch: 13 }, // F 体积
    { wch: 14 }, // G 商编
    { wch: 22 }, // H 货名
    { wch: 14 }, // I 包装
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Version1.1");

  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const filename = `SI Format-${blNo}.xlsx`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
