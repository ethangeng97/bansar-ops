// ============================================================================
// draft-bl-xlsx.js — "提单确认件 / 补料" Excel 版（发一代/船公司补料用）
//
// 字段结构参考 COSCO Shipping Lines 官方补料用户手册（SI / Shipping Instruction）
// 章节：
//   1) 提单基本信息（B/L No / MBL / Booking / Carrier / 提单类型 / 海运费 / 付款地）
//   2) Party 信息（Shipper / Consignee / Notify / 2nd Notify / 货代 + CN24 代码）
//   3) 航线信息（Pre-Carriage / Vessel+Voyage / POR / POL / POD / POD-final）
//   4) 集装箱 & 货物明细（每箱一行：箱号 / 封号 / 箱型 / 件包装毛体 / 品名 / HS）
//   5) VGM 验证总重信息（每箱一行）
//   6) 唛头 & 货物描述 总计
//   7) 提单分发指示（正/副本份数、签发地、签发日期、Release Type）
//   8) 其他备注（提单备注、特殊指令）
//
// 用法：await exportDraftBLToXlsx(shipmentId)
// ============================================================================
import { supabase } from "../supabase.js";

let _xlsxPromise = null;
async function getXLSX() {
  if (!_xlsxPromise) _xlsxPromise = import("xlsx");
  return _xlsxPromise;
}

// 简单数值/日期格式化
const fmtN = (v, d = 3) => {
  const n = parseFloat(v);
  if (!isFinite(n) || n === 0) return "";
  return n.toFixed(d);
};
const fmtI = (v) => {
  const n = parseInt(v);
  if (!isFinite(n) || n === 0) return "";
  return n;
};
const fmtDate = (v) => {
  if (!v) return "";
  try { return new Date(v).toISOString().slice(0, 10); } catch { return String(v); }
};

// 把"件数"转为大写英文（SAY ...）。15000 → "FIFTEEN THOUSAND"
// 简化版本：常用范围（0-999,999）足够提单用。超出范围回退到数字本身。
function numberToWords(n) {
  if (!isFinite(n) || n < 0 || n > 999999) return String(n);
  const ones = ["","ONE","TWO","THREE","FOUR","FIVE","SIX","SEVEN","EIGHT","NINE","TEN","ELEVEN","TWELVE","THIRTEEN","FOURTEEN","FIFTEEN","SIXTEEN","SEVENTEEN","EIGHTEEN","NINETEEN"];
  const tens = ["","","TWENTY","THIRTY","FORTY","FIFTY","SIXTY","SEVENTY","EIGHTY","NINETY"];
  const sub = (x) => {
    if (x < 20) return ones[x];
    if (x < 100) return tens[Math.floor(x / 10)] + (x % 10 ? "-" + ones[x % 10] : "");
    const h = Math.floor(x / 100);
    const r = x % 100;
    return ones[h] + " HUNDRED" + (r ? " AND " + sub(r) : "");
  };
  if (n === 0) return "ZERO";
  const thousands = Math.floor(n / 1000);
  const rem = n % 1000;
  let out = "";
  if (thousands) out += sub(thousands) + " THOUSAND";
  if (rem) out += (out ? " " : "") + sub(rem);
  return out;
}

