import { sql } from 'drizzle-orm';
import type { AppDb } from '../index.js';
import type { AuditEntry } from '../schema.js';

/**
 * Miss-backlog OLTP queries . This is the app's write surface:
 * the agent's `assignCorrectiveActionsBatch` flips a whole plant's open
 * misses to 'action assigned' in ONE atomic UPDATE filtered by plant_id.
 *
 * (File kept named `returns.ts` to preserve the barrel + import graph; the
 * domain is adherence misses, not returns.)
 */

export type MissStatus = 'open' | 'action assigned' | 'resolved';
/**
 * A reason code is whatever the `app.reason_codes` catalog says it is — users
 * add and rename codes in-app, so this can't be a fixed union. Validate with
 * `isActiveReasonCode` (see queries/reasonCodes.ts) before writing one.
 */
export type ReasonCode = string;
export type CaStatus = 'planned' | 'in progress' | 'completed';
export type { AuditEntry };

export type MissListRow = {
  id: string;
  missDate: string | null;
  plantId: string | null;
  plantName: string | null;
  region: string | null;
  lineId: string | null;
  lineName: string | null;
  skuId: string | null;
  skuName: string | null;
  category: string | null;
  productionOrder: string | null;
  missUnits: number | null;
  reasonCode: string | null;
  comment: string | null;
  status: MissStatus;
  correctiveActionDesc: string | null;
  correctiveActionOwner: string | null;
  correctiveActionImplDate: string | null;
  correctiveActionStatus: string | null;
  resolvedBy: string | null;
  resolvedAt: string | null;
  resolutionNote: string | null;
  createdAt: string;
  updatedAt: string;
};

function toListRow(r: Record<string, unknown>): MissListRow {
  return {
    id: r.id as string,
    missDate: (r.miss_date as string | null) ?? null,
    plantId: (r.plant_id as string | null) ?? null,
    plantName: (r.plant_name as string | null) ?? null,
    region: (r.region as string | null) ?? null,
    lineId: (r.line_id as string | null) ?? null,
    lineName: (r.line_name as string | null) ?? null,
    skuId: (r.sku_id as string | null) ?? null,
    skuName: (r.sku_name as string | null) ?? null,
    category: (r.category as string | null) ?? null,
    productionOrder: (r.production_order as string | null) ?? null,
    missUnits: r.miss_units === null || r.miss_units === undefined ? null : Number(r.miss_units),
    reasonCode: (r.reason_code as string | null) ?? null,
    comment: (r.comment as string | null) ?? null,
    status: (r.status as MissStatus) ?? 'open',
    correctiveActionDesc: (r.corrective_action_desc as string | null) ?? null,
    correctiveActionOwner: (r.corrective_action_owner as string | null) ?? null,
    correctiveActionImplDate: (r.corrective_action_impl_date as string | null) ?? null,
    correctiveActionStatus: (r.corrective_action_status as string | null) ?? null,
    resolvedBy: (r.resolved_by as string | null) ?? null,
    resolvedAt: (r.resolved_at as string | null) ?? null,
    resolutionNote: (r.resolution_note as string | null) ?? null,
    createdAt: r.created_at as string,
    updatedAt: r.updated_at as string,
  };
}

export async function listMisses(
  db: AppDb,
  opts: {
    status?: MissStatus;
    plantId?: string;
    region?: string;
    reasonCode?: ReasonCode;
    sort?: 'units' | 'recent';
    limit?: number;
  } = {},
): Promise<MissListRow[]> {
  const limit = opts.limit ?? 300;
  const whereStatus = opts.status ? sql`AND m.status = ${opts.status}` : sql``;
  const wherePlant = opts.plantId ? sql`AND m.plant_id = ${opts.plantId}` : sql``;
  const whereRegion = opts.region ? sql`AND m.region = ${opts.region}` : sql``;
  const whereReason = opts.reasonCode ? sql`AND m.reason_code = ${opts.reasonCode}` : sql``;
  const orderBy =
    opts.sort === 'units'
      ? sql`ORDER BY m.miss_units DESC NULLS LAST, m.miss_date DESC NULLS LAST`
      : sql`ORDER BY m.miss_date DESC NULLS LAST, m.created_at DESC`;
  const result = await db.execute(sql`
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
  `);
  return (result.rows as Record<string, unknown>[]).map(toListRow);
}

