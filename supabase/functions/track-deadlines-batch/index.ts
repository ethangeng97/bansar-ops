// track-deadlines-batch — 定时批量同步 Maersk 单证截止时间
// ============================================================================
// 由 pg_cron 每 12 小时经 pg_net 调用（header x-cron-key）。verify_jwt=false。
// 遍历活跃 Maersk 票（有 vessel+voyage+pol），并发限流查 Maersk，回写 *_cutoff。
// 「截单临期提醒」由独立 SQL 定时任务按 *_cutoff 生成通知（见 migration 034）。
// ============================================================================
import { DEADLINES_SELECT, getMaerskToken, syncDeadlinesOne, markDeadlineError, sbGet }
  from "../_shared/deadlines.ts";

const CRON_KEY = Deno.env.get("TRACK_ETA_CRON_KEY") ?? "";
const MAERSK_KEY = Deno.env.get("MAERSK_CONSUMER_KEY") ?? "";
const CONCURRENCY = 3;   // 每票最多 2 次调用(vessels+deadlines)，并发压低避免 Maersk spike arrest
const MAX_PER_RUN = 800;

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

async function pool<T>(items: T[], n: number, worker: (it: T) => Promise<void>) {
  let idx = 0;
  const runners = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (idx < items.length) await worker(items[idx++]);
  });
  await Promise.all(runners);
}

async function runBatch(): Promise<void> {
  const stat = { checked: 0, ok: 0, not_found: 0, no_imo: 0, errors: 0 };
  let token: string;
  try { token = await getMaerskToken(); }
  catch (e) { console.error("[deadlines-batch] token 失败:", e instanceof Error ? e.message : e); return; }

  const family = "(carrier.ilike.*MAERSK*,carrier.ilike.*SEALAND*,carrier.ilike.*MCC*)";
  const path =
    `shipments?select=${DEADLINES_SELECT}` +
    `&lifecycle=not.in.(已完结,已关闭)` +
    `&or=${family}` +
    `&vessel=not.is.null&voyage=not.is.null&pol=not.is.null` +
    `&order=deadlines_synced_at.asc.nullsfirst&limit=${MAX_PER_RUN}`;

  let rows: any[];
  try { rows = await sbGet(path); }
  catch (e) { console.error("[deadlines-batch] 取候选失败:", e instanceof Error ? e.message : e); return; }

  console.log(`[deadlines-batch] 候选 ${rows.length} 票，开始同步…`);
  await pool(rows, CONCURRENCY, async (s) => {
    stat.checked++;
    try {
      const r = await syncDeadlinesOne(s, token);
      if (r.status === "ok") stat.ok++;
      else if (r.status === "not_found") stat.not_found++;
      else if (r.status === "no_imo") stat.no_imo++;
    } catch (e) {
      stat.errors++;
      await markDeadlineError(s.id);
      console.error(`[deadlines-batch] ${s.order_no || s.id} 失败:`, e instanceof Error ? e.message : e);
    }
  });
  console.log(`[deadlines-batch] 完成: ${JSON.stringify(stat)}`);
}

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok");
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!CRON_KEY || req.headers.get("x-cron-key") !== CRON_KEY) return json({ error: "unauthorized" }, 401);
  if (!MAERSK_KEY) return json({ error: "Maersk 凭证未配置" }, 500);
  // @ts-ignore EdgeRuntime 由 Supabase 注入
  EdgeRuntime.waitUntil(runBatch());
  return json({ status: "accepted" }, 202);
});
