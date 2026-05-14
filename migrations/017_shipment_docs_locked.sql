-- 单证锁定字段
-- locked=true 后单证相关字段（MBL/HBL/shipper/consignee/notify_party/desc/marks）
-- 在前端 UI 强制 disabled；后端不加额外校验（admin 仍可解锁后编辑）
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS docs_locked boolean DEFAULT false;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS docs_locked_at timestamptz;
ALTER TABLE public.shipments ADD COLUMN IF NOT EXISTS docs_locked_by uuid REFERENCES auth.users(id);