export async function exportDraftBLToXlsx(shipmentId) {
  if (!shipmentId) { alert("请先保存作业再导出"); return; }
  const XLSX = await getXLSX();
  const [{ data: s }, { data: ctns }, { data: cargo }, { data: co }] = await Promise.all([
    supabase.from("shipments").select("*").eq("id", shipmentId).single(),
    supabase.from("shipment_containers").select("*").eq("shipment_id", shipmentId).order("sort_order"),
    supabase.from("cargo_items").select("*").eq("shipment_id", shipmentId).order("sort_order"),
    supabase.from("company_settings").select("*").eq("id", 1).single(),
  ]);
  if (!s) { alert("找不到作业数据"); return; }
  const containers = ctns || [];
  const cargoItems = cargo || [];
  const company = co || {};

  // 按 container_no 反查 shipment_containers 行（拿 seal/size/type/VGM）
  const ctnByNo = {};
  for (const c of containers) {
    const k = (c.container_no || "").trim();
    if (k) ctnByNo[k] = c;
  }

  // 合计
  const totalPkg = cargoItems.reduce((a, r) => a + (parseInt(r.qty) || 0), 0)
    || parseInt(s.qty_packages) || 0;
  const totalWt = cargoItems.reduce((a, r) => a + (parseFloat(r.gross_weight) || 0), 0)
    || parseFloat(s.weight) || 0;
  const totalCbm = cargoItems.reduce((a, r) => a + (parseFloat(r.volume) || 0), 0)
    || parseFloat(s.volume) || 0;
  const distinctProducts = [...new Set(cargoItems.map(it => it.product_name_en).filter(Boolean))];
  const unit = cargoItems[0]?.package_unit || s.pkg_unit || "CARTONS";
  const isFCL = (s.shipment_type || "").toUpperCase().includes("FCL") || (s.shipment_type || "") === "整箱";
  const serviceType = (isFCL ? "FCL/" : "") + (s.service_type || "CY-CY");
  const blType = s.bl_type || "ORIGINAL"; // ORIGINAL / TELEX / SEAWAY
  const freightTerms = (s.freight_terms || "").toUpperCase() || "FREIGHT AS ARRANGED";
  const paymentTerms = (s.payment_terms || "COLLECT").toUpperCase();
  const blNo = s.hbl_no || `BSNREF${(s.order_no || "").replace(/^BSO/, "")}`;

  // ───────────────────────────────────────────────
  // 拼 AoA（Array of Arrays）
  // ───────────────────────────────────────────────
  const aoa = [];
  const merges = [];
  let row = 0;
  const COL_COUNT = 9; // A..I

  // Title 行
  aoa.push(["SHIPPING INSTRUCTION / 提单确认件（一代补料用）"]);
  merges.push({ s: { r: row, c: 0 }, e: { r: row, c: COL_COUNT - 1 } });
  row += 1;
  // 副标题：公司名 + B/L No.
  aoa.push([`${company.name_en || "BANSAR (NINGBO) INT'L TRANSPORTATION CO., LTD."}    B/L No.: ${blNo}`]);
  merges.push({ s: { r: row, c: 0 }, e: { r: row, c: COL_COUNT - 1 } });
  row += 1;
  aoa.push([]);
  row += 1;

  // 章节助手
  const section = (title) => {
    aoa.push([`■ ${title}`]);
    merges.push({ s: { r: row, c: 0 }, e: { r: row, c: COL_COUNT - 1 } });
    row += 1;
  };
  // label-value 横排两组：lab1 / val1 跨 4 列 / lab2 / val2 跨 4 列
  const kvLine = (lab1, val1, lab2 = "", val2 = "") => {
    aoa.push([lab1, val1, "", "", "", lab2, val2, "", ""]);
    merges.push({ s: { r: row, c: 1 }, e: { r: row, c: 4 } });
    merges.push({ s: { r: row, c: 6 }, e: { r: row, c: 8 } });
    row += 1;
  };
  // label 在第 A 列，value 跨满列（多行文本用）
  const kvWide = (label, value) => {
    aoa.push([label, value]);
    merges.push({ s: { r: row, c: 1 }, e: { r: row, c: COL_COUNT - 1 } });
    row += 1;
  };
  const blank = () => { aoa.push([]); row += 1; };

  // 1) 提单基本信息
  section("1. 提单基本信息 / Bill of Lading Info");
  kvLine("B/L No.",        blNo,                                "Booking No.",   s.booking_no || "");
  kvLine("MB/L No.",       s.mbl_no || "",                       "HB/L No.",      s.hbl_no || "");
  kvLine("Carrier 船公司",  s.carrier || "",                      "Carrier Agent", s.carrier_agent || "");
  kvLine("Shipment Type",  s.shipment_type || "",                "Service Type",  serviceType);
  kvLine("B/L Type",       blType,                               "Freight Terms", `${freightTerms} - ${paymentTerms}`);
  kvLine("Place of Payment", s.payment_place || (paymentTerms === "COLLECT" ? "DESTINATION" : (s.pol || "")),
                                                                  "Issue Date",    fmtDate(s.issue_date) || fmtDate(new Date()));
  blank();

  // 2) Party 信息
  section("2. 船运方信息 / Parties");
  kvWide("Shipper 发货人",           s.shipper || "");
  kvWide("Shipper CN24 (统一社会信用代码)", s.shipper_uscc || "");
  blank();
  kvWide("Consignee 收货人",         s.consignee || "");
  kvWide("Consignee CN24",            s.consignee_uscc || "");
  blank();
  kvWide("Notify Party 通知方",       s.notify_party || "SAME AS CONSIGNEE");
  kvWide("2nd Notify Party 第二通知方", s.notify_party_2 || "");
  blank();
  kvWide("Freight Forwarder 货代",    s.overseas_agent || "");
  blank();

  // 3) 航线信息
  section("3. 航线信息 / Routing");
  kvLine("Pre-Carriage 头程",        s.pre_carriage || "—",                 "Vessel + Voyage", `${s.vessel || ""} ${s.voyage || ""}`.trim());
  kvLine("Place of Receipt 收货地",  s.receipt_place_name || s.pol || "",   "Port of Loading 装货港", s.pol || "");
  kvLine("Port of Discharge 卸货港", s.pod || "",                            "Place of Delivery 交货地", s.delivery_place_name || s.pod || "");
  kvLine("Final Destination 最终目的地", s.destination || s.pod || "",       "ETD 预计开航",   fmtDate(s.etd));
  kvLine("ATD 实际开航",             fmtDate(s.atd),                         "ETA 预计抵港",    fmtDate(s.eta));
  blank();

  // 4) 集装箱 & 货物明细
  section("4. 集装箱 & 货物明细 / Containers & Cargo Details");
  const hdr = ["Container No.", "Seal No.", "Size/Type", "Packages", "Unit", "Product (English)", "HS Code", "Gross Weight (KGS)", "Measurement (CBM)"];
  aoa.push(hdr);
  row += 1;
  // 按 cargo_items 输出每行
  if (cargoItems.length > 0) {
    for (const it of cargoItems) {
      const cno = (it.container_no || "").trim();
      const c = ctnByNo[cno] || {};
      const size = c.container_size && c.container_type ? `${c.container_size}'${c.container_type}` : (it.container_type || "");
      aoa.push([
        cno,
        c.seal_no || it.seal_no || "",
        size,
        fmtI(it.qty),
        it.package_unit || unit,
        it.product_name_en || "",
        it.hs_code || s.hs_code || "",
        fmtN(it.gross_weight, 3),
        fmtN(it.volume, 3),
      ]);
      row += 1;
    }
  } else if (containers.length > 0) {
    for (const c of containers) {
      aoa.push([
        c.container_no || "",
        c.seal_no || "",
        c.container_size && c.container_type ? `${c.container_size}'${c.container_type}` : "",
        fmtI(c.cargo_qty),
        unit,
        s.desc_en || s.description || "",
        s.hs_code || "",
        fmtN(c.cargo_weight, 3),
        fmtN(c.cargo_volume, 3),
      ]);
      row += 1;
    }
  } else {
    aoa.push([
      "", "", s.qty_container || "",
      fmtI(s.qty_packages),
      unit,
      s.desc_en || s.description || "",
      s.hs_code || "",
      fmtN(s.weight, 3),
      fmtN(s.volume, 3),
    ]);
    row += 1;
  }
  // TOTAL 合计行
  aoa.push([
    "TOTAL", "", "",
    totalPkg || "",
    unit,
    distinctProducts.join(" / ") || s.desc_en || "",
    "",
    fmtN(totalWt, 3),
    fmtN(totalCbm, 3),
  ]);
  row += 1;
  // SAY 大写
  aoa.push([
    "SAY", `${numberToWords(totalPkg)} (${totalPkg}) ${unit} ONLY`,
  ]);
  merges.push({ s: { r: row, c: 1 }, e: { r: row, c: COL_COUNT - 1 } });
  row += 1;
  blank();

  // 5) VGM 验证总重信息
  section("5. VGM 信息 / Verified Gross Mass (Per Container)");
  aoa.push(["Container No.", "VGM Weight (KG)", "VGM Method", "Responsible Party", "VGM Date", "Signer", "", "", ""]);
  row += 1;
  if (containers.length > 0) {
    for (const c of containers) {
      aoa.push([
        c.container_no || "",
        fmtN(c.vgm_weight, 3) || fmtN(c.cargo_weight, 3),
        c.vgm_method || "",
        c.vgm_party || company.name_en || "BANSAR (NINGBO) INT'L TRANSPORTATION CO., LTD.",
        fmtDate(c.vgm_date),
        c.vgm_signer || "",
        "", "", "",
      ]);
      row += 1;
    }
  } else {
    aoa.push(["（无柜信息 / no container data）", "", "", "", "", "", "", "", ""]);
    row += 1;
  }
  blank();

  // 6) 唛头 / Marks
  section("6. 唛头及货物描述 / Marks & Description");
  kvWide("Marks & Nos. 唛头",       s.marks || "N/M");
  kvWide("Description 货物英文品名", distinctProducts.join(" / ") || s.desc_en || s.description || "");
  kvWide("PO No.",                  s.po || "");
  kvWide("Customer PO",             s.customer_po || "");
  blank();

  // 7) 提单分发
  section("7. 提单分发 / B/L Distribution");
  kvLine("Number of Originals 正本份数",   String(s.bl_originals || 3),         "Number of Copies 副本份数", String(s.bl_copies || 0));
  kvLine("Release Type 提单方式",           blType,                              "Issue Place 签发地",        s.issue_place_name || s.pol || "");
  kvLine("Telex Date 电放日期",             fmtDate(s.telex_release_at),         "On Board Date",             fmtDate(s.atd || s.etd));
  blank();

  // 8) 备注 & 其他
  section("8. 其他 / Remarks");
  kvWide("B/L Remarks 提单备注",       s.bl_remark || "");
  kvWide("Special Instructions 特殊指令", s.shipping_instruction || "");
  kvWide("Internal Order No.",         s.order_no || "");
  blank();

  // 页脚
  aoa.push([`Generated: ${new Date().toLocaleString("zh-CN")}    /    本件为提单草稿（DRAFT）供一代补料 / 客户核对用，正本以船公司签发为准`]);
  merges.push({ s: { r: row, c: 0 }, e: { r: row, c: COL_COUNT - 1 } });
  row += 1;

  // 建 sheet
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!merges"] = merges;
  // 列宽
  ws["!cols"] = [
    { wch: 20 }, // A
    { wch: 18 }, // B
    { wch: 12 }, // C
    { wch: 12 }, // D
    { wch: 12 }, // E
    { wch: 32 }, // F
    { wch: 16 }, // G
    { wch: 18 }, // H
    { wch: 16 }, // I
  ];
  // Shipper/Consignee/Notify 多行文本：让行变高
  // 注：XLSX 行高单位 pt；shipper 字段通常 3-5 行
  ws["!rows"] = [];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "BL Draft");
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const filenameBlNo = s.mbl_no || s.booking_no || s.hbl_no || s.order_no || "BL";
  const filename = `${filenameBlNo}+SI_DRAFT.xlsx`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
