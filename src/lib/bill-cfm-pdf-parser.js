// ============================================================================
// bill-cfm-pdf-parser.js — 解析货代发的「费用确认单 PDF」
//
// 当前覆盖模板：
//   · 安俐达物流(上海) — "费用确认单"，单 RMB 货币、9 列表格（费用名/币种/数量/金额/含税单价/不含税单价）
//
// 思路：
//   1) 用 pdfjs-dist 拿 page1 的 textContent.items（带 x/y/width/height）
//   2) 按 y 聚成行；每行按 x 排序
//   3) 头部字段：扫"主单号 / 分单号 / Job No / 船名航次 / 起运港 / 目的港 / 开航日 / SO NO" 等 label
//   4) 表格行：识别"费用名 RMB|USD <数字> ..."模式
//
// 输出：{ partner_name, header, charges, raw } 供 ChargeImportModal 转 drafts 用
// ============================================================================

let _pdfjsPromise = null;
async function getPdfjs() {
  if (!_pdfjsPromise) {
    _pdfjsPromise = (async () => {
      const pdfjs = await import("pdfjs-dist");
      const workerUrl = (await import("pdfjs-dist/build/pdf.worker.mjs?url")).default;
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      return pdfjs;
    })();
  }
  return _pdfjsPromise;
}

const n = (v) => {
  if (v == null || v === "") return null;
  const x = Number(String(v).replace(/[,\s¥￥$]/g, ""));
  return Number.isFinite(x) ? x : null;
};

// 把 textContent.items 按 y 坐标聚成行
function itemsToRows(items) {
  const rows = [];
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const y = Math.round(it.transform[5]);  // y is transform[5]
    const x = it.transform[4];
    // 同一行：y 差距 < 3 像素就归并
    let row = rows.find(r => Math.abs(r.y - y) < 3);
    if (!row) {
      row = { y, items: [] };
      rows.push(row);
    }
    row.items.push({ x, text: it.str });
  }
  // 按 y 倒序（PDF 坐标系 y 从下往上，文档顺序 = y 大到小）
  rows.sort((a, b) => b.y - a.y);
  for (const r of rows) r.items.sort((a, b) => a.x - b.x);
  return rows;
}

// 找到表头行（含"费用名称"）和合计行（含"合计:"）的 index
function findTableBounds(rows) {
  let headerIdx = -1, totalIdx = -1;
  for (let i = 0; i < rows.length; i++) {
    const txt = rows[i].items.map(it => it.text).join(" ");
    if (headerIdx < 0 && /费用名称/.test(txt) && /币种/.test(txt)) headerIdx = i;
    if (totalIdx < 0 && /合\s*计\s*[:：]/.test(txt)) totalIdx = i;
    if (headerIdx >= 0 && totalIdx > headerIdx) break;
  }
  return { headerIdx, totalIdx };
}

// 从一行的 items 里抽：第一段中文/英文 = 费用名；后面找币种 + 第一个数字 = 总金额
function parseChargeRow(row, knownCurrencies) {
  const items = row.items;
  if (items.length === 0) return null;
  // 找币种位置
  let currencyIdx = -1, currency = null;
  for (let i = 0; i < items.length; i++) {
    const t = items[i].text.trim().toUpperCase();
    if (knownCurrencies.has(t)) { currencyIdx = i; currency = t; break; }
  }
  if (currencyIdx < 0) return null;

  // 费用名：币种之前的所有 item 文本拼接
  const name = items.slice(0, currencyIdx).map(it => it.text).join("").trim();
  if (!name) return null;

  // 币种之后的数字：第一个 = 含税单价、第二个 = 不含税单价、第三个 = 数量、第四个 = 总金额
  // 但很多模板把这几列宽度不一，最稳的办法是取"最右边那个数字"作为总金额
  const nums = items.slice(currencyIdx + 1)
    .map(it => ({ x: it.x, val: n(it.text) }))
    .filter(o => o.val != null);
  if (nums.length === 0) return null;
  nums.sort((a, b) => a.x - b.x);

  const last = nums[nums.length - 1];
  // 数量：含 "1" / 整数（不超过 1000）且不是最后一列的数字。模板上通常是 1。
  let qty = 1;
  const qtyCandidate = nums.length >= 2 ? nums[nums.length - 2] : null;
  if (qtyCandidate && Number.isInteger(qtyCandidate.val) && qtyCandidate.val > 0 && qtyCandidate.val < 1000) {
    qty = qtyCandidate.val;
  }
  // 单价：last.val / qty
  const unitPrice = qty > 0 ? +(last.val / qty).toFixed(4) : last.val;

  return {
    name,
    currency,
    quantity: qty,
    unit_price: unitPrice,
    total: last.val,
  };
}

