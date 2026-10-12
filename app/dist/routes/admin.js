import { seedReasonCodes } from "../db/seed.js";
import { syncFromDelta, wipeMirroredTables } from "../db/sync.js";

//#region server/routes/admin.ts
function registerAdminRoutes(app, deps) {
	const { db, data } = deps;
	app.post("/api/admin/reset", async (_req, res) => {
		await wipeMirroredTables(db);
		await seedReasonCodes(db);
		if (data) await syncFromDelta(db, data, { forceIfAnyEmpty: true });
		res.json({ ok: true });
	});
}

//#endregion
export { registerAdminRoutes };