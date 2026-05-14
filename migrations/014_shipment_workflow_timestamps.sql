-- ═══════════════════════════════════════════════════════════════
-- 014_shipment_workflow_timestamps.sql
-- 5 个流程确认时间戳字段（atd 已有，用于开船确认）
--   manifest_confirmed_at   舱单确认（舱单发通了）
--   route_confirmed_at      航线确认（航线/商务确认放舱）
--   booking_confirmed_at    订舱确认（确认安排订舱）
--   space_released_at       放舱确认（船公司放舱）
--   container_released_at   放箱确认（开放刷箱）
-- atd                       开船确认（船真的开了，BL 用作 Loading on Board Date）
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS manifest_confirmed_at  timestamptz;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS route_confirmed_at      timestamptz;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS booking_confirmed_at    timestamptz;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS space_released_at       timestamptz;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS container_released_at   timestamptz;
