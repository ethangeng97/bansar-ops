-- ═══════════════════════════════════════════════════════════════
-- 036_enable_rls_reference_tables.sql
-- 堵住存量隐患：6 张表 RLS 未开 → 任何拿 anon key 的人可读改
-- （charge_items / exchange_rates / pkg_units / cargo_types /
--   charge_templates / charge_template_items）
--
-- 策略：
--  · 字典表(charge_items/exchange_rates/pkg_units/cargo_types)——
--    所有登录用户可读(authenticated，含 portal 客户，要拿来显示费用名/折CNY)，
--    仅内部角色(internal_roles())可写。
--  · 报价模板(charge_templates/charge_template_items)——含定价，
--    内部角色专属(读写都不给外部客户)。
--  · anon 全部回收(REVOKE)，并靠 RLS 兜底。
-- IF NOT EXISTS / DROP POLICY IF EXISTS，可重复执行。
-- ═══════════════════════════════════════════════════════════════

-- ─── 字典表：authenticated 读，internal 写 ───────────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['charge_items','exchange_rates','pkg_units','cargo_types']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_select', t);
    EXECUTE format($p$CREATE POLICY %I ON public.%I FOR SELECT
                      USING (auth.role() = 'authenticated')$p$, t||'_select', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_write', t);
    EXECUTE format($p$CREATE POLICY %I ON public.%I FOR ALL
                      USING (public.current_user_role() = ANY (public.internal_roles()))
                      WITH CHECK (public.current_user_role() = ANY (public.internal_roles()))$p$,
                   t||'_write', t);

    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
  END LOOP;
END $$;

-- ─── 报价模板：内部角色专属(读写都不给外部客户) ─────────────────
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['charge_templates','charge_template_items']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t||'_internal_rw', t);
    EXECUTE format($p$CREATE POLICY %I ON public.%I FOR ALL
                      USING (public.current_user_role() = ANY (public.internal_roles()))
                      WITH CHECK (public.current_user_role() = ANY (public.internal_roles()))$p$,
                   t||'_internal_rw', t);

    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
  END LOOP;
END $$;
