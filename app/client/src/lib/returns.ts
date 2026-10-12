/**
 * REST helpers for the operations domain (misses / plants / backlog /
 * corrective actions / activity feed). All calls hit the OLTP routes in
 * server/routes/returns.ts + activity.ts. TYPES live in shared/types.ts.
 */
import { okOrThrow } from './api';
import type {
  ActivityEvent,
  Backlog,
  CaStatus,
  CorrectiveActionRow,
  MissDetail,
  MissRow,
  MissStatus,
  MissesSummary,
  PlantRow,
  ReasonCode,
  ReasonCodeRow,
} from '@/shared/types';

export async function fetchMisses(
  filters: {
    status?: MissStatus;
    plant?: string;
    region?: string;
    reason?: ReasonCode;
    sort?: 'units' | 'recent';
  } = {},
): Promise<MissRow[]> {
  const qs = new URLSearchParams();
  if (filters.status) qs.set('status', filters.status);
  if (filters.plant) qs.set('plant', filters.plant);
  if (filters.region) qs.set('region', filters.region);
  if (filters.reason) qs.set('reason', filters.reason);
  if (filters.sort) qs.set('sort', filters.sort);
  const res = await okOrThrow(await fetch(`/api/misses?${qs}`), '/api/misses');
  return res.json();
}

export async function fetchMiss(id: string): Promise<MissDetail> {
  const res = await okOrThrow(
    await fetch(`/api/misses/${encodeURIComponent(id)}`),
    `/api/misses/${id}`,
  );
  return res.json();
}

export async function fetchMissesSummary(): Promise<MissesSummary[]> {
  const res = await okOrThrow(
    await fetch('/api/misses/summary'),
    '/api/misses/summary',
  );
  return res.json();
}

export async function fetchBacklog(plant?: string): Promise<Backlog> {
  const qs = new URLSearchParams();
  if (plant) qs.set('plant', plant);
  const res = await okOrThrow(
    await fetch(`/api/misses/backlog?${qs}`),
    '/api/misses/backlog',
  );
  return res.json();
}

export async function fetchPlants(): Promise<PlantRow[]> {
  const res = await okOrThrow(await fetch('/api/plants'), '/api/plants');
  return res.json();
}

export async function fetchCorrectiveActions(
  limit = 500,
): Promise<CorrectiveActionRow[]> {
  const res = await okOrThrow(
    await fetch(`/api/corrective-actions?limit=${limit}`),
    '/api/corrective-actions',
  );
  return res.json();
}

export async function fetchActivity(limit = 20): Promise<ActivityEvent[]> {
  const res = await okOrThrow(
    await fetch(`/api/activity/recent?limit=${limit}`),
    '/api/activity/recent',
  );
  return res.json();
}

export async function updateMissReason(
  id: string,
  reasonCode: ReasonCode,
  notes?: string,
): Promise<void> {
  await okOrThrow(
    await fetch(`/api/misses/${encodeURIComponent(id)}/reason`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reasonCode, notes }),
    }),
    `/api/misses/${id}/reason`,
  );
}

export async function assignCorrectiveActionSingle(
  id: string,
  body: {
    actionDesc: string;
    owner: string;
    implementationDate: string;
    caStatus?: CaStatus;
  },
): Promise<void> {
  await okOrThrow(
    await fetch(`/api/misses/${encodeURIComponent(id)}/corrective-action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    `/api/misses/${id}/corrective-action`,
  );
}

/** Close out an assigned miss. 409s if it isn't in 'action assigned'. */
export async function resolveMiss(id: string, note?: string): Promise<void> {
  await okOrThrow(
    await fetch(`/api/misses/${encodeURIComponent(id)}/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ note }),
    }),
    `/api/misses/${id}/resolve`,
  );
}

// ── Reason-code catalog ──────────────────────────────────────────────────

export async function fetchReasonCodes(
  includeInactive = false,
): Promise<ReasonCodeRow[]> {
  const qs = includeInactive ? '?includeInactive=1' : '';
  const res = await okOrThrow(
    await fetch(`/api/reason-codes${qs}`),
    '/api/reason-codes',
  );
  return res.json();
}

export async function createReasonCode(body: {
  code: string;
  description?: string;
  sortOrder?: number;
}): Promise<void> {
  await okOrThrow(
    await fetch('/api/reason-codes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    '/api/reason-codes',
  );
}

/** Rename (cascades to misses), re-describe, and/or restore a code. */
export async function updateReasonCode(
  code: string,
  body: { newCode?: string; description?: string; active?: boolean },
): Promise<void> {
  await okOrThrow(
    await fetch(`/api/reason-codes/${encodeURIComponent(code)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    `/api/reason-codes/${code}`,
  );
}

/** Soft-retire a code. Misses already carrying it keep it. */
export async function retireReasonCode(code: string): Promise<void> {
  await okOrThrow(
    await fetch(`/api/reason-codes/${encodeURIComponent(code)}`, {
      method: 'DELETE',
    }),
    `/api/reason-codes/${code}`,
  );
}
