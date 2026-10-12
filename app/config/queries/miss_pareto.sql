-- Miss Pareto: miss_count by reason_code over the last 30 days, sorted
-- descending, with a cumulative % of total. Mechanical Downtime is the tall
-- #1 bar, Material Shortage #2.
-- @param catalog STRING = solution_builder
-- @param schema STRING = demo_plant_attainment_control_tower
WITH agg AS (
  SELECT
    reason_code,
    SUM(miss_count) AS miss_count,
    SUM(miss_units) AS miss_units
  FROM IDENTIFIER(:catalog || '.' || :schema || '.gold_miss_pareto')
  WHERE miss_date >= date_sub(current_date(), 30)
  GROUP BY reason_code
)
SELECT
  reason_code,
  miss_count,
  miss_units,
  CAST(ROUND(
    100.0 * SUM(miss_count) OVER (ORDER BY miss_count DESC ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
      / NULLIF(SUM(miss_count) OVER (), 0)
  , 1) AS DOUBLE) AS cumulative_pct
FROM agg
ORDER BY miss_count DESC
