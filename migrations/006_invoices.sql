-- ═══════════════════════════════════════════════════════════════
-- 006_invoices.sql
-- 把发票从 bills.invoice_no 升级成独立表 invoices + 关联表 invoice_bills
-- 包括 schema、回填、RLS（non_business 仅 admin）、updated_at trigger
-- ═══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.invoices (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_no      text NOT NULL,
  invoice_date    date,
  direction       text NOT NULL CHECK (direction IN ('AR','AP')),  -- AR=开票/销项, AP=收票/进项
  kind            text NOT NULL DEFAULT 'business' CHECK (kind IN ('business','non_business')),
  partner_id      uuid REFERENCES public.customers(id),
  partner_name    text,
  amount_total    numeric(18,2) NOT NULL DEFAULT 0,                -- 价税合计
  amount_excl_tax numeric(18,2),                                   -- 不含税
  tax_amount      numeric(18,2),
  tax_rate        numeric(8,4),
  currency        text DEFAULT 'CNY',
  source_status   text,                                            -- 原 CSV 票据状态（正常/已冲红/已作废）
  notes           text,
  imported_from   text,                                            -- 导入批次标记
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (invoice_no, direction)
);

CREATE INDEX IF NOT EXISTS idx_invoices_date    ON public.invoices(invoice_date);
CREATE INDEX IF NOT EXISTS idx_invoices_partner ON public.invoices(partner_id);
CREATE INDEX IF NOT EXISTS idx_invoices_kind    ON public.invoices(kind);

CREATE TABLE IF NOT EXISTS public.invoice_bills (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id     uuid NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  bill_id        uuid NOT NULL REFERENCES public.bills(id)    ON DELETE CASCADE,
  applied_amount numeric(18,2) NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (invoice_id, bill_id)
);

CREATE INDEX IF NOT EXISTS idx_invoice_bills_invoice ON public.invoice_bills(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_bills_bill    ON public.invoice_bills(bill_id);

-- updated_at 自动维护
CREATE OR REPLACE FUNCTION public.tg_invoices_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS invoices_updated_at ON public.invoices;
CREATE TRIGGER invoices_updated_at
BEFORE UPDATE ON public.invoices
FOR EACH ROW EXECUTE FUNCTION public.tg_invoices_updated_at();

-- ─── 一次性回填：bills.invoice_no → invoices + invoice_bills ───
DO $$
DECLARE
  r           record;
  v_inv_id    uuid;
BEGIN
  FOR r IN
    SELECT DISTINCT ON (b.invoice_no, b.direction)
           b.invoice_no, b.invoice_date, b.direction, b.partner_id, c.name AS partner_name, b.currency
      FROM public.bills b
      LEFT JOIN public.customers c ON c.id = b.partner_id
     WHERE b.invoice_no IS NOT NULL AND btrim(b.invoice_no) <> ''
     ORDER BY b.invoice_no, b.direction, b.invoice_date NULLS LAST
  LOOP
    INSERT INTO public.invoices (invoice_no, invoice_date, direction, partner_id, partner_name, currency, kind, source_status)
    VALUES (r.invoice_no, r.invoice_date, r.direction, r.partner_id, r.partner_name, COALESCE(r.currency,'CNY'), 'business', '正常')
    ON CONFLICT (invoice_no, direction) DO UPDATE SET partner_id = COALESCE(EXCLUDED.partner_id, public.invoices.partner_id)
    RETURNING id INTO v_inv_id;
  END LOOP;

  -- 关联：每张挂着发票号的 bill 全额关联到对应 invoice
  INSERT INTO public.invoice_bills (invoice_id, bill_id, applied_amount)
  SELECT i.id, b.id, COALESCE(b.amount_total, 0)
    FROM public.bills b
    JOIN public.invoices i
      ON i.invoice_no = b.invoice_no
     AND i.direction  = b.direction
   WHERE b.invoice_no IS NOT NULL AND btrim(b.invoice_no) <> ''
  ON CONFLICT (invoice_id, bill_id) DO NOTHING;

  -- 重算 invoices.amount_total = SUM(invoice_bills.applied_amount)
  UPDATE public.invoices i
     SET amount_total = COALESCE((
           SELECT SUM(applied_amount) FROM public.invoice_bills WHERE invoice_id = i.id
         ), 0);
END $$;

-- ─── RLS：non_business 仅 admin 可见 ───
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invoices_select ON public.invoices;
CREATE POLICY invoices_select ON public.invoices
  FOR SELECT USING (
    kind = 'business'
    OR EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS invoices_insert ON public.invoices;
CREATE POLICY invoices_insert ON public.invoices
  FOR INSERT WITH CHECK (
    kind = 'business'
    OR EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS invoices_update ON public.invoices;
CREATE POLICY invoices_update ON public.invoices
  FOR UPDATE USING (
    kind = 'business'
    OR EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'admin')
  );

DROP POLICY IF EXISTS invoices_delete ON public.invoices;
CREATE POLICY invoices_delete ON public.invoices
  FOR DELETE USING (
    EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'admin')
  );

ALTER TABLE public.invoice_bills ENABLE ROW LEVEL SECURITY;

-- invoice_bills 跟着所属发票走（看不见发票就看不见关联）
DROP POLICY IF EXISTS invoice_bills_all ON public.invoice_bills;
CREATE POLICY invoice_bills_all ON public.invoice_bills
  USING (EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = invoice_bills.invoice_id));
