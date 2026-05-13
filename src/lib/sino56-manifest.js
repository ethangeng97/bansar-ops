// ============================================================================
// sino56-manifest.js — Sino56（中国电子口岸 56舱单系统）预配舱单 Excel 解析 / 生成
//
// Sino56 通过网页录入舱单数据，导出标准 .xls 模板（VGM + 舱单合并版）。
// 文件第一行明确写：「请勿对本文件进行任何修改」——本系统沿用相同布局，
//   一来给 ops 留存档；二来若 Sino56 后续支持 .xls 直传，可以一键上传。
//
// 文件结构（按行号）：
//   row 1 : 警告语
//   row 2 : "预配舱单 (SN Form)"
//   row 3 : 生成时间 | <ts>      | 修改地址 | <url>
//   row 4 : 船名     | <vessel>  | 航次     | <voyage> | 目的港 | <pod>
//   row 5 : 总提单号 | <mbl>     | 外运编号 | <booking>
//   row 7 : "分票统计数据"
//   row 8 : 提单号 | 英文品名 | ... | 唛头 | ... | 件数 | 包装单位 | 毛重 | 体积
//   row 9 : <每个 hbl 一行>
//   row 11: "按箱统计数据"
//   row 12: 箱号 | 封号 | 箱型 | 提单号 | 拼入件数 | ... | 单箱件数 | 单箱毛重 | 单箱体积
//   row 13: <每箱一行>
//   row 15: "总票统计数据"
//   row 16: 提单号 | 箱型箱数 | ... | 英文品名 | ...
//   row 17: <按 mbl 合并的一行>
//   row 19: "明细品名及数据"
//   row 20: 提单号 | 箱号 | 封号 | 箱型 | 英文品名 | HScode | 件数 | 包装单位 | 毛重 | 体积 | 唛头 | UN | 危险类别
//   row 21+: <每条 cargo line 一行>
//   row 23: "VGM数据"
//   row 24: 箱号 | 封号 | 箱型 | 称重方式 | VGM重量 | VGM责任方 | ... | 签名 | 邮箱 | 电话 | 称重地点
//   row 25+: <每箱一行>
//   row 27+: 发货人 / 收货人 / 通知人 三个块（代码/名称/地址/国家/电话/AEO 等）
//
// 解析返回结构 / 生成入参：
//   {
//     vessel, voyage, pod, mbl_no, booking_no,
//     containers: [{ container_no, seal_no, container_type, qty, weight, volume,
//                    vgm_method, vgm_weight, vgm_party, vgm_signer, vgm_email,
//                    vgm_phone, vgm_place }],
//     cargoLines: [{ hbl_no, container_no, seal_no, container_type,
//                    product_name_en, hs_code, qty, package_unit,
//                    gross_weight, volume, marks, un, cl }],
//     shipper:   { code, name, address, country_code, phone, aeo },
//     consignee: { code, name, address, country_code, phone, aeo, contact, contact_phone },
//     notifier:  { code, name, address, country_code, phone, aeo },
//   }
// ============================================================================

let _xlsxModulePromise = null;
async function getXLSX() {
  if (!_xlsxModulePromise) _xlsxModulePromise = import("xlsx");
  return await _xlsxModulePromise;
}

// ───────────────────────────────────────────────────────────────
// 工具：从二维数组里找标题行（如 "VGM数据" / "明细品名及数据"），
//   返回标题行索引；找不到返回 -1
// ───────────────────────────────────────────────────────────────
function findSectionRow(aoa, keyword) {
  for (let i = 0; i < aoa.length; i++) {
    const row = aoa[i] || [];
    for (const cell of row) {
      if (typeof cell === "string" && cell.includes(keyword)) return i;
    }
  }
  return -1;
}

// 拼接非空字符串
const s = (v) => (v == null ? "" : String(v).trim());
const n = (v) => {
  if (v == null || v === "") return null;
  const x = Number(String(v).replace(/,/g, ""));
  return Number.isFinite(x) ? x : null;
};

// 从「party 块」抽 6~8 个 key:value 行
// header_row 是 "发货人(Shipper)" 那一行，data 在该行后续 6~8 行内
function parsePartyBlock(aoa, headerRow) {
  if (headerRow < 0) return null;
  const out = {};
  const fieldMap = {
    "代码": "code",
    "名称": "name",
    "地址": "address",
    "国家/地区代码": "country_code",
    "电话": "phone",
    "AEO企业编码": "aeo",
    "具体联系人": "contact",
    "联系人电话": "contact_phone",
  };
  // header 行本身可能含「代码: ...」对——row[0]=「发货人(Shipper)」row[1]=「代码」row[2]=value
  for (let i = headerRow; i < Math.min(aoa.length, headerRow + 10); i++) {
    const row = aoa[i] || [];
    // 遇到下一个块标题就停（要先于字段抽取，否则会把下一个块的「代码」覆盖回当前）
    if (i > headerRow) {
      const c0 = s(row[0]);
      if (c0 && /^(发货人|收货人|通知人)/.test(c0)) break;
    }
    const label = s(row[1]);
    const value = s(row[2]);
    if (fieldMap[label] && value) out[fieldMap[label]] = value;
  }
  return Object.keys(out).length ? out : null;
}

