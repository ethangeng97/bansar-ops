// track-eta — Phase 1：从 Maersk 官方 Track & Trace 拉 ETA 回写 shipments
// ============================================================================
// 调用方式：前端 POST /functions/v1/track-eta  { shipment_id, debug? }
//   - verify_jwt 默认开启：调用方带登录用户的 JWT；函数内部用 service_role 读写
//   - 仅处理 carrier 属于 MAERSK 家族的票（Phase 1）
//
// 回写规则（对应 026 migration 的列）：
//   - eta_carrier      ← 船司返回的到港日，始终覆盖（这是"船司说的"）
//   - eta              ← 仅当原本为空时用 eta_carrier 填上；已填的不动（人工优先）
//   - vessel / voyage  ← 仅当原本为空时填
//   - eta_synced_at    ← 本次成功查询时间
//   - eta_track_status ← ok / not_found / unsupported_carrier / error
//
// ⚠️ 待校准点（Track & Trace 审批通过、能拿到真实响应后再调）：
//   1. MAERSK_TRACK_URL —— 确认 Track & Trace 的端点路径与查询参数
//   2. extractArrivalEta() —— 按真实返回结构调整字段路径
//   传 { debug: true } 可在响应里拿到 raw 原始报文，用来对照校准。
// ============================================================================

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MAERSK_KEY = Deno.env.get("MAERSK_CONSUMER_KEY") ?? "";
const MAERSK_SECRET = Deno.env.get("MAERSK_CONSUMER_SECRET") ?? "";
const MAERSK_CUSTOMER_CODE = Deno.env.get("MAERSK_CUSTOMER_CODE") ?? "";

// Maersk OAuth2 (client_credentials)。token 约 2 小时有效，模块级缓存复用。
const MAERSK_TOKEN_URL = "https://api.maersk.com/customer-identity/oauth/v2/access_token";
// ⚠️ 待校准：Track & Trace 端点。下面是按门户文档的占位，审批通过后以 API 目录页为准。
const MAERSK_TRACK_URL = "https://api.maersk.com/track";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

// ── Maersk OAuth token（带缓存）────────────────────────────────────────────
let cachedToken: { value: string; expiresAt: number } | null = null;

async function getMaerskToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) return cachedToken.value;

  const res = await fetch(MAERSK_TOKEN_URL, {
    method: "POST",
    headers: {
      "Consumer-Key": MAERSK_KEY,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: MAERSK_KEY,
      client_secret: MAERSK_SECRET,
    }),
  });
  if (!res.ok) {
    throw new Error(`Maersk token ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  cachedToken = {
    value: data.access_token,
    expiresAt: now + (Number(data.expires_in ?? 7199) * 1000),
  };
  return cachedToken.value;
}

// ── 调 Track & Trace ────────────────────────────────────────────────────────
async function fetchTracking(trackingNumber: string, type: "booking" | "bl") {
  const token = await getMaerskToken();
  // ⚠️ 待校准：查询参数名（carrierBookingReference / billOfLading / containerNumber 等）以真实 API 为准
  const params = new URLSearchParams(
    type === "booking"
      ? { carrierBookingReference: trackingNumber }
      : { transportDocumentReference: trackingNumber },
  );
  const res = await fetch(`${MAERSK_TRACK_URL}?${params}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      "Consumer-Key": MAERSK_KEY,
      Accept: "application/json",
    },
  });
  if (res.status === 404) return { notFound: true, raw: null };
  if (!res.ok) throw new Error(`Maersk track ${res.status}: ${await res.text()}`);
  return { notFound: false, raw: await res.json() };
}

// ── 从返回事件里提炼"到卸货港的预计/实际时间" ──────────────────────────────
// ⚠️ 待校准：以下按 DCSA 风格事件结构(events[].transportEventTypeCode=DEPA/ARRI,
//   eventClassifierCode=EST/ACT/PLN, transportCall.location.UNLocationCode...)做最佳猜测。
//   拿到真实 raw(传 debug:true) 后按实际字段调整即可，逻辑骨架不用改。
function extractMilestones(raw: any, polCode?: string | null, podCode?: string | null): {
  eta: string | null; etd: string | null; atd: string | null; vessel: string | null; voyage: string | null;
} {
  const out = { eta: null as string | null, etd: null as string | null, atd: null as string | null,
                vessel: null as string | null, voyage: null as string | null };
  if (!raw) return out;

  const events: any[] = Array.isArray(raw?.events) ? raw.events
    : Array.isArray(raw) ? raw
    : Array.isArray(raw?.transportEvents) ? raw.transportEvents
    : [];

  const typeOf  = (e: any) => (e?.transportEventTypeCode || e?.eventType || "").toString().toUpperCase();
  const classOf = (e: any) => (e?.eventClassifierCode || e?.eventClassifier || "").toString().toUpperCase(); // EST/ACT/PLN
  const locOf   = (e: any) => (e?.transportCall?.location?.UNLocationCode
    || e?.location?.UNLocationCode || e?.transportCall?.UNLocationCode || "").toString().toUpperCase();
  const dateOf  = (e: any) => {
    const dt = e?.eventDateTime || e?.eventCreatedDateTime || e?.dateTime;
    return dt ? String(dt).slice(0, 10) : null; // YYYY-MM-DD
  };
  const isDep = (e: any) => typeOf(e).includes("DEPA");
  const isArr = (e: any) => typeOf(e).includes("ARRI");
  // 取符合 (类型 + EST/ACT + 港口) 的最后一个事件的日期
  const pick = (fn: (e: any) => boolean, cls: string, code?: string | null) => {
    let cand = events.filter((e) => fn(e) && classOf(e) === cls);
    if (code) { const at = cand.filter((e) => locOf(e) === code.toUpperCase()); if (at.length) cand = at; }
    const e = cand[cand.length - 1];
    return e ? dateOf(e) : null;
  };

  out.atd = pick(isDep, "ACT", polCode);                                  // 实际开船
  out.etd = pick(isDep, "EST", polCode);                                  // 预计开船
  out.eta = pick(isArr, "EST", podCode) || pick(isArr, "ACT", podCode);   // 预计(或实际)到港

  const vEvt = events.find((e) => (isDep(e) || isArr(e)) && (e?.transportCall?.vessel || e?.vessel));
  const vessel = vEvt?.transportCall?.vessel || vEvt?.vessel;
  if (vessel?.vesselName) out.vessel = String(vessel.vesselName).toUpperCase();
  const voy = vEvt?.transportCall?.carrierVoyageNumber || vEvt?.transportCall?.universalExportVoyageReference;
  if (voy) out.voyage = String(voy).toUpperCase();

  return out;
}

