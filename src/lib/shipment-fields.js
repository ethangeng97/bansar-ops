// ============================================================================
// shipment-fields.js — shipments 表的 DB 字段白名单
//
// 用途：保存 shipment 时过滤 payload，只保留 DB 实际存在的字段
// 历史背景：V5 UI 上有大量"幽灵字段"（代码 ch() 设置但 DB 没此列）
//   过去 supabase.js 静默吞错，所以保存看起来"成功"但字段实际没存
//   修复 supabase.js 后保存会抛 schema cache 错误，需要在保存前过滤
//
// 维护：DB 加列时把对应字段加到下面集合
// ============================================================================

// 自动从最近 DB 探查 + migration 加列得到的全集
export const SHIPMENT_DB_COLUMNS = new Set([
  // 原始 84 列（来自探查 1 CSV）
  "_customer_backup", "_order_no_backup", "_supplier_backup",
  "atd", "barcode_expiry", "bl_status", "bl_type",
  "booking_no", "business_type",
  "cargo_type", "carrier", "carrier_agent",
  "completed_at", "completed_by",
  "consignee", "container_no", "container_owner",
  "crd_date", "created_at", "created_by",
  "customer", "customer_id", "customer_po",
  "customs_cutoff", "cy_cutoff",
  "destination", "destination_agent",
  "e_booking_no", "end_customer", "entry_done", "entry_number",
  "equipment_return", "eta", "etd",
  "finance_status",
  "free_demurrage_calc", "free_demurrage_days",
  "freight_terms",
  "has_hbl",
  "hbl_no", "hbl_status",
  "id", "incoterms",
  "lifecycle", "local_payment",
  "marks", "mbl_no", "mbl_status",
  "notify_party",
  "operator_id", "order_no", "overseas_agent",
  "parent_id", "pickup_depot",
  "po", "pod", "pol", "port_entry_code",
  "qc_status", "qty_container", "qty_packages",
  "salesperson_id", "seal_no", "service_types",
  "settlement_code", "shipment_type", "shipper",
  "si_cutoff", "sku", "solicit_type", "space_status",
  "supplier", "supplier_id", "supplier_order_no",
  "telex_release", "terminal", "transport_terms",
  "tuc", "updated_at",
  "vessel", "vgm_cutoff", "volume", "voyage", "weight",

  // Migration 003 加的 23 列
  "receipt_place_code", "receipt_place_name",
  "transit_port_code", "transit_port_name",
  "delivery_place_code", "delivery_place_name",
  "pol_code", "pod_code", "destination_code",
  "pkg_unit", "qty_in_words",
  "desc_zh", "desc_en", "hs_code", "description",
  "swb_no", "swb_date",
  "issue_place_code", "issue_place_name", "issue_date",
  "third_party_payer_id", "third_party_payer_name", "third_party_payer_code",
]);

/**
 * 过滤 payload，只保留白名单内的字段
 * 被过滤掉的字段会通过 console.warn 输出（便于排查"幽灵字段"）
 *
 * @param {object} payload - 原始数据，可能含 UI 上但 DB 没有的字段
 * @param {object} opts - { silent?: boolean } 是否静默
 * @returns {object} 过滤后只含 DB 字段的 payload
 */
export function filterShipmentPayload(payload, opts = {}) {
  if (!payload || typeof payload !== "object") return payload;
  const filtered = {};
  const dropped = [];
  for (const [k, v] of Object.entries(payload)) {
    if (SHIPMENT_DB_COLUMNS.has(k)) {
      filtered[k] = v;
    } else {
      dropped.push(k);
    }
  }
  if (dropped.length > 0 && !opts.silent) {
    console.warn("[shipments] 以下字段不在 DB 上，已忽略:", dropped);
  }
  return filtered;
}
