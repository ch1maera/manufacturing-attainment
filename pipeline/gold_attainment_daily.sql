CREATE OR REFRESH MATERIALIZED VIEW gold_attainment_daily
COMMENT "One row per plant per day: planned/actual units, attainment %, adherence %. Powers company roll-up, per-plant trends and YoY steering trend."
AS
SELECT
  plan_date,
  plant_id,
  plant_name,
  region,
  SUM(planned_units) AS planned_units,
  SUM(actual_units) AS actual_units,
  CAST(SUM(actual_units) AS DOUBLE) / NULLIF(SUM(planned_units), 0) AS attainment_pct,
  AVG(CASE WHEN on_time_flag THEN 1.0 ELSE 0.0 END) AS adherence_pct
FROM silver_build_plan
GROUP BY plan_date, plant_id, plant_name, region
