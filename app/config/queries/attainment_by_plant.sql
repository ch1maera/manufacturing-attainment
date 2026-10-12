-- Attainment % per plant over the recent window (last 14 days), sorted
-- ascending. PLNT-07/12/15 (Plano/Tulsa/Fresno) sit at the bottom (~82%).
-- @param catalog STRING = solution_builder
-- @param schema STRING = demo_plant_attainment_control_tower
SELECT
  plant_name,
  plant_id,
  region,
  CAST(ROUND(SUM(actual_units) / NULLIF(SUM(planned_units), 0), 4) AS DOUBLE) AS attainment_pct
FROM IDENTIFIER(:catalog || '.' || :schema || '.gold_attainment_daily')
WHERE plan_date >= date_sub(current_date(), 14)
GROUP BY plant_name, plant_id, region
ORDER BY attainment_pct ASC
