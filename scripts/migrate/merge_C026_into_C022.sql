-- ═══════════════════════════════════════════════════════════════
-- 客户合并 v3:C026 (HongYi) → C022 (浙江鸿一箱包皮件有限公司)
--
-- v2 → v3 修正:
--   - 删掉 bills.partner_name(DB 上不存在该列,前端那是客户端 fallback)
--   - payments 相关全部用 to_regclass 包起来,如果 004 migration 还没跑也不会报错
--
-- 用法:
--   1. Supabase Dashboard → SQL Editor
--   2. 粘贴本文件全文
--   3. 选中 [DRY-RUN] 段(BEGIN 之前所有内容),Run
--      → Results 看主表 will_update
--      → Messages 看 payments 表的提示
--   4. 数字 OK 再选中 [COMMIT] 段(BEGIN ... COMMIT),Run
--   5. 选中 [VERIFY] 段确认残留为 0
-- ═══════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────
-- [DRY-RUN] 只读,看影响范围
-- ─────────────────────────────────────────────────────────────

-- 1) 确认两个客户都找到
SELECT 'C022 (新)' AS label, id, code, name, partner_type, active FROM customers WHERE code = 'C022'
UNION ALL
SELECT 'C026 (旧)', id, code, name, partner_type, active FROM customers WHERE code = 'C026';

-- 2) 主表 / 主字段 will_update
WITH ids AS (
  SELECT
    (SELECT id   FROM customers WHERE code = 'C022') AS new_id,
    (SELECT id   FROM customers WHERE code = 'C026') AS old_id,
    (SELECT name FROM customers WHERE code = 'C026') AS old_name,
    (SELECT name FROM customers WHERE code = 'C022') AS new_name
)
SELECT 'shipments.customer_id (uuid)' AS field,
       (SELECT count(*) FROM shipments, ids WHERE shipments.customer_id = ids.old_id) AS will_update
UNION ALL
SELECT 'shipments.supplier_id (uuid)',
       (SELECT count(*) FROM shipments, ids WHERE shipments.supplier_id = ids.old_id)
UNION ALL
SELECT 'shipments.customer (字符串)',
       (SELECT count(*) FROM shipments, ids WHERE LOWER(TRIM(shipments.customer))      = LOWER(ids.old_name))
UNION ALL
SELECT 'shipments.supplier (字符串)',
       (SELECT count(*) FROM shipments, ids WHERE LOWER(TRIM(shipments.supplier))      = LOWER(ids.old_name))
UNION ALL
SELECT 'shipments.end_customer (字符串)',
       (SELECT count(*) FROM shipments, ids WHERE LOWER(TRIM(shipments.end_customer))  = LOWER(ids.old_name))
UNION ALL
SELECT 'shipments.overseas_agent (字符串)',
       (SELECT count(*) FROM shipments, ids WHERE LOWER(TRIM(shipments.overseas_agent))= LOWER(ids.old_name))
UNION ALL
SELECT 'bills.partner_id (uuid)',
       (SELECT count(*) FROM bills,    ids WHERE bills.partner_id      = ids.old_id)
UNION ALL
SELECT 'charges.partner_id (uuid)',
       (SELECT count(*) FROM charges,  ids WHERE charges.partner_id    = ids.old_id);

-- 3) payments 单独走 DO block,用 to_regclass 安全跳过(004 migration 没跑过也不会报错)
DO $$
DECLARE
  n1 int := 0;
  n2 int := 0;
BEGIN
  IF to_regclass('public.payments') IS NULL THEN
    RAISE NOTICE 'payments 表不存在(004 migration 未跑过),跳过';
  ELSE
    EXECUTE 'SELECT count(*) FROM payments WHERE partner_id = (SELECT id FROM customers WHERE code = ''C026'')' INTO n1;
    EXECUTE 'SELECT count(*) FROM payments WHERE LOWER(TRIM(partner_name)) = LOWER((SELECT name FROM customers WHERE code = ''C026''))' INTO n2;
    RAISE NOTICE 'payments.partner_id  : will_update = %', n1;
    RAISE NOTICE 'payments.partner_name: will_update = %', n2;
  END IF;
END $$;

-- 4) 把 HongYi 的订单列出来人工对一眼
SELECT id, order_no, mbl_no, customer, customer_id, supplier, end_customer, created_at
  FROM shipments
 WHERE LOWER(TRIM(customer))     = 'hongyi'
    OR LOWER(TRIM(end_customer)) = 'hongyi'
    OR customer_id = (SELECT id FROM customers WHERE code = 'C026');


-- ─────────────────────────────────────────────────────────────
-- [COMMIT] dry-run 数字 OK 后跑这段(单事务,要么全成要么全回滚)
-- ─────────────────────────────────────────────────────────────
BEGIN;

DO $$
DECLARE
  v_old_id   uuid;
  v_new_id   uuid;
  v_old_name text;
  v_new_name text;
  n int;
