// ============================================================================
// si-doc-parser.js — 解析 一代/客户发来的 .doc 格式 Shipping Information / SI
//
// 适用模板：标题 "SHIPPING INFORMATION"，含 SO 号/Shipper/Consignee/Notify/POL/
// POD/箱型/HS/品名/运费条款/Release Type/Container 表格 等字段（参考样本：
// SI 2026USAA02-10 181AN26A1052303S1 PO-180326129.doc）。
//
// 解析思路：
//   1) .doc 是 OLE Compound File V2。借 xlsx 自带的 CFB 读 "WordDocument" 流
//   2) 流里文档正文以 UTF-16 LE 存，逐 2 字节取可打印 Unicode 字符
//   3) 用 regex 在提取出的纯文本上抽字段
//
// 返回结构与 Sino56 parser 接近，便于复用 applySIDocImport handler。
// ============================================================================
let _xlsxPromise = null;
async function getXLSX() {
  if (!_xlsxPromise) _xlsxPromise = import("xlsx");
  const m = await _xlsxPromise;
  return m.default || m;
}

// ── 1. 提取 WordDocument 流的可打印文本 ─────────────────────────
async function extractWordDocText(arrayBuffer) {
  const XLSX = await getXLSX();
  const cfb = XLSX.CFB.read(new Uint8Array(arrayBuffer), { type: "array" });
  const entry = cfb.FileIndex.find(f => f && f.name === "WordDocument");
  if (!entry) throw new Error("不是 Word .doc 文件（缺 WordDocument 流）");
  const buf = entry.content;
  let out = "";
  for (let i = 0; i < buf.length - 1; i += 2) {
    const code = buf[i] | (buf[i + 1] << 8);
    if (code === 0x000d || code === 0x000a) out += "\n";
    else if (code === 0x0009) out += "\t";
    else if (code >= 0x20 && code <= 0x7e) out += String.fromCharCode(code);
    else if (code >= 0x3000 && code <= 0x9fff) out += String.fromCharCode(code);
    else if (code >= 0xff00 && code <= 0xffef) out += String.fromCharCode(code);
    else out += " "; // 控制字符 / 格式标记 → 当分隔符
  }
  // 多空白合并
  return out.replace(/[ \t]+/g, " ").replace(/\n+/g, "\n").trim();
}

// ── 2. regex 抽字段 ─────────────────────────────────────────────
// 大部分字段是 "<英文label>\n<中文label>：value" 或 "<label>：value" 的形式
function pickBetween(text, startMatch, endMatchOrEnd) {
  const startRe = new RegExp(startMatch, "i");
  const sm = text.match(startRe);
  if (!sm) return "";
  const startIdx = sm.index + sm[0].length;
  let endIdx = text.length;
  if (endMatchOrEnd) {
    const endRe = new RegExp(endMatchOrEnd, "i");
    const remainder = text.slice(startIdx);
    const em = remainder.match(endRe);
    if (em) endIdx = startIdx + em.index;
  }
  return text.slice(startIdx, endIdx).trim();
}

