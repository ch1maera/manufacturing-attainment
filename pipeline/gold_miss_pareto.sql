CREATE OR REFRESH MATERIALIZED VIEW gold_miss_pareto
COMMENT "Miss counts + units by date x plant x reason_code. Powers the Pareto page and Genie miss-ranking answers."
AS
SELECT
  miss_date,
  plant_id,
  plant_name,
  region,
  reason_code,
  COUNT(*) AS miss_count,
  SUM(miss_units) AS miss_units
FROM silver_adherence_miss
GROUP BY miss_date, plant_id, plant_name, region, reason_code