BEGIN
  SELECT id, name INTO v_new_id, v_new_name FROM customers WHERE code = 'C022';
  SELECT id, name INTO v_old_id, v_old_name FROM customers WHERE code = 'C026';

  IF v_old_id IS NULL THEN RAISE EXCEPTION 'C026 not found'; END IF;
  IF v_new_id IS NULL THEN RAISE EXCEPTION 'C022 not found'; END IF;

  RAISE NOTICE 'Merging C026 (% / %) -> C022 (% / %)', v_old_id, v_old_name, v_new_id, v_new_name;

  -- shipments uuid 字段
  UPDATE shipments SET customer_id = v_new_id WHERE customer_id = v_old_id;
  GET DIAGNOSTICS n = ROW_COUNT;  RAISE NOTICE '  shipments.customer_id  : % rows', n;

  UPDATE shipments SET supplier_id = v_new_id WHERE supplier_id = v_old_id;
  GET DIAGNOSTICS n = ROW_COUNT;  RAISE NOTICE '  shipments.supplier_id  : % rows', n;

  -- shipments 字符串字段(关键!订单数列就是看这个)
  UPDATE shipments SET customer = v_new_name
   WHERE LOWER(TRIM(customer)) = LOWER(v_old_name);
  GET DIAGNOSTICS n = ROW_COUNT;  RAISE NOTICE '  shipments.customer     : % rows', n;

  UPDATE shipments SET supplier = v_new_name
   WHERE LOWER(TRIM(supplier)) = LOWER(v_old_name);
  GET DIAGNOSTICS n = ROW_COUNT;  RAISE NOTICE '  shipments.supplier     : % rows', n;

  UPDATE shipments SET end_customer = v_new_name
   WHERE LOWER(TRIM(end_customer)) = LOWER(v_old_name);
  GET DIAGNOSTICS n = ROW_COUNT;  RAISE NOTICE '  shipments.end_customer : % rows', n;

  UPDATE shipments SET overseas_agent = v_new_name
   WHERE LOWER(TRIM(overseas_agent)) = LOWER(v_old_name);
  GET DIAGNOSTICS n = ROW_COUNT;  RAISE NOTICE '  shipments.overseas_agent: % rows', n;

  -- 财务表
  UPDATE bills SET partner_id = v_new_id WHERE partner_id = v_old_id;
  GET DIAGNOSTICS n = ROW_COUNT;  RAISE NOTICE '  bills.partner_id       : % rows', n;

  UPDATE charges SET partner_id = v_new_id WHERE partner_id = v_old_id;
  GET DIAGNOSTICS n = ROW_COUNT;  RAISE NOTICE '  charges.partner_id     : % rows', n;

  -- payments(可能不存在,安全跳过)
  IF to_regclass('public.payments') IS NOT NULL THEN
    EXECUTE format('UPDATE payments SET partner_id = %L WHERE partner_id = %L', v_new_id, v_old_id);
    GET DIAGNOSTICS n = ROW_COUNT;  RAISE NOTICE '  payments.partner_id    : % rows', n;

    EXECUTE format('UPDATE payments SET partner_name = %L WHERE LOWER(TRIM(partner_name)) = LOWER(%L)', v_new_name, v_old_name);
    GET DIAGNOSTICS n = ROW_COUNT;  RAISE NOTICE '  payments.partner_name  : % rows', n;
  ELSE
    RAISE NOTICE '  payments 表不存在,跳过';
  END IF;

  -- 停用 C026 + 改名留审计痕迹
  UPDATE customers
     SET active = false,
         name   = name || '【已合并到C022】'
   WHERE id = v_old_id;
  RAISE NOTICE '  customers C026 deactivated and renamed';
END $$;

COMMIT;
-- NOTICE 数字看不对,把 COMMIT 改成 ROLLBACK 重跑这段。


-- ─────────────────────────────────────────────────────────────
-- [VERIFY] 跑完后的校验,所有 "残留" 应该都是 0
-- ─────────────────────────────────────────────────────────────
SELECT id, code, name, active FROM customers WHERE code IN ('C022', 'C026');

WITH ids AS (
  SELECT (SELECT id FROM customers WHERE code = 'C026') AS old_id
)
SELECT 'shipments.customer_id 残留'    AS what, count(*) FROM shipments, ids WHERE customer_id = ids.old_id
UNION ALL
SELECT 'shipments.supplier_id 残留',           count(*) FROM shipments, ids WHERE supplier_id = ids.old_id
UNION ALL
SELECT 'shipments.customer = HongYi 残留',     count(*) FROM shipments      WHERE LOWER(TRIM(customer))     = 'hongyi'
UNION ALL
SELECT 'shipments.supplier = HongYi 残留',     count(*) FROM shipments      WHERE LOWER(TRIM(supplier))     = 'hongyi'
UNION ALL
SELECT 'shipments.end_customer = HongYi 残留', count(*) FROM shipments      WHERE LOWER(TRIM(end_customer)) = 'hongyi'
UNION ALL
SELECT 'bills.partner_id 残留',                count(*) FROM bills,     ids WHERE partner_id = ids.old_id
UNION ALL
SELECT 'charges.partner_id 残留',              count(*) FROM charges,   ids WHERE partner_id = ids.old_id;

-- payments 残留(安全跳过)
DO $$
DECLARE n int := 0;
BEGIN
  IF to_regclass('public.payments') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM payments WHERE partner_id = (SELECT id FROM customers WHERE code = ''C026'')' INTO n;
    RAISE NOTICE 'payments.partner_id 残留: %', n;
  END IF;
END $$;
