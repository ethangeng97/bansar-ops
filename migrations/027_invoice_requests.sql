-- ═══════════════════════════════════════════════════════════════
-- 027_invoice_requests.sql
-- 开票申请工作流（AR / 我方给客户开票）
--   内部操作/客服 或 客户在 portal 发起「开票申请」 → 应收财务在队列看到
--   → 财务开票后上传发票 PDF + 填票号/日期 → 「完成开票」
--   → 自动生成 invoices + invoice_bills，盖 bills.invoice_no，客户可在 portal 下载
--
-- 与现有「一步开票」(issue_invoice) 并存，互不影响。
-- RLS 照搬 payment_vouchers / shipment_documents 范式：
--   internal_rw_all（内部角色全权） + customer_rw_own（customer_id = 本客户）
-- ═══════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────
-- 1) 表
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.invoice_requests (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_no     text UNIQUE,
  direction      text NOT NULL DEFAULT 'AR' CHECK (direction IN ('AR','AP')),
  status         text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','completed','rejected','cancelled')),
  customer_id    uuid REFERENCES public.customers(id),   -- 被开票客户（portal RLS 关键）
  partner_name   text,                                   -- 客户名快照
  currency       text DEFAULT 'CNY',
  amount_total   numeric(18,2) NOT NULL DEFAULT 0,       -- 申请金额 = 所选账单合计
  statement_id   bigint,                                 -- 若由某张对账单发起
  invoice_title  text,                                   -- 开票抬头（客户可填）
  tax_no         text,                                   -- 税号
  request_note   text,
  requested_by   uuid,
  requested_at   timestamptz NOT NULL DEFAULT now(),
  -- 完成开票时回填
  invoice_id     uuid REFERENCES public.invoices(id),
  invoice_no     text,
  invoice_date   date,
  completed_by   uuid,
  completed_at   timestamptz,
  complete_note  text,
  reject_note    text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invreq_status   ON public.invoice_requests(status);
CREATE INDEX IF NOT EXISTS idx_invreq_customer ON public.invoice_requests(customer_id);
CREATE INDEX IF NOT EXISTS idx_invreq_reqat    ON public.invoice_requests(requested_at);

-- 申请 ↔ 账单
CREATE TABLE IF NOT EXISTS public.invoice_request_bills (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id  uuid NOT NULL REFERENCES public.invoice_requests(id) ON DELETE CASCADE,
  bill_id     uuid NOT NULL REFERENCES public.bills(id)            ON DELETE CASCADE,
  amount      numeric(18,2),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, bill_id)
);

CREATE INDEX IF NOT EXISTS idx_invreqbills_req  ON public.invoice_request_bills(request_id);
CREATE INDEX IF NOT EXISTS idx_invreqbills_bill ON public.invoice_request_bills(bill_id);

-- 申请 ↔ 发票文件（支持一申请多票）
CREATE TABLE IF NOT EXISTS public.invoice_request_files (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id  uuid NOT NULL REFERENCES public.invoice_requests(id) ON DELETE CASCADE,
  file_url    text NOT NULL,                             -- storage path: {customer_id}/{request_id}/{uuid}-{name}
  file_name   text,
  file_size   bigint,
  mime_type   text,
  uploaded_by uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invreqfiles_req ON public.invoice_request_files(request_id);

-- updated_at 自动维护（复用 006 的同款 trigger 函数命名习惯）
CREATE OR REPLACE FUNCTION public.tg_invoice_requests_updated_at() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS invoice_requests_updated_at ON public.invoice_requests;
CREATE TRIGGER invoice_requests_updated_at
BEFORE UPDATE ON public.invoice_requests
FOR EACH ROW EXECUTE FUNCTION public.tg_invoice_requests_updated_at();

-- ─────────────────────────────────────────────
-- 2) 申请号生成（仿 next_payment_no：IR-YYYY-NNNN）
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.gen_invoice_request_no()
  RETURNS text LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  prefix text := 'IR';
  yr     text := to_char(now(), 'YYYY');
  seq    int;
BEGIN
  SELECT COALESCE(MAX(NULLIF((regexp_match(request_no, '\d+$'))[1], '')::int), 0) + 1
    INTO seq
    FROM public.invoice_requests
   WHERE request_no LIKE prefix || '-' || yr || '-%';
  RETURN prefix || '-' || yr || '-' || lpad(seq::text, 4, '0');
