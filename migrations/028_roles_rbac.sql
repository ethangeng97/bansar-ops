-- ═══════════════════════════════════════════════════════════════
-- 028_roles_rbac.sql
-- 角色目录(数据驱动权限) + 应收/应付财务拆分 + AR/AP 严格隔离
--
-- 设计要点：
--  · roles 表存角色目录(系统角色 + 自定义角色)，含 data_scope(财务方向范围) 与 page_access
--  · AR/AP 隔离用 RESTRICTIVE 策略：只收窄 data_scope=ar/ap 的角色，
--    其余角色(all/none/未知)及所有现有 permissive 策略一律不受影响
--    → 不重写任何现有策略(尤其 bills_select=true)，portal/客户可见性零影响
--  · charges.direction 用中文「应收/应付」；bills/statements/payments/invoices 用「AR/AP」
-- ═══════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────
-- 1) 角色目录表
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.roles (
  key         text PRIMARY KEY,
  label       text NOT NULL,
  is_system   boolean NOT NULL DEFAULT false,
  data_scope  text NOT NULL DEFAULT 'all' CHECK (data_scope IN ('all','ar','ap','none')),
  page_access text[] NOT NULL DEFAULT '{}',
  is_internal boolean NOT NULL DEFAULT true,
  sort        int DEFAULT 100,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.tg_roles_updated_at() RETURNS trigger
  LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS roles_updated_at ON public.roles;
CREATE TRIGGER roles_updated_at BEFORE UPDATE ON public.roles
FOR EACH ROW EXECUTE FUNCTION public.tg_roles_updated_at();

-- 种子系统角色
INSERT INTO public.roles (key, label, is_system, data_scope, is_internal, sort, page_access) VALUES
  ('admin',          '管理员',     true, 'all',  true, 10,
    ARRAY['dashboard','orders','charges','billing','payments','invoices','invoice_requests','documents','settings','manage','user_admin']),
  ('operator',       '操作',       true, 'all',  true, 20,
    ARRAY['dashboard','orders','charges','documents']),
  ('sales',          '销售',       true, 'all',  true, 30,
    ARRAY['dashboard','orders','documents']),
  ('finance_ar',     '应收财务',   true, 'ar',   true, 40,
    ARRAY['dashboard','orders','charges','billing','payments','invoices','invoice_requests','documents']),
  ('finance_ap',     '应付财务',   true, 'ap',   true, 50,
    ARRAY['dashboard','orders','charges','billing','payments','invoices','documents']),
  ('finance',        '财务(全部)', true, 'all',  true, 60,
    ARRAY['dashboard','orders','charges','billing','payments','invoices','invoice_requests','documents']),
  ('customer',       '客户',       true, 'none', false, 70, ARRAY['dashboard','orders','documents']),
  ('supplier',       '供应商/客户',true, 'none', false, 80, ARRAY['dashboard','orders','documents']),
  ('overseas_agent', '海外代理',   true, 'none', false, 90, ARRAY['dashboard','orders','documents'])
ON CONFLICT (key) DO UPDATE SET
  label=EXCLUDED.label, is_system=EXCLUDED.is_system, data_scope=EXCLUDED.data_scope,
  is_internal=EXCLUDED.is_internal, sort=EXCLUDED.sort, page_access=EXCLUDED.page_access;

-- roles 表 RLS：登录用户可读(前端渲染权限要用)；仅 admin 可写
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS roles_read ON public.roles;
CREATE POLICY roles_read ON public.roles FOR SELECT USING (auth.uid() IS NOT NULL);
DROP POLICY IF EXISTS roles_admin_write ON public.roles;
CREATE POLICY roles_admin_write ON public.roles FOR ALL
  USING (public.current_user_role() = 'admin')
  WITH CHECK (public.current_user_role() = 'admin');

-- user_profiles.role：去掉写死的 CHECK，改为对 roles(key) 的外键(支持动态/自定义角色)
ALTER TABLE public.user_profiles DROP CONSTRAINT IF EXISTS user_profiles_role_check;
ALTER TABLE public.user_profiles DROP CONSTRAINT IF EXISTS user_profiles_role_fk;
ALTER TABLE public.user_profiles
  ADD CONSTRAINT user_profiles_role_fk FOREIGN KEY (role)
  REFERENCES public.roles(key) ON UPDATE CASCADE ON DELETE RESTRICT;

-- ─────────────────────────────────────────────
-- 2) 助手函数
-- ─────────────────────────────────────────────
-- 当前用户的财务数据范围；查不到返回 'all'(老/未知角色不被误限)
CREATE OR REPLACE FUNCTION public.current_user_data_scope()
  RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((SELECT data_scope FROM public.roles WHERE key = public.current_user_role()), 'all')
$$;

-- 内部角色 key 数组(供新策略使用；不改动现有硬编码策略)
CREATE OR REPLACE FUNCTION public.internal_roles()
  RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(array_agg(key), ARRAY['admin','operator','sales','finance']::text[])
    FROM public.roles WHERE is_internal
$$;

