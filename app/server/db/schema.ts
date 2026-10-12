import {
  text,
  timestamp,
  date,
  uuid,
  integer,
  doublePrecision,
  jsonb,
  pgSchema,
  index,
  uniqueIndex,
  boolean,
} from 'drizzle-orm/pg-core';

/**
 * Lakebase schema, under `app.*` — Plant Attainment Control Tower.
 *
 * Four groups:
 *   1. Chat state      (conversations, messages, feedback) — reused as-is.
 *   2. Delta mirror    (plants, corrective_actions_seed) — OLTP copies of
 *                      Delta gold tables that `db/sync.ts` pulls at boot.
 *   3. Reference data  `reason_codes` — the app-owned miss-code catalog,
 *                      seeded at boot and editable in-app (replaces the
 *                      hand-typed reason-code column in the Excel export).
 *   4. Write-surface   `misses` — the open adherence-miss backlog. The agent
 *                      writes corrective actions directly onto these rows
 *                      (owner + implementation date + status) via one atomic,
 *                      filter-driven UPDATE, and appends to `ai_audit_trail`.
 *
 * Why Lakebase: transactional Postgres next to the lakehouse under Unity
 * Catalog governance. The agent does real transactional writes; the analytics
 * layer still queries Delta gold. The steering-committee view UNIONs Delta
 * history with these live Lakebase corrective actions.
 */
export const appSchema = pgSchema('app');

// ============================================================================
// Chat state
// ============================================================================

export const conversations = appSchema.table(
  'conversations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userEmail: text('user_email').notNull(),
    title: text('title').notNull(),
    // 'default' for regular chats, 'demo_dock' for the floating dock's
    // persistent conversation (one per user).
    kind: text('kind', { enum: ['default', 'demo_dock'] })
      .notNull()
      .default('default'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('conversations_user_idx').on(t.userEmail, t.updatedAt),
    index('conversations_kind_idx').on(t.userEmail, t.kind),
  ],
);

export const messages = appSchema.table(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['user', 'assistant', 'system'] }).notNull(),
    content: text('content').notNull(),
    position: integer('position').notNull(),
    traceId: text('trace_id'),
    thinking: jsonb('thinking').$type<ThinkingEntry[]>().notNull().default([]),
    error: text('error'),
    canceled: boolean('canceled').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex('messages_convo_pos_uq').on(t.conversationId, t.position),
  ],
);

