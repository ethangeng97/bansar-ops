-- ═══════════════════════════════════════════════════════════════
-- 007_payments_summary.sql
-- payments 列表头部统计 RPC：返回符合筛选条件的全量 count + sum
-- 不受 PostgREST 默认 1000 行上限影响。客户端分页时单独调一次拿头部数字。
-- 使用 CREATE OR REPLACE，重复执行安全。
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.payments_summary(
  p_direction  text,
  p_status     text DEFAULT NULL,
  p_currency   text DEFAULT NULL,
  p_keyword    text DEFAULT NULL,
  p_date_from  date DEFAULT NULL,
  p_date_to    date DEFAULT NULL
)
RETURNS TABLE(cnt bigint, total_cny numeric, by_currency jsonb)
LANGUAGE sql STABLE AS $$
  WITH filtered AS (
    SELECT amount, amount_cny, currency
      FROM public.payments
     WHERE direction = p_direction
       AND (p_status   IS NULL OR p_status   = '' OR status   = p_status)
       AND (p_currency IS NULL OR p_currency = '' OR currency = p_currency)
       AND (p_date_from IS NULL OR payment_date >= p_date_from)
       AND (p_date_to   IS NULL OR payment_date <= p_date_to)
       AND (
         p_keyword IS NULL OR p_keyword = '' OR (
           payment_no   ILIKE '%' || p_keyword || '%' OR
           partner_name ILIKE '%' || p_keyword || '%' OR
           bank_account ILIKE '%' || p_keyword || '%' OR
           bank_flow_no ILIKE '%' || p_keyword || '%' OR
           notes        ILIKE '%' || p_keyword || '%'
         )
       )
  ),
  by_ccy AS (
    SELECT currency, SUM(amount) AS total
      FROM filtered
     GROUP BY currency
  )
  SELECT
    (SELECT COUNT(*)::bigint                              FROM filtered) AS cnt,
    (SELECT COALESCE(SUM(amount_cny), 0)::numeric         FROM filtered) AS total_cny,
    COALESCE(
      (SELECT jsonb_agg(jsonb_build_object('currency', currency, 'total', total) ORDER BY currency)
         FROM by_ccy),
      '[]'::jsonb
    ) AS by_currency;
$$;

GRANT EXECUTE ON FUNCTION public.payments_summary(text, text, text, text, date, date) TO authenticated, anon;
