// ============================================================================
// draft-bl-xlsx.js — 加载 SI Format 模板，填入本票数据后下载
//
// 模板路径：/templates/si-format.xlsx（放在 public/，由 Vite 直接静态服务）
// 用 exceljs 做模板填充（社区版 xlsx 写回会丢图片/边框/字体，所以用 exceljs）
// 单元格映射严格对应模板"Version1.1" sheet 的行列位置。
// ============================================================================
import { supabase } from "../supabase.js";

let _exceljsPromise = null;
async function getExcelJS() {
  if (!_exceljsPromise) _exceljsPromise = import("exceljs");
  return (await _exceljsPromise).default || await _exceljsPromise;
}

const numOr = (v, fallback = "") => {
  const n = parseFloat(v);
  if (!isFinite(n) || n === 0) return fallback;
  return Number(n);
};
const intOr = (v, fallback = "") => {
  const n = parseInt(v);
  if (!isFinite(n) || n === 0) return fallback;
  return n;
};

export async function exportDraftBLToXlsx(shipmentId) {
  if (!shipmentId) { alert("请先保存作业再导出"); return; }

  // 拉数据
  const [{ data: s }, { data: ctns }, { data: cargo }] = await Promise.all([
    supabase.from("shipments").select("*").eq("id", shipmentId).single(),
    supabase.from("shipment_containers").select("*").eq("shipment_id", shipmentId).order("sort_order"),
    supabase.from("cargo_items").select("*").eq("shipment_id", shipmentId).order("sort_order"),
  ]);
  if (!s) { alert("找不到作业数据"); return; }
  const containers = ctns || [];
  const cargoItems = cargo || [];
  const ctnByNo = {};
  for (const c of containers) {
    const k = (c.container_no || "").trim();
    if (k) ctnByNo[k] = c;
  }

  // 加载模板
  const ExcelJS = await getExcelJS();
  const res = await fetch("/templates/si-format.xlsx");
  if (!res.ok) { alert("模板文件加载失败"); return; }
  const tplBuf = await res.arrayBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(tplBuf);
  // 第 1 张 sheet 是 "Version1.1"；第 2 张是下拉参考"请勿修改或删除"
  const ws = wb.worksheets[0];
  if (!ws) { alert("模板 sheet 异常"); return; }

  // 派生字段
  const blNo = s.mbl_no || s.booking_no || s.hbl_no || s.order_no || "";
  const bkgNo = s.booking_no || "";
  const hblNo = s.hbl_no || "";
  const blType = (s.bl_type || "").toUpperCase() || "ORIGINAL";
  const paymentTerm = (s.payment_terms || "COLLECT").toUpperCase();
  const deliveryTerm = s.service_type || "CY-CY";
  const carrier = s.carrier || "";
  const distinctProducts = [...new Set(cargoItems.map(it => it.product_name_en).filter(Boolean))];
  const commodityName = distinctProducts.join(" / ") || s.desc_en || s.description || "";

  // ── 写入单元格（坐标对应模板原样位置）──
  // 由于模板里这些 cell 可能在 merge 块内，写值得写到 merge 起点（A5、A13、A21 等）
  ws.getCell("A5").value  = s.shipper || "";
  ws.getCell("G5").value  = blNo;
  ws.getCell("E7").value  = bkgNo;
  ws.getCell("G7").value  = blType;
  ws.getCell("E9").value  = s.vessel || "";
  ws.getCell("G9").value  = s.voyage || "";
  ws.getCell("E11").value = s.ams_type || "";
  ws.getCell("G11").value = s.scac_code || "";

  ws.getCell("A13").value = s.consignee || "";
  ws.getCell("E13").value = paymentTerm;
  ws.getCell("G13").value = hblNo;
  ws.getCell("E15").value = deliveryTerm;
  ws.getCell("G15").value = s.hs_code || "";
  ws.getCell("E17").value = s.contract_no || "";
  ws.getCell("G17").value = s.contract_holder || "";
  ws.getCell("E19").value = s.feedback_system || "是";
  ws.getCell("G19").value = s.show_destination_agent || "是";

  ws.getCell("A21").value = s.notify_party || "SAME AS CONSIGNEE";
  ws.getCell("E21").value = s.notify_party_2 || "";

  // 航线（第 29 行）
  ws.getCell("B29").value = s.receipt_place_name || s.pol || "";
  ws.getCell("C29").value = s.pol || "";
  ws.getCell("D29").value = s.transit_port_name || "";
  ws.getCell("E29").value = s.pod || "";
  ws.getCell("F29").value = s.destination || s.pod || "";
  ws.getCell("G29").value = s.payment_place
    || (paymentTerm === "COLLECT" ? "DESTINATION" : (s.pol || ""));

  // 唛头 + 货名
  ws.getCell("A32").value = s.marks || "N/M";
  ws.getCell("E32").value = commodityName;

  // 集装箱 + 货物表（从第 40 行开始）
  const cntrTypeStr = (c) => {
    if (c && c.container_size && c.container_type) return `${c.container_size}${c.container_type}`;
    return "";
  };
  // 先清掉模板示例的 3 行（行 40-42 在模板里被填了 sample）
  for (let r = 40; r <= 50; r++) {
    for (let col = 1; col <= 9; col++) {
      ws.getCell(r, col).value = null;
    }
  }
  let rowIdx = 40;
  const writeCargoRow = ({ cntrType, cntrNo, seal, pkg, kgs, cbm, hs, commodity, pkgType }) => {
    ws.getCell(rowIdx, 1).value = cntrType || "";
    ws.getCell(rowIdx, 2).value = cntrNo   || "";
    ws.getCell(rowIdx, 3).value = seal     || "";
    ws.getCell(rowIdx, 4).value = intOr(pkg);
    ws.getCell(rowIdx, 5).value = numOr(kgs);
    ws.getCell(rowIdx, 6).value = numOr(cbm);
    ws.getCell(rowIdx, 7).value = hs       || "";
    ws.getCell(rowIdx, 8).value = commodity|| "";
    ws.getCell(rowIdx, 9).value = pkgType  || "CARTONS";
    rowIdx += 1;
  };
  if (cargoItems.length > 0) {
    for (const it of cargoItems) {
      const cno = (it.container_no || "").trim();
      const c = ctnByNo[cno] || {};
      writeCargoRow({
        cntrType: cntrTypeStr(c) || it.container_type,
        cntrNo: cno,
        seal: c.seal_no || it.seal_no,
        pkg: it.qty,
        kgs: it.gross_weight,
        cbm: it.volume,
        hs: it.hs_code || s.hs_code,
        commodity: it.product_name_en,
        pkgType: it.package_unit || "CARTONS",
      });
    }
  } else if (containers.length > 0) {
    for (const c of containers) {
      writeCargoRow({
        cntrType: cntrTypeStr(c),
        cntrNo: c.container_no,
        seal: c.seal_no,
        pkg: c.cargo_qty,
        kgs: c.cargo_weight,
        cbm: c.cargo_volume,
        hs: s.hs_code,
        commodity: s.desc_en || s.description,
        pkgType: "CARTONS",
      });
    }
  } else {
    writeCargoRow({
      cntrType: s.qty_container,
      pkg: s.qty_packages,
      kgs: s.weight,
      cbm: s.volume,
      hs: s.hs_code,
      commodity: s.desc_en || s.description,
      pkgType: "CARTONS",
    });
  }

  // 备注（模板里 R52 起 4 行合并）
  if (s.bl_remark || s.shipping_instruction) {
    ws.getCell("A52").value = s.bl_remark || s.shipping_instruction;
  }

  // 写出
  const outBuf = await wb.xlsx.writeBuffer();
  const blob = new Blob([outBuf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const filename = `SI Format-${blNo || s.order_no || "BL"}.xlsx`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
