// ============================================================================
// spot-inventory.js — 现舱库存的单一事实源
//
// 现舱用「计算式库存」模型：不存"可用柜数"，而是实时算出来——
//   可用 = spot_bookings.total_qty − Σ(shipments.qty_container WHERE spot_booking_id=X)
// 所以「舱位退回现舱」的本质 = 解除/减少 shipment↔spot 的占用，再重算状态。
//
// 历史：recalc 逻辑曾在 Orders.jsx / SpotBookings.jsx 各抄一份且不一致
//   （一处用 qty_container||1，一处用 numQty），现统一到这里。
// ============================================================================

import { supabase } from "../supabase.js";

// qty_container 是 text 类型，可能是 "1" / "2x40HC" / ""，统一抽出整数（前缀数字）
// 没填或不可识别时 fallback 到 1 柜
export const numQty = (v) => {
  if (v == null) return 1;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
};

// 现舱手动锁定的状态（人工设置后默认不被自动重算覆盖）
const LOCKED_STATUSES = ["已截单", "已取消"];

// ─── 重算现舱状态 ───────────────────────────────────────────────
// sum(关联 shipments 的 qty_container) vs total_qty → 可售/部分已售/全部已售
// 用于：现舱"划给客户"后 / 订单删除后 / 退关退柜后 / spot_booking_id 改了后
//
// force=false（默认）：现舱处于"已截单/已取消"时跳过，不覆盖人工锁定
// force=true：忽略锁定，强制按实际占用重算（退关常发生在截单后，
//            此时柜虽腾出来了，但状态卡在"已截单"不会自动变回可售，需强制放开）
export async function recalcSpotStatus(spotId, { force = false } = {}) {
  if (!spotId) return;
  const [{ data: spot }, { data: ships }] = await Promise.all([
    supabase.from("spot_bookings").select("total_qty, status").eq("id", spotId).single(),
    supabase.from("shipments").select("qty_container").eq("spot_booking_id", spotId),
  ]);
  if (!spot) return;
  if (!force && LOCKED_STATUSES.includes(spot.status)) return;
  const sold = (ships || []).reduce((a, s) => a + numQty(s.qty_container), 0);
  const total = spot.total_qty || 0;
  let next = "可售";
  if (sold >= total && total > 0) next = "全部已售";
  else if (sold > 0) next = "部分已售";
  if (next !== spot.status) {
    await supabase.from("spot_bookings").update({ status: next }).eq("id", spotId);
  }
}

