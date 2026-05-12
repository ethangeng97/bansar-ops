-- ═══════════════════════════════════════════════════════════════
-- 010_update_manggis_electrical.sql
-- 一次性数据更新（不是 schema 变更）：
-- 把客户 "Manggis Electrical" 重命名为 "广东省中山食品水产进出口
-- 集团有限公司"，并补全开票资料；同时回填所有关联 shipments 的
-- customer 字符串字段（冗余存储）。
-- 数据来源：客户提供的开票 PDF（统一社会信用代码 9144200019037933XJ）
-- ═══════════════════════════════════════════════════════════════

DO $$
DECLARE
  cust_id uuid;
  affected_shipments int;
BEGIN
  -- 找到这条客户记录（name / name_en / name_short 任一匹配 Manggis Electrical）
  SELECT id INTO cust_id FROM public.customers
    WHERE name ILIKE '%Manggis%Electrical%'
       OR name_en ILIKE '%Manggis%Electrical%'
       OR name_short ILIKE '%Manggis%Electrical%'
    LIMIT 1;

  IF cust_id IS NULL THEN
    RAISE NOTICE '[010] 未找到 Manggis Electrical 客户记录，跳过';
    RETURN;
  END IF;

  -- 更新客户主信息（COALESCE 保留已有值，仅在原值为空时填新值）
  UPDATE public.customers SET
    name          = '广东省中山食品水产进出口集团有限公司',
    name_en       = COALESCE(NULLIF(name_en, ''),       'Manggis Electrical'),
    invoice_title = '广东省中山食品水产进出口集团有限公司',
    tax_id        = '9144200019037933XJ',
    address_zh    = '中山市石岐中山三路华苑大街 113 号',
    contact_phone = COALESCE(NULLIF(contact_phone, ''), '0760-88312155'),
    bank_name     = '中国银行中山分行',
    bank_account  = '662657736719'
  WHERE id = cust_id;

  -- 回填 shipments.customer 冗余字段（按 customer_id 匹配）
  UPDATE public.shipments
  SET customer = '广东省中山食品水产进出口集团有限公司'
  WHERE customer_id = cust_id;
  GET DIAGNOSTICS affected_shipments = ROW_COUNT;

  RAISE NOTICE '[010] 客户 % 已更新，回填 % 条 shipments.customer', cust_id, affected_shipments;
END $$;
