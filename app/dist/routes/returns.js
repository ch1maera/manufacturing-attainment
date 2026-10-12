import { getCurrentUserEmail } from "../lib/user.js";
import { assignCorrectiveActionSingle, backlogByPlant, backlogByReason, correctiveActionTracker, getMiss, listMisses, listPlants, missesSummary, resolveMiss, updateMissReason } from "../db/queries/returns.js";
import { createReasonCode, isActiveReasonCode, listReasonCodes, updateReasonCode } from "../db/queries/reasonCodes.js";
import "../db/queries/index.js";
import express from "express";

//#region server/routes/returns.ts
/**
* OLTP business routes — the miss backlog queue, plant scorecard/map, backlog
* summaries, the operator single-assign + resolve endpoints, the reason-code
* catalog, and the steering corrective-action tracker. Drives the Operations
* + Steering pages.
*/
const VALID_STATUS = [
	"open",
	"action assigned",
	"resolved"
];
const VALID_CA_STATUS = [
	"planned",
	"in progress",
	"completed"
];
function strParam(v) {
	return typeof v === "string" && v.length > 0 ? v : void 0;
}
function intParam(v, fallback, max) {
	const n = Number(v);
	if (!Number.isFinite(n) || n < 1) return fallback;
	return Math.min(Math.floor(n), max);
}
function parseStatus(v) {
	const s = strParam(v);
	return s && VALID_STATUS.includes(s) ? s : void 0;
}
function parseBool(v) {
	if (typeof v === "boolean") return v;
	if (v === "true" || v === "1") return true;
	if (v === "false" || v === "0") return false;
}
function registerReturnsRoutes(app, deps) {
	const { db } = deps;
	app.get("/api/misses", async (req, res) => {
		const sort = strParam(req.query.sort);
		const rows = await listMisses(db, {
			status: parseStatus(req.query.status),
			plantId: strParam(req.query.plant),
			region: strParam(req.query.region),
			reasonCode: strParam(req.query.reason),
			sort: sort === "units" || sort === "recent" ? sort : void 0
		});
		res.json(rows);
	});
	app.get("/api/misses/summary", async (_req, res) => {
		const rows = await missesSummary(db);
		res.json(rows);
	});
	app.get("/api/misses/backlog", async (req, res) => {
		const plantId = strParam(req.query.plant);
		const [byPlant, byReason] = await Promise.all([backlogByPlant(db, { plantId }), backlogByReason(db, { plantId })]);
		res.json({
			by_plant: byPlant,
			by_reason: byReason
		});
	});
	app.get("/api/plants", async (_req, res) => {
		const rows = await listPlants(db);
		res.json(rows);
	});
	app.get("/api/misses/:id", async (req, res) => {
		const row = await getMiss(db, req.params.id);
		if (!row) {
			res.status(404).json({ error: "not found" });
			return;
		}
		res.json(row);
	});
	app.patch("/api/misses/:id/reason", express.json({ limit: "16kb" }), async (req, res) => {
		const userEmail = getCurrentUserEmail(req);
		const reasonCode = strParam(req.body?.reasonCode);
		if (!reasonCode || !await isActiveReasonCode(db, reasonCode)) {
			res.status(400).json({ error: "reasonCode must be an active code from the reason-code catalog (GET /api/reason-codes)" });
			return;
		}
		const rawNotes = req.body?.notes;
		const notes = typeof rawNotes === "string" && rawNotes.length > 0 ? rawNotes.slice(0, 4e3) : void 0;
		const result = await updateMissReason(db, {
			id: req.params.id,
			userEmail,
			reasonCode,
			notes
		});
		res.json(result);
	});
	app.post("/api/misses/:id/corrective-action", express.json({ limit: "32kb" }), async (req, res) => {
		const userEmail = getCurrentUserEmail(req);
		const actionDesc = strParam(req.body?.actionDesc);
		const owner = strParam(req.body?.owner);
		const implementationDate = strParam(req.body?.implementationDate);
		const caStatusRaw = strParam(req.body?.caStatus);
		const caStatus = caStatusRaw && VALID_CA_STATUS.includes(caStatusRaw) ? caStatusRaw : "planned";
		if (!actionDesc || !owner || !implementationDate) {
			res.status(400).json({ error: "actionDesc, owner, and implementationDate are required" });
			return;
		}
		const result = await assignCorrectiveActionSingle(db, {
			id: req.params.id,
			userEmail,
			actionDesc,
			owner,
			implementationDate,
			caStatus
		});
		res.json(result);
	});
	app.post("/api/misses/:id/resolve", express.json({ limit: "16kb" }), async (req, res) => {
		const userEmail = getCurrentUserEmail(req);
		const rawNote = req.body?.note;
		const note = typeof rawNote === "string" && rawNote.length > 0 ? rawNote.slice(0, 4e3) : void 0;
		const result = await resolveMiss(db, {
			id: req.params.id,
			userEmail,
			note
		});
		if (!result) {
			res.status(409).json({ error: "Only a miss with status \"action assigned\" can be resolved — assign a corrective action first." });
			return;
		}
		res.json(result);
	});
	app.get("/api/corrective-actions", async (req, res) => {
		const rows = await correctiveActionTracker(db, { limit: intParam(req.query.limit, 500, 2e3) });
		res.json(rows);
	});
	app.get("/api/reason-codes", async (req, res) => {
		const rows = await listReasonCodes(db, { includeInactive: parseBool(req.query.includeInactive) ?? false });
		res.json(rows);
	});
	app.post("/api/reason-codes", express.json({ limit: "16kb" }), async (req, res) => {
		const code = strParam(req.body?.code)?.trim();
		if (!code || code.length > 80) {
			res.status(400).json({ error: "code is required (max 80 characters)" });
			return;
		}
		const description = strParam(req.body?.description)?.slice(0, 500);
		const sortOrderRaw = Number(req.body?.sortOrder);
		const row = await createReasonCode(db, {
			code,
			description,
			sortOrder: Number.isFinite(sortOrderRaw) ? sortOrderRaw : void 0
		});
		if (!row) {
			res.status(409).json({ error: `Reason code "${code}" already exists.` });
			return;
		}
		res.status(201).json(row);
	});
	app.patch("/api/reason-codes/:code", express.json({ limit: "16kb" }), async (req, res) => {
		const newCode = strParam(req.body?.newCode)?.trim();
		if (newCode !== void 0 && newCode.length > 80) {
			res.status(400).json({ error: "newCode must be 80 characters or fewer" });
			return;
		}
		const row = await updateReasonCode(db, {
			code: req.params.code,
			newCode,
			description: strParam(req.body?.description)?.slice(0, 500),
			active: parseBool(req.body?.active)
		});
		if (!row) {
			res.status(409).json({ error: `Could not update "${req.params.code}" — it no longer exists, or the new name is already taken.` });
			return;
		}
		res.json(row);
	});
	app.delete("/api/reason-codes/:code", async (req, res) => {
		const row = await updateReasonCode(db, {
			code: req.params.code,
			active: false
		});
		if (!row) {
			res.status(404).json({ error: `Reason code "${req.params.code}" not found.` });
			return;
		}
		res.json(row);
	});
}

//#endregion
export { registerReturnsRoutes };