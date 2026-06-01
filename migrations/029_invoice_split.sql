-- ═══════════════════════════════════════════════════════════════
-- 029_invoice_split.sql
-- 开票申请「按税率拆分多张发票」——完成开票下沉到费用(charge)层
--   一个开票申请可对应多张发票；同一账单的费用按税率分到不同发票
--   (如 代理报关费 6% 一张、海运费等 免税 一张、拖车费 9% 一张)
-- ═══════════════════════════════════════════════════════════════

-- 1) invoices 增 request_id：一个申请的多张发票挂上来
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS request_id uuid REFERENCES public.invoice_requests(id);
CREATE INDEX IF NOT EXISTS idx_invoices_request ON public.invoices(request_id);

-- 2) 发票文件归属到具体那张发票(为空=申请级附件，向后兼容)
ALTER TABLE public.invoice_request_files ADD COLUMN IF NOT EXISTS invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL;

-- 3) 发票 ↔ 费用 精确关联
CREATE TABLE IF NOT EXISTS public.invoice_charges (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  charge_id  uuid NOT NULL REFERENCES public.charges(id),
  amount     numeric(18,2),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (invoice_id, charge_id)
);
CREATE INDEX IF NOT EXISTS idx_invoice_charges_invoice ON public.invoice_charges(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_charges_charge  ON public.invoice_charges(charge_id);

ALTER TABLE public.invoice_charges ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS invoice_charges_all ON public.invoice_charges;
CREATE POLICY invoice_charges_all ON public.invoice_charges
  USING (EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = invoice_charges.invoice_id));

-- 4) RPC：按费用分组完成开票(多张发票)
CREATE OR REPLACE FUNCTION public.complete_invoice_request_split(p_request_id uuid, p_invoices jsonb)
  RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_req      invoice_requests%ROWTYPE;
  v_all      uuid[];
  v_passed   uuid[];
  v_inv      jsonb;
  v_inv_id   uuid;
  v_cids     uuid[];
  v_amount   numeric(18,2);
  v_excl     numeric(18,2);
  v_rate     numeric;
  v_nrate    int;
  n          int := 0;
