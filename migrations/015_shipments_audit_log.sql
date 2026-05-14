-- ═══════════════════════════════════════════════════════════════
-- 015_shipments_audit_log.sql
-- 作业修改历史：trigger AFTER UPDATE 算 diff，存 JSONB
-- 详情页"历史"按钮读这张表展示
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.shipments_audit (
  id          bigserial PRIMARY KEY,
  shipment_id uuid NOT NULL REFERENCES public.shipments(id) ON DELETE CASCADE,
  changed_at  timestamptz DEFAULT now(),
  changed_by  uuid REFERENCES auth.users(id),
  changes     jsonb NOT NULL          -- {col1: {old, new}, col2: {old, new}, ...}
);

CREATE INDEX IF NOT EXISTS idx_shp_audit_shipment_time
  ON public.shipments_audit(shipment_id, changed_at DESC);

CREATE OR REPLACE FUNCTION public.fn_shipments_audit() RETURNS trigger AS $$
DECLARE
  v_changes jsonb := '{}'::jsonb;
  v_uid uuid := auth.uid();
  v_excluded text[] := ARRAY[
    'updated_at', 'created_at', 'created_by',
    '_customer_backup', '_supplier_backup', '_order_no_backup'
  ];
  v_col text;
  v_old jsonb;
  v_new jsonb;
  v_old_row jsonb := to_jsonb(OLD);
  v_new_row jsonb := to_jsonb(NEW);
BEGIN
  FOR v_col IN SELECT jsonb_object_keys(v_new_row) LOOP
    IF v_col = ANY(v_excluded) THEN CONTINUE; END IF;
    v_old := v_old_row -> v_col;
    v_new := v_new_row -> v_col;
    IF v_old IS DISTINCT FROM v_new THEN
      v_changes := v_changes || jsonb_build_object(v_col, jsonb_build_object('old', v_old, 'new', v_new));
    END IF;
  END LOOP;
  IF v_changes <> '{}'::jsonb THEN
    INSERT INTO public.shipments_audit (shipment_id, changed_by, changes)
    VALUES (NEW.id, v_uid, v_changes);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_shipments_audit ON public.shipments;
CREATE TRIGGER trg_shipments_audit
  AFTER UPDATE ON public.shipments
  FOR EACH ROW EXECUTE FUNCTION public.fn_shipments_audit();

ALTER TABLE public.shipments_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sa_audit_select ON public.shipments_audit;
CREATE POLICY sa_audit_select ON public.shipments_audit FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.shipments s
                 WHERE s.id = shipment_id
                   AND public.can_see_shipment(s.customer, s.customer_id)));

DROP POLICY IF EXISTS sa_audit_insert ON public.shipments_audit;
CREATE POLICY sa_audit_insert ON public.shipments_audit FOR INSERT WITH CHECK (false);
DROP POLICY IF EXISTS sa_audit_update ON public.shipments_audit;
CREATE POLICY sa_audit_update ON public.shipments_audit FOR UPDATE USING (false);
DROP POLICY IF EXISTS sa_audit_delete ON public.shipments_audit;
CREATE POLICY sa_audit_delete ON public.shipments_audit FOR DELETE USING (false);

GRANT SELECT ON public.shipments_audit TO authenticated;
