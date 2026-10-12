# Deploy — Plant Attainment Control Tower

This guide walks a data engineer with **no prior Databricks Apps experience**
through deploying this demo into your own Databricks workspace.

**You will not install Node, npm, Python, or `psql`, and you will not run any
`.sh`/`.py` script.** Every step is either a single Databricks CLI command or
a few clicks in the Databricks UI. Every command below is written as ONE line
and works identically whether you paste it into **Windows PowerShell** or
**macOS/Linux zsh/bash** — don't add line breaks or backslashes.

---

## 1. Prerequisites

### 1.1 Install the Databricks CLI

**Windows (PowerShell):**

```powershell
winget install Databricks.DatabricksCLI
```

Restart your terminal after this finishes, then confirm it worked:

```powershell
databricks -v
```

**macOS (zsh/Terminal):**

```zsh
brew tap databricks/tap
```

```zsh
brew install databricks
```

Confirm it worked:

```zsh
databricks -v
```

You need CLI version **0.283.0 or later** (this package's `databricks.yml`
uses the app `config` field added in that release). If `databricks -v` shows
an older version, re-run the install command above to update.

### 1.2 Authenticate to your workspace

Get your workspace URL from your browser's address bar (e.g.
`https://your-company.cloud.databricks.com`), then run (same command, both
platforms):

```
databricks auth login --host https://<your-workspace-url> --profile customer
```

This opens a browser window to log in, then saves the credentials under the
profile name `customer`. **Every command below explicitly passes
`--profile customer`** rather than relying on an environment variable —
that's what keeps every command identical between PowerShell and zsh (setting
persistent environment variables uses different syntax in each shell, so we
avoid it entirely).

### 1.3 Workspace prerequisites checklist

Confirm with your Databricks admin (or verify yourself if you have
sufficient permissions) **before** deploying:

| Requirement | Why | If missing |
|---|---|---|
| A Unity Catalog **catalog** you can create schemas/volumes in | Holds all demo data | Ask an admin to grant you `USE CATALOG` + `CREATE SCHEMA` + `CREATE VOLUME`, or create a catalog |
| A running **SQL Warehouse** (serverless recommended) | Powers the Genie space + app analytics queries | Create one under **SQL Warehouses** in the sidebar |
| **Databricks Apps** enabled for your workspace | Hosts the Control Tower UI | Ask your admin — this is a workspace-level toggle |
| **Lakebase** enabled for your workspace/region | The app's read/write Postgres store | Ask your admin. |
| Permission to create a **Genie space** | Powers "why did attainment drop" natural-language questions | Ask your admin for Genie space creation permission |
| Permission to create an **Agent Bricks / Multi-Agent Supervisor (MAS)** endpoint | Powers the in-app chat assistant | Ask your admin. **This feature may be preview-gated in your workspace.** |

**If MAS or Genie space creation isn't available to you:** the setup job
will simply skip wiring that piece, and the app **still boots and works** —
you lose the in-app chat's ability to answer data questions (it degrades to
"no `ask_mas` tool"), but every dashboard, the plant map, the open-miss
queue, and the reason-code/corrective-action editing all work independently
of Genie/MAS.

---

## 2. Manual Lakebase setup (UI only — no CLI, no script)

The app's Postgres database must exist **before** you deploy the bundle
(the bundle references it by ID, it doesn't create it). Do this once, in
the Databricks UI:

1. Open your workspace, click the **app switcher** (top right), and select
   **Lakebase Postgres**.
2. Click **Create project**. Give it a name — e.g. `plant-attainment`. Wait
   for it to finish provisioning (~30 seconds).
3. Creating a project automatically creates a default branch named
   **`production`** — you don't need to create a branch yourself unless you
   want a separate one.
4. Open the `production` branch, go to its **Computes** tab, and confirm a
   primary compute/endpoint exists. If not, create one (defaults are fine —
   small autoscaling range, e.g. 0.5–2 CU).
5. Go to the branch's **Roles & Databases** tab → **Create database**. Name
   it `dbgen_attainment` (or your own name — just stay consistent below). The UI
   shows the generated **database ID** next to the name — it follows the
   pattern `db-` + your database name with underscores turned into hyphens
   (e.g. `dbgen_attainment` → `db-dbgen-attainment`).

### Map what you just created to the bundle's variables

| Bundle variable | Where it comes from | Example |
|---|---|---|
| `lakebase_project_id` | The project name from step 2 | `plant-attainment` |
| `lakebase_branch_id` | The branch name from step 3 (almost always `production`) | `production` |
| `lakebase_database_name` | The database name you typed in step 5 | `dbgen_attainment` |
| `lakebase_database_id` | The database ID shown in step 5 (`db-` + name, underscores→hyphens) | `db-dbgen-attainment` |

Keep these four values handy — you'll pass them as `--var` flags in the next
section.

---

## 3. Deploy

Unzip the package you received and open a terminal **in that folder**
(PowerShell on Windows, Terminal on macOS). Replace the placeholder values
below with your own (catalog/schema names, your SQL warehouse ID, and the
four Lakebase values from step 2).

**Command 1 — deploy the bundle** (creates the schema, volume, SDP
pipeline, and the app shell; no data yet):

```
databricks bundle deploy -t customer --profile customer --var catalog=my_catalog --var schema=plant_attainment --var warehouse_id=<your-warehouse-id> --var lakebase_project_id=plant-attainment --var lakebase_branch_id=production --var lakebase_database_name=dbgen_attainment --var lakebase_database_id=db-dbgen-attainment
```

**Command 2 — run the setup job** (generates synthetic data, runs the
pipeline, creates the Genie space + MAS endpoint, grants permissions, and
finalizes + deploys the app — this is the slow step, mostly waiting on the
MAS endpoint to come online, typically 10-20 minutes):

```
databricks bundle run plant_setup -t customer --profile customer --var catalog=my_catalog --var schema=plant_attainment --var warehouse_id=<your-warehouse-id> --var lakebase_project_id=plant-attainment --var lakebase_branch_id=production --var lakebase_database_name=dbgen_attainment --var lakebase_database_id=db-dbgen-attainment
```

That's it — two commands. Everything else (the Lakebase grant, rendering
the app's environment variables, redeploying the app, and granting it
workspace permissions) happens automatically inside the job.

