-- ═══════════════════════════════════════════════════════════════
-- 011_shipment_containers_cargo_qty.sql
-- 给 shipment_containers 表加 cargo_qty 列（每箱货物件数）
-- 配合 ContainerEditor UI 在"铅封号"和"货重"列之间增加件数列
-- 重复执行安全（IF NOT EXISTS）
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.shipment_containers
  ADD COLUMN IF NOT EXISTS cargo_qty integer;
