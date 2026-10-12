import { sql } from 'drizzle-orm';
import type { AppDb } from '../index.js';

/**
 * Reason-code catalog CRUD . This is the app-owned list that replaces the
 * hand-typed Reason Code column in the weekly Excel adherence-miss export —
 * plant users pick from it in the drawer and maintain it in-app, all persisted
 * in Lakebase.
 *
 * Two rules the rest of the app depends on:
 *   - Retire is a SOFT delete (`active = false`). Misses already carrying the
 *     code keep it, so the Pareto and steering history don't silently change.
 *   - Rename CASCADES. `code` is the display text and misses store it
 *     verbatim, so a rename rewrites the referencing rows in the same
 *     transaction (there's no FK — these are mirrored rows, not children).
 */

export type ReasonCodeRow = {
  code: string;
  description: string | null;
  sortOrder: number;
  active: boolean;
  /** Misses currently carrying this code — drives the "in use" hint + the
   *  retire-vs-delete decision in the manager UI. */
  usageCount: number;
};

function toRow(r: Record<string, unknown>): ReasonCodeRow {
  return {
    code: r.code as string,
    description: (r.description as string | null) ?? null,
    sortOrder: Number(r.sort_order),
    active: Boolean(r.active),
    usageCount: Number(r.usage_count ?? 0),
  };
}

export async function listReasonCodes(
  db: AppDb,
  opts: { includeInactive?: boolean } = {},
): Promise<ReasonCodeRow[]> {
  const whereActive = opts.includeInactive ? sql`` : sql`WHERE rc.active`;
  const rows = await db.execute(sql`
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
  `);
  return (rows.rows as Record<string, unknown>[]).map(toRow);
}

/** True when the code exists AND is active — the route-layer validator. */
export async function isActiveReasonCode(
  db: AppDb,
  code: string,
): Promise<boolean> {
  const res = await db.execute(sql`
    SELECT 1 FROM app.reason_codes WHERE code = ${code} AND active LIMIT 1
  `);
  return res.rows.length > 0;
}

/**
 * Add a code. Returns null if the code already exists so the route can 409
 * rather than silently reactivating something the user forgot they retired.
 */
export async function createReasonCode(
  db: AppDb,
  args: { code: string; description?: string; sortOrder?: number },
): Promise<ReasonCodeRow | null> {
  const res = await db.execute(sql`
    INSERT INTO app.reason_codes (code, description, sort_order)
    VALUES (${args.code}, ${args.description ?? null}, ${args.sortOrder ?? 100})
    ON CONFLICT (code) DO NOTHING
    RETURNING code
  `);
  if (res.rows.length === 0) return null;
  return getReasonCode(db, args.code);
}

export async function getReasonCode(
  db: AppDb,
  code: string,
): Promise<ReasonCodeRow | null> {
  const rows = await listReasonCodes(db, { includeInactive: true });
  return rows.find((r) => r.code === code) ?? null;
}

/**
 * Edit a code: rename, re-describe, and/or retire/restore. A rename rewrites
 * every miss (and mirrored corrective-action row) carrying the old code in the
 * same transaction, so the queue, Pareto, and steering tracker all move
 * together instead of stranding rows on a code that no longer exists.
 */
export async function updateReasonCode(
  db: AppDb,
  args: {
    code: string;
    newCode?: string;
    description?: string;
    active?: boolean;
  },
): Promise<ReasonCodeRow | null> {
  const target = args.newCode ?? args.code;

  const updated = await db.transaction(async (tx) => {
    const exists = await tx.execute(sql`
      SELECT 1 FROM app.reason_codes WHERE code = ${args.code} LIMIT 1
    `);
    if (exists.rows.length === 0) return false;

    if (args.newCode && args.newCode !== args.code) {
      const clash = await tx.execute(sql`
        SELECT 1 FROM app.reason_codes WHERE code = ${args.newCode} LIMIT 1
      `);
      if (clash.rows.length > 0) return false;
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

    if (args.description !== undefined) {
      await tx.execute(sql`
        UPDATE app.reason_codes
        SET description = ${args.description}, updated_at = now()
        WHERE code = ${target}
      `);
    }
    if (args.active !== undefined) {
      await tx.execute(sql`
        UPDATE app.reason_codes
        SET active = ${args.active}, updated_at = now()
        WHERE code = ${target}
      `);
    }
    return true;
  });

  if (!updated) return null;
  return getReasonCode(db, target);
}
