/**
 * Types that cross the client/server boundary . Keep in sync with
 * server/db/queries/returns.ts + server/db/queries/chat.ts.
 */

export type MissStatus = 'open' | 'action assigned' | 'resolved';
/**
 * Reason codes come from the `app.reason_codes` catalog in Lakebase, which
 * users maintain in-app — so this is deliberately not a fixed union. Fetch the
 * current list with `useReasonCodes()` rather than hardcoding one.
 */
export type ReasonCode = string;
export type CaStatus = 'planned' | 'in progress' | 'completed';

/** One row of the editable reason-code catalog. */
export type ReasonCodeRow = {
  code: string;
  description: string | null;
  sortOrder: number;
  active: boolean;
  /** How many misses currently carry this code. */
  usageCount: number;
};

export type MissRow = {
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

export type AuditEntry = {
  at: string;
  by: string;
  action: 'action_assigned' | 'action_resolved' | 'reason_updated' | 'note';
  notes?: string;
  tool?: string;
};

export type MissDetail = MissRow & {
  aiAuditTrail: AuditEntry[];
  decidedAt: string | null;
};

export type MissesSummary = {
  status: MissStatus;
  n: number;
  total_units: number;
};

/** Per-plant scorecard row — the map + KPI source. */
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

export type BacklogByPlant = {
  plant_id: string;
  plant_name: string;
  region: string | null;
  open_count: number;
  open_units: number;
};

export type BacklogByReason = {
  reason_code: string;
  open_count: number;
  open_units: number;
};

export type Backlog = {
  by_plant: BacklogByPlant[];
  by_reason: BacklogByReason[];
};

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
