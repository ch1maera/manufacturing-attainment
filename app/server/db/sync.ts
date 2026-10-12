import { sql } from 'drizzle-orm';
import { getExecutionContext } from '@databricks/appkit';
import type { AppDb } from './index.js';
import { plants, misses, correctiveActionsSeed } from './schema.js';

/**
 * One-shot Delta → Lakebase sync .
 *
 * Databricks Apps sit next to the lakehouse. Delta gold is the source of
 * truth; Lakebase is the OLTP mirror the app reads + writes against.
 *
 * Pulls three gold tables:
 *   - gold_plant_scorecard   → app.plants                (map + KPIs)
 *   - gold_open_misses       → app.misses                (write surface: open backlog)
 *   - gold_corrective_actions→ app.corrective_actions_seed (pre-seeded history)
 *
 * Idempotent in the "only-if-destination-empty" sense — if `app.misses` has
 * rows, we skip. Pass `{ forceIfAnyEmpty: true }` to re-sync (Reset demo).
 * For reset the caller TRUNCATEs the mirror tables first, then calls this.
 */

type DataConfig = {
  catalog: string;
  schema: string;
  tables: {
    /** gold_plant_scorecard — one row per plant, recent-window metrics. */
    plants: string;
    /** gold_open_misses — open backlog (no corrective action). */
    misses: string;
    /** gold_corrective_actions — pre-seeded resolved-miss action history. */
    correctiveActions: string;
  };
};

export async function syncFromDelta(
  db: AppDb,
  cfg: DataConfig,
  opts: { forceIfAnyEmpty?: boolean } = {},
): Promise<void> {
  const exists = await db.execute(sql`SELECT COUNT(*)::int AS n FROM app.misses`);
  const n = (exists.rows[0] as { n: number } | undefined)?.n ?? 0;
  if (n > 0 && !opts.forceIfAnyEmpty) return;

  const warehouseId = process.env.DATABRICKS_WAREHOUSE_ID;
  if (!warehouseId) {
    console.warn('[sync] DATABRICKS_WAREHOUSE_ID not set — skipping Delta sync');
    return;
  }

  console.log('[sync] Starting Delta → Lakebase sync (parallel)…');
  const t0 = Date.now();

  const fq = (name: keyof DataConfig['tables']) =>
    `${cfg.catalog}.${cfg.schema}.${cfg.tables[name]}`;

  // Fire all warehouse queries in parallel (the slow part), then insert.
  // No FK constraints between these three tables, so insert order is free.
  const [plantRows, missRows, caRows] = await Promise.all([
    execSql<{
      plant_id: string;
      plant_name: string;
      city: string | null;
      state: string | null;
      region: string | null;
      lat: number | null;
      lng: number | null;
      attainment_pct: number | null;
      adherence_pct: number | null;
      open_miss_count: number | null;
      open_miss_units: number | null;
      breakdowns_count: number | null;
      work_orders_count: number | null;
      maintenance_spend_usd: number | null;
      first_pass_quality_pct: number | null;
      holds_count: number | null;
    }>(
      warehouseId,
      `SELECT plant_id, plant_name, city, state, region, lat, lng,
              attainment_pct, adherence_pct, open_miss_count, open_miss_units,
              breakdowns_count, work_orders_count, maintenance_spend_usd,
              first_pass_quality_pct, holds_count
       FROM ${fq('plants')}`,
    ),
    execSql<{
      miss_id: string;
      miss_date: string | null;
      plant_id: string | null;
      plant_name: string | null;
      region: string | null;
      line_id: string | null;
      line_name: string | null;
      sku_id: string | null;
      sku_name: string | null;
      category: string | null;
      production_order: string | null;
      miss_units: number | null;
      reason_code: string | null;
      comment: string | null;
      status: string | null;
    }>(
      warehouseId,
      `SELECT miss_id, miss_date, plant_id, plant_name, region, line_id,
              line_name, sku_id, sku_name, category, production_order,
              miss_units, reason_code, comment, status
       FROM ${fq('misses')}`,
    ),
    execSql<{
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
    }>(
      warehouseId,
      `SELECT action_id, miss_id, plant_id, plant_name, region, sku_name,
              reason_code, miss_date, action_desc, owner, implementation_date,
              ca_status
       FROM ${fq('correctiveActions')}`,
    ),
  ]);
  console.log(`[sync]   queries done (${((Date.now() - t0) / 1000).toFixed(1)}s) — inserting…`);

  // Validate incoming reason codes against the app's catalog rather than a
  // hardcoded list — otherwise a code the user added in-app (or one the
  // pipeline starts emitting) would be silently nulled on every re-sync.
  const catalogRes = await db.execute(
    sql`SELECT code FROM app.reason_codes WHERE active`,
  );
  const known = new Set(
    (catalogRes.rows as Array<{ code: string }>).map((r) => r.code),
  );

  if (plantRows.length) {
    await chunkInsert(plantRows, 5_000, (chunk) =>
      db.insert(plants).values(
        chunk.map((r) => ({
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
          maintenanceSpendUsd:
            r.maintenance_spend_usd === null ? null : Number(r.maintenance_spend_usd),
          firstPassQualityPct:
            r.first_pass_quality_pct === null ? null : Number(r.first_pass_quality_pct),
          holdsCount: r.holds_count === null ? null : Number(r.holds_count),
        })),
      ).onConflictDoNothing(),
    );
  }
  console.log(`[sync]   plants: ${plantRows.length} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);

  if (missRows.length) {
    await chunkInsert(missRows, 2_500, (chunk) =>
      db.insert(misses).values(
        chunk.map((r) => ({
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
          reasonCode:
            r.reason_code && known.has(r.reason_code) ? r.reason_code : null,
          comment: r.comment,
          // Backlog always lands as 'open' with null corrective fields.
          status: 'open' as const,
        })),
      ).onConflictDoNothing(),
    );
  }
  console.log(`[sync]   misses: ${missRows.length} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);

  if (caRows.length) {
    await chunkInsert(caRows, 5_000, (chunk) =>
      db.insert(correctiveActionsSeed).values(
        chunk.map((r) => ({
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
          caStatus: r.ca_status,
        })),
      ).onConflictDoNothing(),
    );
  }
  console.log(`[sync]   corrective actions (seed): ${caRows.length} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);

  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[sync] Done in ${dt}s`);
}

