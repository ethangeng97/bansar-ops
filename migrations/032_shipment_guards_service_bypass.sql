-- ═══════════════════════════════════════════════════════════════
-- 032_shipment_guards_service_bypass.sql
-- shipments 的两个 BEFORE UPDATE guard 在 service_role / 系统上下文
-- (auth.uid() 为空) 下会误伤后端写入：
--   - shipments_field_guard:      r is null → raise 'no profile'（直接报错）
--   - shipments_customer_qc_only: r is null 时 `r <> 'customer'` 为 NULL，
--       不提前返回 → 执行 new := old，把后端写的列静默还原。
-- 这两个 guard 本意只约束终端用户；service_role 本就绕过 RLS（可信后端），
-- 故在 auth.uid() 为空时直接放行。真实登录用户但 profile 缺失（auth.uid()
-- 非空、查不到）仍按原逻辑抛 'no profile'，权限约束不变。
-- 触发场景：track-eta edge function 用 service_role 回写 eta/etd/atd_carrier。
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.shipments_field_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare r text;
begin
  -- service_role / 系统上下文：无登录用户，放行（RLS 已在上游把关）
  if auth.uid() is null then return new; end if;

  select role into r from public.user_profiles where id = auth.uid();
  if r is null then raise exception 'no profile'; end if;
  if r = 'admin' then return new; end if;

  if tg_op = 'INSERT' then
    if r = 'customer' then raise exception 'customer cannot create shipments'; end if;
    -- operator/sales: forbid setting qc_status on insert (must be null/default)
    if r in ('operator','sales') and new.qc_status is distinct from null then
      new.qc_status := null;
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    -- customer is handled in shipments_customer_qc_only trigger; here we only
    -- block operator/sales from changing qc_status.
    if r in ('operator','sales') and (new.qc_status is distinct from old.qc_status) then
      raise exception 'role % cannot update qc_status', r;
    end if;
    return new;
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.shipments_customer_qc_only()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
declare r text; allowed_new text;
begin
  -- service_role / 系统上下文：无登录用户，放行（不要把它当成 customer 而还原列）
  if auth.uid() is null then return new; end if;

  select role into r from public.user_profiles where id = auth.uid();
  if r <> 'customer' then return new; end if;
  if tg_op <> 'UPDATE' then return new; end if;
  allowed_new := new.qc_status;
  new := old;
  new.qc_status := allowed_new;
  return new;
end $function$;
