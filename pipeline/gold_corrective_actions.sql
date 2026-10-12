CREATE OR REFRESH MATERIALIZED VIEW gold_corrective_actions
COMMENT "Pre-seeded corrective-action history for the steering-committee tracker (misses that already have a corrective action)."
AS
SELECT
  action_id,
  miss_id,
  plant_id,
  plant_name,
  region,
  sku_name,
  reason_code,
  miss_date,
  action_desc,
  owner,
  implementation_date,
  ca_status
FROM silver_adherence_miss
WHERE has_corrective_action = TRUE
