# Agent brief — customer rebrand of Plant Attainment Control Tower

This branch (`generic`) is the **reusable template**. Identity in the code is
a fictional placeholder: **Acme Manufacturing**. It is not a real customer.

Do **not** start a new customer cut from `customer-release`. Branch from
`generic`.

## When you are asked to brand this for a customer

1. Create a new branch from `generic`, named after the customer
   (e.g. `customer/northstar`).
2. Collect the facts in **Inputs you must get** below. Do not invent plant
   names, dollars, logos, or product lines.
3. Update every file in the checklist. Keep the **demo arc** the same
   (one app, ask why, capture the fix in-system, steering view writes
   itself). Replace Acme / placeholder names, places, colors, and numbers.
4. Grep the whole repo for leftover placeholder strings (`Acme`,
   `example.com`, `PlantOps`, `Maya Patel` if the hero changes, current
   plant names if those change) before you stop.
5. Rebuild the client (`npm run build:source` in `app/`) so
   `app/client/dist` and `app/dist` match source. Update Playwright smoke
   tests.
6. Do not commit `app/.env` or secrets.

## Demo arc that must survive the rebrand

Do not change the product shape. A future agent should still be able to
walk this story:

1. Home frames a recent miss spike at **three named plants**.
2. Chat asks **why attainment dropped ~two weeks ago**.
3. Pareto is dominated by **two reason codes**.
4. Open misses at the worst plant have **no corrective action**.
5. Agent drafts CAs, **stops for approval**, then bulk-assigns in Lakebase.
6. Weekly Steering Committee view is generated from the same live data.

If the customer’s real story cannot support three plants + a two-week
spike + an open backlog, say so — do not silently flatten the demo.

## Inputs you must get

Replace these **current generic values**:

| Field | Current placeholder | Notes |
|---|---|---|
| Company legal / go-to-market name | Acme Manufacturing | Exact customer spelling |
| Industry one-liner | 20-plant manufacturer | Used in README, Genie, MAS, in-app agent |
| App display name | Plant Attainment Control Tower | Header, `<title>`, `config/app.json` — prefix with customer if they want |
| CLI / DAB resource slug | `plant-attainment-control-tower` | Databricks resource names, `package.json` |
| Schema / Lakebase defaults | `plant_attainment`, `plant-attainment`, `dbgen_attainment` | `databricks.yml` vars, `CUSTOMER_DEPLOY.md` |
| Brand palette (5 hex + ink) | `#0033A0`, `#2A5CD7`, `#8FB4F5`, `#FFC72C`, `#E31837`, ink `#0B1B3A` | Must meet contrast on white for primary + accent |
| Website | https://www.example.com | `brand/brand.json` |
| Logo file | `brand/company_logo.jpg` (path only today) | Drop the real logo in `brand/` and wire if the UI uses it |
| Hero persona | Maya Patel, VP of Manufacturing Excellence | Home page + agent instructions |
| Plant count | 20 | Must match `PLANTS` in data gen |
| Three laggard plants | Plano `PLNT-07`, Tulsa `PLNT-12`, Fresno `PLNT-15` | Story, map, chat script, Genie SQL |
| Dominant miss reasons | Mechanical Downtime, Material Shortage | Keep the core five codes unless the customer insists |
| Spike economics | ~96% → ~82% at 3 plants, company ~94%, ~2.6x misses, $480K | Recalculate so Gold tables match the talk track |
| CLI profile name | `customer` | `CUSTOMER_DEPLOY.md` only |
| SKU / line catalog | Snack CPG (chips, crackers, popcorn, pretzels) | In `data_generation/generate_data.py` — retarget if the customer is not CPG |

If any of those are missing, ask. Do not copy Acme’s US plant list onto a
customer who manufactures somewhere else.

## File checklist (do every row)

### Identity and talk track

| File | What to change |
|---|---|
| `README.md` | Title, company, hero, plants, numbers, walkthrough quotes |
| `CUSTOMER_DEPLOY.md` | Title, profile name, example `--var` values, app name, job name |
| `brand/brand.json` | `company`, `palette`, `website`, `company_logo` |
| `app/config/app.json` | `branding.appName`, `assistantScript` prompts (plant names / ids) |

