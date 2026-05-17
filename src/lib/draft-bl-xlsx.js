// ============================================================================
// draft-bl-xlsx.js — 简版"提单确认件" Excel，发给一代用
// 不抄 BL 框框造型，关键字段平铺成表格，方便一代填回或对照。
// 用法：await exportDraftBLToXlsx(shipmentId)
// ============================================================================
import { supabase } from "../supabase.js";

let _xlsxPromise = null;
async function getXLSX() {
  if (!_xlsxPromise) _xlsxPromise = import("xlsx");
  return _xlsxPromise;
}

export async function exportDraftBLToXlsx(shipmentId) {
  if (!shipmentId) { alert("请先保存作业再导出"); return; }
  const XLSX = await getXLSX();
  // 拉数据
  const [{ data: s }, { data: ctns }, { data: cargo }] = await Promise.all([
    supabase.from("shipments").select("*").eq("id", shipmentId).single(),
    supabase.from("shipment_containers").select("*").eq("shipment_id", shipmentId).order("sort_order"),
    supabase.from("cargo_items").select("*").eq("shipment_id", shipmentId).order("sort_order"),
  ]);
  if (!s) { alert("找不到作业数据"); return; }
  const containers = ctns || [];
  const cargoItems = cargo || [];

  // 容器箱号→封号/箱型 反查
  const ctnByNo = {};
  for (const c of containers) {
    const k = (c.container_no || "").trim();
    if (k) ctnByNo[k] = c;
  }

  // 汇总
  const totalPkg = cargoItems.reduce((sum, r) => sum + (parseInt(r.qty) || 0), 0);
  const totalWt  = cargoItems.reduce((sum, r) => sum + (parseFloat(r.gross_weight) || 0), 0);
  const totalCbm = cargoItems.reduce((sum, r) => sum + (parseFloat(r.volume) || 0), 0);
  const distinctProducts = [...new Set(cargoItems.map(it => it.product_name_en).filter(Boolean))];
  const unit = cargoItems[0]?.package_unit || s.pkg_unit || "CARTONS";
  const isFCL = (s.shipment_type || "").toUpperCase().includes("FCL") || (s.shipment_type || "") === "整箱";
  const service = (isFCL ? "FCL/" : "") + (s.service_type || "CY-CY");

  // 拼 AoA（Array of Arrays）—— 每行一个数组，给 aoa_to_sheet
  const aoa = [];
  aoa.push(["BILL OF LADING DRAFT — FOR CONFIRMATION（提单确认件 / 一代版）"]);
  aoa.push([]);
  aoa.push(["B/L No.", s.hbl_no || `BSNREF${(s.order_no || "").replace(/^BSO/, "")}`, "", "Booking No.", s.booking_no || ""]);
  aoa.push(["MB/L No.", s.mbl_no || "", "", "Carrier", s.carrier || ""]);
  aoa.push([]);

  aoa.push(["Shipper", s.shipper || ""]);
  aoa.push(["Consignee", s.consignee || ""]);
  aoa.push(["Notify Party", s.notify_party || s.consignee || ""]);
  aoa.push([]);

  aoa.push(["Vessel / Voyage", `${s.vessel || ""} ${s.voyage || ""}`.trim()]);
  aoa.push(["Place of Receipt", s.receipt_place_name || s.pol || "", "", "Port of Loading", s.pol || ""]);
  aoa.push(["Port of Discharge", s.pod || "",                       "", "Place of Delivery", s.delivery_place_name || s.pod || ""]);
  aoa.push(["Final Destination", s.destination || s.pod || ""]);
  aoa.push(["Service Type", service]);
  aoa.push(["Freight Terms", `${s.freight_terms || "FREIGHT AS ARRANGED"} - ${(s.payment_terms || "COLLECT").toUpperCase()}`]);
  aoa.push([]);

  // 集装箱 + 货物明细表
  aoa.push(["Container No.", "Seal No.", "Size/Type", "Packages", "Unit", "Product", "HS Code", "Gross Weight (KGS)", "Measurement (CBM)"]);
  if (cargoItems.length > 0) {
    for (const it of cargoItems) {
      const cno = (it.container_no || "").trim();
      const c = ctnByNo[cno] || {};
      const size = c.container_size && c.container_type ? `${c.container_size}'${c.container_type}` : (it.container_type || "");
      aoa.push([
        cno,
        c.seal_no || it.seal_no || "",
        size,
        parseInt(it.qty) || "",
        it.package_unit || unit,
        it.product_name_en || "",
        it.hs_code || "",
        parseFloat(it.gross_weight) || "",
        parseFloat(it.volume) || "",
      ]);
    }
  } else if (containers.length > 0) {
    // 没有 cargo_items 时，按 container 拉一行（数据回退）
    for (const c of containers) {
      aoa.push([
        c.container_no || "",
        c.seal_no || "",
        c.container_size && c.container_type ? `${c.container_size}'${c.container_type}` : "",
        c.cargo_qty || "",
        unit,
        s.desc_en || s.description || "",
        s.hs_code || "",
        parseFloat(c.cargo_weight) || "",
        parseFloat(c.cargo_volume) || "",
      ]);
    }
  } else {
    // 完全没有箱/货明细，只有 shipments 主字段
    aoa.push([
      "", "", s.qty_container || "",
      parseInt(s.qty_packages) || "",
      unit,
      s.desc_en || s.description || "",
      s.hs_code || "",
      parseFloat(s.weight) || "",
      parseFloat(s.volume) || "",
    ]);
  }
  // TOTAL 合计行
  aoa.push([
    "TOTAL", "", "",
    totalPkg || (parseInt(s.qty_packages) || ""),
    unit,
    distinctProducts.join(" / ") || s.desc_en || "",
    "",
    totalWt || (parseFloat(s.weight) || ""),
    totalCbm || (parseFloat(s.volume) || ""),
  ]);
  aoa.push([]);
  aoa.push(["SAY", `${totalPkg || parseInt(s.qty_packages) || 0} ${unit} ONLY`]);
  aoa.push([]);
  aoa.push(["Marks & Nos.", s.marks || "N/M"]);
  aoa.push(["PO", s.po || ""]);
  aoa.push([]);
  aoa.push(["注：本件为提单草稿，发一代核对，确认后出正本"]);

  // 建 sheet
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // 列宽
  ws["!cols"] = [
    { wch: 18 }, { wch: 16 }, { wch: 10 }, { wch: 10 }, { wch: 10 },
    { wch: 32 }, { wch: 14 }, { wch: 18 }, { wch: 18 },
  ];
  // 标题行合并
  ws["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 8 } }, // 标题
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "BL Draft");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const blNo = s.mbl_no || s.booking_no || s.hbl_no || s.order_no || "BL";
  const filename = `${blNo}+BL_DRAFT.xlsx`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
