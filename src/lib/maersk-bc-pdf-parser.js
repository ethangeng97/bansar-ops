// ============================================================================
// maersk-bc-pdf-parser.js — 解析 Maersk "BOOKING CONFIRMATION" PDF
//
// 思路：取所有 page 的 textContent 拼成一大段文本，然后用 regex 抽字段
// (Maersk 的 PDF 模板字段位置稳定，文本顺序也稳定，不用按 x/y 切位)
//
// 输出：{ ok, data: {...spot_bookings 字段}, raw } 给 SpotBookingImportModal 用
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

// 简化港口名：剥掉 terminal 后缀 + 按逗号切只取第一段
//   "Ningbo,Zhejiang,China" → "NINGBO"
//   "London Gateway Terminal" → "LONDON GATEWAY"
function simplifyPort(s) {
  if (!s) return "";
  return s
    .split(",")[0]                          // 去省/国
    .replace(/\s*Terminal\b/i, "")          // 去 Terminal
    .replace(/\s+Meishan\b/i, "")           // Ningbo Meishan → Ningbo
    .trim()
    .toUpperCase();
}

// 解析 Maersk 给的"40 DRY 9 6" 格式
//   尺寸: 第一个数字（20/40/45）
//   箱型: DRY → HC(若高度=9'6") 或 GP(若 8'6")；REEFER → RF
function parseCntr(token) {
  if (!token) return { size: null, type: null };
  const m = token.match(/(\d{2,3})\s+(DRY|REEFER|FLAT|OPEN)\s+(\d+)\s*(\d+)?/i);
  if (!m) return { size: null, type: null };
  const size = m[1];
  const kind = m[2].toUpperCase();
  const feet = parseInt(m[3], 10);
  if (kind === "REEFER") return { size, type: "RF" };
  if (kind === "FLAT")   return { size, type: "FR" };
  if (kind === "OPEN")   return { size, type: "OT" };
  // DRY: 9 feet = HC, 8 feet = GP
  return { size, type: feet >= 9 ? "HC" : "GP" };
}

// 把"2026-06-20" / "2026/06/20" → "2026-06-20"
function normDate(s) {
  if (!s) return null;
  const m = s.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!m) return null;
  return `${m[1]}-${String(m[2]).padStart(2,"0")}-${String(m[3]).padStart(2,"0")}`;
}

// "2026-06-13 00:00" → "2026-06-13T00:00:00.000Z" (本地时区当 UTC 处理，足够给 datetime-local 用)
function normDateTime(date, time) {
  if (!date) return null;
  const d = normDate(date);
  if (!d) return null;
  const t = (time || "00:00").match(/(\d{1,2}):(\d{2})/);
  const hh = t ? String(t[1]).padStart(2,"0") : "00";
  const mm = t ? t[2] : "00";
  return new Date(`${d}T${hh}:${mm}:00`).toISOString();
}

