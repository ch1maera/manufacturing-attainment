# Plant Attainment Control Tower

> **Template branch (`generic`).** Names below are the fictional placeholder
> **Acme Manufacturing**. To brand this for a real customer, branch off
> `generic` and follow [`AGENTS.md`](AGENTS.md) — do not start from
> `customer-release`.

# Acme Manufacturing — Plant Attainment Control Tower

## The Story

| | |
|---|---|
| **Company** | Acme Manufacturing — 20-plant manufacturer  |
| **Hero** | Maya Patel, VP of Manufacturing Excellence |
| **Problem** | Attainment reporting runs on Excel → Power BI → a hand-built weekly steering-committee deck. Two weeks ago plant misses spiked to 3x normal — $480K in overtime, expediting, and lost throughput — while her team was still retyping reason codes into slides |
| **Investigation** | Maya opens one Databricks App: company-wide attainment, adherence, and a Pareto of misses by plant / line / SKU / date. She asks the in-app assistant *"Why did attainment drop two weeks ago?"* |
| **Root cause** | The miss spike is concentrated in **3 plants** (Plano TX, Tulsa OK, Fresno CA), driven overwhelmingly by **Mechanical Downtime** + **Material Shortage** — a Pareto with one obvious #1 bar. Dozens of those misses have **no corrective action recorded** |
| **Resolution** | Maya edits reason codes and drafts corrective actions **directly in the app** — writing to Lakebase, not Excel. The assistant bulk-assigns owners + implementation dates to the open-miss backlog after her approval. The Weekly Steering Committee view regenerates from the same live data. Reporting prep goes from **days to minutes** |
| **Impact** | $480K spike; three plants cratered from ~96% to ~82% attainment (dragging the company roll-up below target), ~2.6x misses — one live source of truth replaces the Excel/PowerBI/deck chain |

---

## Overview

Acme Manufacturing runs 20 plants and measures two things every day: **attainment** (did we build what we planned?) and **adherence** (did we build it when we planned it?). Today that lives in plant Excel trackers, gets copy-pasted into Power BI, and is retyped a third time into a weekly steering-committee deck. Every hop is manual re-entry.

Two weeks ago misses tripled. Maya's team burned days assembling the deck while the plants bled $480K in overtime and expediting. This demo replaces the whole chain with a **single Lakebase-backed Databricks App**: operational dashboards, a Pareto decomposition, direct in-app data capture (reason codes + corrective actions written to Lakebase), and a presentation-ready steering-committee view — all reading from one governed source of truth.

The wow: Maya never leaves the app. She asks *why*, sees the answer traced across plants/lines/SKUs, **captures the fix directly in-system**, and the exec view updates itself.

**Duration:** 6–8 minutes

---

## Key Numbers

| Metric | Value |
|--------|-------|
| Plants | 20 (across US regions) |
| Production lines / PODs | ~70 |
| Active SKUs | ~40 |
| Normal company attainment | ~96% |
| Attainment during spike | Plano/Tulsa/Fresno ~82% at peak; company roll-up ~94% (~2 pts below the ~96% baseline) |
| Miss spike | ~2.6x normal (41→107/wk), peaked ~2 weeks ago |
| Cost of the spike | $480K (overtime + expediting + lost throughput) |
| Affected plants | Plano TX (PLNT-07), Tulsa OK (PLNT-12), Fresno CA (PLNT-15) |
| Dominant miss reasons | Mechanical Downtime, Material Shortage |
| Reason-code list | Seeded catalog in Lakebase, editable in-app. Core five: Changeover · Material Shortage · Mechanical Downtime · Quality Hold · Labor (plus five industry extras) |

---

## Demo Walkthrough

**Frame:** Monday. The steering committee meets Thursday. Two weeks ago misses tripled and the deck is due. Maya opens the Control Tower instead of Excel.

### Act 1 — One app, not three tools (1 min)
Open the **Plant Attainment Control Tower**. The Home screen frames Maya's week: three plants cratered to ~82% attainment (pulling the company roll-up below target), misses ~2.6x, $480K impact. A US plant map glows red on the 3 laggard plants.

> *"This one Databricks App replaces Excel → Power BI → the hand-built deck. It's a full-stack React/Node app hosted on Databricks with OAuth and Unity Catalog governance. The operational data users type in — miss reason codes, corrective actions — lives in **Lakebase**, serverless Postgres built for app reads/writes. The Gold tables behind the dashboards come from an **SDP pipeline** fed on a schedule by a **Lakeflow Job** simulating the Excel-tracker ingestion."*

