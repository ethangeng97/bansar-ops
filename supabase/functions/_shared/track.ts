// _shared/track.ts — Maersk Track & Trace 共享逻辑
// ============================================================================
// 被 track-eta(单票手动)与 track-eta-batch(定时批量)复用。
// 职责：拿 OAuth token、调 Track & Trace Events、解析 DCSA 里程碑、
//       回写 shipments（船司值始终覆盖 *_carrier，人工列仅空白回填），
//       变更检测 + 写站内通知 shipment_notifications。
// 回写规则沿用 026/031：eta/etd/atd_carrier 存船司值；eta/etd/atd 人工优先。
// ============================================================================

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const MAERSK_KEY = Deno.env.get("MAERSK_CONSUMER_KEY") ?? "";
const MAERSK_SECRET = Deno.env.get("MAERSK_CONSUMER_SECRET") ?? "";

const MAERSK_TOKEN_URL = "https://api.maersk.com/customer-identity/oauth/v2/access_token";
// Track & Trace Events（DCSA v2.2, Maersk product "Ocean Track & Trace"）
const MAERSK_TRACK_URL = "https://api.maersk.com/track-and-trace-private/events";

export const MAERSK_FAMILY = ["MAERSK", "SEALAND", "MCC"];
export const isMaersk = (carrier?: string | null) =>
  MAERSK_FAMILY.some((c) => (carrier || "").toUpperCase().includes(c));

export function maerskConfigured() {
  return !!(MAERSK_KEY && MAERSK_SECRET);
}

// ── Maersk OAuth token（模块级缓存，约 2h 有效）──────────────────────────────
let cachedToken: { value: string; expiresAt: number } | null = null;

export async function getMaerskToken(): Promise<string> {
  const now = Date.now();
  if (cachedToken && cachedToken.expiresAt > now + 60_000) return cachedToken.value;

  const res = await fetch(MAERSK_TOKEN_URL, {
    method: "POST",
    headers: { "Consumer-Key": MAERSK_KEY, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: MAERSK_KEY,
      client_secret: MAERSK_SECRET,
    }),
  });
  if (!res.ok) throw new Error(`Maersk token ${res.status}: ${await res.text()}`);
  const data = await res.json();
  cachedToken = { value: data.access_token, expiresAt: now + (Number(data.expires_in ?? 7199) * 1000) };
  return cachedToken.value;
}