export async function getMiss(db: AppDb, id: string): Promise<
  (MissListRow & { aiAuditTrail: AuditEntry[]; decidedAt: string | null }) | null
> {
  const result = await db.execute(sql`
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
  `);
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    ...toListRow(row),
    aiAuditTrail: (row.ai_audit_trail as AuditEntry[]) ?? [],
    decidedAt: (row.decided_at as string | null) ?? null,
  };
}

/**
 * Operator-driven reason-code correction on a single miss. Appends one
 * audit entry.
 */
export async function updateMissReason(
  db: AppDb,
  args: { id: string; userEmail: string; reasonCode: ReasonCode; notes?: string },
): Promise<MissListRow | null> {
  const entry: AuditEntry = {
    at: new Date().toISOString(),
    by: args.userEmail,
    action: 'reason_updated',
    notes: args.notes ?? `Reason set to ${args.reasonCode}`,
  };
  await db.execute(sql`
    UPDATE app.misses
    SET reason_code = ${args.reasonCode},
        updated_at = now(),
        ai_audit_trail = ai_audit_trail || ${JSON.stringify([entry])}::jsonb
    WHERE id = ${args.id}
  `);
  const m = await getMiss(db, args.id);
  return m;
}

/**
 * Operator-driven single corrective-action assignment (drawer form). Sets
 * the corrective-action fields + flips status → 'action assigned'.
 */
export async function assignCorrectiveActionSingle(
  db: AppDb,
  args: {
    id: string;
    userEmail: string;
    actionDesc: string;
    owner: string;
    implementationDate: string;
    caStatus: CaStatus;
  },
): Promise<MissListRow | null> {
  const entry: AuditEntry = {
    at: new Date().toISOString(),
    by: args.userEmail,
    action: 'action_assigned',
    notes: `${args.owner} · ${args.caStatus} · due ${args.implementationDate}`,
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
export async function resolveMiss(
  db: AppDb,
  args: { id: string; userEmail: string; note?: string },
): Promise<MissListRow | null> {
  const entry: AuditEntry = {
    at: new Date().toISOString(),
    by: args.userEmail,
    action: 'action_resolved',
    notes: args.note ?? 'Corrective action closed out',
  };
  const res = await db.execute(sql`
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
  `);
  if (res.rows.length === 0) return null;
  return getMiss(db, args.id);
}

export async function missesSummary(db: AppDb) {
  const rows = await db.execute(sql`
    SELECT status,
           COUNT(*)::int AS n,
           COALESCE(SUM(miss_units), 0)::int AS total_units
    FROM app.misses
    GROUP BY status
  `);
  return rows.rows as Array<{ status: MissStatus; n: number; total_units: number }>;
}

// ============================================================================
// Plant scorecard (the map + KPI source)
// ============================================================================

export type PlantRow = {
  id: string;
  plantName: string;
  city: string | null;
  state: string | null;
  region: string | null;
  lat: number | null;
  lng: number | null;
  attainmentPct: number | null;
  adherencePct: number | null;
  openMissCount: number | null;
  openMissUnits: number | null;
  breakdownsCount: number | null;
  workOrdersCount: number | null;
  maintenanceSpendUsd: number | null;
  firstPassQualityPct: number | null;
  holdsCount: number | null;
};

/**
 * Per-plant scorecard for the map. `open_miss_count` is recomputed LIVE from
 * app.misses (status='open') so the map drops when the agent assigns actions —
 * the pre-synced scorecard value is only a fallback.
 */
export async function listPlants(db: AppDb): Promise<PlantRow[]> {
  const rows = await db.execute(sql`
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
  `);
  return (rows.rows as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    plantName: r.plant_name as string,
    city: (r.city as string | null) ?? null,
    state: (r.state as string | null) ?? null,
    region: (r.region as string | null) ?? null,
    lat: r.lat === null ? null : Number(r.lat),
    lng: r.lng === null ? null : Number(r.lng),
    attainmentPct: r.attainment_pct === null ? null : Number(r.attainment_pct),
    adherencePct: r.adherence_pct === null ? null : Number(r.adherence_pct),
    openMissCount: r.open_miss_count === null ? null : Number(r.open_miss_count),
    openMissUnits: r.open_miss_units === null ? null : Number(r.open_miss_units),
    breakdownsCount: r.breakdowns_count === null ? null : Number(r.breakdowns_count),
    workOrdersCount: r.work_orders_count === null ? null : Number(r.work_orders_count),
    maintenanceSpendUsd:
      r.maintenance_spend_usd === null ? null : Number(r.maintenance_spend_usd),
    firstPassQualityPct:
      r.first_pass_quality_pct === null ? null : Number(r.first_pass_quality_pct),
    holdsCount: r.holds_count === null ? null : Number(r.holds_count),
  }));
}

