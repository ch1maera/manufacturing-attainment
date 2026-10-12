CREATE OR REFRESH MATERIALIZED VIEW silver_plant_kpi
CLUSTER BY (kpi_date)
COMMENT "Daily plant KPIs (breakdowns, work orders, spend, first-pass quality, holds) joined to plant dims."
AS
SELECT
  k.kpi_date,
  k.plant_id,
  p.plant_name,
  p.region,
  k.breakdowns_count,
  k.work_orders_count,
  k.maintenance_spend_usd,
  k.first_pass_quality_pct,
  k.holds_count
FROM read_files('/Volumes/${catalog}/${schema}/raw_data/plant_kpi_daily', format => 'parquet') k
JOIN read_files('/Volumes/${catalog}/${schema}/raw_data/plants', format => 'parquet') p
  ON k.plant_id = p.plant_id
