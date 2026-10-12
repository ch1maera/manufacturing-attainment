-- Company-wide daily attainment % + adherence % over the last ~90 days.
-- Company attainment = SUM(actual)/SUM(planned) across all plants per day.
-- The ~96%→~94% dip two weeks ago is visible (the 3 laggards fell to ~82%).
-- @param catalog STRING = solution_builder
-- @param schema STRING = demo_plant_attainment_control_tower
SELECT
  plan_date,
  CAST(ROUND(SUM(actual_units) / NULLIF(SUM(planned_units), 0), 4) AS DOUBLE) AS attainment_pct,
  CAST(ROUND(AVG(adherence_pct), 4) AS DOUBLE) AS adherence_pct
FROM IDENTIFIER(:catalog || '.' || :schema || '.gold_attainment_daily')
WHERE plan_date >= date_sub(current_date(), 90)
GROUP BY plan_date
ORDER BY plan_date
