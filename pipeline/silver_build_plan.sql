CREATE OR REFRESH MATERIALIZED VIEW silver_build_plan
(
  CONSTRAINT valid_planned EXPECT (planned_units > 0)
)
CLUSTER BY (plan_date)
COMMENT "Build plan (date x plant x sku) enriched with plant, line and sku dimensions; attainment_pct computed."
AS
SELECT
  bp.plan_date,
  bp.plant_id,
  p.plant_name,
  p.region,
  p.city,
  p.state,
  p.lat,
  p.lng,
  bp.line_id,
  l.line_name,
  l.product_family,
  bp.sku_id,
  s.sku_name,
  s.category,
  s.pack_size,
  bp.planned_units,
  bp.actual_units,
  CAST(bp.actual_units AS DOUBLE) / NULLIF(bp.planned_units, 0) AS attainment_pct,
  bp.planned_complete_ts,
  bp.actual_complete_ts,
  bp.on_time_flag
FROM read_files('/Volumes/${catalog}/${schema}/raw_data/build_plan', format => 'parquet') bp
JOIN read_files('/Volumes/${catalog}/${schema}/raw_data/plants', format => 'parquet') p
  ON bp.plant_id = p.plant_id
JOIN read_files('/Volumes/${catalog}/${schema}/raw_data/lines', format => 'parquet') l
  ON bp.line_id = l.line_id
JOIN read_files('/Volumes/${catalog}/${schema}/raw_data/skus', format => 'parquet') s
  ON bp.sku_id = s.sku_id