END $$;

-- ─────────────────────────────────────────────
-- 3) RPC：创建开票申请
--    内部角色可为任意客户发起；外部客户只能为自己的账单发起。
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_invoice_request(
  p_bill_ids      uuid[],
  p_note          text DEFAULT NULL,
  p_invoice_title text DEFAULT NULL,
  p_tax_no        text DEFAULT NULL
) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role       text := public.current_user_role();
  v_my_cust    uuid := public.current_user_customer_id();
  v_partner_id uuid;
  v_currency   text;
  v_total      numeric(18,2);
  v_partner_nm text;
  v_req_id     uuid;
BEGIN
  IF array_length(p_bill_ids, 1) IS NULL THEN
    RAISE EXCEPTION '请至少选择一张账单';
  END IF;

  -- 同质性校验：同结算单位 / 同币别 / 全为应收
  IF (SELECT count(DISTINCT partner_id) FROM bills WHERE id = ANY(p_bill_ids)) <> 1 THEN
    RAISE EXCEPTION '所选账单结算单位不一致，无法合并申请';
  END IF;
  IF (SELECT count(DISTINCT currency) FROM bills WHERE id = ANY(p_bill_ids)) <> 1 THEN
    RAISE EXCEPTION '所选账单币别不一致，请分别申请';
  END IF;
  IF (SELECT count(*) FROM bills WHERE id = ANY(p_bill_ids) AND direction <> 'AR') > 0 THEN
    RAISE EXCEPTION '只能对应收账单申请开票';
  END IF;

  -- 防重复：这些账单不能已在「待开票/已开票」的申请里
  IF EXISTS (
    SELECT 1 FROM invoice_request_bills irb
      JOIN invoice_requests ir ON ir.id = irb.request_id
     WHERE irb.bill_id = ANY(p_bill_ids)
       AND ir.status IN ('pending','completed')
  ) THEN
    RAISE EXCEPTION '所选账单中存在已提交开票申请的，请先处理或取消原申请';
  END IF;

  SELECT partner_id, currency, SUM(amount_total)
    INTO v_partner_id, v_currency, v_total
    FROM bills WHERE id = ANY(p_bill_ids)
    GROUP BY partner_id, currency;

  -- 外部客户（非内部角色）只能为自己的账单发起
  -- 注：028 起内部角色目录化，这里用 internal_roles() 动态判定（含 finance_ar/finance_ap/自定义内部角色）
  IF NOT (v_role = ANY (public.internal_roles())) THEN
    IF v_my_cust IS NULL OR v_partner_id IS DISTINCT FROM v_my_cust THEN
      RAISE EXCEPTION '无权对该客户的账单发起开票申请';
    END IF;
  END IF;

  SELECT name INTO v_partner_nm FROM customers WHERE id = v_partner_id;

  INSERT INTO invoice_requests(
    request_no, direction, status, customer_id, partner_name, currency,
    amount_total, invoice_title, tax_no, request_note, requested_by)
  VALUES (
    public.gen_invoice_request_no(), 'AR', 'pending', v_partner_id,
    COALESCE(v_partner_nm,'—'), COALESCE(v_currency,'CNY'),
    COALESCE(v_total,0), p_invoice_title, p_tax_no, p_note, auth.uid())
  RETURNING id INTO v_req_id;

  INSERT INTO invoice_request_bills(request_id, bill_id, amount)
  SELECT v_req_id, id, amount_total FROM bills WHERE id = ANY(p_bill_ids);

  RETURN v_req_id;
END $$;

-- ─────────────────────────────────────────────
-- 4) RPC：完成开票
--    建/补 invoices + invoice_bills，盖 bills.invoice_no，回填申请。
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.complete_invoice_request(
  p_request_id   uuid,
  p_invoice_no   text,
  p_invoice_date date,
  p_note         text DEFAULT NULL
) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_req      invoice_requests%ROWTYPE;
  v_inv_id   uuid;
  v_bill_ids uuid[];