// ── Supabase REST 小助手（service_role）─────────────────────────────────────
async function sbGet(path: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` },
  });
  if (!res.ok) throw new Error(`sb get ${res.status}: ${await res.text()}`);
  return res.json();
}
async function sbPatch(path: string, body: unknown) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: "PATCH",
    headers: {
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`sb patch ${res.status}: ${await res.text()}`);
}

const MAERSK_FAMILY = ["MAERSK", "SEALAND", "MCC"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  if (!MAERSK_KEY || !MAERSK_SECRET) {
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
    const rows = await sbGet(
      `shipments?id=eq.${shipmentId}&select=id,order_no,carrier,booking_no,mbl_no,pol,pol_code,pod,pod_code,eta,etd,atd,vessel,voyage`,
    );
    const s = rows?.[0];
    if (!s) return json({ error: "票号不存在" }, 404);

    const carrier = (s.carrier || "").toUpperCase();
    if (!MAERSK_FAMILY.some((c) => carrier.includes(c))) {
      await sbPatch(`shipments?id=eq.${shipmentId}`, {
        eta_track_status: "unsupported_carrier",
        eta_synced_at: new Date().toISOString(),
      });
      return json({ status: "unsupported_carrier", carrier: s.carrier, message: "Phase 1 仅支持 Maersk" });
    }

    // 优先用 booking_no 查，没有再用 mbl_no
    let result;
    if (s.booking_no) result = await fetchTracking(s.booking_no, "booking");
    else if (s.mbl_no) result = await fetchTracking(s.mbl_no, "bl");
    else return json({ status: "error", message: "缺 booking_no / mbl_no，无法查询" }, 422);

    if (result.notFound) {
      await sbPatch(`shipments?id=eq.${shipmentId}`, {
        eta_track_status: "not_found",
        eta_synced_at: new Date().toISOString(),
      });
      return json({ status: "not_found", ...(debug ? { raw: result.raw } : {}) });
    }

    const parsed = extractMilestones(result.raw, s.pol_code, s.pod_code);
    const got = parsed.eta || parsed.etd || parsed.atd;

    const patch: Record<string, unknown> = {
      eta_synced_at: new Date().toISOString(),
      eta_track_status: got ? "ok" : "no_eta_in_response",
    };
    // 船司值始终覆盖 *_carrier；人工列(eta/etd/atd)仅空白时回填
    if (parsed.eta) { patch.eta_carrier = parsed.eta; if (!s.eta) patch.eta = parsed.eta; }
    if (parsed.etd) { patch.etd_carrier = parsed.etd; if (!s.etd) patch.etd = parsed.etd; }
    if (parsed.atd) { patch.atd_carrier = parsed.atd; if (!s.atd) patch.atd = parsed.atd; }
    if (parsed.vessel && !s.vessel) patch.vessel = parsed.vessel;
    if (parsed.voyage && !s.voyage) patch.voyage = parsed.voyage;

    await sbPatch(`shipments?id=eq.${shipmentId}`, patch);

    return json({
      status: patch.eta_track_status,
      eta_carrier: parsed.eta, etd_carrier: parsed.etd, atd_carrier: parsed.atd,
      eta_existing: s.eta, etd_existing: s.etd, atd_existing: s.atd,
      mismatch: !!(parsed.eta && s.eta && parsed.eta !== s.eta),
      vessel: parsed.vessel, voyage: parsed.voyage,
      ...(debug ? { raw: result.raw } : {}),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    try {
      await sbPatch(`shipments?id=eq.${shipmentId!}`, {
        eta_track_status: "error",
        eta_synced_at: new Date().toISOString(),
      });
    } catch { /* 记录失败不阻断错误返回 */ }
    return json({ status: "error", message: msg }, 502);
  }
});