// ───────────────────────────────────────────────────────────────
// parseSino56Manifest
// ───────────────────────────────────────────────────────────────
export async function parseSino56Manifest(arrayBuffer) {
  const XLSX = await getXLSX();
  const wb = XLSX.read(arrayBuffer, { type: "array" });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  // 转成二维数组，按空格 fill 默认值，保留所有 row（包括空行做对齐）
  const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", blankrows: true, raw: false });

  const out = {
    vessel: "", voyage: "", pod: "",
    mbl_no: "", booking_no: "",
    containers: [],
    cargoLines: [],
    shipper: null, consignee: null, notifier: null,
  };

  // 行 4：船名/航次/目的港
  for (let i = 0; i < Math.min(aoa.length, 8); i++) {
    const row = aoa[i] || [];
    for (let j = 0; j < row.length; j++) {
      const label = s(row[j]);
      const val = s(row[j + 1]);
      if (label === "船名" && val) out.vessel = val;
      else if (label === "航次" && val) out.voyage = val;
      else if (label === "目的港" && val) out.pod = val;
      else if (label === "总提单号" && val) out.mbl_no = val;
      else if (label === "外运编号" && val) out.booking_no = val;
    }
  }

  // 「按箱统计数据」：用作 container 基础信息（拿件数/毛重/体积）
  const ctnSectionRow = findSectionRow(aoa, "按箱统计数据");
  const ctnByNo = new Map();
  if (ctnSectionRow >= 0) {
    // 标题行 = ctnSectionRow + 1；数据从 ctnSectionRow + 2 开始
    for (let i = ctnSectionRow + 2; i < aoa.length; i++) {
      const row = aoa[i] || [];
      const c0 = s(row[0]);
      if (!c0) break;  // 空行 → 段结束
      // 列: 0=箱号 1=封号 2=箱型 3=提单号 4=拼入件数 5='' 6=拼入毛重 7='' 8=拼入体积 9='' 10=单箱件数 11=单箱毛重 12=单箱体积
      ctnByNo.set(c0, {
        container_no: c0,
        seal_no: s(row[1]),
        container_type: s(row[2]),
        qty: n(row[10] ?? row[4]),
        weight: n(row[11] ?? row[6]),
        volume: n(row[12] ?? row[8]),
      });
    }
  }

  // 「VGM数据」：合并到 container
  const vgmSectionRow = findSectionRow(aoa, "VGM数据");
  if (vgmSectionRow >= 0) {
    for (let i = vgmSectionRow + 2; i < aoa.length; i++) {
      const row = aoa[i] || [];
      const c0 = s(row[0]);
      if (!c0) break;
      // 列: 0=箱号 1=封号 2=箱型 3=称重方式 4=VGM重量 5=VGM责任方 6,7='' 8=签名 9=邮箱 10='' 11=电话 12=称重地点
      const existing = ctnByNo.get(c0) || { container_no: c0, seal_no: s(row[1]), container_type: s(row[2]) };
      existing.vgm_method = s(row[3]);
      existing.vgm_weight = n(row[4]);
      existing.vgm_party = s(row[5]);
      existing.vgm_signer = s(row[8]);
      existing.vgm_email = s(row[9]);
      existing.vgm_phone = s(row[11]);
      existing.vgm_place = s(row[12]);
      ctnByNo.set(c0, existing);
    }
  }
  out.containers = Array.from(ctnByNo.values());

  // 「明细品名及数据」：cargo lines
  const cargoSectionRow = findSectionRow(aoa, "明细品名及数据");
  if (cargoSectionRow >= 0) {
    for (let i = cargoSectionRow + 2; i < aoa.length; i++) {
      const row = aoa[i] || [];
      const c0 = s(row[0]);
      if (!c0) break;
      // 列: 0=提单号 1=箱号 2=封号 3=箱型 4=英文品名 5=HScode 6=件数 7=包装单位 8=毛重 9=体积 10=唛头 11=UN 12=类别
      out.cargoLines.push({
        hbl_no: c0,
        container_no: s(row[1]),
        seal_no: s(row[2]),
        container_type: s(row[3]),
        product_name_en: s(row[4]),
        hs_code: s(row[5]),
        qty: n(row[6]),
        package_unit: s(row[7]) || "CARTONS",
        gross_weight: n(row[8]),
        volume: n(row[9]),
        marks: s(row[10]),
        un: s(row[11]),
        cl: s(row[12]),
      });
    }
  }

  // Party 块
  out.shipper = parsePartyBlock(aoa, findSectionRow(aoa, "发货人(Shipper)"));
  out.consignee = parsePartyBlock(aoa, findSectionRow(aoa, "收货人(Consignee)"));
  out.notifier = parsePartyBlock(aoa, findSectionRow(aoa, "通知人(Notifier)"));

  return out;
}

