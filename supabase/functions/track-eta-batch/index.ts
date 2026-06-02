// track-eta-batch — 定时批量同步 Maersk ETA/开船 → 回写 + 变更告警
// ============================================================================
// 由 pg_cron 每 6 小时经 pg_net 调用（POST，带 header x-cron-key）。
// verify_jwt=false：靠 x-cron-key === TRACK_ETA_CRON_KEY 鉴权（仅 cron 知道）。
// 遍历所有活跃 Maersk 票（有 booking_no/mbl_no），并发限流查 Maersk，
// 复用 _shared/track.ts 的 syncOne（回写 + 变更检测 + 写站内通知）。
// 用 EdgeRuntime.waitUntil 后台跑完，立即 202 返回，不受 pg_net 超时影响。
// ============================================================================
import { SYNC_SELECT, getMaerskToken, maerskConfigured, syncOne, markError, sbGet }
  from "../_shared/track.ts";

const CRON_KEY = Deno.env.get("TRACK_ETA_CRON_KEY") ?? "";
const CONCURRENCY = 8;
const MAX_PER_RUN = 800; // 安全上限

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

// 简单并发池
async function pool<T>(items: T[], n: number, worker: (it: T, i: number) => Promise<void>) {
  let idx = 0;
  const runners = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (idx < items.length) {
      const i = idx++;
      await worker(items[i], i);
    }
  });
  await runners.reduce((p, r) => p.then(() => r), Promise.resolve());
  await Promise.all(runners);
}

async function runBatch(): Promise<void> {
  const stat = { checked: 0, ok: 0, not_found: 0, errors: 0, changed: 0, alerts: 0 };
  let token: string;
  try {
    token = await getMaerskToken();
  } catch (e) {
    console.error("[track-eta-batch] token 失败:", e instanceof Error ? e.message : e);
    return;
  }

  // 活跃 Maersk 票（lifecycle 未完结/关闭、carrier 属 Maersk 家族、有 booking 或 mbl），
  // 按最久未同步优先（eta_synced_at NULLS FIRST）。
  const family = "(carrier.ilike.*MAERSK*,carrier.ilike.*SEALAND*,carrier.ilike.*MCC*)";
  const path =
    `shipments?select=${SYNC_SELECT}` +
    `&lifecycle=not.in.(已完结,已关闭)` +
    `&or=${family}` +
    `&or=(booking_no.not.is.null,mbl_no.not.is.null)` +
    `&order=eta_synced_at.asc.nullsfirst&limit=${MAX_PER_RUN}`;

  let rows: any[];
  try {
    rows = await sbGet(path);
  } catch (e) {
    console.error("[track-eta-batch] 取候选票失败:", e instanceof Error ? e.message : e);
    return;
  }

  console.log(`[track-eta-batch] 候选 ${rows.length} 票，开始同步…`);
  await pool(rows, CONCURRENCY, async (s) => {
    stat.checked++;
    try {
      const r = await syncOne(s, token, "maersk_auto");
      if (r.status === "ok") stat.ok++;
      else if (r.status === "not_found") stat.not_found++;
      stat.changed += r.changed?.length || 0;
      stat.alerts += r.alerts || 0;
    } catch (e) {
      stat.errors++;
      await markError(s.id);
      console.error(`[track-eta-batch] ${s.order_no || s.id} 失败:`, e instanceof Error ? e.message : e);
    }
  });

  console.log(`[track-eta-batch] 完成: ${JSON.stringify(stat)}`);
}

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok");
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  if (!CRON_KEY || req.headers.get("x-cron-key") !== CRON_KEY) {
    return json({ error: "unauthorized" }, 401);
  }
  if (!maerskConfigured()) return json({ error: "Maersk 凭证未配置" }, 500);

  // 后台跑，立即返回（pg_net 不必等）
  // @ts-ignore EdgeRuntime 由 Supabase 运行时注入
  EdgeRuntime.waitUntil(runBatch());
  return json({ status: "accepted" }, 202);
});