BEGIN
  IF COALESCE(public.current_user_role(),'') NOT IN ('admin','finance') THEN
    RAISE EXCEPTION '无权完成开票（仅应收财务/管理员）';
  END IF;
  IF p_invoice_no IS NULL OR length(btrim(p_invoice_no)) = 0 THEN
    RAISE EXCEPTION '发票号不能为空';
  END IF;

  SELECT * INTO v_req FROM invoice_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '开票申请不存在';
  END IF;
  IF v_req.status <> 'pending' THEN
    RAISE EXCEPTION '该申请状态为 %，无法完成开票', v_req.status;
  END IF;

  SELECT array_agg(bill_id) INTO v_bill_ids
    FROM invoice_request_bills WHERE request_id = p_request_id;
  IF v_bill_ids IS NULL THEN
    RAISE EXCEPTION '该申请未关联任何账单';
  END IF;

  -- 建/补正式发票记录
  INSERT INTO invoices(invoice_no, invoice_date, direction, kind,
                       partner_id, partner_name, currency, amount_total, source_status)
  VALUES (p_invoice_no, p_invoice_date, v_req.direction, 'business',
          v_req.customer_id, v_req.partner_name, v_req.currency, v_req.amount_total, '正常')
  ON CONFLICT (invoice_no, direction)
    DO UPDATE SET partner_id   = COALESCE(EXCLUDED.partner_id, invoices.partner_id),
                  partner_name = COALESCE(EXCLUDED.partner_name, invoices.partner_name),
                  invoice_date = COALESCE(EXCLUDED.invoice_date, invoices.invoice_date)
  RETURNING id INTO v_inv_id;

  -- 关联账单（按账单金额全额关联）
  INSERT INTO invoice_bills(invoice_id, bill_id, applied_amount)
  SELECT v_inv_id, b.id, COALESCE(b.amount_total, 0)
    FROM bills b WHERE b.id = ANY(v_bill_ids)
  ON CONFLICT (invoice_id, bill_id) DO NOTHING;

  -- 重算发票合计
  UPDATE invoices i SET amount_total = COALESCE(
    (SELECT SUM(applied_amount) FROM invoice_bills WHERE invoice_id = i.id), 0)
   WHERE i.id = v_inv_id;

  -- 盖 bills 的发票号（兼容旧字段 / 一步开票视图）
  UPDATE bills SET invoice_no = p_invoice_no, invoice_date = p_invoice_date
   WHERE id = ANY(v_bill_ids);

  -- 回填申请
  UPDATE invoice_requests
     SET status = 'completed', invoice_id = v_inv_id,
         invoice_no = p_invoice_no, invoice_date = p_invoice_date,
         completed_by = auth.uid(), completed_at = now(), complete_note = p_note
   WHERE id = p_request_id;

  RETURN v_inv_id;
END $$;

-- ─────────────────────────────────────────────
-- 5) RPC：驳回 / 取消
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.reject_invoice_request(p_request_id uuid, p_note text DEFAULT NULL)
  RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF COALESCE(public.current_user_role(),'') NOT IN ('admin','finance') THEN
    RAISE EXCEPTION '无权驳回开票申请（仅应收财务/管理员）';
  END IF;
  UPDATE invoice_requests
     SET status = 'rejected', reject_note = p_note, completed_by = auth.uid(), completed_at = now()
   WHERE id = p_request_id AND status = 'pending';
  IF NOT FOUND THEN RAISE EXCEPTION '仅待开票状态可驳回'; END IF;
END $$;

-- 取消：内部角色可取消任意；外部客户仅可取消自己名下的申请
CREATE OR REPLACE FUNCTION public.cancel_invoice_request(p_request_id uuid)
  RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF COALESCE(public.current_user_role(),'') NOT IN ('admin','operator','sales','finance')
     AND NOT EXISTS (SELECT 1 FROM invoice_requests
                      WHERE id = p_request_id
                        AND customer_id = public.current_user_customer_id()) THEN
    RAISE EXCEPTION '无权取消该开票申请';
  END IF;
  UPDATE invoice_requests
     SET status = 'cancelled'
   WHERE id = p_request_id AND status = 'pending';
  IF NOT FOUND THEN RAISE EXCEPTION '仅待开票状态可取消'; END IF;
END $$;

-- ─────────────────────────────────────────────
-- 6) RLS（内部全权 + 客户仅自己）
-- ─────────────────────────────────────────────
ALTER TABLE public.invoice_requests      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_request_bills ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoice_request_files ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS internal_rw_all_invreq ON public.invoice_requests;
CREATE POLICY internal_rw_all_invreq ON public.invoice_requests
  USING      (public.current_user_role() = ANY (ARRAY['admin','operator','sales','finance']))
  WITH CHECK (public.current_user_role() = ANY (ARRAY['admin','operator','sales','finance']));

