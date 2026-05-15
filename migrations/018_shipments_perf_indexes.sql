-- 018_shipments_perf_indexes.sql
-- 给 shipments 表加 4 个关键索引，加速：
--   · Orders 列表 ORDER BY created_at DESC
--   · operator/sales 角色按 operator_id / salesperson_id 过滤
--   · Portal / Dashboard 按 lifecycle 过滤未关闭票
-- 用 CONCURRENTLY 避免在线表上锁；IF NOT EXISTS 保证重跑安全
--
-- ⚠️ Supabase SQL Editor 默认在事务里跑，CREATE INDEX CONCURRENTLY 不能在事务里。
--    在 SQL Editor 里跑这个文件时需要逐条选中执行；或者把 CONCURRENTLY 去掉
--    （表数据量级 ≤ 万级时不加锁影响也不大）。

CREATE INDEX IF NOT EXISTS idx_shipments_created_at
  ON public.shipments (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_shipments_operator
  ON public.shipments (operator_id)
  WHERE operator_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_shipments_salesperson
  ON public.shipments (salesperson_id)
  WHERE salesperson_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_shipments_lifecycle
  ON public.shipments (lifecycle);
