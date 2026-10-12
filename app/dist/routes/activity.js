import { recentActivity } from "../db/queries/returns.js";
import "../db/queries/index.js";

//#region server/routes/activity.ts
/**
* Unified activity feed — email sends, coupon issuance, return decisions.
* Powers the home-page "Recent activity" list.
*/
function registerActivityRoutes(app, deps) {
	app.get("/api/activity/recent", async (req, res) => {
		const raw = Number(req.query.limit);
		const limit = Number.isFinite(raw) && raw >= 1 ? Math.min(Math.floor(raw), 100) : 20;
		const events = await recentActivity(deps.db, limit);
		res.json(events);
	});
}

//#endregion
export { registerActivityRoutes };