BEGIN
  IF COALESCE(public.current_user_role(),'') NOT IN ('admin','finance','finance_ar') THEN
    RAISE EXCEPTION '无权完成开票（仅应收财务/管理员）'; END IF;

  SELECT * INTO v_req FROM invoice_requests WHERE id = p_request_id;
  IF NOT FOUND THEN RAISE EXCEPTION '开票申请不存在'; END IF;
  IF v_req.status <> 'pending' THEN RAISE EXCEPTION '该申请状态为 %，无法完成开票', v_req.status; END IF;
  IF p_invoices IS NULL OR jsonb_array_length(p_invoices) = 0 THEN RAISE EXCEPTION '至少需要一张发票'; END IF;

  -- 申请覆盖账单下的全部应收费用
  SELECT array_agg(c.id) INTO v_all
    FROM charges c
   WHERE c.bill_id IN (SELECT bill_id FROM invoice_request_bills WHERE request_id = p_request_id)
     AND c.direction = '应收';
  IF v_all IS NULL THEN RAISE EXCEPTION '该申请关联账单下没有应收费用，无法拆票'; END IF;

  -- 收集所有发票分到的费用，校验：不重复
  SELECT array_agg(x) INTO v_passed FROM (
    SELECT (jsonb_array_elements_text(inv->'charge_ids'))::uuid AS x
      FROM jsonb_array_elements(p_invoices) inv
  ) t;
  IF (SELECT count(*) FROM (SELECT u FROM unnest(v_passed) u GROUP BY u HAVING count(*) > 1) d) > 0 THEN
    RAISE EXCEPTION '有费用被分配到多张发票'; END IF;
  -- 全覆盖(集合相等)
  IF EXISTS (SELECT 1 FROM (SELECT unnest(v_all) EXCEPT SELECT unnest(v_passed)) z)
     OR EXISTS (SELECT 1 FROM (SELECT unnest(v_passed) EXCEPT SELECT unnest(v_all)) z) THEN
    RAISE EXCEPTION '费用分配不完整或含无关费用：须把全部应收费用各分配到一张发票'; END IF;

  FOR v_inv IN SELECT * FROM jsonb_array_elements(p_invoices) LOOP
    IF COALESCE(btrim(v_inv->>'invoice_no'),'') = '' THEN RAISE EXCEPTION '存在未填发票号的发票'; END IF;
    SELECT array_agg(value::uuid) INTO v_cids FROM jsonb_array_elements_text(v_inv->'charge_ids');
    IF v_cids IS NULL THEN RAISE EXCEPTION '存在未分配费用的发票'; END IF;

    -- 金额：价税合计 = Σ费用；不含税按每条费用各自税率反推；税率单一则记该值，否则 NULL(混合)
    SELECT SUM(amount_total),
           SUM(round(amount_total / (1 + COALESCE(tax_rate,0)/100), 2)),
           count(DISTINCT COALESCE(tax_rate,0))
      INTO v_amount, v_excl, v_nrate
      FROM charges WHERE id = ANY(v_cids);
    v_rate := CASE WHEN v_nrate = 1 THEN (SELECT DISTINCT COALESCE(tax_rate,0) FROM charges WHERE id = ANY(v_cids)) ELSE NULL END;

    INSERT INTO invoices(request_id, invoice_no, invoice_date, direction, kind, partner_id, partner_name,
      currency, tax_rate, amount_total, amount_excl_tax, tax_amount, source_status)
    VALUES (p_request_id, btrim(v_inv->>'invoice_no'), NULLIF(v_inv->>'invoice_date','')::date, 'AR', 'business',
      v_req.customer_id, v_req.partner_name, v_req.currency, v_rate, v_amount, v_excl, v_amount - v_excl, '正常')
    RETURNING id INTO v_inv_id;

    INSERT INTO invoice_charges(invoice_id, charge_id, amount)
    SELECT v_inv_id, id, amount_total FROM charges WHERE id = ANY(v_cids);

    UPDATE charges SET invoice_no = btrim(v_inv->>'invoice_no'), invoice_date = NULLIF(v_inv->>'invoice_date','')::date
     WHERE id = ANY(v_cids);

    -- invoice_bills：按账单汇总该发票覆盖的费用金额(供开票记录/核销对账)
    INSERT INTO invoice_bills(invoice_id, bill_id, applied_amount)
    SELECT v_inv_id, c.bill_id, SUM(c.amount_total)
      FROM charges c WHERE c.id = ANY(v_cids) AND c.bill_id IS NOT NULL
      GROUP BY c.bill_id
    ON CONFLICT (invoice_id, bill_id) DO UPDATE SET applied_amount = EXCLUDED.applied_amount;

    IF COALESCE(v_inv->>'file_url','') <> '' THEN
      INSERT INTO invoice_request_files(request_id, invoice_id, file_url, file_name, uploaded_by)
      VALUES (p_request_id, v_inv_id, v_inv->>'file_url', v_inv->>'file_name', auth.uid());
    END IF;

    n := n + 1;
  END LOOP;

  -- 账单发票号：去重拼接其费用涉及的所有发票号
  UPDATE bills b SET invoice_no = sub.nos, invoice_date = sub.dt
  FROM (
    SELECT c.bill_id, string_agg(DISTINCT c.invoice_no, ' / ') nos, min(c.invoice_date) dt
      FROM charges c
     WHERE c.bill_id IN (SELECT bill_id FROM invoice_request_bills WHERE request_id = p_request_id)
       AND c.invoice_no IS NOT NULL
     GROUP BY c.bill_id
  ) sub
  WHERE b.id = sub.bill_id;

  UPDATE invoice_requests SET status='completed', completed_by=auth.uid(), completed_at=now(),
    invoice_no = (SELECT string_agg(DISTINCT invoice_no, ' / ') FROM invoices WHERE request_id = p_request_id),
    invoice_date = (SELECT min(invoice_date) FROM invoices WHERE request_id = p_request_id)
   WHERE id = p_request_id;

  RETURN n;
END $$;

REVOKE EXECUTE ON FUNCTION public.complete_invoice_request_split(uuid, jsonb) FROM anon;
