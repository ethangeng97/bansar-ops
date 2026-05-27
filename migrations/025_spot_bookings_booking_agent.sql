-- ═══════════════════════════════════════════════════════════════
-- 025_spot_bookings_booking_agent.sql
-- spot_bookings 增加「订舱代理」字段（ops 内部用，跟船公司订舱的中间人）
-- 区分于 partner_id/partner_name（那个是关联给哪个客户/海外代理的）
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.spot_bookings
  ADD COLUMN IF NOT EXISTS booking_agent_id    uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS booking_agent_name  text;

CREATE INDEX IF NOT EXISTS idx_spot_bookings_booking_agent ON public.spot_bookings(booking_agent_id);
