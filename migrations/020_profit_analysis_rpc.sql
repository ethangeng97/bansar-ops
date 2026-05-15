-- 020_profit_analysis_rpc.sql
-- 利润分析 RPC：按维度返回每组的 票数 / 应收 CNY / 应付 CNY / 毛利 / 毛利率
-- 维度 p_dimension：'month' | 'customer' | 'salesperson' | 'route' | 'carrier'
-- 时间过滤走 shipments.etd（默认）；shipments.etd IS NULL 的票纳入"未排船"分组
-- 过滤参数都可空。
--
-- charges.amount_cny 是 ETL/触发器在录入时折算的 CNY 金额，直接 SUM 即可。

CREATE OR REPLACE FUNCTION public.profit_analysis(
  p_date_from      date    DEFAULT NULL,
  p_date_to        date    DEFAULT NULL,
  p_dimension      text    DEFAULT 'month',
  p_customer       text    DEFAULT NULL,
  p_salesperson_id uuid    DEFAULT NULL,
  p_carrier        text    DEFAULT NULL
)
RETURNS TABLE (
  bucket          text,
  shipments_count bigint,
  ar_cny          numeric,
  ap_cny          numeric,
  gross_cny       numeric,
  gross_pct       numeric
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  WITH ship_filtered AS (
    SELECT s.*
    FROM public.shipments s
    WHERE (p_date_from      IS NULL OR s.etd >= p_date_from)
      AND (p_date_to        IS NULL OR s.etd <= p_date_to)
      AND (p_customer       IS NULL OR s.customer = p_customer)
      AND (p_salesperson_id IS NULL OR s.salesperson_id = p_salesperson_id)
      AND (p_carrier        IS NULL OR s.carrier = p_carrier)
      AND (s.lifecycle IS NULL OR s.lifecycle != '已关闭')
  ),
  charges_agg AS (
    SELECT
      c.shipment_id,
      SUM(c.amount_cny) FILTER (WHERE c.direction = '应收') AS ar_cny,
      SUM(c.amount_cny) FILTER (WHERE c.direction = '应付') AS ap_cny
    FROM public.charges c
    WHERE c.shipment_id IN (SELECT id FROM ship_filtered)
    GROUP BY c.shipment_id
  ),
  bucketed AS (
    SELECT
      CASE p_dimension
        WHEN 'month'       THEN COALESCE(to_char(s.etd, 'YYYY-MM'), '未排船')
        WHEN 'customer'    THEN COALESCE(s.customer, '（无委托单位）')
        WHEN 'salesperson' THEN COALESCE(up.display_name, up.full_name, '（未指派销售）')
        WHEN 'route'       THEN COALESCE(s.pol, '?') || ' → ' || COALESCE(s.pod, '?')
        WHEN 'carrier'     THEN COALESCE(s.carrier, '（无船公司）')
        ELSE 'all'
      END AS bucket,
      s.id,
      COALESCE(ca.ar_cny, 0) AS ar,
      COALESCE(ca.ap_cny, 0) AS ap
    FROM ship_filtered s
    LEFT JOIN charges_agg ca ON ca.shipment_id = s.id
    LEFT JOIN public.user_profiles up ON up.id = s.salesperson_id
  )
  SELECT
    bucket,
    COUNT(*)::bigint                              AS shipments_count,
    COALESCE(SUM(ar), 0)                          AS ar_cny,
    COALESCE(SUM(ap), 0)                          AS ap_cny,
    COALESCE(SUM(ar) - SUM(ap), 0)                AS gross_cny,
    CASE
      WHEN COALESCE(SUM(ar), 0) > 0
        THEN ROUND((SUM(ar) - SUM(ap)) / SUM(ar) * 100, 1)
      ELSE NULL
    END                                           AS gross_pct
  FROM bucketed
  GROUP BY bucket
  ORDER BY
    -- month 维度按时间倒序；其他按毛利从高到低
    CASE WHEN p_dimension = 'month' THEN bucket END DESC,
    CASE WHEN p_dimension != 'month' THEN COALESCE(SUM(ar), 0) - COALESCE(SUM(ap), 0) END DESC;
$$;

GRANT EXECUTE ON FUNCTION public.profit_analysis(date, date, text, text, uuid, text) TO authenticated;
