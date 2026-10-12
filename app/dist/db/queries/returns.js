import { sql } from "drizzle-orm";

//#region server/db/queries/returns.ts
function toListRow(r) {
	return {
		id: r.id,
		missDate: r.miss_date ?? null,
		plantId: r.plant_id ?? null,
		plantName: r.plant_name ?? null,
		region: r.region ?? null,
		lineId: r.line_id ?? null,
		lineName: r.line_name ?? null,
		skuId: r.sku_id ?? null,
		skuName: r.sku_name ?? null,
		category: r.category ?? null,
		productionOrder: r.production_order ?? null,
		missUnits: r.miss_units === null || r.miss_units === void 0 ? null : Number(r.miss_units),
		reasonCode: r.reason_code ?? null,
		comment: r.comment ?? null,
		status: r.status ?? "open",
		correctiveActionDesc: r.corrective_action_desc ?? null,
		correctiveActionOwner: r.corrective_action_owner ?? null,
		correctiveActionImplDate: r.corrective_action_impl_date ?? null,
		correctiveActionStatus: r.corrective_action_status ?? null,
		resolvedBy: r.resolved_by ?? null,
		resolvedAt: r.resolved_at ?? null,
		resolutionNote: r.resolution_note ?? null,
		createdAt: r.created_at,
		updatedAt: r.updated_at
	};
}
async function listMisses(db, opts = {}) {
	const limit = opts.limit ?? 300;
	const whereStatus = opts.status ? sql`AND m.status = ${opts.status}` : sql``;
	const wherePlant = opts.plantId ? sql`AND m.plant_id = ${opts.plantId}` : sql``;
	const whereRegion = opts.region ? sql`AND m.region = ${opts.region}` : sql``;
	const whereReason = opts.reasonCode ? sql`AND m.reason_code = ${opts.reasonCode}` : sql``;
	const orderBy = opts.sort === "units" ? sql`ORDER BY m.miss_units DESC NULLS LAST, m.miss_date DESC NULLS LAST` : sql`ORDER BY m.miss_date DESC NULLS LAST, m.created_at DESC`;
	return (await db.execute(sql`
    SELECT m.id, m.miss_date, m.plant_id, m.plant_name, m.region,
           m.line_id, m.line_name, m.sku_id, m.sku_name, m.category,
           m.production_order, m.miss_units, m.reason_code, m.comment, m.status,
           m.corrective_action_desc, m.corrective_action_owner,
           m.corrective_action_impl_date, m.corrective_action_status,
           m.resolved_by, m.resolved_at, m.resolution_note,
           m.created_at, m.updated_at
    FROM app.misses m
    WHERE 1=1 ${whereStatus} ${wherePlant} ${whereRegion} ${whereReason}
    ${orderBy}
    LIMIT ${limit}
  `)).rows.map(toListRow);
}
async function getMiss(db, id) {
	const row = (await db.execute(sql`
    SELECT m.id, m.miss_date, m.plant_id, m.plant_name, m.region,
           m.line_id, m.line_name, m.sku_id, m.sku_name, m.category,
           m.production_order, m.miss_units, m.reason_code, m.comment, m.status,
           m.corrective_action_desc, m.corrective_action_owner,
           m.corrective_action_impl_date, m.corrective_action_status,
           m.resolved_by, m.resolved_at, m.resolution_note,
           m.ai_audit_trail, m.decided_at, m.created_at, m.updated_at
    FROM app.misses m
    WHERE m.id = ${id}
    LIMIT 1
  `)).rows[0];
	if (!row) return null;
	return {
		...toListRow(row),
		aiAuditTrail: row.ai_audit_trail ?? [],
		decidedAt: row.decided_at ?? null
	};
}
/**
* Operator-driven reason-code correction on a single miss. Appends one
* audit entry.
*/
async function updateMissReason(db, args) {
	const entry = {
		at: (/* @__PURE__ */ new Date()).toISOString(),
		by: args.userEmail,
		action: "reason_updated",
		notes: args.notes ?? `Reason set to ${args.reasonCode}`
	};
	await db.execute(sql`
    UPDATE app.misses
    SET reason_code = ${args.reasonCode},
        updated_at = now(),
        ai_audit_trail = ai_audit_trail || ${JSON.stringify([entry])}::jsonb
    WHERE id = ${args.id}
  `);
	return await getMiss(db, args.id);
}
/**
* Operator-driven single corrective-action assignment (drawer form). Sets
* the corrective-action fields + flips status → 'action assigned'.
*/
async function assignCorrectiveActionSingle(db, args) {
	const entry = {
		at: (/* @__PURE__ */ new Date()).toISOString(),
		by: args.userEmail,
		action: "action_assigned",
		notes: `${args.owner} · ${args.caStatus} · due ${args.implementationDate}`
	};
	await db.execute(sql`
    UPDATE app.misses
    SET status = 'action assigned',
        corrective_action_desc = ${args.actionDesc},
        corrective_action_owner = ${args.owner},
        corrective_action_impl_date = ${args.implementationDate},
        corrective_action_status = ${args.caStatus},
        decided_at = now(),
        updated_at = now(),
        ai_audit_trail = ai_audit_trail || ${JSON.stringify([entry])}::jsonb
    WHERE id = ${args.id}
  `);
	return getMiss(db, args.id);
}
/**
* Operator close-out on an assigned miss. Flips status → 'resolved', marks
* the corrective action completed, and stamps resolver + timestamp (+ an
* optional close note).
*
* The `status = 'action assigned'` guard makes this idempotent-safe: a
* double-click, or a resolve on a miss that was never assigned, matches no
* rows and returns null so the route can 409 instead of silently
* back-dating an open miss straight to resolved.
*/
async function resolveMiss(db, args) {
	const entry = {
		at: (/* @__PURE__ */ new Date()).toISOString(),
		by: args.userEmail,
		action: "action_resolved",
		notes: args.note ?? "Corrective action closed out"
	};
	if ((await db.execute(sql`
    UPDATE app.misses
    SET status = 'resolved',
        corrective_action_status = 'completed',
        resolved_by = ${args.userEmail},
        resolved_at = now(),
        resolution_note = ${args.note ?? null},
        updated_at = now(),
        ai_audit_trail = ai_audit_trail || ${JSON.stringify([entry])}::jsonb
    WHERE id = ${args.id} AND status = 'action assigned'
    RETURNING id
  `)).rows.length === 0) return null;
	return getMiss(db, args.id);
}
async function missesSummary(db) {
	return (await db.execute(sql`
    SELECT status,
           COUNT(*)::int AS n,
           COALESCE(SUM(miss_units), 0)::int AS total_units
    FROM app.misses
    GROUP BY status
  `)).rows;
}
/**
* Per-plant scorecard for the map. `open_miss_count` is recomputed LIVE from
* app.misses (status='open') so the map drops when the agent assigns actions —
* the pre-synced scorecard value is only a fallback.
*/
async function listPlants(db) {
	return (await db.execute(sql`
    SELECT p.id, p.plant_name, p.city, p.state, p.region, p.lat, p.lng,
           p.attainment_pct, p.adherence_pct,
           COALESCE(oc.open_count, 0)::int AS open_miss_count,
           COALESCE(oc.open_units, p.open_miss_units, 0)::int AS open_miss_units,
           p.breakdowns_count, p.work_orders_count, p.maintenance_spend_usd,
           p.first_pass_quality_pct, p.holds_count
    FROM app.plants p
    LEFT JOIN (
      SELECT plant_id,
             COUNT(*)::int AS open_count,
             COALESCE(SUM(miss_units), 0)::int AS open_units
      FROM app.misses
      WHERE status = 'open'
      GROUP BY plant_id
    ) oc ON oc.plant_id = p.id
    ORDER BY p.attainment_pct ASC NULLS LAST
  `)).rows.map((r) => ({
		id: r.id,
		plantName: r.plant_name,
		city: r.city ?? null,
		state: r.state ?? null,
		region: r.region ?? null,
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
	}));
}
async function backlogByPlant(db, opts = {}) {
	const wherePlant = opts.plantId ? sql`AND m.plant_id = ${opts.plantId}` : sql``;
	return (await db.execute(sql`
    SELECT m.plant_id,
           MAX(m.plant_name) AS plant_name,
           MAX(m.region) AS region,
           COUNT(*)::int AS open_count,
           COALESCE(SUM(m.miss_units), 0)::int AS open_units
    FROM app.misses m
    WHERE m.status = 'open' ${wherePlant}
    GROUP BY m.plant_id
    ORDER BY open_count DESC
  `)).rows;
}
async function backlogByReason(db, opts = {}) {
	const wherePlant = opts.plantId ? sql`AND m.plant_id = ${opts.plantId}` : sql``;
	return (await db.execute(sql`
    SELECT COALESCE(m.reason_code, 'Unknown') AS reason_code,
           COUNT(*)::int AS open_count,
           COALESCE(SUM(m.miss_units), 0)::int AS open_units
    FROM app.misses m
    WHERE m.status = 'open' ${wherePlant}
    GROUP BY COALESCE(m.reason_code, 'Unknown')
    ORDER BY open_count DESC
  `)).rows;
}
async function recentActivity(db, limit = 20) {
	return (await db.execute(sql`
    SELECT m.id AS miss_id,
           m.plant_id,
           (a->>'at') AS at,
           (a->>'by') AS by_email,
           (a->>'action') AS action,
           (a->>'notes') AS notes,
           (a->>'tool') AS tool
    FROM app.misses m, jsonb_array_elements(m.ai_audit_trail) AS a
    ORDER BY at DESC NULLS LAST
    LIMIT ${limit}
  `)).rows.map((r) => ({
		kind: "audit",
		miss_id: r.miss_id,
		plant_id: r.plant_id ?? null,
		at: r.at,
		by: r.by_email ?? "",
		action: r.action ?? "",
		notes: r.notes ?? null,
		tool: r.tool ?? null
	}));
}
async function correctiveActionTracker(db, opts = {}) {
	const limit = opts.limit ?? 500;
	return (await db.execute(sql`
    SELECT * FROM (
      SELECT s.action_id, s.miss_id, s.plant_id, s.plant_name, s.region,
             s.sku_name, s.reason_code, s.miss_date, s.action_desc,
             s.owner, s.implementation_date, s.ca_status,
             'history' AS source
      FROM app.corrective_actions_seed s
      UNION ALL
      SELECT ('LIVE-' || m.id) AS action_id, m.id AS miss_id, m.plant_id,
             m.plant_name, m.region, m.sku_name, m.reason_code, m.miss_date,
             m.corrective_action_desc AS action_desc,
             m.corrective_action_owner AS owner,
             m.corrective_action_impl_date AS implementation_date,
             m.corrective_action_status AS ca_status,
             'live' AS source
      FROM app.misses m
      WHERE m.corrective_action_desc IS NOT NULL
    ) t
    ORDER BY implementation_date DESC NULLS LAST
    LIMIT ${limit}
  `)).rows;
}
async function assignCorrectiveActionsBatch(db, args) {
	return db.transaction(async (tx) => {
		const rows = (await tx.execute(sql`
      SELECT m.id, m.reason_code, m.miss_units
      FROM app.misses m
      WHERE m.plant_id = ${args.plantId} AND m.status = 'open'
      FOR UPDATE OF m
    `)).rows;
		const draftByReason = /* @__PURE__ */ new Map();
		for (const d of args.drafts) draftByReason.set(d.reason_code, d);
		const fallback = args.drafts[0];
		if (rows.length === 0 || !fallback) return {
			plant_id: args.plantId,
			assigned_count: 0,
			assigned_units: 0,
			by_reason: [],
			skipped_miss_ids: []
		};
		const now = (/* @__PURE__ */ new Date()).toISOString();
		const valuesParts = [];
		const metaById = /* @__PURE__ */ new Map();
		for (const row of rows) {
			const reason = row.reason_code ?? fallback.reason_code;
			const draft = draftByReason.get(reason) ?? fallback;
			const audit = [{
				at: now,
				by: args.userEmail,
				action: "action_assigned",
				notes: `${draft.owner} · ${draft.ca_status} · due ${draft.implementation_date} · ${reason}`,
				tool: "assign_corrective_actions_batch"
			}];
			valuesParts.push(sql`(${row.id}, ${draft.action_desc}, ${draft.owner}, ${draft.implementation_date}::date, ${draft.ca_status}, ${JSON.stringify(audit)}::jsonb)`);
			metaById.set(row.id, {
				reason,
				units: row.miss_units === null ? 0 : Number(row.miss_units)
			});
		}
		const updRes = await tx.execute(sql`
      UPDATE app.misses AS m
      SET status = 'action assigned',
          corrective_action_desc = v.action_desc,
          corrective_action_owner = v.owner,
          corrective_action_impl_date = v.impl_date,
          corrective_action_status = v.ca_status,
          decided_at = now(),
          updated_at = now(),
          ai_audit_trail = m.ai_audit_trail || v.audit
      FROM (VALUES ${sql.join(valuesParts, sql`, `)})
        AS v(id, action_desc, owner, impl_date, ca_status, audit)
      WHERE m.id = v.id
        AND m.plant_id = ${args.plantId}
        AND m.status = 'open'
      RETURNING m.id
    `);
		const updatedIds = new Set(updRes.rows.map((r) => r.id));
		let assignedUnits = 0;
		const byReason = /* @__PURE__ */ new Map();
		const skipped = [];
		for (const [id, meta] of metaById.entries()) {
			if (!updatedIds.has(id)) {
				skipped.push(id);
				continue;
			}
			assignedUnits += meta.units;
			byReason.set(meta.reason, (byReason.get(meta.reason) ?? 0) + 1);
		}
		return {
			plant_id: args.plantId,
			assigned_count: updatedIds.size,
			assigned_units: assignedUnits,
			by_reason: [...byReason.entries()].map(([reason_code, count]) => ({
				reason_code,
				count
			})),
			skipped_miss_ids: skipped
		};
	});
}

//#endregion
export { assignCorrectiveActionSingle, assignCorrectiveActionsBatch, backlogByPlant, backlogByReason, correctiveActionTracker, getMiss, listMisses, listPlants, missesSummary, recentActivity, resolveMiss, updateMissReason };