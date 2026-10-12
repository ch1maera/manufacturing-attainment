CREATE OR REFRESH MATERIALIZED VIEW gold_attainment_by_sku
COMMENT "Attainment by SKU x plant x day. Powers the by-SKU dashboard and Genie SKU questions."
AS
SELECT
  plan_date,
  sku_id,
  sku_name,
  category,
  plant_id,
  plant_name,
  region,
  SUM(planned_units) AS planned_units,
  SUM(actual_units) AS actual_units,
  CAST(SUM(actual_units) AS DOUBLE) / NULLIF(SUM(planned_units), 0) AS attainment_pct
FROM silver_build_plan
GROUP BY plan_date, sku_id, sku_name, category, plant_id, plant_name, region
