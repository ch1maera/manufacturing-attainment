# Databricks notebook source
"""
Grant the app's service principal UC privileges — DAB setup-job task.

The app reads the demo's data via SQL warehouse + reads raw data from a UC
volume. Without these grants the app's first /api/config call crashes with:
  INSUFFICIENT_PERMISSIONS: User does not have USE CATALOG on Catalog ...

Granted to the app SP:
  - USE_CATALOG on the catalog
  - USE_SCHEMA + SELECT on the schema (covers every gold_*/silver_* read)
  - READ_VOLUME on the demo's volume(s)

WHY auto-resolve the SP: the grant target is the app's service-principal
client_id (a UUID). We resolve it via w.apps.get(app_name) rather than passing
it as a parameter — more robust against config drift. UC grants are issued as
SQL via spark.sql.

Idempotent — repeated grants no-op.

Parameters:
- catalog, schema, app_name
"""

# COMMAND ----------

# Volumes the app reads. This demo only has the raw_data volume (no RAG PDFs,
# no ML model/function).
DEMO_VOLUMES = ["raw_data"]

# COMMAND ----------

dbutils.widgets.text("catalog",  "", "Catalog")
dbutils.widgets.text("schema",   "", "Schema")
dbutils.widgets.text("app_name", "", "App name")

catalog  = dbutils.widgets.get("catalog")
schema   = dbutils.widgets.get("schema")
app_name = dbutils.widgets.get("app_name")
assert catalog and schema and app_name

# COMMAND ----------

from databricks.sdk import WorkspaceClient

w = WorkspaceClient()

# Resolve the app SP's client_id (UUID grant target). Auto-resolving is more
# robust against config drift than passing it as a parameter.
app = w.apps.get(name=app_name)
sp_client_id = app.service_principal_client_id
assert sp_client_id, f"App '{app_name}' has no service_principal_client_id"
print(f"App SP: {sp_client_id}")

# COMMAND ----------

# UC grants are SQL — easier to issue via spark.sql than the SDK.
grants = [
    f"GRANT USE_CATALOG ON CATALOG {catalog} TO `{sp_client_id}`",
    f"GRANT USE_SCHEMA, SELECT ON SCHEMA {catalog}.{schema} TO `{sp_client_id}`",
]
grants += [
    f"GRANT READ_VOLUME ON VOLUME {catalog}.{schema}.{vol} TO `{sp_client_id}`"
    for vol in DEMO_VOLUMES
]

for stmt in grants:
    print(f"  {stmt}")
    spark.sql(stmt)

print("Grants applied.")
