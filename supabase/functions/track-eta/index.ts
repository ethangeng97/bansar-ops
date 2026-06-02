// track-eta — 单票手动查 Maersk Track & Trace → 回写 shipments（详情页「查ETA」按钮）
// ============================================================================
// 前端 POST /functions/v1/track-eta  { shipment_id, debug? }，带登录用户 JWT。
// 核心逻辑在 _shared/track.ts（与定时批量 track-eta-batch 复用）：
//   回写 eta/etd/atd_carrier（船司值始终覆盖）、eta/etd/atd 人工优先，
//   变更时写站内通知 shipment_notifications（source=maersk_manual）。
// ============================================================================
import { SYNC_SELECT, getMaerskToken, maerskConfigured, syncOne, markError, sbGet }
  from "../_shared/track.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!maerskConfigured()) {
    return json({ error: "Maersk 凭证未配置（设置 MAERSK_CONSUMER_KEY / MAERSK_CONSUMER_SECRET）" }, 500);
  }

  let shipmentId: string, debug = false;
  try {
    const body = await req.json();
    shipmentId = body.shipment_id;
    debug = !!body.debug;
    if (!shipmentId) throw new Error("missing shipment_id");
  } catch {
    return json({ error: "body 需为 { shipment_id }" }, 400);
  }

  try {
    const rows = await sbGet(`shipments?id=eq.${shipmentId}&select=${SYNC_SELECT}`);
    const s = rows?.[0];
    if (!s) return json({ error: "票号不存在" }, 404);

    const token = await getMaerskToken();
    const r = await syncOne(s, token, "maersk_manual", debug);
    if (r.status === "no_ref") return json({ status: "error", message: "缺 booking_no / mbl_no，无法查询" }, 422);
    return json(r);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markError(shipmentId!);
    return json({ status: "error", message: msg }, 502);
  }
});
