-- ═══════════════════════════════════════════════════════════════
-- 031_carrier_departure.sql
-- 船司轨迹除"到港 ETA"外，再记"船司报的开船日"。
-- 沿用 026 的约定：*_carrier 存船司值(始终覆盖)，eta/etd/atd 为人工值(仅空白时由船司值回填)。
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS etd_carrier date;  -- 船司预计开船
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS atd_carrier date;  -- 船司实际开船
