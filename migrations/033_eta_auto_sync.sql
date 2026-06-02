-- ═══════════════════════════════════════════════════════════════
-- 033_eta_auto_sync.sql
-- ETA/开船 自动同步 Phase 2：每 6 小时定时批量查 Maersk + 站内变更告警。
--   1) shipment_notifications：船司轨迹变更的站内通知（OPS 可读/标记已处理）
--   2) fn_shipments_audit 排除 eta_synced_at / eta_track_status（每 6h 刷时间戳不污染历史）
--   3) pg_cron + pg_net：每 6 小时 POST track-eta-batch（x-cron-key 走 vault）
-- 配套（不在本 migration，避免密钥进 git）：
--   - vault 里建 secret 'track_eta_cron_key'
--   - edge function track-eta-batch 设 env TRACK_ETA_CRON_KEY 为同值
-- ═══════════════════════════════════════════════════════════════

-- ── 1) 站内通知表 ───────────────────────────────────────────────
create table if not exists public.shipment_notifications (
  id           bigserial primary key,
  shipment_id  uuid not null references public.shipments(id) on delete cascade,
  kind         text not null,                       -- eta_change | etd_change | atd_change
  field        text not null,                       -- eta_carrier | etd_carrier | atd_carrier
  old_value    text,
  new_value    text,
  summary      text not null,                       -- 人读摘要
  source       text not null default 'maersk_auto', -- maersk_auto | maersk_manual
  created_at   timestamptz not null default now(),
  is_resolved  boolean not null default false,
  resolved_by  uuid references auth.users(id),
  resolved_at  timestamptz
);
create index if not exists idx_shp_notif_unresolved on public.shipment_notifications(is_resolved, created_at desc);
create index if not exists idx_shp_notif_shipment   on public.shipment_notifications(shipment_id, created_at desc);

alter table public.shipment_notifications enable row level security;

-- 内部员工（非 customer）可读、可标记已处理；插入只由 service_role（绕过 RLS）
drop policy if exists shp_notif_select on public.shipment_notifications;
create policy shp_notif_select on public.shipment_notifications for select
  using (exists (select 1 from public.user_profiles up where up.id = auth.uid() and up.role <> 'customer'));

drop policy if exists shp_notif_update on public.shipment_notifications;
create policy shp_notif_update on public.shipment_notifications for update
  using      (exists (select 1 from public.user_profiles up where up.id = auth.uid() and up.role <> 'customer'))
  with check (exists (select 1 from public.user_profiles up where up.id = auth.uid() and up.role <> 'customer'));

drop policy if exists shp_notif_no_insert on public.shipment_notifications;
create policy shp_notif_no_insert on public.shipment_notifications for insert with check (false);
drop policy if exists shp_notif_no_delete on public.shipment_notifications;
create policy shp_notif_no_delete on public.shipment_notifications for delete using (false);

grant select on public.shipment_notifications to authenticated;
-- 只允许更新这三列（标记已处理）
grant update (is_resolved, resolved_by, resolved_at) on public.shipment_notifications to authenticated;

-- ── 2) 审计排除自动刷新写的两列 ─────────────────────────────────
create or replace function public.fn_shipments_audit() returns trigger as $$
declare
  v_changes jsonb := '{}'::jsonb;
  v_uid uuid := auth.uid();
  v_excluded text[] := array[
    'updated_at', 'created_at', 'created_by',
    'eta_synced_at', 'eta_track_status',          -- ← 每 6h 自动刷，不计入历史
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

-- ── 3) 定时任务：每 6 小时触发批量同步 ──────────────────────────
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('track-eta-6h') where exists (select 1 from cron.job where jobname = 'track-eta-6h');

select cron.schedule('track-eta-6h', '7 */6 * * *', $cron$
  select net.http_post(
    url     := 'https://pewdvheoaqofmzwhwwvu.supabase.co/functions/v1/track-eta-batch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-key',  (select decrypted_secret from vault.decrypted_secrets where name = 'track_eta_cron_key')
    ),
    body    := jsonb_build_object('source', 'cron')
  );
$cron$);