-- ─────────────────────────────────────────────
-- 3) AR/AP 严格隔离 —— RESTRICTIVE 策略(与现有 permissive 策略 AND)
--    判定：非 ar/ap 角色全放行；ar 角色只见应收；ap 角色只见应付。
-- ─────────────────────────────────────────────

-- 把现有 permissive 内部策略的硬编码角色数组改为动态 internal_roles()
-- (新角色 finance_ar/finance_ap 是旧 {admin,operator,sales,finance} 的超集 → 对现有角色零影响，
--  否则新财务角色连本方向的 charges/payments 都看不到)
DROP POLICY IF EXISTS internal_rw_charges ON public.charges;
CREATE POLICY internal_rw_charges ON public.charges FOR ALL
  USING (public.current_user_role() = ANY (public.internal_roles()))
  WITH CHECK (public.current_user_role() = ANY (public.internal_roles()));
DROP POLICY IF EXISTS internal_read_charges ON public.charges;
CREATE POLICY internal_read_charges ON public.charges FOR SELECT
  USING (public.current_user_role() = ANY (public.internal_roles()));
DROP POLICY IF EXISTS payments_internal_all ON public.payments;
CREATE POLICY payments_internal_all ON public.payments FOR ALL
  USING (public.current_user_role() = ANY (public.internal_roles()))
  WITH CHECK (public.current_user_role() = ANY (public.internal_roles()));
DROP POLICY IF EXISTS internal_rw_invoices ON public.invoices;
CREATE POLICY internal_rw_invoices ON public.invoices FOR ALL
  USING (public.current_user_role() = ANY (public.internal_roles()))
  WITH CHECK (public.current_user_role() = ANY (public.internal_roles()));
DROP POLICY IF EXISTS internal_read_invoices ON public.invoices;
CREATE POLICY internal_read_invoices ON public.invoices FOR SELECT
  USING (public.current_user_role() = ANY (public.internal_roles()));

-- bills (AR/AP)
DROP POLICY IF EXISTS bills_dir_scope ON public.bills;
CREATE POLICY bills_dir_scope ON public.bills AS RESTRICTIVE USING (
  public.current_user_data_scope() <> ALL (ARRAY['ar','ap'])
  OR (public.current_user_data_scope() = 'ar' AND direction = 'AR')
  OR (public.current_user_data_scope() = 'ap' AND direction = 'AP')
);

-- charges (中文 应收/应付)
DROP POLICY IF EXISTS charges_dir_scope ON public.charges;
CREATE POLICY charges_dir_scope ON public.charges AS RESTRICTIVE USING (
  public.current_user_data_scope() <> ALL (ARRAY['ar','ap'])
  OR (public.current_user_data_scope() = 'ar' AND direction = '应收')
  OR (public.current_user_data_scope() = 'ap' AND direction = '应付')
);

-- payments (AR/AP)
DROP POLICY IF EXISTS payments_dir_scope ON public.payments;
CREATE POLICY payments_dir_scope ON public.payments AS RESTRICTIVE USING (
  public.current_user_data_scope() <> ALL (ARRAY['ar','ap'])
  OR (public.current_user_data_scope() = 'ar' AND direction = 'AR')
  OR (public.current_user_data_scope() = 'ap' AND direction = 'AP')
);

-- invoices (AR/AP)
DROP POLICY IF EXISTS invoices_dir_scope ON public.invoices;
CREATE POLICY invoices_dir_scope ON public.invoices AS RESTRICTIVE USING (
  public.current_user_data_scope() <> ALL (ARRAY['ar','ap'])
  OR (public.current_user_data_scope() = 'ar' AND direction = 'AR')
  OR (public.current_user_data_scope() = 'ap' AND direction = 'AP')
);

-- invoice_bills 跟随 invoices 方向
DROP POLICY IF EXISTS invoice_bills_dir_scope ON public.invoice_bills;
CREATE POLICY invoice_bills_dir_scope ON public.invoice_bills AS RESTRICTIVE USING (
  public.current_user_data_scope() <> ALL (ARRAY['ar','ap'])
  OR EXISTS (SELECT 1 FROM public.invoices i WHERE i.id = invoice_bills.invoice_id
              AND ((public.current_user_data_scope() = 'ar' AND i.direction = 'AR')
                OR (public.current_user_data_scope() = 'ap' AND i.direction = 'AP')))
);

-- ─────────────────────────────────────────────
-- 4) statements / payment_bills 之前未开 RLS → 启用 + 内部 permissive + 方向 restrictive
-- ─────────────────────────────────────────────
ALTER TABLE public.statements    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_bills ENABLE ROW LEVEL SECURITY;

-- statements: 内部角色读写(对账单是纯内部概念)
DROP POLICY IF EXISTS statements_internal_all ON public.statements;
CREATE POLICY statements_internal_all ON public.statements FOR ALL
  USING (public.current_user_role() = ANY (public.internal_roles()))
  WITH CHECK (public.current_user_role() = ANY (public.internal_roles()));
