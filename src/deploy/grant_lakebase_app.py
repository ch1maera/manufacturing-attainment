# Databricks notebook source
"""
Grant the app's service-principal Postgres role what it needs — DAB
setup-job task. Customer-release replacement for
`app/scripts/lakebase_grant_app_credential.sh`: no `psql`, no local
script — runs entirely server-side via the SDK + psycopg2.

WHY THIS EXISTS: adding a `postgres` app resource with
`CAN_CONNECT_AND_CREATE` (see databricks.yml) already makes the platform
create the app SP's Postgres role and grant it CONNECT + CREATE on the
database at bind time — which is enough for the app's own schemas (`app`,
`appkit`, `drizzle`; the app creates + owns these itself on first boot).
This task is a best-effort, idempotent SAFETY NET on top of that platform
behavior — cheap insurance across workspace/platform versions, and it also
covers `public` in case anything unexpectedly lands there. If it ever needs
re-running by hand, see CUSTOMER_DEPLOY.md's troubleshooting section for the
Lakebase UI SQL Editor fallback (paste one GRANT statement, no CLI at all).

Idempotent — repeated GRANTs no-op. Non-fatal by design: a GRANT failure
here must not fail the whole setup job (the platform-level grant from
CAN_CONNECT_AND_CREATE is very likely already sufficient on its own).

Parameters:
- app_name, lakebase_project_id, lakebase_branch_id, lakebase_database_name

Requires: databricks-sdk>=0.114.0, psycopg2-binary (environment_key: sdk_latest).
"""

# COMMAND ----------

dbutils.widgets.text("app_name", "", "App name")
dbutils.widgets.text("lakebase_project_id", "", "Lakebase project id")
dbutils.widgets.text("lakebase_branch_id", "production", "Lakebase branch id")
dbutils.widgets.text("lakebase_database_name", "", "Lakebase database name")

app_name = dbutils.widgets.get("app_name")
project_id = dbutils.widgets.get("lakebase_project_id")
branch_id = dbutils.widgets.get("lakebase_branch_id")
db_name = dbutils.widgets.get("lakebase_database_name")
assert app_name and project_id and branch_id and db_name, (
    "app_name, lakebase_project_id, lakebase_branch_id, "
    "lakebase_database_name are all required"
)

# COMMAND ----------

import sys

from databricks.sdk import WorkspaceClient

w = WorkspaceClient()

branch_path = f"projects/{project_id}/branches/{branch_id}"
endpoint_path = f"{branch_path}/endpoints/primary"

# Resolve the app's SP client_id — the grant TARGET. Per current Lakebase
# docs, the Postgres role Databricks creates for an app's `postgres`
# resource binding is named after the SP's client_id directly, so no
# `list-roles` lookup/matching is needed (simpler than the old bash script).
app = w.apps.get(name=app_name)
sp_client_id = app.service_principal_client_id
if not sp_client_id:
    print(
        f"[grant] WARN: app '{app_name}' has no service_principal_client_id yet "
        "— skipping (non-fatal). Re-run this task later if Drizzle migrations "
        "fail with pg=42501 on first app boot.",
        file=sys.stderr,
    )
    dbutils.notebook.exit("skipped: no service principal yet")

print(f"[grant] target: {endpoint_path} database={db_name} app={app_name} (sp={sp_client_id})")

# COMMAND ----------

# Generate a short-lived OAuth credential for the CALLING identity (the job's
# run-as user — typically the same person who created the Lakebase database
# in the UI, and therefore its owner, which is required to issue GRANTs).
try:
    cred = w.postgres.generate_database_credential(endpoint=endpoint_path)
    endpoint = w.postgres.get_endpoint(endpoint_path)
    pg_host = endpoint.status.hosts.host
    pg_user = w.current_user.me().user_name
except Exception as e:  # noqa: BLE001 — best-effort safety net, never fail the job
    print(f"[grant] WARN: could not obtain a Postgres credential — skipping (non-fatal): {e}", file=sys.stderr)
    dbutils.notebook.exit(f"skipped: {e}")

# COMMAND ----------

import psycopg2

GRANT_SQL = f"""
-- CREATE on the database so the app can make new schemas itself. Usually
-- already granted by the platform via the CAN_CONNECT_AND_CREATE binding —
-- re-asserting is a harmless no-op.
GRANT CREATE ON DATABASE "{db_name}" TO "{sp_client_id}";

-- public schema (default landing for anything unqualified). The app itself
-- doesn't use `public` today, but this keeps the door open + matches the
-- historical behavior this task replaces.
GRANT USAGE, CREATE ON SCHEMA public TO "{sp_client_id}";
GRANT ALL ON ALL TABLES IN SCHEMA public TO "{sp_client_id}";
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO "{sp_client_id}";
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO "{sp_client_id}";
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO "{sp_client_id}";

-- The app's own schemas (`app`, `appkit`, `drizzle`) are created + owned by
-- the SP itself on first boot (it has GRANT CREATE ON DATABASE above). Only
-- GRANT on any that already exist from a prior run — best-effort, skip
-- silently if a schema isn't present yet (the SP makes it on boot).
DO $$
DECLARE s text;
BEGIN
  FOREACH s IN ARRAY ARRAY['app','appkit','drizzle'] LOOP
    IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = s) THEN
      BEGIN
        EXECUTE format('GRANT ALL ON SCHEMA %I TO %I', s, '{sp_client_id}');
        EXECUTE format('GRANT ALL ON ALL TABLES IN SCHEMA %I TO %I', s, '{sp_client_id}');
        EXECUTE format('GRANT ALL ON ALL SEQUENCES IN SCHEMA %I TO %I', s, '{sp_client_id}');
      EXCEPTION WHEN insufficient_privilege THEN
        RAISE NOTICE 'not owner of schema % - SP owns it or will on boot; skipping', s;
      END;
    END IF;
  END LOOP;
END $$;
"""

try:
    conn = psycopg2.connect(
        host=pg_host,
        port=5432,
        user=pg_user,
        password=cred.token,
        dbname=db_name,
        sslmode="require",
    )
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute(GRANT_SQL)
    conn.close()
    print(f"[grant] done — {sp_client_id} granted on database '{db_name}'.")
except Exception as e:  # noqa: BLE001 — never fail the whole setup job over this
    print(f"[grant] WARN: GRANT statements failed — skipping (non-fatal): {e}", file=sys.stderr)
    print(
        "[grant]   If Drizzle migrations then fail on first app boot with "
        "pg=42501, see CUSTOMER_DEPLOY.md's troubleshooting section for the "
        "one-statement Lakebase SQL Editor fallback.",
        file=sys.stderr,
    )

# COMMAND ----------

dbutils.notebook.exit("done")
