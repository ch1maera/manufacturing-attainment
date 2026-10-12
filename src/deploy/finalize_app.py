# Databricks notebook source
"""
Finalize the Databricks App — DAB setup-job task. Customer-release
replacement for `app/scripts/finalize_app.sh`: runs entirely server-side,
inside this job, with no customer-run script.

Renders app.yaml's env block from the resources this job itself just
created (Genie space, MAS endpoint — the bundle can't know these at deploy
time), redeploys the app with that env, and grants the app's service
principal the workspace permissions it needs to actually use them.

WHY IN-JOB (not a local script harvesting `get-run-output`): this task runs
INSIDE the same job as `deploy_genie`/`deploy_mas`, so it reads their
outputs directly via task values — no external harvesting step needed.

Parameters (base_parameters):
- bundle_name, bundle_target: used only to compute the default app source
  path if the app has no active deployment yet.
- app_name, catalog, schema, pipeline_id, warehouse_id
- genie_space_id, mas_endpoint_name (task values from deploy_genie/deploy_mas)

GUARD: if {{task.values}} substitution didn't fire, the widget value is the
literal template string ("{{...}}") — fail loudly rather than deploy a
broken app.yaml.

Requires: databricks-sdk>=0.114.0 (environment_key: sdk_latest).
"""

# COMMAND ----------

names = [
    "bundle_name", "bundle_target", "app_name",
    "catalog", "schema", "pipeline_id", "warehouse_id",
    "genie_space_id", "mas_endpoint_name",
]
for n in names:
    dbutils.widgets.text(n, "", n)

vals = {n: dbutils.widgets.get(n) for n in names}

for k in ("genie_space_id", "mas_endpoint_name"):
    v = vals[k]
    if v.startswith("{{") and v.endswith("}}"):
        raise RuntimeError(f"{k}={v!r} — task value substitution didn't fire.")

print("Finalizing app with resources:")
for k, v in vals.items():
    print(f"  {k} = {v}")

# COMMAND ----------

import sys
from datetime import timedelta

from databricks.sdk import WorkspaceClient
from databricks.sdk.service.apps import AppDeployment

w = WorkspaceClient()

# Locate the bundle's synced files root the same way deploy_genie.py /
# deploy_mas.py do: this notebook's own workspace path is
# <files_root>/src/deploy/finalize_app, so three dirname() calls up gets
# back to <files_root>.
notebook_path = dbutils.notebook.entry_point.getDbutils().notebook().getContext().notebookPath().get()
import os
files_root = os.path.dirname(os.path.dirname(os.path.dirname(notebook_path)))
template_path = f"/Workspace{files_root}/app/app.yaml.template"
print(f"Reading template: {template_path}")

with open(template_path) as f:
    template_text = f.read()

# COMMAND ----------

# Render the full env: block — same field list as the old finalize_app.sh.
# value_from entries are platform bindings (warehouse + postgres); plain
# values come from this job's own parameters/task-values.
env_lines = [
    ("NODE_ENV", "production"),
    ("__VALUEFROM__DATABRICKS_WAREHOUSE_ID", "sql-warehouse"),
    ("__VALUEFROM__WAREHOUSE_ID", "sql-warehouse"),
    ("__VALUEFROM__LAKEBASE_ENDPOINT", "postgres"),
    ("DEMO_CATALOG", vals["catalog"]),
    ("DEMO_SCHEMA", vals["schema"]),
    ("DASHBOARD_ID", ""),
    ("PIPELINE_ID", vals["pipeline_id"]),
    ("AGENT_MLFLOW_EXPERIMENT_PATH", ""),
    ("GENIE_SPACE_ID", vals["genie_space_id"]),
    ("KA_ENDPOINT_NAME", ""),
    ("MAS_ENDPOINT_NAME", vals["mas_endpoint_name"]),
]

# Keep everything BEFORE the `env:` line (command + user_authorization).
head = template_text.split("\nenv:", 1)[0].rstrip() + "\n"

lines = ["", "env:"]
for name, val in env_lines:
    if name.startswith("__VALUEFROM__"):
        lines.append(f"  - name: {name.replace('__VALUEFROM__', '')}")
        lines.append(f"    valueFrom: {val}")
    else:
        lines.append(f"  - name: {name}")
        lines.append(f'    value: "{val}"')