### Act 2 — Ask why, in the app (2 min)
In the chat dock: **`Why did attainment drop two weeks ago?`** The thinking panel streams the investigation live.

> *"The assistant is a **Multi-Agent Supervisor**. It routed to **Genie**, which traced the dip to 3 plants and ranked the misses — Mechanical Downtime and Material Shortage dominate the Pareto. **MLflow** traces every step; **Unity Catalog** means the agent only sees what Maya can see."*

Open the **Attainment & Adherence** dashboard (daily/weekly by plant + SKU + company roll-up) and the **Adherence Miss Pareto** (ranked reason codes, filter by plant/date) — the spike is obvious at a glance.

### Act 3 — Capture the fix, in-system (2 min)
The differentiator. On the **Operations / Data Entry** page, Maya sees the open-miss queue — dozens of misses from the spike with **no corrective action recorded**, each tied to its **production line and production order** so a plant lead knows exactly which run to go look at. She edits a reason code inline (writes straight to Lakebase), and via **Manage codes** adds one her plant actually uses — the list itself lives in Lakebase, not a spreadsheet column. Then she clicks **`Assign corrective actions to the Plano backlog`**.

The agent drafts corrective actions — owner, implementation date, status — for every open miss matching the filter, **stops for approval**, and only writes after Maya says yes. On commit, KPI cards tick, miss rows flip to *Action Assigned*, and the audit trail records who/what/when.

Once the fix is actually done, the owner opens the miss and hits **Resolve** with a close note. Status goes to *Resolved*, stamped with who closed it and when — so the backlog reflects finished work instead of growing forever.

> *"This is the difference between a chatbot and an app: it **acts**. The write is a hard stop for human approval, not a UI suggestion. Every corrective action lands in **Lakebase** with an audit row — assigned, then resolved, with the full timeline on the row. No more retyping into a spreadsheet."*

### Act 4 — The deck writes itself (1 min)
Switch to the **Weekly Steering Committee** view: year-over-year attainment/adherence trend + the corrective-action table (owner, implementation date, status) — presentation-ready, generated from the same live data via **Databricks SQL Serverless**.

> *"The deck Maya's team spent days assembling is now a live view off the same source of truth. Operating plan, exec view, and action tracker never drift apart again. And for everyone who just wants to ask — finance, the plant GMs — **Genie** and Databricks One answer the same questions with the same governance, no app to build."*

### Closing
> One governed source of truth feeds the operational dashboards, the in-app data capture, and the exec steering view. Ingest from the plant trackers once (**Lakeflow Connect**), shape it with **SDP**, and build whatever the business needs on top — dashboards, a Lakebase app, agents — without re-stitching the data or retyping it three times. **Days to minutes.**

---

## Products Showcased

| Product | Mode | What it does in this demo |
|---------|------|---------------------------|
| **Lakeflow Connect** | Talk track | Ingests the 20 plants' Excel attainment trackers into the lakehouse — the assumed source of record |
| **Synthetic Data Gen** | Build | Generates realistic build-plan, miss, corrective-action, and plant-KPI data with the 2-weeks-ago spike |
| **SDP Pipeline** | Build | Bronze → Silver → Gold: raw tracker feeds into the attainment, adherence, Pareto, and steering-committee Gold tables the app + Genie read |
| **Lakeflow Jobs** | Build | Serverless scheduled job simulating the recurring tracker ingestion + pipeline refresh |
| **Lakebase** | Build | Serverless Postgres write store — the editable reason-code catalog, user-entered reason codes, corrective actions + resolutions, and the live miss queue the app reads back |
| **Databricks Apps** | Build | The Control Tower — Attainment dashboard, Miss Pareto, Data-Entry, and Steering-Committee screens; React/Node (Express), OAuth + UC governance |
| **AI/BI Genie** | Build | Cracks *"why did attainment drop?"* — traces the dip to 3 plants and ranks the miss reason codes |
| **Multi-Agent Supervisor** | Build | The brain in the app's chat — routes Maya's questions to Genie and drafts the corrective-action batch |
| **Unity Catalog** | Talk track | One permission model from tracker ingestion through Genie to the app's Lakebase writes |
| **Genie One** | Talk track | Business-user front door — plant GMs and finance ask the same questions without the app |
| **Genie Code** | Talk track | Builds the pipeline, dashboards, and app scaffolding from natural language |
