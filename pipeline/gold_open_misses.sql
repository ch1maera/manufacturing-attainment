CREATE OR REFRESH MATERIALIZED VIEW gold_open_misses
COMMENT "Open-miss backlog (no corrective action) for the app Operations queue + Lakebase mirror. ~120-180 rows concentrated at PLNT-07/12/15."
AS
SELECT
  miss_id,
  miss_date,
  plant_id,
  plant_name,
  region,
  line_id,
  line_name,
  sku_id,
  sku_name,
  category,
  production_order,
  miss_units,
  reason_code,
  comment,
  status
FROM silver_adherence_miss
WHERE has_corrective_action = FALSE AND status = 'open'
