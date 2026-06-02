-- ═══════════════════════════════════════════════════════════════
-- 035_spot_booking_cancellations.sql
-- 退关留痕：把舱位从订单退回现舱时记一条审计（谁、退几柜、原因、退关费）
--
-- 背景：现舱用计算式库存（可用 = total_qty − Σ已售柜），退关本身是
--   "解绑/减少 shipments.spot_booking_id 占用"——这个动作过去无声无息，
--   月报/对账查不到。这张表给退关事件一个一级记录。
-- 注意：订单可能事后被删，所以船期/订单号/客户都冗余快照在本表，不靠 FK。
-- 内部表，仅 ops 角色可读写（internal_roles()，跟 028 RBAC 对齐）。
-- IF NOT EXISTS，可重复执行。
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.spot_booking_cancellations (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 关联（订单/现舱可能被删，故都 ON DELETE SET NULL，靠下面快照兜底）
  spot_booking_id      uuid REFERENCES public.spot_bookings(id) ON DELETE SET NULL,  -- 退回的源现舱
  new_spot_booking_id  uuid REFERENCES public.spot_bookings(id) ON DELETE SET NULL,  -- 改配的目标现舱
  shipment_id          uuid REFERENCES public.shipments(id)     ON DELETE SET NULL,

  -- 快照（订单删了也能查）
  order_no             text,
  customer             text,
  carrier              text,
  vessel               text,
  voyage               text,
  pol                  text,
  pod                  text,
  etd                  date,

  -- 退关本身
  mode                 text NOT NULL DEFAULT 'cancel'
                         CHECK (mode IN ('cancel','partial','reassign')),
  qty_returned         integer NOT NULL DEFAULT 0,   -- 退回/改配的柜数
  reason               text,                         -- 退关原因
  cancel_fee           numeric(12,2),                -- 退关费（如船司收）
  currency             text DEFAULT 'USD',

  operator_id          uuid REFERENCES public.user_profiles(id),
  created_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_spotcancel_spot     ON public.spot_booking_cancellations(spot_booking_id);
CREATE INDEX IF NOT EXISTS idx_spotcancel_shipment ON public.spot_booking_cancellations(shipment_id);
CREATE INDEX IF NOT EXISTS idx_spotcancel_created  ON public.spot_booking_cancellations(created_at);

-- ─── RLS：内部角色全权，外部客户无权 ───
ALTER TABLE public.spot_booking_cancellations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS spotcancel_internal_rw ON public.spot_booking_cancellations;
CREATE POLICY spotcancel_internal_rw ON public.spot_booking_cancellations
  USING      (public.current_user_role() = ANY (public.internal_roles()))
  WITH CHECK (public.current_user_role() = ANY (public.internal_roles()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.spot_booking_cancellations TO authenticated;
