CREATE OR REFRESH MATERIALIZED VIEW gold_plant_scorecard
COMMENT "One row per plant over the recent 14-day window: attainment/adherence, open-miss counts/units, KPIs, lat/lng. The app plant-map source — PLNT-07/12/15 glow red."
AS
WITH bounds AS (
  SELECT date_sub(MAX(plan_date), 14) AS win_start FROM silver_build_plan
),
att AS (
  SELECT
    b.plant_id,
    CAST(SUM(b.actual_units) AS DOUBLE) / NULLIF(SUM(b.planned_units), 0) AS attainment_pct,
    AVG(CASE WHEN b.on_time_flag THEN 1.0 ELSE 0.0 END) AS adherence_pct
  FROM silver_build_plan b, bounds
  WHERE b.plan_date >= bounds.win_start
  GROUP BY b.plant_id
),
openm AS (
  SELECT
    plant_id,
    COUNT(*) AS open_miss_count,
    SUM(miss_units) AS open_miss_units
  FROM silver_adherence_miss
  WHERE has_corrective_action = FALSE AND status = 'open'
  GROUP BY plant_id
),
kpi AS (
  SELECT
    k.plant_id,
    SUM(k.breakdowns_count) AS breakdowns_count,
    SUM(k.work_orders_count) AS work_orders_count,
    SUM(k.maintenance_spend_usd) AS maintenance_spend_usd,
    AVG(k.first_pass_quality_pct) AS first_pass_quality_pct,
    SUM(k.holds_count) AS holds_count
  FROM silver_plant_kpi k, bounds
  WHERE k.kpi_date >= bounds.win_start
  GROUP BY k.plant_id
)
SELECT
  p.plant_id,
  p.plant_name,
  p.city,
  p.state,
  p.region,
  p.lat,
  p.lng,
  att.attainment_pct,
  att.adherence_pct,
  COALESCE(openm.open_miss_count, 0) AS open_miss_count,
  COALESCE(openm.open_miss_units, 0) AS open_miss_units,
  COALESCE(kpi.breakdowns_count, 0) AS breakdowns_count,
  COALESCE(kpi.work_orders_count, 0) AS work_orders_count,
  COALESCE(kpi.maintenance_spend_usd, 0.0) AS maintenance_spend_usd,
  kpi.first_pass_quality_pct,
  COALESCE(kpi.holds_count, 0) AS holds_count
FROM read_files('/Volumes/${catalog}/${schema}/raw_data/plants', format => 'parquet') p
LEFT JOIN att ON p.plant_id = att.plant_id
LEFT JOIN openm ON p.plant_id = openm.plant_id
LEFT JOIN kpi ON p.plant_id = kpi.plant_id
