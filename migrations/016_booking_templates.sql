-- ═══════════════════════════════════════════════════════════════
-- 016_booking_templates.sql
-- 订舱模板：常用航线/客户预设字段
-- 新建作业 / 详情页 "订舱模板" 入口 → 加载到 shipment 上
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.booking_templates (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,                   -- 模板名（"Keplin 宁波→Felixstowe 周一线"）
  description  text,
  shipment_type text,                           -- FCL / LCL / Console
  snapshot     jsonb NOT NULL,                  -- {col: value, ...}
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now(),
  created_by   uuid REFERENCES auth.users(id),
  use_count    int DEFAULT 0,                   -- 被 apply 次数（按热度排序）
  active       boolean DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_booking_templates_name ON public.booking_templates(name) WHERE active;

ALTER TABLE public.booking_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bt_select ON public.booking_templates;
CREATE POLICY bt_select ON public.booking_templates FOR SELECT USING (true);

DROP POLICY IF EXISTS bt_insert ON public.booking_templates;
CREATE POLICY bt_insert ON public.booking_templates FOR INSERT
  WITH CHECK (public.current_role() IN ('admin','operator','sales'));

DROP POLICY IF EXISTS bt_update ON public.booking_templates;
CREATE POLICY bt_update ON public.booking_templates FOR UPDATE
  USING (public.current_role() IN ('admin','operator','sales'));

DROP POLICY IF EXISTS bt_delete ON public.booking_templates;
CREATE POLICY bt_delete ON public.booking_templates FOR DELETE
  USING (public.current_role() IN ('admin','operator'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.booking_templates TO authenticated;