// ============================================================================
// Backlog summary — per-plant + per-reason open-miss counts. The agent's
// discovery tool. Filterable by plant.
// ============================================================================

export type BacklogByPlant = {
  plant_id: string;
  plant_name: string;
  region: string | null;
  open_count: number;
  open_units: number;
};

export async function backlogByPlant(
  db: AppDb,
  opts: { plantId?: string } = {},
): Promise<BacklogByPlant[]> {
  const wherePlant = opts.plantId ? sql`AND m.plant_id = ${opts.plantId}` : sql``;
  const rows = await db.execute(sql`
    SELECT m.plant_id,
           MAX(m.plant_name) AS plant_name,
           MAX(m.region) AS region,
           COUNT(*)::int AS open_count,
           COALESCE(SUM(m.miss_units), 0)::int AS open_units
    FROM app.misses m
    WHERE m.status = 'open' ${wherePlant}
    GROUP BY m.plant_id
    ORDER BY open_count DESC
  `);
  return rows.rows as BacklogByPlant[];
}

export type BacklogByReason = {
  reason_code: string;
  open_count: number;
  open_units: number;
};

export async function backlogByReason(
  db: AppDb,
  opts: { plantId?: string } = {},
): Promise<BacklogByReason[]> {
  const wherePlant = opts.plantId ? sql`AND m.plant_id = ${opts.plantId}` : sql``;
  const rows = await db.execute(sql`
    SELECT COALESCE(m.reason_code, 'Unknown') AS reason_code,
           COUNT(*)::int AS open_count,
           COALESCE(SUM(m.miss_units), 0)::int AS open_units
    FROM app.misses m
    WHERE m.status = 'open' ${wherePlant}
    GROUP BY COALESCE(m.reason_code, 'Unknown')
    ORDER BY open_count DESC
  `);
  return rows.rows as BacklogByReason[];
}

// ============================================================================
// Recent activity — unnest ai_audit_trail across misses.
// ============================================================================

export type ActivityEvent = {
  kind: 'audit';
  miss_id: string;
  plant_id: string | null;
  at: string;
  by: string;
  action: string;
  notes: string | null;
  tool: string | null;
};

export async function recentActivity(db: AppDb, limit = 20): Promise<ActivityEvent[]> {
  const rows = await db.execute(sql`
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
  `);
  return (rows.rows as Array<Record<string, unknown>>).map((r) => ({
    kind: 'audit' as const,
    miss_id: r.miss_id as string,
    plant_id: (r.plant_id as string | null) ?? null,
    at: r.at as string,
    by: (r.by_email as string) ?? '',
    action: (r.action as string) ?? '',
    notes: (r.notes as string | null) ?? null,
    tool: (r.tool as string | null) ?? null,
  }));
}

// ============================================================================
// Steering-committee corrective-action tracker — UNION of the pre-seeded
// Delta history (app.corrective_actions_seed) with the LIVE actions the
// agent + operators just recorded on app.misses. Merged server-side because
// the live rows live in Lakebase, not the warehouse.
// ============================================================================

