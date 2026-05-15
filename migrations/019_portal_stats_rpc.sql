-- 019_portal_stats_rpc.sql
-- 把 Portal Dashboard 的 3 个聚合查询合成 1 个 SQL function（一次 RTT）
-- 之前: 拉全部 shipments + 全部 bills 到前端算（数据量上千就开始慢）
-- 现在: SQL 端 COUNT(*) FILTER (...) 聚合，只返回一个 JSON
--
-- SOP 节点 done 判定与 src/lib/constants.js: SOP_NODES 保持一致。
-- 若 SOP_NODES 调整需同步更新本函数。

CREATE OR REPLACE FUNCTION public.portal_stats()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH
  m AS (
    SELECT date_trunc('month', now())::timestamptz AS month_start
  ),
  s AS (
    SELECT
      COUNT(*) FILTER (WHERE created_at >= (SELECT month_start FROM m))                                    AS month_orders,
      COUNT(*) FILTER (WHERE lifecycle NOT IN ('已关闭','已完结') OR lifecycle IS NULL)                       AS open_orders,
      -- 各 SOP 节点未完成数（active 单池中过滤；done 值取 SOP_NODES 里 done=true 的枚举）
      COUNT(*) FILTER (
        WHERE (lifecycle IS NULL OR lifecycle NOT IN ('已关闭','已完结'))
          AND COALESCE(qc_status,'') NOT IN ('验货通过')
      ) AS sop_qc,
      COUNT(*) FILTER (
        WHERE (lifecycle IS NULL OR lifecycle NOT IN ('已关闭','已完结'))
          AND COALESCE(space_status,'') NOT IN ('已订舱')
      ) AS sop_booking,
      COUNT(*) FILTER (
        WHERE (lifecycle IS NULL OR lifecycle NOT IN ('已关闭','已完结'))
          AND has_hbl = true
          AND COALESCE(hbl_status,'') NOT IN ('已放单','已电放')
      ) AS sop_hbl,
      COUNT(*) FILTER (
        WHERE (lifecycle IS NULL OR lifecycle NOT IN ('已关闭','已完结'))
          AND COALESCE(mbl_status,'') NOT IN ('已放单','已电放')
      ) AS sop_mbl,
      COUNT(*) FILTER (
        WHERE (lifecycle IS NULL OR lifecycle NOT IN ('已关闭','已完结'))
          AND COALESCE(finance_status,'') NOT IN ('已销账')
      ) AS sop_finance
    FROM public.shipments
  ),
  b AS (
    SELECT
      COUNT(*) FILTER (WHERE created_at >= (SELECT month_start FROM m)) AS month_bills,
      -- 未销账金额（CNY）：amount_cny × (1 - settled_amount / amount_total)
      ROUND(SUM(
        CASE
          WHEN COALESCE(amount_total,0) <= 0 THEN 0
          ELSE COALESCE(amount_cny,0)
               * GREATEST(0, 1 - COALESCE(settled_amount,0) / amount_total)
        END
      ))::bigint AS unsettled_cny
    FROM public.bills
  )
  SELECT jsonb_build_object(
    'month_orders',  s.month_orders,
    'open_orders',   s.open_orders,
    'month_bills',   b.month_bills,
    'unsettled_cny', COALESCE(b.unsettled_cny, 0),
    'sop_untouched', jsonb_build_object(
      'qc',      s.sop_qc,
      'booking', s.sop_booking,
      'hbl',     s.sop_hbl,
      'mbl',     s.sop_mbl,
      'finance', s.sop_finance
    )
  )
  FROM s, b;
$$;

GRANT EXECUTE ON FUNCTION public.portal_stats() TO authenticated;
