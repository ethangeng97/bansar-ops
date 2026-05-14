-- ═══════════════════════════════════════════════════════════════
-- 013_shipment_attachments.sql
-- 作业附件：每票挂多个文件（订舱委托书 / 提单截图 / 报关单等）
-- 文件本体放 Supabase Storage bucket "shipment-attachments"
-- 元信息存这张表
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.shipment_attachments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id   uuid NOT NULL REFERENCES public.shipments(id) ON DELETE CASCADE,
  filename      text NOT NULL,                  -- 原始文件名
  storage_path  text NOT NULL,                  -- bucket 里的路径，如 "<shipment_id>/<uuid>-原名"
  mime_type     text,
  file_size     bigint,                         -- 字节
  note          text,                           -- 备注（订舱委托书 / 提单 / 报关单 …）
  uploaded_by   uuid REFERENCES auth.users(id),
  uploaded_at   timestamptz DEFAULT now(),
  sort_order    int DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_shp_attach_shipment ON public.shipment_attachments(shipment_id);

-- ─── RLS ───
ALTER TABLE public.shipment_attachments ENABLE ROW LEVEL SECURITY;

-- 能看父分票就能看附件
DROP POLICY IF EXISTS sa_select ON public.shipment_attachments;
CREATE POLICY sa_select ON public.shipment_attachments FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.shipments s WHERE s.id = shipment_id
                 AND public.can_see_shipment(s.customer, s.customer_id)));

DROP POLICY IF EXISTS sa_insert ON public.shipment_attachments;
CREATE POLICY sa_insert ON public.shipment_attachments FOR INSERT
  WITH CHECK (public.current_role() IN ('admin','operator','sales'));

DROP POLICY IF EXISTS sa_update ON public.shipment_attachments;
CREATE POLICY sa_update ON public.shipment_attachments FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.shipments s WHERE s.id = shipment_id
                 AND public.can_see_shipment(s.customer, s.customer_id)));

DROP POLICY IF EXISTS sa_delete ON public.shipment_attachments;
CREATE POLICY sa_delete ON public.shipment_attachments FOR DELETE
  USING (public.current_role() IN ('admin','operator'));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.shipment_attachments TO authenticated;

-- ─── Storage bucket（私有；URL 用 signed URL 拿）───
INSERT INTO storage.buckets (id, name, public)
VALUES ('shipment-attachments', 'shipment-attachments', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS sa_obj_select ON storage.objects;
CREATE POLICY sa_obj_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'shipment-attachments');

DROP POLICY IF EXISTS sa_obj_insert ON storage.objects;
CREATE POLICY sa_obj_insert ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'shipment-attachments' AND public.current_role() IN ('admin','operator','sales'));

DROP POLICY IF EXISTS sa_obj_delete ON storage.objects;
CREATE POLICY sa_obj_delete ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'shipment-attachments' AND public.current_role() IN ('admin','operator'));
