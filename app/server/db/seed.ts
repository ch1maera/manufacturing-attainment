import { sql } from 'drizzle-orm';
import type { AppDb } from './index.js';

/**
 * App-owned reference data seeded into Lakebase at boot.
 *
 * Unlike `db/sync.ts` (which mirrors Delta gold), this data has no lakehouse
 * source — it's the catalog the app itself owns and users edit. It lives here
 * rather than in a Drizzle migration because `drizzle/` is a gitignored build
 * artifact regenerated from schema.ts on every build (see app/.gitignore), so
 * a hand-edited migration would be blown away.
 */

/**
 * Starter miss/reason-code catalog.
 *
 * The first five are the codes the whole demo story is built on — the Pareto,
 * the agent instructions, and the seeded corrective-action history all assume
 * them, so they keep the low sort orders and lead the list. The rest are
 * plausible extra codes (sanitation overruns, component shortages, packaging
 * defects, inspection rejects), there so the reason-code manager opens with a
 * real list to tweak rather than an empty table.
 */
const STARTER_REASON_CODES: Array<{
  code: string;
  description: string;
  sortOrder: number;
}> = [
  {
    code: 'Changeover',
    description: 'Line changeover or sanitation ran past the planned window.',
    sortOrder: 10,
  },
  {
    code: 'Material Shortage',
    description: 'A required material, component, or packaging was unavailable.',
    sortOrder: 20,
  },
  {
    code: 'Mechanical Downtime',
    description: 'Unplanned equipment stop — breakdown, jam, or component failure.',
    sortOrder: 30,
  },
  {
    code: 'Quality Hold',
    description: 'Product held pending QA disposition or retest.',
    sortOrder: 40,
  },
  {
    code: 'Labor',
    description: 'Staffing shortfall, callout, or overtime cap.',
    sortOrder: 50,
  },
  {
    code: 'Sanitation Overrun',
    description: 'A full sanitation cycle exceeded the scheduled slot.',
    sortOrder: 60,
  },
  {
    code: 'Component Shortage',
    description: 'A required component or sub-assembly was short or delayed.',
    sortOrder: 70,
  },
  {
    code: 'Packaging Defect',
    description: 'Packaging material splice, seal, or tracking defect on the line.',
    sortOrder: 80,
  },
  {
    code: 'Inspection Reject',
    description: 'In-line inspection or checkweigher reject spike pulled product.',
    sortOrder: 90,
  },
  {
    code: 'Short Staffed',
    description: 'Crew ran below minimum manning for the shift.',
    sortOrder: 100,
  },
];

/**
 * Insert any missing starter codes. Idempotent and non-destructive: codes the
 * user renamed, retired, or added are left exactly as they are, and a starter
 * code they deleted outright comes back on the next boot (or demo reset).
 */
export async function seedReasonCodes(db: AppDb): Promise<void> {
  const values = STARTER_REASON_CODES.map(
    (r) => sql`(${r.code}, ${r.description}, ${r.sortOrder})`,
  );
  const res = await db.execute(sql`
    INSERT INTO app.reason_codes (code, description, sort_order)
    VALUES ${sql.join(values, sql`, `)}
    ON CONFLICT (code) DO NOTHING
    RETURNING code
  `);
  if (res.rows.length > 0) {
    console.log(`[seed] reason codes: inserted ${res.rows.length}`);
  }
}
