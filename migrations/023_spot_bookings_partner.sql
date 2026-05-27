-- ═══════════════════════════════════════════════════════════════
-- 023_spot_bookings_partner.sql
-- spot_bookings 增加关联客户/海外代理：
--   partner_id   — FK 到 customers.id（可空，可以是客户 或 海外代理类型）
--   partner_name — 冗余存名字，方便列表展示和搜索
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.spot_bookings
  ADD COLUMN IF NOT EXISTS partner_id    uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS partner_name  text;

CREATE INDEX IF NOT EXISTS idx_spot_bookings_partner ON public.spot_bookings(partner_id);
