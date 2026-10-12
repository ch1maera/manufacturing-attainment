-- Daily miss_count over the last ~60 days — the 3x spike ~2 weeks ago is
-- visible, then partial decay.
-- @param catalog STRING = solution_builder
-- @param schema STRING = demo_plant_attainment_control_tower
SELECT
  miss_date,
  SUM(miss_count) AS miss_count,
  SUM(miss_units) AS miss_units
FROM IDENTIFIER(:catalog || '.' || :schema || '.gold_miss_pareto')
WHERE miss_date >= date_sub(current_date(), 60)
GROUP BY miss_date
ORDER BY miss_date