function parseSIDocText(text) {
  const fields = {};
  const extras = { containers: [], cargoLines: [] };

  // SO No. → booking_no
  fields.booking_no = pickBetween(text, "\\bSO[：:]\\s*", "\\s*Shipper\\b").trim();
  // 船名/航次（样本里空，可有）
  const vessel = pickBetween(text, "船名\\s*/\\s*航次[：:]?\\s*", "\\s*SO[：:]");
  if (vessel) fields.vessel = vessel;

  // Shipper
  fields.shipper = pickBetween(text, "Shipper\\s*\\n?发货人[：:]?\\s*\\n?", "\\s*Consignee\\b");
  // Consignee
  fields.consignee = pickBetween(text, "Consignee\\s*\\n?收货人[：:]?\\s*\\n?", "\\s*Notify\\s+party\\b");
  // Notify
  fields.notify_party = pickBetween(text, "Notify\\s+party\\s*\\n?通知人[：:]?\\s*\\n?", "\\s*Port\\s+Of\\s+Loading\\b");

  // POL / POD
  fields.pol = pickBetween(text, "Port\\s+Of\\s+Loading\\s*起运港口[：:]?\\s*", "\\s*Port\\s+Of\\s+Discharge").trim();
  fields.pod = pickBetween(text, "Port\\s+Of\\s+Discharge\\s*目的港[：:]?\\s*", "\\s*箱型和箱量").trim();
  // 通常目的地 = POD
  if (fields.pod) fields.destination = fields.pod.split(/[;,]/)[0].trim();

  // 箱型箱量
  const ctnRaw = pickBetween(text, "箱型和箱量[：:]?\\s*", "\\s*商品编号").trim();
  // 形如 "CONTAINER 1*40HQ"
  const ctnMatch = ctnRaw.match(/CONTAINER\s*(\d+\s*[*x×]\s*\w+)/i);
  if (ctnMatch) fields.qty_container = ctnMatch[1].replace(/\s/g, "").toUpperCase().replace(/[*×]/g, "x");
  else if (ctnRaw) fields.qty_container = ctnRaw.replace(/CONTAINER\s*/i, "").trim();

  // HS Code
  const hsMatch = text.match(/商品编号\s*\(HS\s*CODE\)\s*([0-9]+)/i);
  if (hsMatch) fields.hs_code = hsMatch[1];

  // Marks
  fields.marks = pickBetween(text, "Mark\\s*唛头[:：]?\\s*", "\\s*Description").trim() || "N/M";

  // 品名 → 拆 PO 和品名
  const desc = pickBetween(text, "Description\\s+of\\s+Goods\\s*\\n?品名[：:]?\\s*", "\\s*运费条款").trim();
  // 格式可能：" PO-180326129 | SCHALLEN 18INCH ..." 或多行
  if (desc) {
    const poMatch = desc.match(/PO[-#]?\s*([0-9A-Z]+)/i);
    if (poMatch) fields.po = poMatch[1];
    const descNoPO = desc.replace(/PO[-#]?\s*[0-9A-Z]+\s*\|?\s*/i, "").trim();
    if (descNoPO) fields.desc_en = descNoPO;
  }

  // 运费条款 → payment_terms
  const freight = pickBetween(text, "FREIGHT\\s+CLAUSE\\s*", "\\s*Original\\b").trim();
  if (/COLLECT/i.test(freight)) fields.payment_terms = "COLLECT";
  else if (/PREPAID/i.test(freight)) fields.payment_terms = "PREPAID";

  // BL Type
  const blTypeRaw = pickBetween(text, "Original\\s*\\/\\s*telex\\s+release\\s*\\/\\s*WAYBILL\\s*", "\\s*REMARK\\b").trim();
  if (/telex/i.test(blTypeRaw)) fields.bl_type = "TLX RELEASE";
  else if (/waybill/i.test(blTypeRaw)) fields.bl_type = "SEAWAY";
  else if (/original/i.test(blTypeRaw)) fields.bl_type = "ORIGINAL";

  // Container 行：在 "总计" 之前，"REMARK:" 之后 的表格行
  //  柜号 / 封号 / 箱数 / 毛重 / VGM / 体积
  // 标准每行类似："MSDU8631759 FJ27558173 1092 5350.8 9190.8 68"
  const afterHeader = (text.split(/体积\s*\n?\(?CBM\)?/i)[1] || text.split(/REMARK[:：]/i)[1] || "");
  const beforeTotal = afterHeader.split(/总计/)[0] || afterHeader;
  // 一行典型：箱号(字母+数字 8-12 位) 封号 件数 毛重 VGM 体积
  const rowRe = /([A-Z]{3,4}\d{6,8})\s+([A-Z0-9-]{4,})\s+(\d+)\s+(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)?\s+(\d+(?:\.\d+)?)?/gi;
  let m;
  while ((m = rowRe.exec(beforeTotal))) {
    const cno = m[1];
    const seal = m[2];
    const pkg = parseInt(m[3]) || null;
    const gw = parseFloat(m[4]) || null;
    // 有的模板把 VGM 和体积顺序换，简单处理：第 5 个 = VGM，第 6 个 = 体积；如果第 6 个比第 5 个明显小（体积通常 ≤ VGM），就保留这个解读
    const vgm = m[5] ? parseFloat(m[5]) : null;
    const vol = m[6] ? parseFloat(m[6]) : null;
    // 把 qty_container 里的 40HQ 拆 size/type
    const ctnTypeRaw = (fields.qty_container || "").replace(/^\d+x/, "");
    const sizeMatch = ctnTypeRaw.match(/^(\d{2})(\w+)$/);
    extras.containers.push({
      container_no: cno,
      seal_no: seal,
      container_type: ctnTypeRaw,
      qty: pkg,
      weight: gw,
      vgm_weight: vgm,
      volume: vol,
      ...(sizeMatch ? { container_size: sizeMatch[1], container_type_clean: sizeMatch[2] } : {}),
    });
    extras.cargoLines.push({
      hbl_no: fields.booking_no || "",
      container_no: cno,
      seal_no: seal,
      container_type: ctnTypeRaw,
      product_name_en: fields.desc_en || "",
      hs_code: fields.hs_code || "",
      qty: pkg,
      package_unit: "CARTONS",
      gross_weight: gw,
      volume: vol,
    });
  }

  return { fields, extras, rawText: text };
}

export async function parseSIDocFile(file) {
  if (!file) throw new Error("没有文件");
  const buf = await file.arrayBuffer();
  // 简单 magic 检查：CFB 文件以 D0 CF 11 E0 A1 B1 1A E1 开头
  const head = new Uint8Array(buf, 0, 8);
  const magic = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
  for (let i = 0; i < 8; i++) {
    if (head[i] !== magic[i]) {
      throw new Error("不是 .doc 文件（请用 Word 97-2003 .doc，非 .docx）");
    }
  }
  const text = await extractWordDocText(buf);
  return parseSIDocText(text);
}