// 从行集合里抽头部字段（主单号 / Job No / 船名 / 起运港 / 目的港 / 开航日 / SO NO 等）
function parseHeader(rows) {
  const text = rows.slice(0, 25).map(r => r.items.map(it => it.text).join(" ")).join("\n");
  const out = {};
  const pick = (re) => {
    const m = text.match(re);
    return m ? m[1].trim() : null;
  };
  out.mbl_no = pick(/主单号\s*[:：]?\s*([A-Z0-9-]+)/i);
  out.hbl_no = pick(/分单号\s*[:：]?\s*([A-Z0-9-]+)/i);
  out.job_no = pick(/Job\s*No\s*[:：]?\s*([A-Z0-9-]+)/i);
  out.vessel_voyage = pick(/船名航次\s*[:：]?\s*([^\n]+?)\s*开航日/i);
  out.pol = pick(/起运港\s*[:：]?\s*([A-Z ]+?)\s*(?:目的港|$)/);
  out.pod = pick(/目的港\s*[:：]?\s*([A-Z ]+?)\s*(?:件数|箱量|船名|$)/);
  out.etd = pick(/开航日\s*[:：]?\s*([\d-]+)/);
  out.so_no = pick(/SO\s*NO\s*[:：]?\s*([A-Z0-9]+)/i);
  out.total_text = pick(/合\s*计\s*[:：]\s*([^\n]+)/);
  // 提取合计的数字（如 "RMB3,955.00"）
  const totalNumMatch = (out.total_text || text).match(/(?:RMB|USD|CNY)?\s*([\d,]+\.\d{2})/);
  if (totalNumMatch) out.total_amount = n(totalNumMatch[1]);
  return out;
}

// 识别 partner_name：扫前 8 行找"XXX 有限公司 / Co\.,? ?Ltd"
function parsePartner(rows) {
  for (let i = 0; i < Math.min(rows.length, 12); i++) {
    const txt = rows[i].items.map(it => it.text).join("").trim();
    // 首选：以"有限公司"结尾且不是"贵司"
    if (/有限公司$/.test(txt) && !/贵司|发票/.test(txt)) return txt;
  }
  return null;
}

export async function parseBillCfmPdf(file) {
  if (!file) throw new Error("没有文件");
  const buf = await file.arrayBuffer();
  const pdfjs = await getPdfjs();
  // cMapUrl 指向 public/pdfjs-cmaps/（由 predev/prebuild 从 node_modules 拷过去）
  // 没它会读不出 CJK 字符，整个 PDF 解出来都是空字符串
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buf),
    isEvalSupported: false,
    cMapUrl: "/pdfjs-cmaps/",
    cMapPacked: true,
  }).promise;

  const allRows = [];
  for (let pg = 1; pg <= doc.numPages; pg++) {
    const page = await doc.getPage(pg);
    const content = await page.getTextContent();
    allRows.push(...itemsToRows(content.items));
  }

  // 整体按 y 倒序（已经在 itemsToRows 内做了，但跨页要再排一次；page1 优先）
  // 这里简化处理：单页 PDF 已经够用；多页时按页内顺序
  const header = parseHeader(allRows);
  const partner_name = parsePartner(allRows);

  const { headerIdx, totalIdx } = findTableBounds(allRows);
  const charges = [];
  const currencies = new Set(["RMB", "USD", "CNY", "EUR", "JPY", "HKD"]);
  if (headerIdx >= 0) {
    const end = totalIdx > headerIdx ? totalIdx : allRows.length;
    for (let i = headerIdx + 1; i < end; i++) {
      const c = parseChargeRow(allRows[i], currencies);
      if (c) charges.push(c);
    }
  }

  return { partner_name, header, charges, raw: allRows };
}
