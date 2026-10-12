-- YoY attainment & adherence: current 52-week series vs the prior-year
-- same-week series. Grouped by ISO week; current-year vs (year-1) joined on
-- ISO week number so recent weeks line up with their prior-year counterpart.
-- The gold table carries 15 months of history so the overlap exists.
-- @param catalog STRING = solution_builder
-- @param schema STRING = demo_plant_attainment_control_tower
WITH weekly AS (
  SELECT
    weekofyear(plan_date) AS iso_week,
    year(plan_date) AS yr,
    SUM(actual_units) AS actual_units,
    SUM(planned_units) AS planned_units,
    AVG(adherence_pct) AS adherence_pct
  FROM IDENTIFIER(:catalog || '.' || :schema || '.gold_attainment_daily')
  WHERE plan_date >= date_sub(current_date(), 400)
  GROUP BY weekofyear(plan_date), year(plan_date)
),
cur AS (
  SELECT * FROM weekly WHERE yr = year(current_date())
),
prev AS (
  SELECT * FROM weekly WHERE yr = year(current_date()) - 1
)
SELECT
  cur.iso_week,
  CAST(ROUND(cur.actual_units / NULLIF(cur.planned_units, 0), 4) AS DOUBLE) AS attainment_pct,
  CAST(ROUND(cur.adherence_pct, 4) AS DOUBLE) AS adherence_pct,
  CAST(ROUND(prev.actual_units / NULLIF(prev.planned_units, 0), 4) AS DOUBLE) AS attainment_pct_prior,
  CAST(ROUND(prev.adherence_pct, 4) AS DOUBLE) AS adherence_pct_prior
FROM cur
LEFT JOIN prev ON prev.iso_week = cur.iso_week
ORDER BY cur.iso_week
