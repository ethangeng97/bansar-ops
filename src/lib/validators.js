// ============================================================================
// validators.js — 字段校验 + 格式化工具
// ============================================================================

/**
 * 检查字符串是否只含 ASCII 可打印字符（半角英文/数字/符号/空格/换行/回车）
 * 用于 shipper / consignee / notify_party 等会上英文提单的字段
 *
 * @param {string} text
 * @returns {string|null} 错误消息（中文）或 null（无错误）
 */
export function validateAsciiOnly(text) {
  if (!text) return null;
  // 0x20-0x7E 是 ASCII 可打印；\n \r \t 也允许
  if (/[^\x20-\x7E\n\r\t]/.test(text)) {
    return "包含全角字符或非法符号（仅允许半角英文/数字/标点/空格/换行）";
  }
  return null;
}

/**
 * 检查中文字段是否含全角符号（可以含中文，但不允许全角空格、全角逗号等）
 * 用于 marks / desc_zh 等中文字段
 */
export function validateNoFullWidthSymbols(text) {
  if (!text) return null;
  // 全角空格 / 全角符号
  // \u3000 全角空格；常见全角符号区间
  const fwSymbolRe = /[\u3000\uff01-\uff5e]/;
  if (fwSymbolRe.test(text)) {
    return "包含全角符号（请改为半角）";
  }
  return null;
}

/**
 * 强制大写 + 去掉前后空格
 * 用于 vessel / voyage / mbl_no / hbl_no / booking_no / container_no / seal_no
 */
export function upperTrim(text) {
  if (text === null || text === undefined) return text;
  return String(text).trim().toUpperCase();
}

/**
 * onChange 时即时大写转换（不 trim，让用户能输入空格）
 */
export function liveUpper(text) {
  if (text === null || text === undefined) return text;
  return String(text).toUpperCase();
}

/**
 * 应用大写规则到 payload 的多个字段
 * 用于保存时统一处理
 *
 * @param {object} payload
 * @param {string[]} fields
 * @returns {object} 新对象
 */
export function upperizeFields(payload, fields) {
  const out = { ...payload };
  fields.forEach(f => {
    if (out[f] !== undefined && out[f] !== null && out[f] !== "") {
      out[f] = String(out[f]).trim().toUpperCase();
    }
  });
  return out;
}

// 业务上要强制大写的标准字段集
export const UPPERCASE_FIELDS = [
  "vessel", "voyage", "mbl_no", "hbl_no", "booking_no",
  "container_no", "seal_no", "pol", "pod", "destination",
  "pol_code", "pod_code", "destination_code",
  "receipt_place_code", "receipt_place_name",
  "transit_port_code",  "transit_port_name",
  "delivery_place_code","delivery_place_name",
  "issue_place_code",   "issue_place_name",
  "swb_no", "hs_code",
];

// 业务上必须 ASCII（提单上要英文显示）的字段
export const ASCII_ONLY_FIELDS = [
  "shipper", "consignee", "notify_party",
  "desc_en",
];
