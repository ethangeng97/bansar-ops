// ============================================================================
// si-xlsx-parser.js — 解析 Excel 版 SI 补料（提单补料 / Bill of Lading Submission Form）
//
// 模板特征（与 si-doc-parser 配套，输出 { fields, extras } 同形）：
//   Sheet "SI补料"
//     r0   SO NO. | <so>
//     r2-4 Shipper 多行（col 1）
//     r5-7 Consignee 多行（col 1）
//     r9   Notify Party | <notify>
//     r14  船名(col1) | 航次(col4) | 收货地(col6)
//     r16  POL(col1)  | POD(col4) | 交货地(col6)
//     r18  Marks(col1) | 总件数(col3) | 品名(col6)
//     r27  容器表头：Container No | Seal No | Container Type | HS | Commodity | Pkgs | Unit | KGS | CBM | PO
//     r28+ 容器明细，直到出现 "TOTAL" 单行
//   Sheet " VGM "（含前后空格）
//     r12  表头：booking_no(col2) container_no(col4) seal_no(col6) type(col7) pkgs(col8) VGM(col9) tare(col10) method(col11)
//     r13+ VGM 行，按 container_no 合并到 extras.containers[].vgm_weight
//
// 输出契合 applySino56Import 的下游管线。
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

// 三行 shipper/consignee 文本：去重相邻重复行（合并单元格在某些导出器里会重复值）
function joinLines(rows) {
  const out = [];
  for (const r of rows) {
    const t = s(r);
    if (!t) continue;
    if (out[out.length - 1] !== t) out.push(t);
  }
  return out.join("\n");
}

function parseSIBuliao(aoa) {
  const fields = {};
  const extras = { containers: [], cargoLines: [] };

  // SO No. → booking_no（r0 col1，r14 col1 也有，取第一个）
  fields.booking_no = s(aoa[0]?.[1]) || s(aoa[14]?.[1]);

  // Shipper：r2-r4 col1
  fields.shipper = joinLines([aoa[2]?.[1], aoa[3]?.[1], aoa[4]?.[1]]);
  // Consignee：r6-r8 col1（r5 是 "Consignee :" 标签）
  fields.consignee = joinLines([aoa[6]?.[1], aoa[7]?.[1], aoa[8]?.[1]]);
  // Notify：r9 col1
  fields.notify_party = s(aoa[9]?.[1]);

  // 船 / 航次 / POL / POD / 交货地
  fields.vessel = s(aoa[14]?.[2]) || s(aoa[14]?.[3]);  // 模板里可能是 col2 也可能空，先取 col2，没就退 col3
  // 实际样本里 vessel 在 col1 是 SO 号重复，船名在 r14 列其实空着，618W 在 col4 是 voyage
  // 标签 r13 col3 = "Ocean Vessel/Voy No."，值跨 col2(船名) + col4(航次)
  // 重新按观察：r14 col1=so, col2 空, col3 空, col4=618W(voyage), col5 空, col6=Place of Receipt
  // 因此 vessel 在该模板里没拆出来；voyage = col4
  fields.vessel = "";  // 模板里船名往往跟 voyage 合并写在 col4，留空让用户填
  fields.voyage = s(aoa[14]?.[4]);

  // POL/POD/delivery
  fields.pol = s(aoa[16]?.[1]);
  fields.pod = s(aoa[16]?.[4]);
  const placeOfDelivery = s(aoa[16]?.[6]);
  fields.destination = placeOfDelivery || fields.pod || "";

  // Marks
  fields.marks = s(aoa[18]?.[1]) || "N/M";
  // 品名 = r18 col6（"STAND FAN"）
  fields.desc_en = s(aoa[18]?.[6]);

  // ── Container 明细行 ──
  // 表头通常在 r27（"Container No."），从 r28 起逐行直到 "TOTAL"
  let headerRow = -1;
  for (let i = 20; i < Math.min(aoa.length, 40); i++) {
    if (s(aoa[i]?.[0]).toLowerCase().includes("container no")) { headerRow = i; break; }
  }
  if (headerRow < 0) headerRow = 27;  // 兜底
  const POs = [];
  for (let i = headerRow + 1; i < aoa.length; i++) {
    const row = aoa[i] || [];
    const c0 = s(row[0]);
    if (!c0) break;
    if (/^total$/i.test(c0)) break;
    const ctnNo = c0;
    const seal = s(row[1]);
    const ctnType = s(row[2]);
    const hs = s(row[3]);
    const cmdty = s(row[4]);
    const qty = n(row[5]);
    const unit = s(row[6]) || "CARTONS";
    const gw = n(row[7]);
    const cbm = n(row[8]);
    const po = s(row[9]);
    if (po) POs.push(po);
    extras.containers.push({
      container_no: ctnNo,
      seal_no: seal,
      container_type: ctnType,
      qty,
      weight: gw,
      vgm_weight: null,  // 由 VGM sheet 合并
      volume: cbm,
    });
    extras.cargoLines.push({
      hbl_no: fields.booking_no || "",
      container_no: ctnNo,
      seal_no: seal,
      container_type: ctnType,
      product_name_en: cmdty || fields.desc_en || "",
      hs_code: hs,
      qty,
      package_unit: unit,
      gross_weight: gw,
      volume: cbm,
      marks: fields.marks,
    });
  }

  // 第一个 PO 暂存到 fields.po（per-container 的 PO 在 cargo_items 没列存，舍）
  if (POs.length) fields.po = POs[0];

  // 整票 HS Code（所有 cargo 同 HS 才填，避免覆盖）
  const hsSet = new Set(extras.cargoLines.map(c => c.hs_code).filter(Boolean));
  if (hsSet.size === 1) fields.hs_code = [...hsSet][0];

  // 箱型箱量汇总（"3x40HQ" 这种）
  const typeCount = {};
  for (const c of extras.containers) {
    if (!c.container_type) continue;
    typeCount[c.container_type] = (typeCount[c.container_type] || 0) + 1;
  }
  const qcParts = Object.entries(typeCount).map(([t, q]) => `${q}x${t}`);
  if (qcParts.length) fields.qty_container = qcParts.join(",");

  return { fields, extras };
}