export type CorrectiveActionRow = {
  action_id: string;
  miss_id: string | null;
  plant_id: string | null;
  plant_name: string | null;
  region: string | null;
  sku_name: string | null;
  reason_code: string | null;
  miss_date: string | null;
  action_desc: string | null;
  owner: string | null;
  implementation_date: string | null;
  ca_status: string | null;
  source: 'history' | 'live';
};

export async function correctiveActionTracker(
  db: AppDb,
  opts: { limit?: number } = {},
): Promise<CorrectiveActionRow[]> {
  const limit = opts.limit ?? 500;
  const rows = await db.execute(sql`
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
  `);
  return rows.rows as CorrectiveActionRow[];
}

// ============================================================================
// THE BULK WRITE — assign_corrective_actions_batch.
//
// Filter-driven (scalar plant_id, never a list of IDs). Wraps SELECT ... FOR
// UPDATE + one UPDATE ... RETURNING in a transaction. Flips every OPEN miss
// at the plant → 'action assigned', stamps owner + implementation date +
// per-reason corrective action, appends one audit entry per row. Counts are
// derived from the RETURNING set (ground truth), not intent.
//
// The agent drafts ONE corrective action per reason_code (owner + desc + due
// date); each open miss inherits the action for its own reason_code.
// ============================================================================

export type ReasonActionDraft = {
  reason_code: ReasonCode;
  action_desc: string;
  owner: string;
  implementation_date: string; // ISO date
  ca_status: CaStatus;
};

export type AssignBatchResult = {
  plant_id: string;
  assigned_count: number;
  assigned_units: number;
  by_reason: Array<{ reason_code: string; count: number }>;
  skipped_miss_ids: string[];
};

export async function assignCorrectiveActionsBatch(
  db: AppDb,
  args: {
    plantId: string;
    drafts: ReasonActionDraft[];
    userEmail: string;
  },
): Promise<AssignBatchResult> {
  return db.transaction(async (tx) => {
    // 1) Lock + read every OPEN miss at this plant. Scalar filter — no IN().
    const rowsRes = await tx.execute(sql`
      SELECT m.id, m.reason_code, m.miss_units
      FROM app.misses m
      WHERE m.plant_id = ${args.plantId} AND m.status = 'open'
      FOR UPDATE OF m
    `);
    const rows = rowsRes.rows as Array<{
      id: string;
      reason_code: string | null;
      miss_units: number | null;
    }>;

    const draftByReason = new Map<string, ReasonActionDraft>();
    for (const d of args.drafts) draftByReason.set(d.reason_code, d);
    // Fallback draft: if a reason has no matching draft, use the first one so
    // no open miss is stranded (the agent always drafts for the top reasons).
    const fallback = args.drafts[0];

    if (rows.length === 0 || !fallback) {
      return {
        plant_id: args.plantId,
        assigned_count: 0,
        assigned_units: 0,
        by_reason: [],
        skipped_miss_ids: [],
      };
    }

    const now = new Date().toISOString();
    const valuesParts: ReturnType<typeof sql>[] = [];
    const metaById = new Map<string, { reason: string; units: number }>();

    for (const row of rows) {
      const reason = row.reason_code ?? fallback.reason_code;
      const draft = draftByReason.get(reason) ?? fallback;
      const audit: AuditEntry[] = [
        {
          at: now,
          by: args.userEmail,
          action: 'action_assigned',
          notes: `${draft.owner} · ${draft.ca_status} · due ${draft.implementation_date} · ${reason}`,
          tool: 'assign_corrective_actions_batch',
        },
      ];
      valuesParts.push(
        sql`(${row.id}, ${draft.action_desc}, ${draft.owner}, ${draft.implementation_date}::date, ${draft.ca_status}, ${JSON.stringify(audit)}::jsonb)`,
      );
      metaById.set(row.id, {
        reason,
        units: row.miss_units === null ? 0 : Number(row.miss_units),
      });
    }

    // 2) ONE UPDATE ... FROM (VALUES ...) ... RETURNING.
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
    const updatedIds = new Set((updRes.rows as Array<{ id: string }>).map((r) => r.id));

    let assignedUnits = 0;
    const byReason = new Map<string, number>();
    const skipped: string[] = [];
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
        count,
      })),
      skipped_miss_ids: skipped,
    };
  });
}
