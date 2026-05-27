-- ═══════════════════════════════════════════════════════════════
-- 024_shipments_internal_note.sql
-- shipments 增加 internal_note 字段 —— 内部备注
-- 用法：现舱划给客户时的备注、其他内部备注写这里
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS internal_note text;
