# Databricks notebook source
"""
Deploy the Plant Attainment Genie Space — DAB setup-job task.

Loads the committed Genie space JSON (curated questions + curated SQLs + story
instructions), substitutes the catalog/schema, then creates or updates the
space via the SDK. Idempotent: searches by title, updates if present, creates
if not.

REQUIRES: databricks-sdk>=0.114.0 (environment_key: sdk_latest in databricks.yml).

Parameters (via base_parameters):
- catalog: Unity Catalog name
- schema:  Schema name
- warehouse_id: SQL warehouse the Genie space uses

Outputs (via dbutils.jobs.taskValues.set):
- genie_space_id: the resolved space ID (consumed by the MAS task)
"""

# COMMAND ----------

SPACE_TITLE = "Attainment Analyst"
SPACE_DESCRIPTION = (
    "Attainment analyst for Acme Manufacturing (20-plant manufacturer). "
    "Answers attainment / adherence / open-miss questions over the gold tables. "
    "Walk the sample questions in order on a cold start."
)

# The catalog.schema baked into the committed genie_space.json; literal-replaced
# with the deployed catalog.schema at runtime.
SRC_QUALIFIER = "solution_builder.demo_plant_attainment_control_tower"

# COMMAND ----------

dbutils.widgets.text("catalog", "", "Catalog")
dbutils.widgets.text("schema",  "", "Schema")
dbutils.widgets.text("warehouse_id", "", "Warehouse ID")

catalog      = dbutils.widgets.get("catalog")
schema       = dbutils.widgets.get("schema")
warehouse_id = dbutils.widgets.get("warehouse_id")

assert catalog and schema and warehouse_id, "catalog + schema + warehouse_id are required"

print(f"Deploying Genie Space: '{SPACE_TITLE}'")
print(f"  catalog.schema: {catalog}.{schema}")
print(f"  warehouse:      {warehouse_id}")

# COMMAND ----------

import json
import os
from databricks.sdk import WorkspaceClient

# Committed config lives at src/genie/genie_space.json relative to the bundle root.
notebook_path = dbutils.notebook.entry_point.getDbutils().notebook().getContext().notebookPath().get()
bundle_root   = os.path.dirname(os.path.dirname(os.path.dirname(notebook_path)))
config_path   = f"/Workspace{bundle_root}/src/genie/genie_space.json"
print(f"Loading: {config_path}")

with open(config_path) as f:
    serialized = f.read()

# Substitute the authored catalog.schema with the deployed one. Literal
# string-replace covers both table identifiers AND SQL bodies.
DST_QUALIFIER = f"{catalog}.{schema}"
n = serialized.count(SRC_QUALIFIER)
substituted = serialized.replace(SRC_QUALIFIER, DST_QUALIFIER)
print(f"Substituted {n} occurrences of {SRC_QUALIFIER} → {DST_QUALIFIER}")

# Validate it still parses cleanly.
space_payload = json.loads(substituted)
print(f"data_sources.tables: {len(space_payload['data_sources']['tables'])}")
print(f"sample_questions:    {len(space_payload['config']['sample_questions'])}")
print(f"example_sqls:        {len(space_payload['instructions']['example_question_sqls'])}")

# COMMAND ----------

w = WorkspaceClient()

# Search by title — paginate through pages of GenieListSpacesResponse (NOT a
# generator: it returns .spaces + .next_page_token).
existing_id = None
page_token = None
while True:
    resp = w.genie.list_spaces(page_size=200, page_token=page_token)
    for sp in (resp.spaces or []):
        if sp.title == SPACE_TITLE:
            existing_id = sp.space_id
            print(f"Found existing space: {existing_id}")
            break
    if existing_id or not getattr(resp, "next_page_token", None):
        break
    page_token = resp.next_page_token

# COMMAND ----------

if existing_id:
    print(f"Updating space {existing_id}…")
    w.genie.update_space(
        space_id=existing_id,
        warehouse_id=warehouse_id,
        serialized_space=substituted,
    )
    space_id = existing_id
else:
    print("Creating new space…")
    created = w.genie.create_space(
        warehouse_id=warehouse_id,
        title=SPACE_TITLE,
        description=SPACE_DESCRIPTION,
        serialized_space=substituted,
    )
    space_id = created.space_id

print(f"Genie space ready: {space_id}")

# COMMAND ----------

dbutils.jobs.taskValues.set(key="genie_space_id", value=space_id)
print(f"task value set: genie_space_id = {space_id}")
