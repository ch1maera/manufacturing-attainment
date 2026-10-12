import { sql } from "drizzle-orm";

//#region server/db/queries/reasonCodes.ts
function toRow(r) {
	return {
		code: r.code,
		description: r.description ?? null,
		sortOrder: Number(r.sort_order),
		active: Boolean(r.active),
		usageCount: Number(r.usage_count ?? 0)
	};
}
async function listReasonCodes(db, opts = {}) {
	const whereActive = opts.includeInactive ? sql`` : sql`WHERE rc.active`;
	return (await db.execute(sql`
    SELECT rc.code, rc.description, rc.sort_order, rc.active,
           COALESCE(u.n, 0)::int AS usage_count
    FROM app.reason_codes rc
    LEFT JOIN (
      SELECT reason_code, COUNT(*)::int AS n
      FROM app.misses
      WHERE reason_code IS NOT NULL
      GROUP BY reason_code
    ) u ON u.reason_code = rc.code
    ${whereActive}
    ORDER BY rc.sort_order ASC, rc.code ASC
  `)).rows.map(toRow);
}
/** True when the code exists AND is active — the route-layer validator. */
async function isActiveReasonCode(db, code) {
	return (await db.execute(sql`
    SELECT 1 FROM app.reason_codes WHERE code = ${code} AND active LIMIT 1
  `)).rows.length > 0;
}
/**
* Add a code. Returns null if the code already exists so the route can 409
* rather than silently reactivating something the user forgot they retired.
*/
async function createReasonCode(db, args) {
	if ((await db.execute(sql`
    INSERT INTO app.reason_codes (code, description, sort_order)
    VALUES (${args.code}, ${args.description ?? null}, ${args.sortOrder ?? 100})
    ON CONFLICT (code) DO NOTHING
    RETURNING code
  `)).rows.length === 0) return null;
	return getReasonCode(db, args.code);
}
async function getReasonCode(db, code) {
	return (await listReasonCodes(db, { includeInactive: true })).find((r) => r.code === code) ?? null;
}
/**
* Edit a code: rename, re-describe, and/or retire/restore. A rename rewrites
* every miss (and mirrored corrective-action row) carrying the old code in the
* same transaction, so the queue, Pareto, and steering tracker all move
* together instead of stranding rows on a code that no longer exists.
*/
async function updateReasonCode(db, args) {
	const target = args.newCode ?? args.code;
	if (!await db.transaction(async (tx) => {
		if ((await tx.execute(sql`
      SELECT 1 FROM app.reason_codes WHERE code = ${args.code} LIMIT 1
    `)).rows.length === 0) return false;
		if (args.newCode && args.newCode !== args.code) {
			if ((await tx.execute(sql`
        SELECT 1 FROM app.reason_codes WHERE code = ${args.newCode} LIMIT 1
      `)).rows.length > 0) return false;
			await tx.execute(sql`
        UPDATE app.reason_codes
        SET code = ${args.newCode}, updated_at = now()
        WHERE code = ${args.code}
      `);
			await tx.execute(sql`
        UPDATE app.misses
        SET reason_code = ${args.newCode}, updated_at = now()
        WHERE reason_code = ${args.code}
      `);
			await tx.execute(sql`
        UPDATE app.corrective_actions_seed
        SET reason_code = ${args.newCode}
        WHERE reason_code = ${args.code}
      `);
		}
		if (args.description !== void 0) await tx.execute(sql`
        UPDATE app.reason_codes
        SET description = ${args.description}, updated_at = now()
        WHERE code = ${target}
      `);
		if (args.active !== void 0) await tx.execute(sql`
        UPDATE app.reason_codes
        SET active = ${args.active}, updated_at = now()
        WHERE code = ${target}
      `);
		return true;
	})) return null;
	return getReasonCode(db, target);
}

//#endregion
export { createReasonCode, getReasonCode, isActiveReasonCode, listReasonCodes, updateReasonCode };