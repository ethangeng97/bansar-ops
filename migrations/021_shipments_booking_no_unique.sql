-- 021_shipments_booking_no_unique.sql
-- 在 (booking_no, shipment_type) 上加 partial unique index，挡住"同一票订舱被建成两个母单/作业"
-- 的重复建壳问题（前端在 Orders.jsx 的 save() 里也有查重，这条是 DB 兜底）。
--
-- 范围：
--   · 仅约束非空、非空字符串的 booking_no（历史数据里有 booking_no='' 的 FCL）
--   · 排除 Console 分票（order_no 带 -N 后缀的天然共享母单 booking_no，是正常的）
--
-- 重跑安全：IF NOT EXISTS。

CREATE UNIQUE INDEX IF NOT EXISTS uq_shipments_booking_master
  ON public.shipments (booking_no, shipment_type)
  WHERE booking_no IS NOT NULL
    AND booking_no <> ''
    AND order_no !~ '-[0-9]+$';
