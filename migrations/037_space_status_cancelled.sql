-- 037_space_status_cancelled.sql
-- 退关/改配功能（spot-inventory.js cancel 模式）会把 shipments.space_status 标成 'Cancelled'，
-- 但 001 迁移建的 check 约束只允许 Booked/Released/Wait Info，导致整柜退关报
--   new row for relation "shipments" violates check constraint "shipments_space_status_check"
-- 这里放宽约束，把 'Cancelled' 加进允许值。仅扩大取值范围，对存量行安全。

ALTER TABLE public.shipments DROP CONSTRAINT IF EXISTS shipments_space_status_check;

ALTER TABLE public.shipments
  ADD CONSTRAINT shipments_space_status_check
  CHECK (space_status = ANY (ARRAY['Booked'::text, 'Released'::text, 'Wait Info'::text, 'Cancelled'::text]));
