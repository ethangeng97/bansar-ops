-- ═══════════════════════════════════════════════════════════════
-- 030_bills_invoices_rls.sql
-- 修复隐患：bills / invoices 的 RLS 此前是全开的
--   bills:    select/insert/update/delete 全 USING(true)  → 任何角色(含 anon/客户)可增删改查所有账单
--   invoices: select/insert/update USING(kind='business' OR admin) → 任何登录用户可读/插/改所有业务发票
-- 收紧为：内部角色全权；客户只读自己的(账单=自己的应收账单、发票=自己的业务发票)；anon 全挡。
-- 不影响内部页面(走 internal_roles)与 SECURITY DEFINER RPC(本就绕过 RLS)。
-- ═══════════════════════════════════════════════════════════════

-- ── bills ──────────────────────────────────────────────────────
DROP POLICY IF EXISTS bills_select ON public.bills;
DROP POLICY IF EXISTS bills_insert ON public.bills;
DROP POLICY IF EXISTS bills_update ON public.bills;
DROP POLICY IF EXISTS bills_delete ON public.bills;

-- 内部角色：全 CRUD
DROP POLICY IF EXISTS bills_internal_all ON public.bills;
CREATE POLICY bills_internal_all ON public.bills FOR ALL
  USING      (public.current_user_role() = ANY (public.internal_roles()))
  WITH CHECK (public.current_user_role() = ANY (public.internal_roles()));

-- 客户：只读自己的应收账单
DROP POLICY IF EXISTS bills_customer_read ON public.bills;
CREATE POLICY bills_customer_read ON public.bills FOR SELECT
  USING (direction = 'AR' AND partner_id = public.current_user_customer_id());

-- ── invoices ───────────────────────────────────────────────────
-- 去掉三条"业务票人人可读/可写"的全开策略
DROP POLICY IF EXISTS invoices_select ON public.invoices;
DROP POLICY IF EXISTS invoices_insert ON public.invoices;
DROP POLICY IF EXISTS invoices_update ON public.invoices;
-- 保留：internal_rw_invoices(内部全权) / internal_read_invoices(内部读) / invoices_delete(admin)
--       supplier_read_own_invoices(供应商读自己) / invoices_dir_scope(AR/AP 限制)

-- 客户：只读自己的业务发票
DROP POLICY IF EXISTS invoices_customer_read ON public.invoices;
CREATE POLICY invoices_customer_read ON public.invoices FOR SELECT
  USING (kind = 'business' AND partner_id = public.current_user_customer_id());