// ───────────────────────────────────────────────────────────────
// 把解析结果摊平成「主字段 + extras」给 onApply 用，
//   语义跟 BLImportModal 对齐
// ───────────────────────────────────────────────────────────────
export function flattenSino56ForApply(data) {
  const fields = {
    vessel: data.vessel || undefined,
    voyage: data.voyage || undefined,
    pod: data.pod || undefined,
    mbl_no: data.mbl_no || undefined,
    booking_no: data.booking_no || undefined,
  };
  // 第一箱用作分票主字段
  const c0 = (data.containers || [])[0];
  if (c0) {
    fields.container_no = c0.container_no;
    fields.seal_no = c0.seal_no;
    if (c0.qty != null) fields.qty_packages = c0.qty;
    if (c0.weight != null) fields.weight = c0.weight;
    if (c0.volume != null) fields.volume = c0.volume;
  }
  // shipper / consignee / notify_party：把名称+地址拼成多行文本
  const partyText = (p) => p ? [p.name, p.address, p.country_code && `Country: ${p.country_code}`, p.phone && `Tel: ${p.phone}`].filter(Boolean).join("\n") : "";
  if (data.shipper) fields.shipper = partyText(data.shipper);
  if (data.consignee) fields.consignee = partyText(data.consignee);
  if (data.notifier) fields.notify_party = partyText(data.notifier);
  // 第一条 cargo line 的品名做 description 兜底
  const cl0 = (data.cargoLines || [])[0];
  if (cl0?.product_name_en) {
    fields.description = cl0.product_name_en;
    if (cl0.hs_code) fields.hs_code = cl0.hs_code;
    if (cl0.marks) fields.marks = cl0.marks;
  }

  const extras = {
    containers: data.containers || [],
    cargoLines: data.cargoLines || [],
  };
  return { fields, extras };
}

