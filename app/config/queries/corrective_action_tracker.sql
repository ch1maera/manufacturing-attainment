-- Steering-committee corrective-action HISTORY, from Delta gold. This returns
-- the pre-seeded resolved-miss actions only. The LIVE corrective actions Maya
-- + the agent just recorded are NOT here — they live in Lakebase (app.misses)
-- and are fetched via the app's DB (`GET /api/corrective-actions`, which UNIONs
-- this history with the live rows server-side). The Steering view merges both;
-- this query supplies the historical set.
-- @param catalog STRING = solution_builder
-- @param schema STRING = demo_plant_attainment_control_tower
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
FROM IDENTIFIER(:catalog || '.' || :schema || '.gold_corrective_actions')
ORDER BY implementation_date DESC
