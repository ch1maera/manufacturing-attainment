import { conversations, feedback, messages } from "../schema.js";
import { and, asc, desc, eq, sql } from "drizzle-orm";

//#region server/db/queries/chat.ts
async function listConversations(db, userEmail) {
	return db.select({
		id: conversations.id,
		title: conversations.title,
		createdAt: conversations.createdAt,
		updatedAt: conversations.updatedAt
	}).from(conversations).where(eq(conversations.userEmail, userEmail)).orderBy(desc(conversations.updatedAt));
}
async function createConversation(db, userEmail, title) {
	return (await db.insert(conversations).values({
		userEmail,
		title
	}).returning())[0];
}
/**
* Get-or-create the single persistent conversation for the floating chat
* dock, scoped to the current user. One `kind='demo_dock'` row per user.
*/
async function getOrCreateDockConversation(db, userEmail) {
	const existing = await db.select().from(conversations).where(and(eq(conversations.userEmail, userEmail), eq(conversations.kind, "demo_dock"))).limit(1);
	if (existing[0]) return existing[0];
	return (await db.insert(conversations).values({
		userEmail,
		title: "Assistant",
		kind: "demo_dock"
	}).returning())[0];
}
async function getConversationWithMessages(db, userEmail, id) {
	const convo = (await db.select().from(conversations).where(and(eq(conversations.id, id), eq(conversations.userEmail, userEmail))))[0];
	if (!convo) return null;
	const msgs = await db.select().from(messages).where(eq(messages.conversationId, id)).orderBy(asc(messages.position), asc(messages.createdAt));
	return {
		...convo,
		messages: msgs
	};
}
async function deleteConversation(db, userEmail, id) {
	return (await db.delete(conversations).where(and(eq(conversations.id, id), eq(conversations.userEmail, userEmail))).returning({ id: conversations.id })).length > 0;
}
async function appendMessage(db, conversationId, role, content, traceId, thinking, error, canceled) {
	const thinkingJson = JSON.stringify(thinking ?? []);
	const MAX_ATTEMPTS = 5;
	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) try {
		return await db.transaction(async (tx) => {
			const rows = await tx.execute(sql`
          INSERT INTO app.messages (conversation_id, role, content, position, trace_id, thinking, error, canceled)
          SELECT
            ${conversationId}::uuid,
            ${role},
            ${content},
            COALESCE((SELECT MAX(position) FROM app.messages WHERE conversation_id = ${conversationId}::uuid), -1) + 1,
            ${traceId ?? null},
            ${thinkingJson}::jsonb,
            ${error ?? null},
            ${canceled ?? false}
          RETURNING id, position
        `);
			await tx.update(conversations).set({ updatedAt: /* @__PURE__ */ new Date() }).where(eq(conversations.id, conversationId));
			return rows.rows[0];
		});
	} catch (e) {
		if ((e.cause?.code ?? e.code) === "23505" && /messages_convo_pos_uq/.test(e.message ?? "") && attempt < MAX_ATTEMPTS) continue;
		throw e;
	}
	throw new Error("appendMessage: exhausted retries");
}
async function renameConversationIfDefault(db, id, title) {
	await db.update(conversations).set({ title }).where(and(eq(conversations.id, id), eq(conversations.title, "New conversation")));
}
async function getMessageById(db, id) {
	return (await db.select().from(messages).where(eq(messages.id, id)))[0] ?? null;
}
async function insertFeedback(db, args) {
	return (await db.insert(feedback).values({
		messageId: args.messageId,
		userEmail: args.userEmail,
		value: args.value,
		rationale: args.rationale,
		traceId: args.traceId ?? null,
		mlflowAssessmentId: args.mlflowAssessmentId ?? null
	}).returning())[0];
}

//#endregion
export { appendMessage, createConversation, deleteConversation, getConversationWithMessages, getMessageById, getOrCreateDockConversation, insertFeedback, listConversations, renameConversationIfDefault };