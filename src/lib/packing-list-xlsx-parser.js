// ============================================================================
// packing-list-xlsx-parser.js — 解析客户发来的装箱单 Excel（Packing List）
//
// 模板特征：
//   Sheet "Packing list"
//     r4   客户名称 | <name>   ...   报关地 | <city>   装柜日期 | <date>
//     r5   出口国/地区 | <addr> ...   目的港 | <port>  报关日期 | <date>
//     r6   电压/功率 | <spec>  ...                     PI日期   | <date>
//     r8   表头：产品名称 | 牌子 | 型号 | 总数量 | 每箱数量 | 总箱数 | L | W | H |
//                 单箱体积 | 净重 | 总净重 | 毛重 | 总毛重 | 总体积 |
//                 单价 | 总金额 | 柜号 | 封条号 | SO | PO | 柜重 | VGM | 磅重
//     r10+ 数据行（每行 = 一个 SKU + 一只柜）
//     最后一行：合计（col0 空、col3 = 总数量合计）→ 跳过
//
// 只输出 cargo_items 形状的行（不动 shipments 票级字段、不动 shipment_containers）。
// ============================================================================

let _xlsxModulePromise = null;
async function getXLSX() {
  if (!_xlsxModulePromise) _xlsxModulePromise = import("xlsx");
  return await _xlsxModulePromise;
}

const s = (v) => (v == null ? "" : String(v).trim());
const n = (v) => {
  if (v == null || v === "") return null;
  const x = Number(String(v).replace(/[,$\s]/g, ""));
  return Number.isFinite(x) ? x : null;
};

// 表头行：扫描前 20 行找到"产品名称"开头的那一行
function findHeaderRow(aoa) {
  for (let i = 0; i < Math.min(aoa.length, 20); i++) {
    const row = aoa[i] || [];
    const c0 = s(row[0]).replace(/\s+/g, "");
    if (c0.startsWith("产品名称") || /productname/i.test(c0)) return i;
  }
  return -1;
}

// 根据表头行的标签匹配列索引（容忍换行符、空格、繁简差异）
function buildColMap(headerRow) {
  const M = {};
  const norm = (t) => s(t).replace(/\s+/g, "").toLowerCase();
  headerRow.forEach((cell, idx) => {
    const t = norm(cell);
    if (!t) return;
    // 第一次命中即采纳；合并表头时会多个列同名，只取第一个
    if (!("product_name" in M) && (t.startsWith("产品名称") || t.includes("productname"))) M.product_name = idx;
    else if (!("brand" in M) && (t.startsWith("牌子") || t.includes("brand"))) M.brand = idx;
    else if (!("model" in M) && (t.startsWith("型号") || t.includes("model"))) M.model = idx;
    else if (!("total_qty" in M) && (t.startsWith("总数量") || t.includes("quantity"))) M.total_qty = idx;
    else if (!("per_box" in M) && (t.startsWith("每箱") || t.includes("perbox"))) M.per_box = idx;
    else if (!("total_boxes" in M) && (t.startsWith("总箱数") || t === "pcs" || t.includes("totalboxes"))) M.total_boxes = idx;
    else if (!("total_net" in M) && (t.startsWith("总净重"))) M.total_net = idx;
    else if (!("total_gross" in M) && (t.startsWith("总毛重"))) M.total_gross = idx;
    else if (!("total_cbm" in M) && (t.startsWith("总体积"))) M.total_cbm = idx;
    else if (!("container_no" in M) && (t.includes("柜号") || t.includes("cabinetnumber"))) M.container_no = idx;
    else if (!("seal_no" in M) && (t.startsWith("封条号") || t.includes("sealnumber"))) M.seal_no = idx;
    else if (!("so" in M) && t === "so") M.so = idx;
    else if (!("po" in M) && t === "po") M.po = idx;
    else if (!("vgm" in M) && t.startsWith("vgm")) M.vgm = idx;
    else if (!("tare" in M) && (t.startsWith("柜重") || t === "kg")) M.tare = idx;
  });
  return M;
}

