-- ═══════════════════════════════════════════════════════════════
-- 034_ocean_deadlines.sql
-- Ocean Deadlines：拉 Maersk 单证截止时间（截单SI/截VGM/截关CY）+ 临期提醒。
--   1) shipments 加 *_cutoff / deadlines_raw / 同步状态列
--   2) fn_shipments_audit 再排除 deadlines_synced_at/status/raw（避免噪音；*_cutoff 仍记录）
--   3) 定时任务：每 12h 批量同步截止时间；每小时扫描 24h 内临期 → 写站内提醒（去重）
-- 配套：edge function track-deadlines-batch 设 env TRACK_ETA_CRON_KEY（与 ETA 共用同一 cron key）。
-- ═══════════════════════════════════════════════════════════════

alter table public.shipments add column if not exists si_cutoff  timestamptz;  -- 截单(Shipping Instructions)
alter table public.shipments add column if not exists vgm_cutoff timestamptz;  -- 截VGM(Verified Gross Mass)
alter table public.shipments add column if not exists cy_cutoff  timestamptz;  -- 截关(Commercial Cargo Cutoff)
alter table public.shipments add column if not exists deadlines_raw jsonb;       -- 原始全部截止时间 + 终端名
alter table public.shipments add column if not exists deadlines_synced_at timestamptz;
alter table public.shipments add column if not exists deadlines_status text;     -- ok|not_found|no_imo|missing_input|error

-- 审计排除：自动刷新写的状态/时间戳/原始报文不计入历史（*_cutoff 仍记录，截止时间变更有意义）
create or replace function public.fn_shipments_audit() returns trigger as $$
declare
  v_changes jsonb := '{}'::jsonb;
  v_uid uuid := auth.uid();
  v_excluded text[] := array[
    'updated_at', 'created_at', 'created_by',
    'eta_synced_at', 'eta_track_status',
    'deadlines_synced_at', 'deadlines_status', 'deadlines_raw',
    '_customer_backup', '_supplier_backup', '_order_no_backup'
  ];
  v_col text; v_old jsonb; v_new jsonb;
  v_old_row jsonb := to_jsonb(OLD);
  v_new_row jsonb := to_jsonb(NEW);
begin
  for v_col in select jsonb_object_keys(v_new_row) loop
    if v_col = any(v_excluded) then continue; end if;
    v_old := v_old_row -> v_col;
    v_new := v_new_row -> v_col;
    if v_old is distinct from v_new then
      v_changes := v_changes || jsonb_build_object(v_col, jsonb_build_object('old', v_old, 'new', v_new));
    end if;
  end loop;
  if v_changes <> '{}'::jsonb then
    insert into public.shipments_audit (shipment_id, changed_by, changes)
    values (NEW.id, v_uid, v_changes);
  end if;
  return NEW;
end;
$$ language plpgsql security definer;

-- 每 12 小时批量同步截止时间
select cron.unschedule('track-deadlines-12h') where exists (select 1 from cron.job where jobname = 'track-deadlines-12h');
select cron.schedule('track-deadlines-12h', '13 */12 * * *', $cron$
  select net.http_post(
    url     := 'https://pewdvheoaqofmzwhwwvu.supabase.co/functions/v1/track-deadlines-batch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-key',  (select decrypted_secret from vault.decrypted_secrets where name = 'track_eta_cron_key')
    ),
    body    := jsonb_build_object('source', 'cron')
  );
$cron$);

-- 每小时扫描：24 小时内临期的 截单/截VGM/截关 → 写站内提醒（同票同字段未处理时不重复）
select cron.unschedule('deadline-reminders-hourly') where exists (select 1 from cron.job where jobname = 'deadline-reminders-hourly');
select cron.schedule('deadline-reminders-hourly', '23 * * * *', $cron$
  insert into public.shipment_notifications (shipment_id, kind, field, old_value, new_value, summary, source)
  select s.id, 'deadline_soon', d.field, null,
         to_char(d.cut at time zone 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI'),
         coalesce(s.order_no, '') || ' ' || d.label || '临期 ' ||
           to_char(d.cut at time zone 'Asia/Shanghai', 'MM-DD HH24:MI'),
         'deadline_auto'
  from public.shipments s
  cross join lateral (values
    ('si_cutoff',  s.si_cutoff,  '截单(SI)'),
    ('vgm_cutoff', s.vgm_cutoff, '截VGM'),
    ('cy_cutoff',  s.cy_cutoff,  '截关')
  ) as d(field, cut, label)
  where d.cut is not null
    and d.cut between now() and now() + interval '24 hours'
    and coalesce(s.lifecycle, '') not in ('已完结', '已关闭')
    and not exists (
      select 1 from public.shipment_notifications n
      where n.shipment_id = s.id and n.field = d.field
        and n.kind = 'deadline_soon' and n.is_resolved = false
    );
$cron$);
