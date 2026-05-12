-- ═══════════════════════════════════════════════════════════════
-- 009_volume_precision.sql
-- 把 volume 字段精度从 3 位扩到 4 位（业务要求 CBM 保留 4 位小数）
-- 影响表：cargo_items / shipments
-- 安全：扩大精度不会丢数据；缩小才会。
-- 重复执行安全（ALTER TYPE 用同一类型不会报错）
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.cargo_items
  ALTER COLUMN volume TYPE numeric(12,4);

-- shipments 表的 volume 字段也提到 4 位（如果原本就是 numeric(12,4) 或更高
-- 也安全：PostgreSQL 不会因为同精度报错）
DO $$
DECLARE
  v_type text;
BEGIN
  SELECT data_type INTO v_type
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='shipments' AND column_name='volume';
  IF v_type = 'numeric' THEN
    EXECUTE 'ALTER TABLE public.shipments ALTER COLUMN volume TYPE numeric(12,4)';
  END IF;
END $$;
