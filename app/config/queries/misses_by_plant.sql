-- Misses by plant over the recent window (last 14 days). Plano/Tulsa/Fresno
-- lead.
-- @param catalog STRING = solution_builder
-- @param schema STRING = demo_plant_attainment_control_tower
SELECT
  plant_name,
  plant_id,
  region,
  SUM(miss_count) AS miss_count,
  SUM(miss_units) AS miss_units
FROM IDENTIFIER(:catalog || '.' || :schema || '.gold_miss_pareto')
WHERE miss_date >= date_sub(current_date(), 14)
GROUP BY plant_name, plant_id, region
ORDER BY miss_count DESC
