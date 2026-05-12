-- ═══════════════════════════════════════════════════════════════
-- 008_cargo_items.sql
-- 货物明细表（品名级），给单证（BL/SI）+ portal loading detail 用
-- 与 shipments(分票) 是 N:1 关系；按 container_no / hbl_no 还能做
--   按箱合计、按提单合计两个聚合视角
-- 使用 IF NOT EXISTS, 重复执行安全
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.cargo_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id      uuid NOT NULL REFERENCES public.shipments(id) ON DELETE CASCADE,
  hbl_no           text,                          -- 提单号（一般等于 shipments.hbl_no，冗余存便于 group）
  container_no     text,                          -- 箱号
  seal_no          text,                          -- 封号
  container_type   text,                          -- 箱型 e.g. 40HC / 20GP
  product_name_en  text,                          -- 英文品名
  hs_code          text,                          -- HS 编码
  qty              integer,                       -- 件数
  package_unit     text DEFAULT 'CARTONS',        -- 包装单位
  gross_weight     numeric(12,3),                 -- 毛重 KGS
  volume           numeric(12,3),                 -- 体积 CBM
  marks            text,                          -- 唛头
  un               text,                          -- 危险品 UN 编号
  cl               text,                          -- 危险品 Class
  sort_order       int DEFAULT 0,                 -- 同一分票内的排序
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cargo_items_shipment   ON public.cargo_items(shipment_id);
CREATE INDEX IF NOT EXISTS idx_cargo_items_container  ON public.cargo_items(container_no);
CREATE INDEX IF NOT EXISTS idx_cargo_items_hbl        ON public.cargo_items(hbl_no);

-- 自动维护 updated_at（依赖前面 migration 已有的 set_updated_at()；没有就用 now()）
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    DROP TRIGGER IF EXISTS cargo_items_updated_at ON public.cargo_items;
    CREATE TRIGGER cargo_items_updated_at
      BEFORE UPDATE ON public.cargo_items
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

-- ─── RLS ───
ALTER TABLE public.cargo_items ENABLE ROW LEVEL SECURITY;

-- 可见性：跟父分票（shipments）一致
DROP POLICY IF EXISTS ci_select ON public.cargo_items;
CREATE POLICY ci_select ON public.cargo_items FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.shipments s
    WHERE s.id = shipment_id
      AND public.can_see_shipment(s.customer, s.customer_id)
  ));

DROP POLICY IF EXISTS ci_insert ON public.cargo_items;
CREATE POLICY ci_insert ON public.cargo_items FOR INSERT
  WITH CHECK (public.current_role() IN ('admin','operator','sales'));

DROP POLICY IF EXISTS ci_update ON public.cargo_items;
CREATE POLICY ci_update ON public.cargo_items FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.shipments s
    WHERE s.id = shipment_id
      AND public.can_see_shipment(s.customer, s.customer_id)
  ));

DROP POLICY IF EXISTS ci_delete ON public.cargo_items;
CREATE POLICY ci_delete ON public.cargo_items FOR DELETE
  USING (public.current_role() IN ('admin','operator'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cargo_items TO authenticated;