rendered = head + "\n".join(lines) + "\n"
print(f"Rendered app.yaml with {len(env_lines)} env entries")

# COMMAND ----------

# Resolve the app's actual source path: reuse the active/pending deployment's
# path if one exists, else fall back to the bundle-synced default (matches
# the old finalize_app.sh's fallback logic).
app = w.apps.get(name=vals["app_name"])
default_src = f"/Workspace{files_root}/app"
src_path = (
    (app.active_deployment.source_code_path if app.active_deployment else None)
    or app.default_source_code_path
    or default_src
)
print(f"App source path: {src_path}")

app_yaml_path = f"{src_path}/app.yaml"
print(f"Uploading rendered app.yaml -> {app_yaml_path}")
w.workspace.upload(app_yaml_path, rendered.encode("utf-8"), overwrite=True)

# COMMAND ----------

# App compute must be RUNNING before `apps.deploy`.
print("Ensuring app compute is running…")
w.apps.start_and_wait(name=vals["app_name"], timeout=timedelta(minutes=20))

print(f"Deploying app: {vals['app_name']}")
w.apps.deploy_and_wait(
    app_name=vals["app_name"],
    app_deployment=AppDeployment(source_code_path=src_path),
    timeout=timedelta(minutes=20),
)
print("App deployed.")

# COMMAND ----------

# Grant the app SP what it needs on workspace resources it can't know about
# until it exists — the SP doesn't exist until `bundle deploy` creates the
# app, so these can't be a `permissions:` block in databricks.yml.
#
#   pipelines/<id>          CAN_VIEW   → the UI's live pipeline status
#   serving-endpoints/<id>  CAN_QUERY  → the chat dock can call the MAS at all
#   genie/<space_id>        CAN_RUN    → the MAS can reach its Genie sub-agent
#
# Non-fatal by design — a missing grant must not fail the whole setup job;
# it degrades to "chat gets PERMISSION_DENIED", documented in
# CUSTOMER_DEPLOY.md's troubleshooting section (re-run this task to retry).
app_sp = app.service_principal_client_id


def grant_permission(object_path: str, level: str, label: str) -> None:
    try:
        w.api_client.do(
            method="PATCH",
            path=f"/api/2.0/permissions/{object_path}",
            body={
                "access_control_list": [
                    {"service_principal_name": app_sp, "permission_level": level}
                ]
            },
        )
        print(f"  {label} grant ok ({level})")
    except Exception as e:  # noqa: BLE001 — never fail the job over a grant
        print(f"WARN: {label} grant failed — need CAN_MANAGE on it? {e}", file=sys.stderr)


if not app_sp:
    print(
        "WARN: couldn't resolve the app service principal's application id. "
        "Live pipeline status will read 'unavailable' and the chat dock will "
        "get PERMISSION_DENIED. Grant the app SP CAN_VIEW on the pipeline, "
        "CAN_QUERY on the MAS endpoint and CAN_RUN on the Genie space manually, "
        "or re-run this task.",
        file=sys.stderr,
    )
else:
    print(f"Granting app SP {app_sp} workspace permissions")
    if vals["pipeline_id"]:
        grant_permission(f"pipelines/{vals['pipeline_id']}", "CAN_VIEW", "pipeline")
    else:
        print("  NOTE: no pipeline_id — skipping pipeline grant.")

    mas_endpoint_id = ""
    if vals["mas_endpoint_name"]:
        try:
            mas_endpoint_id = w.serving_endpoints.get(vals["mas_endpoint_name"]).id or ""
        except Exception as e:  # noqa: BLE001
            print(f"WARN: couldn't resolve MAS serving endpoint id: {e}", file=sys.stderr)
    if mas_endpoint_id:
        grant_permission(f"serving-endpoints/{mas_endpoint_id}", "CAN_QUERY", "MAS endpoint")
    else:
        print(
            "WARN: couldn't resolve the MAS serving endpoint id — the chat dock "
            "will get PERMISSION_DENIED on every question.",
            file=sys.stderr,
        )

    if vals["genie_space_id"]:
        grant_permission(f"genie/{vals['genie_space_id']}", "CAN_RUN", "genie space")
    else:
        print("  NOTE: no genie_space_id — skipping Genie grant.")

print("finalize_app done — app should boot with full env.")

# COMMAND ----------

dbutils.notebook.exit("done")
