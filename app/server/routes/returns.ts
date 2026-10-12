import type { Application } from 'express';
import express from 'express';
import {
  listMisses,
  getMiss,
  missesSummary,
  updateMissReason,
  assignCorrectiveActionSingle,
  resolveMiss,
  listPlants,
  backlogByPlant,
  backlogByReason,
  correctiveActionTracker,
  listReasonCodes,
  isActiveReasonCode,
  createReasonCode,
  updateReasonCode,
  type MissStatus,
  type CaStatus,
} from '../db/queries/index.js';
import { getCurrentUserEmail } from '../lib/user.js';
import type { AppDb } from '../db/index.js';

/**
 * OLTP business routes — the miss backlog queue, plant scorecard/map, backlog
 * summaries, the operator single-assign + resolve endpoints, the reason-code
 * catalog, and the steering corrective-action tracker. Drives the Operations
 * + Steering pages.
 */

const VALID_STATUS = ['open', 'action assigned', 'resolved'] as const;
const VALID_CA_STATUS = ['planned', 'in progress', 'completed'] as const;

function strParam(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function intParam(v: unknown, fallback: number, max: number): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.floor(n), max);
}

function parseStatus(v: unknown): MissStatus | undefined {
  const s = strParam(v);
  return s && (VALID_STATUS as readonly string[]).includes(s)
    ? (s as MissStatus)
    : undefined;
}

function parseBool(v: unknown): boolean | undefined {
  if (typeof v === 'boolean') return v;
  if (v === 'true' || v === '1') return true;
  if (v === 'false' || v === '0') return false;
  return undefined;
}

type Deps = { db: AppDb };