### Visual brand

| File | What to change |
|---|---|
| `app/client/src/index.css` | `--brand-1`…`--brand-5`, `--brand-ink`, `--brand-selection` |
| `app/client/src/lib/brand.ts` | `BRAND_PALETTE` and `BRAND_INK` — **keep in sync with CSS** |
| `app/client/index.html` | `<title>` |
| `app/client/public/site.webmanifest` | `name`, `short_name` |
| `app/client/src/architecture/PlatformDiagram.tsx` | `aria-label`, kick line, H2 |
| `app/client/src/home/HomeView.tsx` | `HERO`, `STORY`, `STARTER_QUESTIONS`, `FEATURED_ACTION_PROMPT` |
| `app/package.json` | `"name"` slug |
| Rebuild | `app/client/dist/**` and `app/dist/**` are committed; rebuild so they match src |

### Data story (plants, spike, SKUs)

| File | What to change |
|---|---|
| `data_generation/generate_data.py` | Module doc, `PLANTS`, `AFFECTED`, `open_targets`, `LINE_TEMPLATES`, `SKU_SEED` |
| `app/server/db/seed.ts` | Extra reason-code flavor. Keep the core five. |
| `src/genie/genie_space.json` | `text_instructions`, sample questions, example SQL that hardcodes `'Plano Plant'` |
| `src/deploy/deploy_genie.py` | `SPACE_TITLE`, `SPACE_DESCRIPTION` |
| `src/supervisor_agent/supervisor_agent.json` | `display_name`, `description`, `instructions`, tool description |
| `app/server/agent/refundops.ts` | Agent `name` (`PlantOps`), full `instructions` string, tool descriptions that cite Plano/`PLNT-07` |

After changing plants or the spike, **regenerate synthetic data** (do not
only rewrite copy). Gold tables, the map, and Genie must agree.

`src/genie/genie_space.json` still qualifies tables as
`solution_builder.demo_plant_attainment_control_tower.*`.
`deploy_genie.py` string-replaces that qualifier at deploy time
(`SRC_QUALIFIER`). Do not “fix” those identifiers to a customer catalog
unless you also change `SRC_QUALIFIER`.

### Bundle / deploy names

| File | What to change |
|---|---|
| `databricks.yml` | Bundle `name`, app default, lakebase defaults, pipeline/job display names, comments |
| `app/app.yaml` | Comments that name `plant_setup` |
| `src/deploy/*.py` | Display titles in `deploy_genie.py` / MAS |

Resource **keys** in `databricks.yml` (`plant_setup`, `plant_attainment`) are
wired through the bundle. Renaming keys is optional; renaming **display
`name:` strings** is required so the customer UI does not say Acme.

### Tests

| File | What to change |
|---|---|
| `app/tests/smoke.spec.ts` | Page title regex, sidebar name, platform diagram region, `/api/config` `appName` |

## What you should not rewrite

- Architecture (Lakebase writes, MAS → Genie, SDP gold tables, approval stop).
- Tool names (`ask_mas`, `backlog_summary`, `find_open_misses`,
  `assign_corrective_actions_batch`) unless you are changing behavior.
- Env-driven IDs in `app/config/app.json` (`${DEMO_CATALOG}`, warehouse, etc.).
- `app/.env` (local secrets; gitignored).
- Databricks product names in the talk track (Lakebase, Genie, SDP, Apps).

## Verify before you declare done

```bash
rg -n -i 'acme|example\.com|plantops' --glob '!app/client/dist/**' --glob '!app/package-lock.json'
```

Then:

1. Smoke tests: title, theme tokens, `/api/config` branding, platform
   diagram label.
2. Home copy names the new hero + three plants.
3. Chat script chips use the customer’s worst plant, not Plano (unless
   Plano is still correct).
4. Palette in the running app matches `brand/brand.json`.
5. If plants moved, the map pins match the customer’s geography and the
   three laggards still read as the large red bubbles.

## Branch protocol

| Branch | Role |
|---|---|
| `generic` | Template + this brief. Keep real-customer work off it. |
| `customer-release` | A prior customer package. Do not branch new work from it. |
| `customer/<slug>` | New customer cuts branched from `generic`. |
