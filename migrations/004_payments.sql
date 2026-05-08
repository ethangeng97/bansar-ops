-- ═══════════════════════════════════════════════════════════════
-- 004_payments.sql
-- 收付款记录(payments)+ 关联账单(payment_bills)
-- 含单号生成函数 + bills.settled_amount 自动同步 trigger
-- 使用 IF NOT EXISTS,重复执行安全
-- ═══════════════════════════════════════════════════════════════

-- ─── payments 主表 ───
CREATE TABLE IF NOT EXISTS public.payments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_no      text UNIQUE NOT NULL,
  direction       text NOT NULL CHECK (direction IN ('AR','AP')),  -- AR=收款 / AP=付款
  payment_date    date NOT NULL,
  amount          numeric(18,2) NOT NULL,
  currency        text NOT NULL DEFAULT 'CNY',
  exchange_rate   numeric(18,6) NOT NULL DEFAULT 1,
  amount_cny      numeric(18,2) GENERATED ALWAYS AS (amount * exchange_rate) STORED,
  partner_id      uuid REFERENCES public.customers(id),
  partner_name    text,                                 -- 冗余:防客户改名后历史失真
  bank_account    text,                                 -- 我方收/付的银行账号
  payment_method  text,                                 -- transfer/cash/check/other
  notes           text,
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','voided')),
  voided_at       timestamptz,
  voided_by       uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payments_date      ON public.payments(payment_date);
CREATE INDEX IF NOT EXISTS idx_payments_direction ON public.payments(direction);
CREATE INDEX IF NOT EXISTS idx_payments_partner   ON public.payments(partner_id);
CREATE INDEX IF NOT EXISTS idx_payments_status    ON public.payments(status);

-- ─── payment_bills 关联表(N:N) ───
CREATE TABLE IF NOT EXISTS public.payment_bills (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id      uuid NOT NULL REFERENCES public.payments(id) ON DELETE CASCADE,
  bill_id         uuid NOT NULL REFERENCES public.bills(id)    ON DELETE CASCADE,
  applied_amount  numeric(18,2) NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payment_id, bill_id)
);

CREATE INDEX IF NOT EXISTS idx_payment_bills_payment ON public.payment_bills(payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_bills_bill    ON public.payment_bills(bill_id);

-- ─── 单号生成函数:RCV-2026-0001(收款)/ PAY-2026-0001(付款) ───
CREATE OR REPLACE FUNCTION public.next_payment_no(p_direction text)
RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  prefix text;
  yr     text;
  seq    int;
BEGIN
  prefix := CASE WHEN p_direction = 'AR' THEN 'RCV' ELSE 'PAY' END;
  yr     := to_char(now(), 'YYYY');
  SELECT COALESCE(MAX(NULLIF((regexp_match(payment_no, '\d+$'))[1], '')::int), 0) + 1
    INTO seq
    FROM public.payments
   WHERE payment_no LIKE prefix || '-' || yr || '-%';
  RETURN prefix || '-' || yr || '-' || lpad(seq::text, 4, '0');
END $$;

-- ─── 重算单张账单的 settled_amount + status ───
-- 给定 bill_id,把所有 active payment 通过 payment_bills 挂上去的 applied_amount 求和,
-- 写回 bills.settled_amount,并依此更新 status(unsettled/partial/settled);
-- 已经 void 的账单不动,避免被自动改活。
CREATE OR REPLACE FUNCTION public.recalc_bill_settled(p_bill_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  total_applied numeric(18,2);
  bill_total    numeric(18,2);
  new_status    text;
  cur_status    text;
BEGIN
  IF p_bill_id IS NULL THEN RETURN; END IF;

  SELECT COALESCE(SUM(pb.applied_amount), 0) INTO total_applied
    FROM public.payment_bills pb
    JOIN public.payments p ON p.id = pb.payment_id
   WHERE pb.bill_id = p_bill_id
     AND p.status = 'active';

  SELECT amount_total, status INTO bill_total, cur_status
    FROM public.bills WHERE id = p_bill_id;

  IF cur_status = 'void' THEN
    -- void 不动状态,但仍刷新 settled_amount 以反映关联事实
    UPDATE public.bills SET settled_amount = total_applied WHERE id = p_bill_id;
    RETURN;
  END IF;

  IF total_applied <= 0 THEN
    new_status := 'unsettled';
  ELSIF total_applied >= COALESCE(bill_total, 0) THEN
    new_status := 'settled';
  ELSE
    new_status := 'partial';
  END IF;

  UPDATE public.bills
     SET settled_amount = total_applied,
         status         = new_status
   WHERE id = p_bill_id;
END $$;

-- ─── Trigger:payment_bills 行变动时重算关联账单 ───
CREATE OR REPLACE FUNCTION public.tg_payment_bills_recalc() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.recalc_bill_settled(OLD.bill_id);
    RETURN OLD;
  END IF;

  PERFORM public.recalc_bill_settled(NEW.bill_id);
  -- UPDATE 把 bill_id 改了的话,旧那条也要重算
  IF TG_OP = 'UPDATE' AND OLD.bill_id IS DISTINCT FROM NEW.bill_id THEN
    PERFORM public.recalc_bill_settled(OLD.bill_id);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS payment_bills_recalc ON public.payment_bills;
CREATE TRIGGER payment_bills_recalc
AFTER INSERT OR UPDATE OR DELETE ON public.payment_bills
FOR EACH ROW EXECUTE FUNCTION public.tg_payment_bills_recalc();

-- ─── Trigger:payments.status 切换 active↔voided 时,所有挂着的 bill 都要重算 ───
CREATE OR REPLACE FUNCTION public.tg_payments_status_recalc() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r record;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    FOR r IN SELECT bill_id FROM public.payment_bills WHERE payment_id = NEW.id LOOP
      PERFORM public.recalc_bill_settled(r.bill_id);
    END LOOP;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS payments_status_recalc ON public.payments;
CREATE TRIGGER payments_status_recalc
AFTER UPDATE OF status ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.tg_payments_status_recalc();

-- ─── updated_at 自动维护 ───
CREATE OR REPLACE FUNCTION public.tg_payments_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS payments_updated_at ON public.payments;
CREATE TRIGGER payments_updated_at
BEFORE UPDATE ON public.payments
FOR EACH ROW EXECUTE FUNCTION public.tg_payments_updated_at();
