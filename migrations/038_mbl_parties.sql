-- 038_mbl_parties.sql
-- 主单(MBL)与分单(HBL)现在各出各的抬头：
--   分单(HBL) 用现有 shipper / consignee / notify_party（真实发货人→真实收货人，托单信息里录）
--   主单(MBL) 用下面三个新字段（我司/发货地代理 → 目的港代理，MB/L 子 tab 里录）
-- 打印主单时优先取 mbl_*，为空则回退到分单那套，兼容存量数据。

ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS mbl_shipper       text,
  ADD COLUMN IF NOT EXISTS mbl_consignee     text,
  ADD COLUMN IF NOT EXISTS mbl_notify_party  text;