---

## 4. Verification

1. **Job succeeded**: the `bundle run plant_setup` command in your terminal
   prints a link to the job run and exits with no error. You can also open
   **Workflows** in the sidebar → find **`[customer] Plant Attainment
   Setup`** → confirm all tasks show green.
2. **App is running**: open **Compute → Apps** (or **Apps** in the app
   switcher) → find your app (default name `plant-attainment-control-tower`)
   → status should read **Running**. Click the app's URL to open it.
3. **Dashboards have data**: in the app, the Home screen should show plant
   map markers and non-zero KPI numbers within a minute or two of the app
   loading (the first boot syncs Delta → Lakebase in the background).
4. **Chat works** (if you have MAS/Genie): open the chat dock and ask
   *"Why did attainment drop two weeks ago?"* — you should get a
   data-backed answer, not an error.

To check the app's own status/logs directly:

```
databricks apps get plant-attainment-control-tower --profile customer
```

---

## 5. Troubleshooting

**Drizzle migrations fail on first app boot with `pg=42501` (permission
denied)** — the app's service principal couldn't write to its Postgres
database. The setup job already runs a `grant_lakebase_app` task that
should prevent this, but if it happened anyway:
- Re-run just that task: `databricks bundle run plant_setup -t customer --profile customer --only grant_lakebase_app --var catalog=my_catalog --var schema=plant_attainment --var warehouse_id=<your-warehouse-id> --var lakebase_project_id=plant-attainment --var lakebase_branch_id=production --var lakebase_database_name=dbgen_attainment --var lakebase_database_id=db-dbgen-attainment`
- Or fix it by hand with **zero CLI/psql**: open the Lakebase App → your
  project → your branch → **SQL Editor**, pick your database, and run:
  `GRANT CREATE ON DATABASE "dbgen_attainment" TO "<app-service-principal-id>";`
  (find the app's service-principal/application ID on the app's page under
  **Details**). Then restart the app: `databricks apps restart
  plant-attainment-control-tower --profile customer`.

**Chat dock returns `PERMISSION_DENIED` on every question** — the app's
service principal wasn't granted access to the MAS endpoint or Genie space
(usually because they weren't fully online yet when `finalize_app` ran).
Re-run just that task: `databricks bundle run plant_setup -t customer --profile customer --only finalize_app --var catalog=my_catalog --var schema=plant_attainment --var warehouse_id=<your-warehouse-id> --var lakebase_project_id=plant-attainment --var lakebase_branch_id=production --var lakebase_database_name=dbgen_attainment --var lakebase_database_id=db-dbgen-attainment`

**App compute isn't running** — start it:
`databricks apps start plant-attainment-control-tower --profile customer`

**The pipeline has never run / dashboards are empty** — re-run the setup
job (command 2 in section 3); it's safe to re-run.

**"I don't see production order values" (or other newly-added fields look
blank on old rows)** — the Delta→Lakebase sync only pulls data when the
Lakebase `misses` table is empty, so if you re-ran the pipeline after
adding new fields, existing synced rows won't backfill automatically.
Reset the demo: re-run the setup job, then in the app click **Reset demo**
(or call `POST /api/admin/reset` on the app's URL) to re-pull from Delta.
The reason-code catalog survives a reset by design.

---

## 6. Teardown

```
databricks bundle destroy -t customer --profile customer
```

Two things live **outside** the bundle and need manual cleanup:
- The app itself has `prevent_destroy` set (it's stateful) — delete it
  explicitly if you want it gone: `databricks apps delete plant-attainment-control-tower --profile customer`
- The Lakebase project/database were created by hand in the UI (section 2)
  — delete them from the Lakebase App if you no longer need them.