// 票级元数据：r4-r6 行里的「客户名称」「目的港」「装柜日期」等。
// 仅用于 preview 展示，不写入 shipments。
function pickMeta(aoa) {
  const meta = {};
  for (let i = 0; i < Math.min(aoa.length, 10); i++) {
    const row = aoa[i] || [];
    for (let j = 0; j < row.length; j++) {
      const label = s(row[j]);
      const val = s(row[j + 1]);
      if (!val) continue;
      if (label.startsWith("客户名称")) meta.customer = val;
      else if (label.startsWith("出口国")) meta.shipper_addr = val;
      else if (label.startsWith("报关地")) meta.declare_port = val;
      else if (label.startsWith("目的港")) meta.pod = val;
      else if (label.startsWith("装柜日期")) meta.loading_date = val;
      else if (label.startsWith("报关日期")) meta.declare_date = val;
      else if (label.startsWith("PI日期") || label.toLowerCase().startsWith("pi")) meta.pi_date = val;
      else if (label.startsWith("电压") || label.startsWith("功率")) meta.power = val;
    }
  }
  return meta;
}

export async function parsePackingListFile(file) {
  if (!file) throw new Error("没有文件");
  const buf = await file.arrayBuffer();
  const XLSX = await getXLSX();
  const wb = XLSX.read(buf, { type: "array" });

  const sheetName = wb.SheetNames.find(nm => /packing|装箱/i.test(nm))
    || wb.SheetNames[0];
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
    header: 1, defval: "", raw: false, blankrows: true,
  });

  const meta = pickMeta(aoa);
  const headerIdx = findHeaderRow(aoa);
  if (headerIdx < 0) throw new Error("找不到表头行（应含「产品名称」一列）");

  const cmap = buildColMap(aoa[headerIdx] || []);

  // 数据行：从 headerIdx+1 起，遇到空 col0 或合计行（col0 空且 col3 有数）停
  const cargoLines = [];
  for (let i = headerIdx + 1; i < aoa.length; i++) {
    const row = aoa[i] || [];
    const name = s(row[cmap.product_name ?? 0]);
    if (!name) continue;  // 单位副表头（"台/箱/PCS"）或空行
    if (/^合计|^total$/i.test(name)) break;
    // 副表头：col0 通常空，"台"/"箱" 等位于 col3+；若 col0 是 "台/箱/PCS" 之类也跳
    if (/^(台|箱|pcs|kgs?|m³|usd)$/i.test(name)) continue;

    const brand = cmap.brand != null ? s(row[cmap.brand]) : "";
    const model = cmap.model != null ? s(row[cmap.model]) : "";
    const ctnNo = cmap.container_no != null ? s(row[cmap.container_no]) : "";
    const seal = cmap.seal_no != null ? s(row[cmap.seal_no]) : "";
    const qty = cmap.total_boxes != null ? n(row[cmap.total_boxes]) : null;
    const gw = cmap.total_gross != null ? n(row[cmap.total_gross]) : null;
    const vol = cmap.total_cbm != null ? n(row[cmap.total_cbm]) : null;
    const so = cmap.so != null ? s(row[cmap.so]) : "";

    // 表外的杂项行（如「电压标 / 箱唛」标签）：没有柜号也没有数量，跳过
    if (!ctnNo && qty == null && gw == null) continue;

    // 品名拼装：产品名 + 牌子 + 型号（去重空串）
    const productName = [name, brand, model].filter(Boolean).join(" ");

    cargoLines.push({
      hbl_no: so || null,  // SO 暂作 hbl，跟 SI 解析对齐；后续可由用户在分票里改
      container_no: ctnNo,
      seal_no: seal,
      container_type: null,   // PL 模板没有箱型列
      product_name_en: productName,
      hs_code: null,           // PL 无 HS
      qty,
      package_unit: "CARTONS",
      gross_weight: gw,
      volume: vol,
      marks: null,
    });
  }

  if (cargoLines.length === 0) throw new Error("解析到 0 条货物明细，请确认模板结构");
  return { meta, cargoLines };
}