// ─── 退关 / 改配 / 部分退关：把舱位从订单退回现舱 ─────────────────
// 关键：退关 ≠ 删订单。订单是业务记录（客户/费用/审计都挂在上面），
//   退关只是"这柜没上这条船"——所以订单保留，只断开/减少与现舱的占用。
// 每次操作都会往 spot_booking_cancellations 记一条留痕（best-effort）。
//
// @param {object} shipment  至少含 { id, spot_booking_id, qty_container }
//                           （order_no/customer/carrier/vessel/voyage/pol/pod/etd 用于快照）
// @param {object} opts
//   mode:
//     "cancel"   整柜退关（默认）：解绑现舱(spot_booking_id=null)、
//                标 space_status=Cancelled、盖 space_released_at，订单保留
//     "partial"  部分退关：减少 qty_container（仍占用现舱，只是少占几柜）
//     "reassign" 改配到另一现舱：spot_booking_id 换成 newSpotId，并把船期同步成新现舱
//   returnQty   partial 模式：退回的柜数（需 1 ~ 当前柜数-1）
//   newSpotId   reassign 模式：新的现舱 id
//   markCancelled  cancel 模式是否写 space_status=Cancelled（默认 true）
//   reason / cancelFee / currency / operatorId  写进留痕记录
// @returns { ok, oldSpotId, newSpotId, qtyReturned, reason? }
export async function returnSlotToSpot(shipment, opts = {}) {
  const {
    mode = "cancel", returnQty = null, newSpotId = null, markCancelled = true,
    reason = null, cancelFee = null, currency = "USD", operatorId = null,
  } = opts;
  const shipId = shipment?.id;
  const oldSpotId = shipment?.spot_booking_id || null;
  if (!shipId) return { ok: false, reason: "缺少订单 id" };

  // 注意：本项目用的是 supabase.js 自带的 new Date()，浏览器端可用
  const stamp = new Date().toISOString();
  const cur = numQty(shipment.qty_container);
  let qtyReturned = cur;

  if (mode === "partial") {
    if (!oldSpotId) return { ok: false, reason: "订单未关联现舱，无法部分退关" };
    const back = Number(returnQty) || 0;
    if (back <= 0 || back >= cur) {
      return { ok: false, reason: `退回柜数需在 1 ~ ${cur - 1} 之间（整柜退关请用 cancel 模式）` };
    }
    qtyReturned = back;
    const { error } = await supabase.from("shipments")
      .update({ qty_container: String(cur - back), space_released_at: stamp })
      .eq("id", shipId);
    if (error) return { ok: false, reason: error.message };
  } else if (mode === "reassign") {
    if (!newSpotId) return { ok: false, reason: "改配需指定新现舱 newSpotId" };
    if (newSpotId === oldSpotId) return { ok: false, reason: "改配目标与原现舱相同" };
    // 改配 = 换条船：把订单的船期同步成新现舱（订舱号也跟着换）
    const { data: ns } = await supabase.from("spot_bookings")
      .select("carrier, vessel, voyage, pol, pod, etd, eta, booking_no, mbl_no")
      .eq("id", newSpotId).single();
    const patch = { spot_booking_id: newSpotId, space_released_at: stamp };
    if (ns) Object.assign(patch, {
      carrier: ns.carrier, vessel: ns.vessel, voyage: ns.voyage,
      pol: ns.pol, pod: ns.pod, etd: ns.etd, eta: ns.eta,
      booking_no: ns.booking_no || null, mbl_no: ns.mbl_no || null,
    });
    const { error } = await supabase.from("shipments").update(patch).eq("id", shipId);
    if (error) return { ok: false, reason: error.message };
  } else {
    // cancel：整柜退关，解绑现舱，订单保留
    const patch = { spot_booking_id: null, space_released_at: stamp };
    if (markCancelled) patch.space_status = "Cancelled";
    const { error } = await supabase.from("shipments").update(patch).eq("id", shipId);
    if (error) return { ok: false, reason: error.message };
  }

  // 重算旧现舱：若卡在"已截单"（退关常发生在截单后），强制放开重算让柜重新可售；
  // "已取消"（整条现舱作废）则不动——退回单柜对它没意义
  if (oldSpotId) {
    const { data: oldSpot } = await supabase.from("spot_bookings")
      .select("status").eq("id", oldSpotId).single();
    await recalcSpotStatus(oldSpotId, { force: oldSpot?.status === "已截单" });
  }
  // 改配：新现舱也要重算（可能从可售→部分/全部已售）
  if (newSpotId) await recalcSpotStatus(newSpotId);

  // 留痕（best-effort，不因记录失败而回滚已完成的退柜）
  try {
    await supabase.from("spot_booking_cancellations").insert({
      spot_booking_id: oldSpotId,
      new_spot_booking_id: mode === "reassign" ? newSpotId : null,
      shipment_id: shipId,
      order_no: shipment.order_no || null,
      customer: shipment.customer || null,
      carrier: shipment.carrier || null,
      vessel: shipment.vessel || null,
      voyage: shipment.voyage || null,
      pol: shipment.pol || null,
      pod: shipment.pod || null,
      etd: shipment.etd || null,
      mode,
      qty_returned: qtyReturned,
      reason: reason || null,
      cancel_fee: cancelFee != null && cancelFee !== "" ? Number(cancelFee) : null,
      currency: currency || "USD",
      operator_id: operatorId || null,
    });
  } catch (e) {
    console.error("[spot] 退关留痕写入失败（不影响退柜本身）:", e);
  }

  return { ok: true, oldSpotId, newSpotId, qtyReturned };
}
