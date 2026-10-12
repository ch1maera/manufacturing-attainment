CREATE OR REFRESH MATERIALIZED VIEW silver_adherence_miss
CLUSTER BY (miss_date)
COMMENT "Adherence miss events enriched with plant/line/sku dims + LEFT JOIN corrective action; has_corrective_action flag."
AS
SELECT
  m.miss_id,
  m.miss_date,
  m.plant_id,
  p.plant_name,
  p.region,
  m.line_id,
  l.line_name,
  m.sku_id,
  s.sku_name,
  s.category,
  m.production_order,
  m.miss_units,
  m.reason_code,
  m.comment,
  m.detected_by,
  m.status,
  m.created_ts,
  ca.action_id,
  ca.action_desc,
  ca.owner,
  ca.implementation_date,
  ca.ca_status AS ca_status,
  (ca.action_id IS NOT NULL) AS has_corrective_action
FROM read_files('/Volumes/${catalog}/${schema}/raw_data/adherence_miss', format => 'parquet') m
JOIN read_files('/Volumes/${catalog}/${schema}/raw_data/plants', format => 'parquet') p
  ON m.plant_id = p.plant_id
JOIN read_files('/Volumes/${catalog}/${schema}/raw_data/lines', format => 'parquet') l
  ON m.line_id = l.line_id
JOIN read_files('/Volumes/${catalog}/${schema}/raw_data/skus', format => 'parquet') s
  ON m.sku_id = s.sku_id
LEFT JOIN read_files('/Volumes/${catalog}/${schema}/raw_data/corrective_actions', format => 'parquet') ca
  ON m.miss_id = ca.miss_id
