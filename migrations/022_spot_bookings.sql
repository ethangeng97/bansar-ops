-- ═══════════════════════════════════════════════════════════════
-- 022_spot_bookings.sql
-- 海运出口现舱（spot bookings）表
-- 用法：操作提前从船公司订下舱位，落进系统作为"现舱"；
-- 销售看着这张表卖给客户，每卖出去一柜会创建对应 shipment
-- 并通过 shipments.spot_booking_id 反向关联。
-- 安全：authenticated 都能看（共享库存），admin/operator/sales 可改，
--      只 admin 能删（避免误删带订单的现舱）。
-- IF NOT EXISTS，可重复执行。
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.spot_bookings (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- 船期
  carrier           text NOT NULL,                 -- 船公司
  vessel            text,                          -- 船名
  voyage            text,                          -- 航次
  route             text,                          -- 航线（如 USEC / NEU）
  pol               text NOT NULL,                 -- 起运港名称
  pod               text NOT NULL,                 -- 卸货港名称
  etd               date,
  eta               date,

  -- 柜信息
  container_size    text,                          -- 20 / 40 / 45
  container_type    text,                          -- HC / HQ / GP / RF
  total_qty         integer NOT NULL DEFAULT 0,    -- 总舱位数

  -- 截单
  si_cutoff         timestamptz,                   -- SI 截单
  vgm_cutoff        timestamptz,                   -- VGM 截单
  customs_cutoff    timestamptz,                   -- 报关截单
  port_cutoff       timestamptz,                   -- 截港

  -- 价格
  purchase_price    numeric(12,2),                 -- 进价（单柜）
  sell_price_min    numeric(12,2),                 -- 售价区间下限
  sell_price_max    numeric(12,2),                 -- 售价区间上限
  currency          text DEFAULT 'USD',

  -- 船公司侧
  booking_no        text,                          -- 船公司订舱号
  mbl_no            text,                          -- MBL号（如分摊到一份大 MBL）

  -- 业务
  status            text DEFAULT '可售',           -- 可售/部分已售/全部已售/已取消/已截单
  operator_id       uuid REFERENCES public.user_profiles(id),
  notes             text,

  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_spot_bookings_etd      ON public.spot_bookings(etd);
CREATE INDEX IF NOT EXISTS idx_spot_bookings_status   ON public.spot_bookings(status);
CREATE INDEX IF NOT EXISTS idx_spot_bookings_carrier  ON public.spot_bookings(carrier);

-- shipments 增加反向 FK
ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS spot_booking_id uuid REFERENCES public.spot_bookings(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_shipments_spot_booking ON public.shipments(spot_booking_id);

-- updated_at 触发器（复用全局 set_updated_at）
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    DROP TRIGGER IF EXISTS spot_bookings_updated_at ON public.spot_bookings;
    CREATE TRIGGER spot_bookings_updated_at
      BEFORE UPDATE ON public.spot_bookings
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

-- ─── RLS ───
ALTER TABLE public.spot_bookings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sb_select ON public.spot_bookings;
CREATE POLICY sb_select ON public.spot_bookings FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS sb_insert ON public.spot_bookings;
CREATE POLICY sb_insert ON public.spot_bookings FOR INSERT
  WITH CHECK (public.current_role() IN ('admin','operator','sales'));

DROP POLICY IF EXISTS sb_update ON public.spot_bookings;
CREATE POLICY sb_update ON public.spot_bookings FOR UPDATE
  USING (public.current_role() IN ('admin','operator','sales'));

DROP POLICY IF EXISTS sb_delete ON public.spot_bookings;
CREATE POLICY sb_delete ON public.spot_bookings FOR DELETE
  USING (public.current_role() = 'admin');

GRANT SELECT, INSERT, UPDATE, DELETE ON public.spot_bookings TO authenticated;
