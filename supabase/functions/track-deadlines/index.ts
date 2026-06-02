// track-deadlines — 单票手动查 Maersk 单证截止时间（截单/截VGM/截关）回写
// ============================================================================
// 前端 POST { shipment_id, debug? }，带登录 JWT。逻辑在 _shared/deadlines.ts。
// ============================================================================
import { DEADLINES_SELECT, getMaerskToken, syncDeadlinesOne, markDeadlineError, sbGet }
  from "../_shared/deadlines.ts";

const MAERSK_KEY = Deno.env.get("MAERSK_CONSUMER_KEY") ?? "";
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
  if (!MAERSK_KEY) return json({ error: "Maersk 凭证未配置" }, 500);

  let shipmentId: string, debug = false;
  try {
    const b = await req.json();
    shipmentId = b.shipment_id; debug = !!b.debug;
    if (!shipmentId) throw new Error("missing shipment_id");
  } catch { return json({ error: "body 需为 { shipment_id }" }, 400); }

  try {
    const rows = await sbGet(`shipments?id=eq.${shipmentId}&select=${DEADLINES_SELECT}`);
    const s = rows?.[0];
    if (!s) return json({ error: "票号不存在" }, 404);
    const token = await getMaerskToken();
    const r = await syncDeadlinesOne(s, token, debug);
    return json(r);
  } catch (err) {
    await markDeadlineError(shipmentId!);
    return json({ status: "error", message: err instanceof Error ? err.message : String(err) }, 502);
  }
});
