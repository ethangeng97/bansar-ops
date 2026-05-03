-- ═══════════════════════════════════════════════════════════════
-- 003_sop_status.sql
-- 加 5 个 SOP 节点的状态字段 + 订单生命周期 + has_hbl 标志
-- 使用 IF NOT EXISTS，重复执行安全
-- ═══════════════════════════════════════════════════════════════

-- ─── 节点状态字段 ───
-- qc_status / space_status 已存在（001 迁移已加）
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS hbl_status     text;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS mbl_status     text;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS finance_status text DEFAULT '未创建';

-- ─── 是否签 HBL（详情页勾选框） ───
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS has_hbl boolean DEFAULT false;

-- ─── 订单生命周期：处理中 / 已完结 / 已关闭 ───
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS lifecycle text DEFAULT '处理中';
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS completed_at  timestamptz;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS completed_by  uuid;

-- ─── 现有 bl_status 数据兜底迁移到新字段 ───
-- 旧的 bl_status 是混合 mbl/hbl 的状态，这里默认全部迁移到 mbl_status
-- has_hbl 由 hbl_no 是否非空粗略推断（用户后续可在详情页修改勾选框）
UPDATE shipments
SET mbl_status = COALESCE(mbl_status, bl_status),
    has_hbl    = COALESCE(has_hbl, COALESCE(NULLIF(TRIM(hbl_no), ''), NULL) IS NOT NULL)
WHERE bl_status IS NOT NULL OR hbl_no IS NOT NULL;