-- statements 方向隔离 (AR/AP)
DROP POLICY IF EXISTS statements_dir_scope ON public.statements;
CREATE POLICY statements_dir_scope ON public.statements AS RESTRICTIVE USING (
  public.current_user_data_scope() <> ALL (ARRAY['ar','ap'])
  OR (public.current_user_data_scope() = 'ar' AND direction = 'AR')
  OR (public.current_user_data_scope() = 'ap' AND direction = 'AP')
);

-- payment_bills: 内部读写(收付款核销关联)
DROP POLICY IF EXISTS payment_bills_internal_all ON public.payment_bills;
CREATE POLICY payment_bills_internal_all ON public.payment_bills FOR ALL
  USING (public.current_user_role() = ANY (public.internal_roles()))
  WITH CHECK (public.current_user_role() = ANY (public.internal_roles()));
-- payment_bills 跟随所关联 payment 的方向
DROP POLICY IF EXISTS payment_bills_dir_scope ON public.payment_bills;
CREATE POLICY payment_bills_dir_scope ON public.payment_bills AS RESTRICTIVE USING (
  public.current_user_data_scope() <> ALL (ARRAY['ar','ap'])
  OR EXISTS (SELECT 1 FROM public.payments p WHERE p.id = payment_bills.payment_id
              AND ((public.current_user_data_scope() = 'ar' AND p.direction = 'AR')
                OR (public.current_user_data_scope() = 'ap' AND p.direction = 'AP')))
);

-- ─────────────────────────────────────────────
-- 5) 完成开票角色口径：admin + 应收财务(开票=销项=应收) + 兼容老 finance
-- ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.complete_invoice_request(
  p_request_id uuid, p_invoice_no text, p_invoice_date date, p_note text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_req invoice_requests%ROWTYPE; v_inv_id uuid; v_bill_ids uuid[];
BEGIN
  IF COALESCE(public.current_user_role(),'') NOT IN ('admin','finance','finance_ar') THEN
    RAISE EXCEPTION '无权完成开票（仅应收财务/管理员）'; END IF;
  IF p_invoice_no IS NULL OR length(btrim(p_invoice_no)) = 0 THEN
    RAISE EXCEPTION '发票号不能为空'; END IF;
  SELECT * INTO v_req FROM invoice_requests WHERE id = p_request_id;
  IF NOT FOUND THEN RAISE EXCEPTION '开票申请不存在'; END IF;
  IF v_req.status <> 'pending' THEN RAISE EXCEPTION '该申请状态为 %，无法完成开票', v_req.status; END IF;
  SELECT array_agg(bill_id) INTO v_bill_ids FROM invoice_request_bills WHERE request_id = p_request_id;
  IF v_bill_ids IS NULL THEN RAISE EXCEPTION '该申请未关联任何账单'; END IF;
  INSERT INTO invoices(invoice_no, invoice_date, direction, kind, partner_id, partner_name,
    currency, amount_total, source_status)
  VALUES (p_invoice_no, p_invoice_date, v_req.direction, 'business', v_req.customer_id,
    v_req.partner_name, v_req.currency, v_req.amount_total, '正常')
  ON CONFLICT (invoice_no, direction) DO UPDATE SET
    partner_id = COALESCE(EXCLUDED.partner_id, invoices.partner_id),
    partner_name = COALESCE(EXCLUDED.partner_name, invoices.partner_name),
    invoice_date = COALESCE(EXCLUDED.invoice_date, invoices.invoice_date)
  RETURNING id INTO v_inv_id;
  INSERT INTO invoice_bills(invoice_id, bill_id, applied_amount)
  SELECT v_inv_id, b.id, COALESCE(b.amount_total, 0) FROM bills b WHERE b.id = ANY(v_bill_ids)
  ON CONFLICT (invoice_id, bill_id) DO NOTHING;
  UPDATE invoices i SET amount_total = COALESCE(
    (SELECT SUM(applied_amount) FROM invoice_bills WHERE invoice_id = i.id), 0) WHERE i.id = v_inv_id;
  UPDATE bills SET invoice_no = p_invoice_no, invoice_date = p_invoice_date WHERE id = ANY(v_bill_ids);
  UPDATE invoice_requests SET status='completed', invoice_id=v_inv_id, invoice_no=p_invoice_no,
    invoice_date=p_invoice_date, completed_by=auth.uid(), completed_at=now(), complete_note=p_note
   WHERE id = p_request_id;
  RETURN v_inv_id;
END $$;

CREATE OR REPLACE FUNCTION public.reject_invoice_request(p_request_id uuid, p_note text DEFAULT NULL)
  RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF COALESCE(public.current_user_role(),'') NOT IN ('admin','finance','finance_ar') THEN
    RAISE EXCEPTION '无权驳回开票申请（仅应收财务/管理员）'; END IF;
  UPDATE invoice_requests SET status='rejected', reject_note=p_note,
    completed_by=auth.uid(), completed_at=now() WHERE id = p_request_id AND status='pending';
  IF NOT FOUND THEN RAISE EXCEPTION '仅待开票状态可驳回'; END IF;
END $$;