export function registerReturnsRoutes(app: Application, deps: Deps): void {
  const { db } = deps;

  // --- GET /api/misses (list) --------------------------------------------
  app.get('/api/misses', async (req, res) => {
    const sort = strParam(req.query.sort);
    const rows = await listMisses(db, {
      status: parseStatus(req.query.status),
      plantId: strParam(req.query.plant),
      region: strParam(req.query.region),
      // Free-text filter — parameterized, and an unknown code simply matches
      // nothing. No need to validate against the catalog here.
      reasonCode: strParam(req.query.reason),
      sort: sort === 'units' || sort === 'recent' ? sort : undefined,
    });
    res.json(rows);
  });

  // --- GET /api/misses/summary -------------------------------------------
  app.get('/api/misses/summary', async (_req, res) => {
    const rows = await missesSummary(db);
    res.json(rows);
  });

  // --- GET /api/misses/backlog (by-plant + by-reason for the panel) ------
  app.get('/api/misses/backlog', async (req, res) => {
    const plantId = strParam(req.query.plant);
    const [byPlant, byReason] = await Promise.all([
      backlogByPlant(db, { plantId }),
      backlogByReason(db, { plantId }),
    ]);
    res.json({ by_plant: byPlant, by_reason: byReason });
  });

  // --- GET /api/plants (scorecard — the map source) ----------------------
  app.get('/api/plants', async (_req, res) => {
    const rows = await listPlants(db);
    res.json(rows);
  });

  // --- GET /api/misses/:id (detail — includes ai_audit_trail[]) ----------
  app.get('/api/misses/:id', async (req, res) => {
    const row = await getMiss(db, req.params.id);
    if (!row) {
      res.status(404).json({ error: 'not found' });
      return;
    }
    res.json(row);
  });

  // --- PATCH /api/misses/:id/reason (operator reason-code correction) ----
  app.patch(
    '/api/misses/:id/reason',
    express.json({ limit: '16kb' }),
    async (req, res) => {
      const userEmail = getCurrentUserEmail(req);
      const reasonCode = strParam(req.body?.reasonCode);
      if (!reasonCode || !(await isActiveReasonCode(db, reasonCode))) {
        res.status(400).json({
          error:
            'reasonCode must be an active code from the reason-code catalog (GET /api/reason-codes)',
        });
        return;
      }
      const rawNotes = req.body?.notes;
      const notes =
        typeof rawNotes === 'string' && rawNotes.length > 0
          ? rawNotes.slice(0, 4000)
          : undefined;
      const result = await updateMissReason(db, {
        id: req.params.id,
        userEmail,
        reasonCode,
        notes,
      });
      res.json(result);
    },
  );

  // --- POST /api/misses/:id/corrective-action (operator single assign) ---
  app.post(
    '/api/misses/:id/corrective-action',
    express.json({ limit: '32kb' }),
    async (req, res) => {
      const userEmail = getCurrentUserEmail(req);
      const actionDesc = strParam(req.body?.actionDesc);
      const owner = strParam(req.body?.owner);
      const implementationDate = strParam(req.body?.implementationDate);
      const caStatusRaw = strParam(req.body?.caStatus);
      const caStatus =
        caStatusRaw && (VALID_CA_STATUS as readonly string[]).includes(caStatusRaw)
          ? (caStatusRaw as CaStatus)
          : 'planned';
      if (!actionDesc || !owner || !implementationDate) {
        res
          .status(400)
          .json({ error: 'actionDesc, owner, and implementationDate are required' });
        return;
      }
      const result = await assignCorrectiveActionSingle(db, {
        id: req.params.id,
        userEmail,
        actionDesc,
        owner,
        implementationDate,
        caStatus,
      });
      res.json(result);
    },
  );

  // --- POST /api/misses/:id/resolve (operator close-out) -----------------
  app.post(
    '/api/misses/:id/resolve',
    express.json({ limit: '16kb' }),
    async (req, res) => {
      const userEmail = getCurrentUserEmail(req);
      const rawNote = req.body?.note;
      const note =
        typeof rawNote === 'string' && rawNote.length > 0
          ? rawNote.slice(0, 4000)
          : undefined;
      const result = await resolveMiss(db, { id: req.params.id, userEmail, note });
      if (!result) {
        res.status(409).json({
          error:
            'Only a miss with status "action assigned" can be resolved — assign a corrective action first.',
        });
        return;
      }
      res.json(result);
    },
  );

  // --- GET /api/corrective-actions (steering tracker: history ∪ live) ----
  app.get('/api/corrective-actions', async (req, res) => {
    const rows = await correctiveActionTracker(db, {
      limit: intParam(req.query.limit, 500, 2000),
    });
    res.json(rows);
  });

  // ── Reason-code catalog ────────────────────────────────────────────────
  // The app-owned miss-code list users maintain in-app (ReasonCodeManager).
  // Retire is a soft delete; rename cascades to the misses carrying the code.

  // --- GET /api/reason-codes ---------------------------------------------
  app.get('/api/reason-codes', async (req, res) => {
    const rows = await listReasonCodes(db, {
      includeInactive: parseBool(req.query.includeInactive) ?? false,
    });
    res.json(rows);
  });

  // --- POST /api/reason-codes (add) --------------------------------------
  app.post('/api/reason-codes', express.json({ limit: '16kb' }), async (req, res) => {
    const code = strParam(req.body?.code)?.trim();
    if (!code || code.length > 80) {
      res.status(400).json({ error: 'code is required (max 80 characters)' });
      return;
    }
    const description = strParam(req.body?.description)?.slice(0, 500);
    const sortOrderRaw = Number(req.body?.sortOrder);
    const row = await createReasonCode(db, {
      code,
      description,
      sortOrder: Number.isFinite(sortOrderRaw) ? sortOrderRaw : undefined,
    });
    if (!row) {
      res.status(409).json({ error: `Reason code "${code}" already exists.` });
      return;
    }
    res.status(201).json(row);
  });

  // --- PATCH /api/reason-codes/:code (rename / describe / retire-restore) -
  app.patch(
    '/api/reason-codes/:code',
    express.json({ limit: '16kb' }),
    async (req, res) => {
      const newCode = strParam(req.body?.newCode)?.trim();
      if (newCode !== undefined && newCode.length > 80) {
        res.status(400).json({ error: 'newCode must be 80 characters or fewer' });
        return;
      }
      const row = await updateReasonCode(db, {
        code: req.params.code,
        newCode,
        description: strParam(req.body?.description)?.slice(0, 500),
        active: parseBool(req.body?.active),
      });
      if (!row) {
        res.status(409).json({
          error: `Could not update "${req.params.code}" — it no longer exists, or the new name is already taken.`,
        });
        return;
      }
      res.json(row);
    },
  );

  // --- DELETE /api/reason-codes/:code (soft retire) ----------------------
  app.delete('/api/reason-codes/:code', async (req, res) => {
    const row = await updateReasonCode(db, {
      code: req.params.code,
      active: false,
    });
    if (!row) {
      res.status(404).json({ error: `Reason code "${req.params.code}" not found.` });
      return;
    }
    res.json(row);
  });
}