/**
 * Reset the demo to a clean queue. Only the Delta-mirrored tables and chat
 * state are truncated — `app.reason_codes` is deliberately left alone, since
 * a customised code list is user-owned configuration, not demo state. The
 * caller re-runs `seedReasonCodes` afterwards to restore any starter code
 * that was deleted outright.
 */
export async function wipeMirroredTables(db: AppDb): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`TRUNCATE TABLE app.feedback RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.messages RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.conversations RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.misses RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.corrective_actions_seed RESTART IDENTITY CASCADE`);
    await tx.execute(sql`TRUNCATE TABLE app.plants RESTART IDENTITY CASCADE`);
  });
}

async function execSql<T>(
  warehouseId: string,
  statement: string,
): Promise<T[]> {
  const { client } = getExecutionContext();
  type StmtResp = {
    statement_id: string;
    status: { state: string; error?: { message: string } };
    manifest?: {
      schema: { columns: Array<{ name: string }> };
      chunks?: Array<{ chunk_index: number; row_count: number }>;
    };
    result?: {
      chunk_index: number;
      row_count: number;
      data_array?: Array<Array<unknown>>;
      next_chunk_index?: number;
    };
  };

  const initial = (await client.apiClient.request({
    method: 'POST',
    path: '/api/2.0/sql/statements',
    payload: {
      statement,
      warehouse_id: warehouseId,
      wait_timeout: '50s',
      on_wait_timeout: 'CONTINUE',
      disposition: 'INLINE',
      format: 'JSON_ARRAY',
    },
    headers: new Headers(),
    raw: false,
    query: {},
  })) as StmtResp;

  const POLL_DEADLINE_MS = 10 * 60 * 1000;
  const startedAt = Date.now();

  let cur = initial;
  while (
    cur.status.state !== 'SUCCEEDED' &&
    cur.status.state !== 'FAILED' &&
    cur.status.state !== 'CANCELED'
  ) {
    if (Date.now() - startedAt > POLL_DEADLINE_MS) {
      throw new Error(
        `[sync] SQL still ${cur.status.state} after 10 minutes — aborting (statement_id=${cur.statement_id})`,
      );
    }
    await new Promise((r) => setTimeout(r, 1000));
    cur = (await client.apiClient.request({
      method: 'GET',
      path: `/api/2.0/sql/statements/${cur.statement_id}`,
      headers: new Headers(),
      raw: false,
      query: {},
    })) as StmtResp;
  }
  if (cur.status.state !== 'SUCCEEDED') {
    throw new Error(
      `[sync] SQL failed: ${cur.status.error?.message ?? cur.status.state}`,
    );
  }

  const cols = cur.manifest?.schema.columns.map((c) => c.name) ?? [];
  const rows: T[] = [];
  let chunk = cur.result;
  while (chunk) {
    for (const row of chunk.data_array ?? []) {
      const obj: Record<string, unknown> = {};
      for (let i = 0; i < cols.length; i++) obj[cols[i]] = row[i];
      rows.push(obj as T);
    }
    if (chunk.next_chunk_index === undefined || chunk.next_chunk_index === null) break;
    chunk = (await client.apiClient.request({
      method: 'GET',
      path: `/api/2.0/sql/statements/${cur.statement_id}/result/chunks/${chunk.next_chunk_index}`,
      headers: new Headers(),
      raw: false,
      query: {},
    })) as StmtResp['result'];
  }
  return rows;
}

async function chunkInsert<T>(
  rows: T[],
  size: number,
  fn: (chunk: T[]) => Promise<unknown>,
): Promise<void> {
  for (let i = 0; i < rows.length; i += size) {
    await fn(rows.slice(i, i + size));
  }
}
