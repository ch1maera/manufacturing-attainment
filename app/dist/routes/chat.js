import { postMlflowAssessment } from "../lib/mlflow.js";
import { getCurrentUserEmail } from "../lib/user.js";
import { createConversation, deleteConversation, getConversationWithMessages, getMessageById, getOrCreateDockConversation, insertFeedback, listConversations } from "../db/queries/chat.js";
import "../db/queries/index.js";
import { handleChatStream } from "../chat-stream/index.js";
import express from "express";

//#region server/routes/chat.ts
function registerChatRoutes(app, deps) {
	const { db, appConfig } = deps;
	app.get("/api/conversations", async (req, res) => {
		const rows = await listConversations(db, getCurrentUserEmail(req));
		res.json(rows);
	});
	app.get("/api/dock-conversation", async (req, res) => {
		const convo = await getOrCreateDockConversation(db, getCurrentUserEmail(req));
		res.json(convo);
	});
	app.post("/api/conversations", express.json(), async (req, res) => {
		const convo = await createConversation(db, getCurrentUserEmail(req), req.body?.title ?? "New conversation");
		res.json(convo);
	});
	app.get("/api/conversations/:id", async (req, res) => {
		const result = await getConversationWithMessages(db, getCurrentUserEmail(req), req.params.id);
		if (!result) {
			res.status(404).json({ error: "not found" });
			return;
		}
		res.json(result);
	});
	app.delete("/api/conversations/:id", async (req, res) => {
		if (!await deleteConversation(db, getCurrentUserEmail(req), req.params.id)) {
			res.status(404).json({ error: "not found" });
			return;
		}
		res.json({ ok: true });
	});
	app.post("/api/chat/stream", express.json(), async (req, res) => {
		await handleChatStream({
			req,
			res,
			db,
			config: appConfig
		});
	});
	app.post("/api/messages/:id/feedback", express.json(), async (req, res) => {
		const userEmail = getCurrentUserEmail(req);
		const value = req.body?.value ?? null;
		const rationale = req.body?.rationale ?? void 0;
		if (value !== "up" && value !== "down") {
			res.status(400).json({ error: "value must be \"up\" or \"down\"" });
			return;
		}
		const msg = await getMessageById(db, req.params.id);
		if (!msg) {
			res.status(404).json({ error: "message not found" });
			return;
		}
		let mlflowAssessmentId = null;
		const host = (process.env.DATABRICKS_HOST ?? "").replace(/\/$/, "");
		if (msg.traceId && host) mlflowAssessmentId = await postMlflowAssessment({
			req,
			host,
			traceId: msg.traceId,
			userEmail,
			value,
			rationale
		});
		const row = await insertFeedback(db, {
			messageId: req.params.id,
			userEmail,
			value,
			rationale,
			traceId: msg.traceId,
			mlflowAssessmentId
		});
		res.json({
			ok: true,
			id: row.id,
			mlflowAssessmentId
		});
	});
}

//#endregion
export { registerChatRoutes };