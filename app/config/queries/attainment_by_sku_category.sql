-- Attainment % by SKU category (Chips/Crackers/Popcorn/Pretzels) over the
-- recent window (last 30 days).
-- @param catalog STRING = solution_builder
-- @param schema STRING = demo_plant_attainment_control_tower
SELECT
  category,
  CAST(ROUND(SUM(actual_units) / NULLIF(SUM(planned_units), 0), 4) AS DOUBLE) AS attainment_pct,
  SUM(planned_units) AS planned_units,
  SUM(actual_units) AS actual_units
FROM IDENTIFIER(:catalog || '.' || :schema || '.gold_attainment_by_sku')
WHERE plan_date >= date_sub(current_date(), 30)
GROUP BY category
ORDER BY attainment_pct ASC
