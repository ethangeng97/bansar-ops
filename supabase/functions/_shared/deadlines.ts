// _shared/deadlines.ts — Maersk Ocean Deadlines 共享逻辑
// ============================================================================
// 被 track-deadlines(单票手动)与 track-deadlines-batch(定时批量)复用。
//   1) 船名 → IMO：GET reference-data/vessels?vesselNames=（模块级缓存）
//   2) 截止时间：GET shipment-deadlines?ISOCountryCode&portOfLoad&vesselIMONumber&voyage
// 入参取自 shipments：vessel(船名)、voyage(>4位取后4位)、pol(城市英文名)、pol_code(取前2位=国家码)。
// 回写 si_cutoff/vgm_cutoff/cy_cutoff(船司值，始终覆盖) + deadlines_raw + 状态。
// 「截单临期提醒」由 033 之后的 SQL 定时任务按 *_cutoff 触发，不在此函数里。
// ============================================================================
import { getMaerskToken, sbGet, sbPatch } from "./track.ts";

const MAERSK_KEY = Deno.env.get("MAERSK_CONSUMER_KEY") ?? "";
const VESSELS_URL = "https://api.maersk.com/reference-data/vessels";
const DEADLINES_URL = "https://api.maersk.com/shipment-deadlines";

// pol_code 前2位国家码 → UTC 偏移（deadlineLocal 是港口本地时间，转 timestamptz 用）
const TZ_OFFSET: Record<string, string> = {
  CN: "+08:00", HK: "+08:00", MO: "+08:00", TW: "+08:00", SG: "+08:00",
  MY: "+08:00", PH: "+08:00", VN: "+07:00", TH: "+07:00", ID: "+07:00",
  KR: "+09:00", JP: "+09:00", IN: "+05:30",
};
const toTs = (local: string | null, iso: string) =>
  local ? `${local}${TZ_OFFSET[iso] || "+00:00"}` : null;

export { getMaerskToken };
export const DEADLINES_SELECT = "id,order_no,vessel,voyage,pol,pol_code,lifecycle";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 带重试退避：429/502/503（Maersk spike arrest / 瞬时）最多重试 3 次
async function mget(url: string, token: string, tries = 4) {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, "Consumer-Key": MAERSK_KEY, Accept: "application/json" },
    });
    if ((res.status === 429 || res.status === 502 || res.status === 503) && i < tries - 1) {
      await res.body?.cancel();
      await sleep(500 * (i + 1) + Math.floor(Math.random() * 400)); // 退避 + 抖动
      continue;
    }
    if (!res.ok) {
      const t = await res.text();
      return { ok: false, status: res.status, body: t.slice(0, 500) };
    }
    return { ok: true, status: res.status, body: await res.json() };
  }
  return { ok: false, status: 429, body: "rate-limited after retries" };
}

// 船名 → IMO（模块级缓存，避免同一批次同船重复查）
const imoCache = new Map<string, string | null>();
async function resolveImo(token: string, vessel: string): Promise<string | null> {
  const key = vessel.toUpperCase();
  if (imoCache.has(key)) return imoCache.get(key)!;
  const r = await mget(`${VESSELS_URL}?vesselNames=${encodeURIComponent(vessel)}`, token);
  const imo = r.ok
    ? (r.body?.[0]?.vesselIMONumber || r.body?.vessels?.[0]?.vesselIMONumber || r.body?.data?.[0]?.vesselIMONumber || null)
    : null;
  imoCache.set(key, imo);
  return imo;
}

const pickDl = (dls: any[], ...kw: string[]) => {
  const d = dls.find((x) => kw.some((k) => String(x?.deadlineName || "").toLowerCase().includes(k)));
  return d?.deadlineLocal || null;
};

export type DeadlineResult = {
  shipment_id: string; order_no?: string; status: string;
  imo?: string | null; si?: string | null; vgm?: string | null; cy?: string | null;
  terminal?: string | null; raw?: any;
};

// 同步单票截止时间
export async function syncDeadlinesOne(s: any, token: string, debug = false): Promise<DeadlineResult> {
  const id = s.id;
  if (!s.vessel || !s.voyage || !s.pol) {
    await sbPatch(`shipments?id=eq.${id}`, {
      deadlines_status: "missing_input", deadlines_synced_at: new Date().toISOString(),
    });
    return { shipment_id: id, order_no: s.order_no, status: "missing_input" };
  }

  const imo = await resolveImo(token, s.vessel);
  if (!imo) {
    await sbPatch(`shipments?id=eq.${id}`, {
      deadlines_status: "no_imo", deadlines_synced_at: new Date().toISOString(),
    });
    return { shipment_id: id, order_no: s.order_no, status: "no_imo" };
  }

  const iso = (s.pol_code ? String(s.pol_code).slice(0, 2) : "CN").toUpperCase();
  const v = String(s.voyage);
  const voyage4 = v.length > 4 ? v.slice(-4) : v;
  const url = `${DEADLINES_URL}?ISOCountryCode=${iso}&portOfLoad=${encodeURIComponent(s.pol)}` +
    `&vesselIMONumber=${imo}&voyage=${encodeURIComponent(voyage4)}`;
  const r = await mget(url, token);

  if (!r.ok) {
    const status = r.status === 404 ? "not_found" : "error";
    await sbPatch(`shipments?id=eq.${id}`, {
      deadlines_status: status, deadlines_synced_at: new Date().toISOString(),
    });
    return { shipment_id: id, order_no: s.order_no, status, imo, ...(debug ? { raw: r.body } : {}) };
  }

  const node = Array.isArray(r.body) ? r.body[0]?.shipmentDeadlines : r.body?.shipmentDeadlines;
  const dls: any[] = node?.deadlines || [];
  const si  = pickDl(dls, "shipping instruction");
  const vgm = pickDl(dls, "verified gross mass", "vgm");
  const cy  = pickDl(dls, "cargo cutoff", "cargo cut-off", "cargo cut off");

  await sbPatch(`shipments?id=eq.${id}`, {
    deadlines_status: "ok",
    deadlines_synced_at: new Date().toISOString(),
    deadlines_raw: { terminal: node?.terminalName || null, deadlines: dls },
    si_cutoff:  toTs(si, iso),
    vgm_cutoff: toTs(vgm, iso),
    cy_cutoff:  toTs(cy, iso),
  });

  return {
    shipment_id: id, order_no: s.order_no, status: "ok", imo,
    si, vgm, cy, terminal: node?.terminalName || null,
    ...(debug ? { raw: r.body } : {}),
  };
}

export async function markDeadlineError(id: string) {
  try {
    await sbPatch(`shipments?id=eq.${id}`, {
      deadlines_status: "error", deadlines_synced_at: new Date().toISOString(),
    });
  } catch { /* ignore */ }
}

export { sbGet };
