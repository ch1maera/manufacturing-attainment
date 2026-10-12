import { correctiveActionsSeed, misses, plants } from "./schema.js";
import { getExecutionContext } from "@databricks/appkit";
import { sql as sql$1 } from "drizzle-orm";

//#region server/db/sync.ts
async function syncFromDelta(db, cfg, opts = {}) {
	if (((await db.execute(sql$1`SELECT COUNT(*)::int AS n FROM app.misses`)).rows[0]?.n ?? 0) > 0 && !opts.forceIfAnyEmpty) return;
	const warehouseId = process.env.DATABRICKS_WAREHOUSE_ID;
	if (!warehouseId) {
		console.warn("[sync] DATABRICKS_WAREHOUSE_ID not set — skipping Delta sync");
		return;
	}
	console.log("[sync] Starting Delta → Lakebase sync (parallel)…");
	const t0 = Date.now();
	const fq = (name) => `${cfg.catalog}.${cfg.schema}.${cfg.tables[name]}`;
	const [plantRows, missRows, caRows] = await Promise.all([
		execSql(warehouseId, `SELECT plant_id, plant_name, city, state, region, lat, lng,
              attainment_pct, adherence_pct, open_miss_count, open_miss_units,
              breakdowns_count, work_orders_count, maintenance_spend_usd,
              first_pass_quality_pct, holds_count
       FROM ${fq("plants")}`),
		execSql(warehouseId, `SELECT miss_id, miss_date, plant_id, plant_name, region, line_id,
              line_name, sku_id, sku_name, category, production_order,
              miss_units, reason_code, comment, status
       FROM ${fq("misses")}`),
		execSql(warehouseId, `SELECT action_id, miss_id, plant_id, plant_name, region, sku_name,
              reason_code, miss_date, action_desc, owner, implementation_date,
              ca_status
       FROM ${fq("correctiveActions")}`)
	]);
	console.log(`[sync]   queries done (${((Date.now() - t0) / 1e3).toFixed(1)}s) — inserting…`);
	const catalogRes = await db.execute(sql$1`SELECT code FROM app.reason_codes WHERE active`);
	const known = new Set(catalogRes.rows.map((r) => r.code));
	if (plantRows.length) await chunkInsert(plantRows, 5e3, (chunk) => db.insert(plants).values(chunk.map((r) => ({
		id: r.plant_id,
		plantName: r.plant_name,
		city: r.city,
		state: r.state,
		region: r.region,
		lat: r.lat === null ? null : Number(r.lat),
		lng: r.lng === null ? null : Number(r.lng),
		attainmentPct: r.attainment_pct === null ? null : Number(r.attainment_pct),
		adherencePct: r.adherence_pct === null ? null : Number(r.adherence_pct),
		openMissCount: r.open_miss_count === null ? null : Number(r.open_miss_count),
		openMissUnits: r.open_miss_units === null ? null : Number(r.open_miss_units),
		breakdownsCount: r.breakdowns_count === null ? null : Number(r.breakdowns_count),
		workOrdersCount: r.work_orders_count === null ? null : Number(r.work_orders_count),
		maintenanceSpendUsd: r.maintenance_spend_usd === null ? null : Number(r.maintenance_spend_usd),
		firstPassQualityPct: r.first_pass_quality_pct === null ? null : Number(r.first_pass_quality_pct),
		holdsCount: r.holds_count === null ? null : Number(r.holds_count)
	}))).onConflictDoNothing());
	console.log(`[sync]   plants: ${plantRows.length} (${((Date.now() - t0) / 1e3).toFixed(1)}s)`);
	if (missRows.length) await chunkInsert(missRows, 2500, (chunk) => db.insert(misses).values(chunk.map((r) => ({
		id: r.miss_id,
		missDate: r.miss_date,
		plantId: r.plant_id,
		plantName: r.plant_name,
		region: r.region,
		lineId: r.line_id,
		lineName: r.line_name,
		skuId: r.sku_id,
		skuName: r.sku_name,
		category: r.category,
		productionOrder: r.production_order,
		missUnits: r.miss_units === null ? null : Number(r.miss_units),
		reasonCode: r.reason_code && known.has(r.reason_code) ? r.reason_code : null,
		comment: r.comment,
		status: "open"
	}))).onConflictDoNothing());
	console.log(`[sync]   misses: ${missRows.length} (${((Date.now() - t0) / 1e3).toFixed(1)}s)`);
	if (caRows.length) await chunkInsert(caRows, 5e3, (chunk) => db.insert(correctiveActionsSeed).values(chunk.map((r) => ({
		actionId: r.action_id,
		missId: r.miss_id,
		plantId: r.plant_id,
		plantName: r.plant_name,
		region: r.region,
		skuName: r.sku_name,
		reasonCode: r.reason_code,
		missDate: r.miss_date,
		actionDesc: r.action_desc,
		owner: r.owner,
		implementationDate: r.implementation_date,
		caStatus: r.ca_status
	}))).onConflictDoNothing());
	console.log(`[sync]   corrective actions (seed): ${caRows.length} (${((Date.now() - t0) / 1e3).toFixed(1)}s)`);
	const dt = ((Date.now() - t0) / 1e3).toFixed(1);
	console.log(`[sync] Done in ${dt}s`);
}
/**
* Reset the demo to a clean queue. Only the Delta-mirrored tables and chat
* state are truncated — `app.reason_codes` is deliberately left alone, since
* a customised code list is user-owned configuration, not demo state. The
* caller re-runs `seedReasonCodes` afterwards to restore any starter code
* that was deleted outright.
*/
async function wipeMirroredTables(db) {
	await db.transaction(async (tx) => {
		await tx.execute(sql$1`TRUNCATE TABLE app.feedback RESTART IDENTITY CASCADE`);
		await tx.execute(sql$1`TRUNCATE TABLE app.messages RESTART IDENTITY CASCADE`);
		await tx.execute(sql$1`TRUNCATE TABLE app.conversations RESTART IDENTITY CASCADE`);
		await tx.execute(sql$1`TRUNCATE TABLE app.misses RESTART IDENTITY CASCADE`);
		await tx.execute(sql$1`TRUNCATE TABLE app.corrective_actions_seed RESTART IDENTITY CASCADE`);
		await tx.execute(sql$1`TRUNCATE TABLE app.plants RESTART IDENTITY CASCADE`);
	});
}
async function execSql(warehouseId, statement) {
	const { client } = getExecutionContext();
	const initial = await client.apiClient.request({
		method: "POST",
		path: "/api/2.0/sql/statements",
		payload: {
			statement,
			warehouse_id: warehouseId,
			wait_timeout: "50s",
			on_wait_timeout: "CONTINUE",
			disposition: "INLINE",
			format: "JSON_ARRAY"
		},
		headers: new Headers(),
		raw: false,
		query: {}
	});
	const POLL_DEADLINE_MS = 600 * 1e3;
	const startedAt = Date.now();
	let cur = initial;
	while (cur.status.state !== "SUCCEEDED" && cur.status.state !== "FAILED" && cur.status.state !== "CANCELED") {
		if (Date.now() - startedAt > POLL_DEADLINE_MS) throw new Error(`[sync] SQL still ${cur.status.state} after 10 minutes — aborting (statement_id=${cur.statement_id})`);
		await new Promise((r) => setTimeout(r, 1e3));
		cur = await client.apiClient.request({
			method: "GET",
			path: `/api/2.0/sql/statements/${cur.statement_id}`,
			headers: new Headers(),
			raw: false,
			query: {}
		});
	}
	if (cur.status.state !== "SUCCEEDED") throw new Error(`[sync] SQL failed: ${cur.status.error?.message ?? cur.status.state}`);
	const cols = cur.manifest?.schema.columns.map((c) => c.name) ?? [];
	const rows = [];
	let chunk = cur.result;
	while (chunk) {
		for (const row of chunk.data_array ?? []) {
			const obj = {};
			for (let i = 0; i < cols.length; i++) obj[cols[i]] = row[i];
			rows.push(obj);
		}
		if (chunk.next_chunk_index === void 0 || chunk.next_chunk_index === null) break;
		chunk = await client.apiClient.request({
			method: "GET",
			path: `/api/2.0/sql/statements/${cur.statement_id}/result/chunks/${chunk.next_chunk_index}`,
			headers: new Headers(),
			raw: false,
			query: {}
		});
	}
	return rows;
}
async function chunkInsert(rows, size, fn) {
	for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size));
}

//#endregion
export { syncFromDelta, wipeMirroredTables };