-- ═══════════════════════════════════════════════════════════════
-- 012_cargo_items_warehouse_in_no.sql
-- 给 cargo_items 表加 warehouse_in_no（进仓号）字段
-- 配合 CargoLinesEditor 在"提单号"列左边新增"进仓号"列
-- 重复执行安全（IF NOT EXISTS）
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.cargo_items
  ADD COLUMN IF NOT EXISTS warehouse_in_no text;