export const feedback = appSchema.table(
  'feedback',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    messageId: uuid('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    userEmail: text('user_email').notNull(),
    value: text('value', { enum: ['up', 'down'] }).notNull(),
    rationale: text('rationale'),
    traceId: text('trace_id'),
    mlflowAssessmentId: text('mlflow_assessment_id'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('feedback_message_idx').on(t.messageId)],
);

// ============================================================================
// Delta mirror
// ============================================================================

/**
 * Per-plant scorecard, mirrored from `gold_plant_scorecard` (one row per
 * plant, computed over the recent 14-day window). Drives the Operations
 * US plant map (bubbles sized/colored by attainment + open-miss count) and
 * the Home KPIs. PLNT-07/12/15 sit at ~82% attainment with a large open
 * backlog → they glow red on the map.
 */
export const plants = appSchema.table(
  'plants',
  {
    id: text('id').primaryKey(), // plant_id, e.g. PLNT-07
    plantName: text('plant_name').notNull(),
    city: text('city'),
    state: text('state'),
    region: text('region'),
    lat: doublePrecision('lat'),
    lng: doublePrecision('lng'),
    attainmentPct: doublePrecision('attainment_pct'),
    adherencePct: doublePrecision('adherence_pct'),
    openMissCount: integer('open_miss_count'),
    openMissUnits: integer('open_miss_units'),
    breakdownsCount: integer('breakdowns_count'),
    workOrdersCount: integer('work_orders_count'),
    maintenanceSpendUsd: doublePrecision('maintenance_spend_usd'),
    firstPassQualityPct: doublePrecision('first_pass_quality_pct'),
    holdsCount: integer('holds_count'),
  },
  (t) => [index('plants_region_idx').on(t.region)],
);

/**
 * Pre-seeded corrective-action history, mirrored from `gold_corrective_actions`
 * (resolved/older misses that already have an action). Read-only. The steering
 * view UNIONs this Delta history with the live corrective actions the agent
 * just wrote onto `misses` in Lakebase.
 */
export const correctiveActionsSeed = appSchema.table(
  'corrective_actions_seed',
  {
    actionId: text('action_id').primaryKey(),
    missId: text('miss_id'),
    plantId: text('plant_id'),
    plantName: text('plant_name'),
    region: text('region'),
    skuName: text('sku_name'),
    reasonCode: text('reason_code'),
    missDate: date('miss_date'),
    actionDesc: text('action_desc'),
    owner: text('owner'),
    implementationDate: date('implementation_date'),
    caStatus: text('ca_status'),
  },
  (t) => [index('ca_seed_status_idx').on(t.caStatus)],
);

// ============================================================================
// Reason-code catalog
// ============================================================================

/**
 * The miss/reason-code catalog — app-owned, NOT mirrored from Delta. This is
 * what replaces the hand-maintained reason-code column in the weekly Excel
 * export: plant users pick from it in the drawer and can add / rename /
 * retire codes in-app, all persisted in Lakebase.
 *
 * Seeded on boot by `db/seed.ts` (idempotent) so a fresh deploy always has a
 * usable starter list. Retiring a code is a soft delete (`active = false`) —
 * misses that already carry it keep it, so the Pareto history stays intact.
 *
 * `code` is both the primary key AND the display text (misses store it
 * verbatim in `reason_code`, and the badges render it as-is). There's no
 * separate label column on purpose: two fields would drift apart the moment
 * someone renamed one. A rename therefore cascades to `misses.reason_code` —
 * see `db/queries/reasonCodes.ts`.
 */
export const reasonCodes = appSchema.table(
  'reason_codes',
  {
    code: text('code').primaryKey(),
    description: text('description'),
    sortOrder: integer('sort_order').notNull().default(100),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('reason_codes_active_idx').on(t.active, t.sortOrder)],
);

// ============================================================================
// Write-surface: the open miss backlog
// ============================================================================

/**
 * Open adherence-miss backlog, mirrored from `gold_open_misses` (status
 * 'open', no corrective action). This is the app's transactional write
 * surface: the agent's `assign_corrective_actions_batch` tool flips
 * status → 'action assigned' and stamps owner + implementation date +
 * corrective action, all in ONE atomic UPDATE filtered by plant. Each write
 * appends to `ai_audit_trail`.
 *
 * Lifecycle: open → 'action assigned' (agent or operator) → 'resolved'
 * (operator closes it out, stamping resolved_by/resolved_at + an optional
 * resolution note).
 */
export const misses = appSchema.table(
  'misses',
  {
    id: text('id').primaryKey(), // miss_id, e.g. MISS-000123
    missDate: date('miss_date'),
    plantId: text('plant_id'),
    plantName: text('plant_name'),
    region: text('region'),
    lineId: text('line_id'),
    lineName: text('line_name'),
    skuId: text('sku_id'),
    skuName: text('sku_name'),
    category: text('category'),
    productionOrder: text('production_order'),
    missUnits: integer('miss_units'),
    // Free text, validated against the `reason_codes` catalog at the route
    // layer rather than pinned to a TS enum — operators can add their own
    // codes in-app and existing rows keep codes that were later retired.
    reasonCode: text('reason_code'),
    comment: text('comment'),
    status: text('status', {
      enum: ['open', 'action assigned', 'resolved'],
    })
      .notNull()
      .default('open'),

    // Corrective-action fields the agent writes through. Null until assigned.
    correctiveActionDesc: text('corrective_action_desc'),
    correctiveActionOwner: text('corrective_action_owner'),
    correctiveActionImplDate: date('corrective_action_impl_date'),
    correctiveActionStatus: text('corrective_action_status', {
      enum: ['planned', 'in progress', 'completed'],
    }),

    // Close-out fields. Null until an operator resolves the assigned action.
    resolvedBy: text('resolved_by'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    resolutionNote: text('resolution_note'),

    // Append-only audit trail. Each entry:
    //   { at, by, action, notes?, tool? }
    aiAuditTrail: jsonb('ai_audit_trail')
      .$type<AuditEntry[]>()
      .notNull()
      .default([]),

    decidedAt: timestamp('decided_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index('misses_status_idx').on(t.status, t.createdAt),
    index('misses_plant_idx').on(t.plantId, t.status),
    index('misses_reason_idx').on(t.reasonCode),
    index('misses_date_idx').on(t.missDate),
  ],
);

// ============================================================================
// JSONB entry shapes
// ============================================================================

export type AuditEntry = {
  at: string;
  by: string;
  action: 'action_assigned' | 'action_resolved' | 'reason_updated' | 'note';
  notes?: string;
  tool?: string;
};

export type ThinkingEntry =
  | { kind: 'tool_call'; callId: string; name: string; args: string }
  | { kind: 'tool_output'; callId: string; output: string }
  | { kind: 'intermediate_message'; text: string };
