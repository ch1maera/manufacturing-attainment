import { resolve } from "node:path";
import { sql } from "@databricks/appkit";
import { readFileSync } from "node:fs";

//#region server/routes/charts.ts
/**
* Analytics chart data route.
*
* Why this exists instead of AppKit's built-in `analytics` query route: we want
* the queries portable across workspaces, so they don't hardcode
* `catalog.schema.table`. Instead each `.sql` references its tables via
* `IDENTIFIER(:catalog || '.' || :schema || '.table')` and we bind `:catalog`
* and `:schema` here from the demo's config (env → appConfig.data) using
* AppKit's `sql.string()` markers. Same binding the type-generator samples at
* build time via the `-- @param catalog/schema = …` annotations in the .sql.
*
* (We bind them as PARAMETERS rather than pass catalog/schema as statement
* session context because the IDENTIFIER() form is what the type-generator can
* resolve at DESCRIBE time — keeping runtime + typegen on the same mechanism,
* so generated chart types stay accurate instead of degrading to `unknown`.)
*
* The client (AnalyticsView) fetches `/api/charts/<key>` and feeds the rows
* to the chart components via their `data` prop.
*/
const NUMERIC_RE = /^-?\d+(\.\d+)?$/;
function coerce(value) {
	if (typeof value === "string" && NUMERIC_RE.test(value)) {
		const n = Number(value);
		if (!Number.isNaN(n)) return n;
	}
	return value;
}
const QUERY_FILES = {
	company_attainment_trend: "company_attainment_trend.sql",
	attainment_by_plant: "attainment_by_plant.sql",
	attainment_by_sku_category: "attainment_by_sku_category.sql",
	miss_pareto: "miss_pareto.sql",
	misses_by_plant: "misses_by_plant.sql",
	miss_trend: "miss_trend.sql",
	attainment_yoy: "attainment_yoy.sql",
	corrective_action_tracker: "corrective_action_tracker.sql"
};
function registerChartRoutes(app, deps) {
	const { query, catalog, schema, queriesDir } = deps;
	app.get("/api/charts/:key", async (req, res) => {
		const key = String(req.params.key);
		const file = QUERY_FILES[key];
		if (!file) {
			res.status(404).json({ error: `Unknown chart query: ${key}` });
			return;
		}
		let sql$1;
		try {
			sql$1 = readFileSync(resolve(queriesDir, file), "utf8");
		} catch (e) {
			res.status(500).json({ error: `Could not read query ${key}: ${e.message}` });
			return;
		}
		try {
			const rows = ((await query(sql$1, {
				catalog: sql.string(catalog),
				schema: sql.string(schema)
			})).data ?? []).map((row) => Object.fromEntries(Object.entries(row).map(([k, v]) => [k, coerce(v)])));
			res.json({ data: rows });
		} catch (e) {
			res.status(500).json({ error: `Query ${key} failed: ${e.message}` });
		}
	});
}

//#endregion
export { registerChartRoutes };