// ── 调 Track & Trace Events ──────────────────────────────────────────────────
export async function fetchTracking(token: string, trackingNumber: string, type: "booking" | "bl") {
  const params = new URLSearchParams(
    type === "booking"
      ? { carrierBookingReference: trackingNumber }
      : { transportDocumentReference: trackingNumber },
  );
  const url = `${MAERSK_TRACK_URL}?${params}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, "Consumer-Key": MAERSK_KEY, Accept: "application/json" },
  });
  if (res.status === 404) {
    const body = await res.text().catch(() => "");
    return { notFound: true, raw: null, status: 404, url, errBody: body.slice(0, 1200) };
  }
  if (!res.ok) throw new Error(`Maersk track ${res.status} @ ${url}: ${await res.text()}`);
  return { notFound: false, raw: await res.json(), status: res.status, url };
}

// ── 从 DCSA 事件提炼 开船/到港/船名航次 ─────────────────────────────────────
export function extractMilestones(raw: any, polCode?: string | null, podCode?: string | null) {
  const out = { eta: null as string | null, etd: null as string | null, atd: null as string | null,
                vessel: null as string | null, voyage: null as string | null };
  if (!raw) return out;

  const events: any[] = Array.isArray(raw?.events) ? raw.events
    : Array.isArray(raw) ? raw
    : Array.isArray(raw?.transportEvents) ? raw.transportEvents
    : [];

  const typeOf  = (e: any) => (e?.transportEventTypeCode || e?.eventType || "").toString().toUpperCase();
  const classOf = (e: any) => (e?.eventClassifierCode || e?.eventClassifier || "").toString().toUpperCase();
  const locOf   = (e: any) => (e?.transportCall?.location?.UNLocationCode
    || e?.location?.UNLocationCode || e?.transportCall?.UNLocationCode || "").toString().toUpperCase();
  const dateOf  = (e: any) => {
    const dt = e?.eventDateTime || e?.eventCreatedDateTime || e?.dateTime;
    return dt ? String(dt).slice(0, 10) : null;
  };
  const isDep = (e: any) => typeOf(e).includes("DEPA");
  const isArr = (e: any) => typeOf(e).includes("ARRI");
  const pick = (fn: (e: any) => boolean, cls: string, code?: string | null) => {
    let cand = events.filter((e) => fn(e) && classOf(e) === cls);
    if (code) { const at = cand.filter((e) => locOf(e) === code.toUpperCase()); if (at.length) cand = at; }
    const e = cand[cand.length - 1];
    return e ? dateOf(e) : null;
  };

  out.atd = pick(isDep, "ACT", polCode);
  out.etd = pick(isDep, "EST", polCode);
  out.eta = pick(isArr, "EST", podCode) || pick(isArr, "ACT", podCode);

  const vEvt = events.find((e) => (isDep(e) || isArr(e)) && (e?.transportCall?.vessel || e?.vessel));
  const vessel = vEvt?.transportCall?.vessel || vEvt?.vessel;
  if (vessel?.vesselName) out.vessel = String(vessel.vesselName).toUpperCase();
  const voy = vEvt?.transportCall?.carrierVoyageNumber || vEvt?.transportCall?.universalExportVoyageReference;
  if (voy) out.voyage = String(voy).toUpperCase();

  return out;
}

// ── Supabase REST 小助手（service_role，绕过 RLS）────────────────────────────
export async function sbGet(path: string) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}` },
  });
  if (!res.ok) throw new Error(`sb get ${res.status}: ${await res.text()}`);
  return res.json();
}
export async function sbPatch(path: string, body: unknown) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: "PATCH",
    headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}`,
               "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`sb patch ${res.status}: ${await res.text()}`);
}
async function sbInsert(path: string, rows: unknown[]) {
  if (!rows.length) return;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: "POST",
    headers: { apikey: SERVICE_ROLE, Authorization: `Bearer ${SERVICE_ROLE}`,
               "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`sb insert ${res.status}: ${await res.text()}`);
}

// shipments 上同步需要的列
export const SYNC_SELECT =
  "id,order_no,carrier,booking_no,mbl_no,pol,pol_code,pod,pod_code,eta,etd,atd,eta_carrier,etd_carrier,atd_carrier,vessel,voyage,eta_synced_at";

const ddiff = (a?: string | null, b?: string | null) => (a || null) !== (b || null);

// 变更字段 → 通知 kind / 中文名
const FIELD_META: Record<string, { kind: string; label: string }> = {
  atd_carrier: { kind: "atd_change", label: "实际开船" },
  etd_carrier: { kind: "etd_change", label: "预计开船" },
  eta_carrier: { kind: "eta_change", label: "预计到港" },
};

export type SyncResult = {
  shipment_id: string; order_no?: string; status: string;
  eta_carrier: string | null; etd_carrier: string | null; atd_carrier: string | null;
  eta_existing?: string | null; etd_existing?: string | null; atd_existing?: string | null;
  mismatch?: boolean; vessel?: string | null; voyage?: string | null;
  changed?: string[]; alerts?: number; url?: string; errBody?: string; raw?: any;
};

// ── 同步单票：调 Maersk → 回写 → 变更检测 → 写通知 ──────────────────────────
// source: 'maersk_auto'(定时) | 'maersk_manual'(手动按钮)
export async function syncOne(
  s: any, token: string, source: "maersk_auto" | "maersk_manual", debug = false,
): Promise<SyncResult> {
  const id = s.id;
  if (!isMaersk(s.carrier)) {
    await sbPatch(`shipments?id=eq.${id}`, {
      eta_track_status: "unsupported_carrier", eta_synced_at: new Date().toISOString(),
    });
    return { shipment_id: id, order_no: s.order_no, status: "unsupported_carrier",
             eta_carrier: null, etd_carrier: null, atd_carrier: null };
  }

  let result;
  if (s.booking_no) result = await fetchTracking(token, s.booking_no, "booking");
  else if (s.mbl_no) result = await fetchTracking(token, s.mbl_no, "bl");
  else return { shipment_id: id, order_no: s.order_no, status: "no_ref",
                eta_carrier: null, etd_carrier: null, atd_carrier: null };

  if (result.notFound) {
    await sbPatch(`shipments?id=eq.${id}`, {
      eta_track_status: "not_found", eta_synced_at: new Date().toISOString(),
    });
    return { shipment_id: id, order_no: s.order_no, status: "not_found",
             eta_carrier: null, etd_carrier: null, atd_carrier: null,
             ...(debug ? { url: result.url, errBody: result.errBody } : {}) };
  }

  const parsed = extractMilestones(result.raw, s.pol_code, s.pod_code);
  const got = parsed.eta || parsed.etd || parsed.atd;

  const patch: Record<string, unknown> = {
    eta_synced_at: new Date().toISOString(),
    eta_track_status: got ? "ok" : "no_eta_in_response",
  };
  // 船司值始终覆盖 *_carrier；人工列仅空白回填
  if (parsed.eta) { patch.eta_carrier = parsed.eta; if (!s.eta) patch.eta = parsed.eta; }
  if (parsed.etd) { patch.etd_carrier = parsed.etd; if (!s.etd) patch.etd = parsed.etd; }
  if (parsed.atd) { patch.atd_carrier = parsed.atd; if (!s.atd) patch.atd = parsed.atd; }
  if (parsed.vessel && !s.vessel) patch.vessel = parsed.vessel;
  if (parsed.voyage && !s.voyage) patch.voyage = parsed.voyage;

  // 变更检测（仅对 *_carrier 三个里程碑）。首次同步(eta_synced_at 为空)只建基线、不告警，避免首轮刷屏。
  const firstSync = !s.eta_synced_at;
  const changed: string[] = [];
  const notifs: any[] = [];
  for (const field of ["atd_carrier", "etd_carrier", "eta_carrier"]) {
    const nv = (parsed as any)[field.replace("_carrier", "")] as string | null;
    if (nv == null) continue;
    const ov = s[field] as string | null;
    if (!ddiff(nv, ov)) continue;
    changed.push(field);
    if (firstSync) continue;
    const m = FIELD_META[field];
    notifs.push({
      shipment_id: id, kind: m.kind, field, old_value: ov, new_value: nv, source,
      summary: `${s.order_no || ""} ${m.label} ${ov || "—"} → ${nv}`.trim(),
    });
  }

  await sbPatch(`shipments?id=eq.${id}`, patch);
  if (notifs.length) await sbInsert("shipment_notifications", notifs);

  return {
    shipment_id: id, order_no: s.order_no, status: patch.eta_track_status as string,
    eta_carrier: parsed.eta, etd_carrier: parsed.etd, atd_carrier: parsed.atd,
    eta_existing: s.eta, etd_existing: s.etd, atd_existing: s.atd,
    mismatch: !!(parsed.eta && s.eta && parsed.eta !== s.eta),
    vessel: parsed.vessel, voyage: parsed.voyage,
    changed, alerts: notifs.length,
    ...(debug ? { raw: result.raw, url: result.url } : {}),
  };
}

// 标记同步出错（catch 用）
export async function markError(id: string) {
  try {
    await sbPatch(`shipments?id=eq.${id}`, {
      eta_track_status: "error", eta_synced_at: new Date().toISOString(),
    });
  } catch { /* 记录失败不阻断 */ }
}