export async function parseMaerskBC(file) {
  const pdfjs = await getPdfjs();
  const buf = await file.arrayBuffer();
  const doc = await pdfjs.getDocument({ data: buf }).promise;

  // 1. 把所有 page 的文本按出现顺序拼成一个数组 (保留串)
  // 关键：pdfjs 对字间距大的字体会把每个字母拆成单独 item，
  // 不能无脑空格 join。要看 x+width 间距判断该不该补空格。
  const lines = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const rows = new Map();
    for (const it of content.items) {
      if (!it.str) continue;
      const y = Math.round(it.transform[5]);
      const x = it.transform[4];
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push({ x, width: it.width || 0, text: it.str, hasEOL: it.hasEOL });
    }
    const ys = [...rows.keys()].sort((a, b) => b - a);
    for (const y of ys) {
      const row = rows.get(y).sort((a, b) => a.x - b.x);
      // 平均字符宽度，用来判断间距阈值
      const avgCharW = (() => {
        let totalW = 0, totalC = 0;
        for (const r of row) { if (r.text.trim()) { totalW += r.width; totalC += r.text.length; } }
        return totalC > 0 ? totalW / totalC : 5;
      })();
      const gapThreshold = avgCharW * 0.5;  // gap > 半个字符宽 = 真空格
      let acc = "";
      let prevEnd = null;
      for (const r of row) {
        if (!r.text.length) continue;
        // 全空串（pdfjs 有时把"空格" item 独立出来）—— 当成确定的空格
        if (!r.text.trim()) {
          if (acc && !acc.endsWith(" ")) acc += " ";
          prevEnd = r.x + r.width;
          continue;
        }
        if (prevEnd !== null) {
          const gap = r.x - prevEnd;
          if (gap > gapThreshold) acc += " ";
        }
        acc += r.text;
        prevEnd = r.x + r.width;
      }
      acc = acc.replace(/\s+/g, " ").trim();
      if (acc) lines.push(acc);
    }
  }
  const fullText = lines.join("\n");

  // 校验是不是 Maersk BC
  if (!/BOOKING CONFIRMATION/i.test(fullText) || !/MAERSK/i.test(fullText)) {
    return { ok: false, error: "看起来不是 Maersk BOOKING CONFIRMATION PDF" };
  }

  const out = {
    carrier: "MAERSK",
    status: "可售",
    currency: "USD",
  };

  // ───────────────── 字段抽取 ─────────────────
  // Booking No —— label 跟 number 可能在同一行也可能下一行
  let m = fullText.match(/Booking\s*No\.?:?\s*(\d{6,})/i);
  if (m) {
    out.booking_no = m[1];
  } else {
    // label 行没数字，找 label 行的下一个含 6+ 位数字的行
    const idx = lines.findIndex(l => /Booking\s*No/i.test(l));
    if (idx >= 0) {
      for (let j = idx; j < Math.min(idx + 3, lines.length); j++) {
        const dm = lines[j].match(/\b(\d{8,})\b/);
        if (dm) { out.booking_no = dm[1]; break; }
      }
    }
  }

  // 合约号 / 合约客户 → 备注里留痕
  const contractNo = (fullText.match(/合约号[:：]\s*(\S+)/) || [])[1] || "";
  const contractCust = (fullText.match(/合约客户[:：]\s*([^\n]+?)(?:\s*受理订舱|\n)/) || [])[1] || "";

  // POL / POD：从"收货地: xxx" / "交货地: xxx" 抽
  const pol = (fullText.match(/收货地[:：]\s*([^\n]+?)(?:\s*交货地|\n)/) || [])[1] || "";
  const pod = (fullText.match(/交货地[:：]\s*([^\n]+)/) || [])[1] || "";
  if (pol) out.pol = simplifyPort(pol);
  if (pod) out.pod = simplifyPort(pod);

  // 船名 / 航次 / ETD / ETA — 出现在"预期运输计划"那一行，行内顺序：
  //   出发 到达 运输方式 船名 航次 预计出发日期 预计到达日期
  // 实际数据行例："Ningbo Meishan Terminal London Gateway Terminal MVS MUNKEBO MAERSK 624W 2026-06-20 2026-07-25"
  // 用 date 倒着找 ETA + ETD
  m = fullText.match(/(\d{4}-\d{1,2}-\d{1,2})\s+(\d{4}-\d{1,2}-\d{1,2})(?=\s|$)/);
  if (m) {
    out.etd = normDate(m[1]);
    out.eta = normDate(m[2]);
  }

  // 船名 + 航次 — 用 ETD 前的部分
  // 完整行：「<pol_terminal> <pod_terminal> MVS <vessel_words...> <voyage> <etd> <eta>」
  // 取"MVS <words> <CAPS+digits> <etd>"模式
  const shipLine = lines.find(l => /MVS\s+/i.test(l) && /\d{4}-\d{1,2}-\d{1,2}/.test(l));
  if (shipLine) {
    const sm = shipLine.match(/MVS\s+(.+?)\s+([A-Z0-9]+)\s+\d{4}-\d{1,2}-\d{1,2}/i);
    if (sm) {
      out.vessel = sm[1].trim().toUpperCase();
      out.voyage = sm[2].trim().toUpperCase();
    }
  }

  // 集装箱：数量 + "尺寸/箱型/高度"
  // 数据行例："1 40 DRY 9 6 15000.000 KGS 1 Piece(s)"
  const cntrLine = lines.find(l => /\d+\s+(20|40|45)\s+(DRY|REEFER|FLAT|OPEN)\s+\d/.test(l));
  if (cntrLine) {
    const cm = cntrLine.match(/^(\d+)\s+((?:20|40|45)\s+(?:DRY|REEFER|FLAT|OPEN)\s+\d+\s*\d*)/);
    if (cm) {
      out.total_qty = parseInt(cm[1], 10);
      const cntr = parseCntr(cm[2]);
      out.container_size = cntr.size;
      out.container_type = cntr.type;
    }
  }

  // 提空箱 / 还重箱 时间 → 截港(port_cutoff)
  // "提箱还箱指引" 表格里 "Return Equip Delivery Terminal" 行有 Return Date + Time
  // 例如 "Return Equip Delivery Terminal ... 2026-06-18 13:00"
  // 也抓"Empty Container Depot" 的 Release Date 作为提空箱时间(放 notes)
  let emptyDate = null, emptyTime = null;
  let returnDate = null, returnTime = null;
  for (let i = 0; i < lines.length; i++) {
    if (/Empty\s+Container/i.test(lines[i])) {
      // 该行或后续 5 行内找 date + time
      for (let j = i; j < Math.min(i + 5, lines.length); j++) {
        const dm = lines[j].match(/(\d{4}-\d{1,2}-\d{1,2})\s+(\d{1,2}:\d{2})/);
        if (dm) { emptyDate = dm[1]; emptyTime = dm[2]; break; }
      }
    }
    if (/Return\s+Equip/i.test(lines[i])) {
      for (let j = i; j < Math.min(i + 5, lines.length); j++) {
        const dm = lines[j].match(/(\d{4}-\d{1,2}-\d{1,2})\s+(\d{1,2}:\d{2})/);
        if (dm) { returnDate = dm[1]; returnTime = dm[2]; break; }
      }
    }
  }
  if (returnDate) out.port_cutoff = normDateTime(returnDate, returnTime);

  // 备注里塞这些"次要但有用"的信息
  const notesParts = [];
  if (contractNo)   notesParts.push(`合约号: ${contractNo}`);
  if (contractCust) notesParts.push(`合约客户: ${contractCust}`);
  if (emptyDate)    notesParts.push(`提空箱: ${emptyDate} ${emptyTime || ""}`);
  const allocM = fullText.match(/Allocation week[:：]?\s*([^\n]+)/);
  if (allocM) notesParts.push(`Allocation: ${allocM[1].trim()}`);
  if (notesParts.length > 0) out.notes = notesParts.join(" · ");

  return { ok: true, data: out, raw: fullText };
}