function mergeVGM(aoa, extras) {
  if (!extras?.containers?.length) return;
  // 找表头行（含 "VGM"）
  let headerRow = -1;
  for (let i = 0; i < Math.min(aoa.length, 30); i++) {
    const row = aoa[i] || [];
    if (row.some(c => /VGM\s*\(KGS\)/i.test(s(c)))) { headerRow = i; break; }
  }
  if (headerRow < 0) return;
  const byCtn = new Map();
  for (let i = headerRow + 1; i < aoa.length; i++) {
    const row = aoa[i] || [];
    const ctn = s(row[4]);  // container_no
    if (!ctn) continue;
    if (/^我司|^认证|^授权|备注|remark|method/i.test(ctn)) break;
    const vgm = n(row[9]);
    if (ctn && vgm != null) byCtn.set(ctn, vgm);
  }
  for (const c of extras.containers) {
    const k = c.container_no;
    if (k && byCtn.has(k)) c.vgm_weight = byCtn.get(k);
  }
}

export async function parseSIXlsxFile(file) {
  if (!file) throw new Error("没有文件");
  const buf = await file.arrayBuffer();
  const XLSX = await getXLSX();
  const wb = XLSX.read(buf, { type: "array" });

  // 找 SI 补料 sheet（按名字）
  const siName = wb.SheetNames.find(nm => nm.includes("SI") || nm.includes("补料"))
    || wb.SheetNames[0];
  const aoa = XLSX.utils.sheet_to_json(wb.Sheets[siName], { header: 1, defval: "", raw: false, blankrows: true });
  const { fields, extras } = parseSIBuliao(aoa);

  // VGM sheet：sheet 名带空格，trim 后含 "VGM"
  const vgmName = wb.SheetNames.find(nm => nm.trim().toUpperCase().includes("VGM"));
  if (vgmName) {
    const vgmAoa = XLSX.utils.sheet_to_json(wb.Sheets[vgmName], { header: 1, defval: "", raw: false, blankrows: true });
    mergeVGM(vgmAoa, extras);
  }

  return { fields, extras };
}