DROP POLICY IF EXISTS customer_rw_own_invreq ON public.invoice_requests;
CREATE POLICY customer_rw_own_invreq ON public.invoice_requests
  USING      (customer_id = public.current_user_customer_id())
  WITH CHECK (customer_id = public.current_user_customer_id());

-- 子表跟着主表归属走
DROP POLICY IF EXISTS internal_rw_all_invreqbills ON public.invoice_request_bills;
CREATE POLICY internal_rw_all_invreqbills ON public.invoice_request_bills
  USING      (public.current_user_role() = ANY (ARRAY['admin','operator','sales','finance']))
  WITH CHECK (public.current_user_role() = ANY (ARRAY['admin','operator','sales','finance']));

DROP POLICY IF EXISTS customer_rw_own_invreqbills ON public.invoice_request_bills;
CREATE POLICY customer_rw_own_invreqbills ON public.invoice_request_bills
  USING (EXISTS (SELECT 1 FROM invoice_requests ir
                  WHERE ir.id = invoice_request_bills.request_id
                    AND ir.customer_id = public.current_user_customer_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM invoice_requests ir
                  WHERE ir.id = invoice_request_bills.request_id
                    AND ir.customer_id = public.current_user_customer_id()));

DROP POLICY IF EXISTS internal_rw_all_invreqfiles ON public.invoice_request_files;
CREATE POLICY internal_rw_all_invreqfiles ON public.invoice_request_files
  USING      (public.current_user_role() = ANY (ARRAY['admin','operator','sales','finance']))
  WITH CHECK (public.current_user_role() = ANY (ARRAY['admin','operator','sales','finance']));

DROP POLICY IF EXISTS customer_rw_own_invreqfiles ON public.invoice_request_files;
CREATE POLICY customer_rw_own_invreqfiles ON public.invoice_request_files
  USING (EXISTS (SELECT 1 FROM invoice_requests ir
                  WHERE ir.id = invoice_request_files.request_id
                    AND ir.customer_id = public.current_user_customer_id()))
  WITH CHECK (EXISTS (SELECT 1 FROM invoice_requests ir
                  WHERE ir.id = invoice_request_files.request_id
                    AND ir.customer_id = public.current_user_customer_id()));

-- ─────────────────────────────────────────────
-- 7) 存储桶 invoice-files（私有）+ storage.objects RLS
--    路径首段 = customer_id，客户只能读到自己名下的发票
-- ─────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('invoice-files', 'invoice-files', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS invoice_files_select ON storage.objects;
CREATE POLICY invoice_files_select ON storage.objects
  FOR SELECT USING (
    bucket_id = 'invoice-files' AND (
      public.current_user_role() = ANY (ARRAY['admin','operator','sales','finance'])
      OR (storage.foldername(name))[1] = public.current_user_customer_id()::text
    )
  );

DROP POLICY IF EXISTS invoice_files_insert ON storage.objects;
CREATE POLICY invoice_files_insert ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'invoice-files' AND (
      public.current_user_role() = ANY (ARRAY['admin','operator','sales','finance'])
      OR (storage.foldername(name))[1] = public.current_user_customer_id()::text
    )
  );

DROP POLICY IF EXISTS invoice_files_delete ON storage.objects;
CREATE POLICY invoice_files_delete ON storage.objects
  FOR DELETE USING (
    bucket_id = 'invoice-files'
    AND public.current_user_role() = ANY (ARRAY['admin','operator','sales','finance'])
  );

-- ─────────────────────────────────────────────
-- 8) 收回 anon 执行权（这些 SECURITY DEFINER RPC 只允许登录用户调用，
--    函数内再按角色/归属细分；防止公开 anon key 直接 POST /rest/v1/rpc/*）
-- ─────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.gen_invoice_request_no()                              FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_invoice_request(uuid[], text, text, text)      FROM anon;
REVOKE EXECUTE ON FUNCTION public.complete_invoice_request(uuid, text, date, text)      FROM anon;
REVOKE EXECUTE ON FUNCTION public.reject_invoice_request(uuid, text)                    FROM anon;
REVOKE EXECUTE ON FUNCTION public.cancel_invoice_request(uuid)                          FROM anon;