// ───────────────────────────────────────────────────────────────
// buildSino56Manifest — 把 ops 数据按 Sino56 布局拼成 .xls
// data 形参同 parse 出参；缺字段用空串占位即可
// ───────────────────────────────────────────────────────────────
export async function buildSino56Manifest(data) {
  const XLSX = await getXLSX();
  const containers = data.containers || [];
  const cargoLines = data.cargoLines || [];

  // 分票合计（按 hbl_no group cargo lines）
  const byHbl = new Map();
  for (const cl of cargoLines) {
    const k = cl.hbl_no || data.mbl_no || "";
    if (!byHbl.has(k)) byHbl.set(k, { hbl_no: k, names: new Set(), marks: new Set(), qty: 0, weight: 0, volume: 0, package_unit: "" });
    const g = byHbl.get(k);
    if (cl.product_name_en) g.names.add(cl.product_name_en);
    if (cl.marks) g.marks.add(cl.marks);
    g.qty += Number(cl.qty || 0);
    g.weight += Number(cl.gross_weight || 0);
    g.volume += Number(cl.volume || 0);
    if (!g.package_unit && cl.package_unit) g.package_unit = cl.package_unit;
  }

  // 箱型箱数：按 container_type group containers
  const typeCount = new Map();
  for (const c of containers) {
    const k = c.container_type || "";
    typeCount.set(k, (typeCount.get(k) || 0) + 1);
  }
  const ctnSummary = Array.from(typeCount.entries()).map(([t, c]) => `${t} x ${c};`).join(" ");

  // 总票合计
  let totalQty = 0, totalWeight = 0, totalVolume = 0;
  let totalNames = new Set(), totalMarks = new Set(), totalUnit = "";
  for (const cl of cargoLines) {
    totalQty += Number(cl.qty || 0);
    totalWeight += Number(cl.gross_weight || 0);
    totalVolume += Number(cl.volume || 0);
    if (cl.product_name_en) totalNames.add(cl.product_name_en);
    if (cl.marks) totalMarks.add(cl.marks);
    if (!totalUnit && cl.package_unit) totalUnit = cl.package_unit;
  }

  const now = new Date();
  const ts = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;

  const aoa = [];
  // row 0：警告语
  aoa.push(["请勿对本文件进行任何修改，以免后续导入系统出错。若需修改，请点击修改地址，进入网页修改，重新导出即可。"]);
  // row 1：标题
  aoa.push(["预配舱单 (SN Form)"]);
  // row 2：生成时间 / 修改地址
  aoa.push(["生成时间", ts, "", "修改地址", ""]);
  // row 3：船名 / 航次 / 目的港
  aoa.push(["船名", data.vessel || "", "", "航次", data.voyage || "", "", "目的港", data.pod || ""]);
  // row 4：总提单号 / 外运编号
  aoa.push(["总提单号", data.mbl_no || "", "", "外运编号", data.booking_no || ""]);
  // row 5：空
  aoa.push([]);
  // row 6：分票统计数据
  aoa.push(["分票统计数据 - (系统自动合成)"]);
  aoa.push(["提单号", "", "英文品名", "", "", "", "唛头", "", "", "件数", "包装单位", "毛重(KGS)", "体积(CBM)"]);
  for (const g of byHbl.values()) {
    aoa.push([g.hbl_no, "", Array.from(g.names).join(" / "), "", "", "", Array.from(g.marks).join(" / ") || "N/M", "", "",
              g.qty || "", g.package_unit || "CARTONS", g.weight || "", g.volume || ""]);
  }
  // 空 + 按箱统计数据
  aoa.push([]);
  aoa.push(["按箱统计数据 - (系统自动合成)"]);
  aoa.push(["箱号", "封号", "箱型", "提单号", "拼入件数", "", "拼入毛重", "", "拼入体积", "", "单箱件数", "单箱毛重", "单箱体积"]);
  for (const c of containers) {
    aoa.push([c.container_no || "", c.seal_no || "", c.container_type || "",
              data.mbl_no || "", c.qty || "", "", c.weight || "", "", c.volume || "", "",
              c.qty || "", c.weight || "", c.volume || ""]);
  }
  // 空 + 总票统计数据
  aoa.push([]);
  aoa.push(["总票统计数据 - (系统自动合成)"]);
  aoa.push(["提单号", "箱型箱数", "", "英文品名", "", "", "唛头", "", "", "件数", "包装单位", "毛重(KGS)", "体积(CBM)"]);
  aoa.push([data.mbl_no || "", ctnSummary, "", Array.from(totalNames).join(" / "), "", "",
            Array.from(totalMarks).join(" / ") || "N/M", "", "",
            totalQty || "", totalUnit || "CARTONS", totalWeight || "", totalVolume || ""]);
  // 空 + 明细品名及数据
  aoa.push([]);
  aoa.push(["明细品名及数据"]);
  aoa.push(["提单号", "箱号", "封号", "箱型", "英文品名", "10位HScode", "件数", "包装单位", "毛重(KGS)", "体积(CBM)", "唛头", "UN Code(危)", "类别(危)"]);
  for (const cl of cargoLines) {
    aoa.push([cl.hbl_no || data.mbl_no || "", cl.container_no || "", cl.seal_no || "", cl.container_type || "",
              cl.product_name_en || "", cl.hs_code || "", cl.qty || "", cl.package_unit || "CARTONS",
              cl.gross_weight || "", cl.volume || "", cl.marks || "", cl.un || "", cl.cl || ""]);
  }
  // 空 + VGM 数据
  aoa.push([]);
  aoa.push(["VGM数据"]);
  aoa.push(["箱号", "封号", "箱型", "称重方式", "VGM重量", "VGM责任方", "", "", "责任人签名", "VGM邮箱", "", "VGM电话", "称重地点"]);
  for (const c of containers) {
    aoa.push([c.container_no || "", c.seal_no || "", c.container_type || "",
              c.vgm_method || "", c.vgm_weight || "", c.vgm_party || "",
              "", "", c.vgm_signer || "", c.vgm_email || "", "", c.vgm_phone || "", c.vgm_place || ""]);
  }
  // 空 + 三个 party 块
  for (const [label, p] of [
    ["发货人(Shipper)", data.shipper],
    ["收货人(Consignee)", data.consignee],
    ["通知人(Notifier)", data.notifier],
  ]) {
    aoa.push([]);
    const pp = p || {};
    aoa.push([label, "代码", pp.code || ""]);
    aoa.push(["", "名称", pp.name || ""]);
    aoa.push(["", "地址", pp.address || ""]);
    aoa.push(["", "国家/地区代码", pp.country_code || ""]);
    aoa.push(["", "电话", pp.phone || ""]);
    aoa.push(["", "AEO企业编码", pp.aeo || ""]);
    if (label.startsWith("收货人")) {
      aoa.push(["", "具体联系人", pp.contact || ""]);
      aoa.push(["", "联系人电话", pp.contact_phone || ""]);
    }
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[]]), "Sheet2");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[]]), "Sheet3");

  // 输出为 .xls（BIFF8）— Sino56 模板格式
  const arrayBuffer = XLSX.write(wb, { type: "array", bookType: "biff8" });
  return arrayBuffer;
}

// 浏览器下载
export function downloadArrayBufferAsXls(buf, filename) {
  const blob = new Blob([buf], { type: "application/vnd.ms-excel" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
