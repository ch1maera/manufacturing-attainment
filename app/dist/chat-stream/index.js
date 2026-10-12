import { getCurrentUserEmail } from "../lib/user.js";
import { appendMessage, renameConversationIfDefault } from "../db/queries/chat.js";
import "../db/queries/index.js";
import { sseError } from "./sse.js";
import { streamAgentTurn } from "./agent-stream.js";

//#region server/chat-stream/index.ts
/**
* /api/chat/stream entry point.
*
* Drives the OpenAI Agents SDK loop in agent-stream.ts. The agent's
* `ask_mas` tool is what reaches the configured Databricks data backend
* (MAS endpoint OR Genie space — see refundops.ts dispatcher).
*
* Robustness:
*   1. Persist the user message FIRST so a crash mid-stream still leaves
*      the user's text on a page reload.
*   2. Sanitize history: drop empty content rows + non-user/assistant
*      roles. The Responses API rejects empty `output_text` items with
*      a misleading 502.
*   3. After the stream ends (success OR error) persist an assistant
*      row with finalText / errorText so reload shows what happened.
*/
async function handleChatStream(args) {
	const { req, res, db, config } = args;
	res.setHeader("Content-Type", "text/event-stream");
	res.setHeader("Cache-Control", "no-cache");
	res.setHeader("Connection", "keep-alive");
	res.setHeader("X-Accel-Buffering", "no");
	const turnAbort = new AbortController();
	res.on("close", () => {
		if (!res.writableEnded) {
			console.debug("[chat-stream] client disconnected → aborting agent run");
			turnAbort.abort();
		}
	});
	const userEmail = getCurrentUserEmail(req);
	const conversationId = req.body?.conversationId ?? null;
	const messages = req.body?.messages ?? [];
	if (conversationId && messages.length > 0) {
		const last = messages[messages.length - 1];
		if (last?.role === "user" && typeof last.content === "string") try {
			await appendMessage(db, conversationId, "user", last.content);
			await renameConversationIfDefault(db, conversationId, last.content.slice(0, 48) + (last.content.length > 48 ? "…" : ""));
		} catch (e) {
			const cause = e.cause;
			console.error("[db] persist user message failed", {
				drizzle_message: e.message,
				pg_code: cause?.code,
				pg_detail: cause?.detail,
				pg_hint: cause?.hint,
				pg_schema: cause?.schema,
				pg_table: cause?.table,
				pg_column: cause?.column,
				pg_message: cause?.message
			});
			sseError(res, `Your last message couldn't be saved (${cause?.code ?? "db error"}). The agent will reply but a page reload won't show it.`);
		}
	}
	const host = (process.env.DATABRICKS_HOST ?? "").replace(/\/$/, "");
	if (!host) {
		sseError(res, "DATABRICKS_HOST not set");
		res.write("data: [DONE]\n\n");
		res.end();
		return;
	}
	const cleanMessages = messages.filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim().length > 0);
	const lastClean = cleanMessages[cleanMessages.length - 1];
	if (!lastClean || lastClean.role !== "user") {
		sseError(res, "Empty message — please type something before sending.");
		res.write("data: [DONE]\n\n");
		res.end();
		return;
	}
	let out;
	try {
		out = await streamAgentTurn({
			db,
			req,
			res,
			userEmail,
			masEndpointName: config.masEndpointName,
			databricksHost: host,
			model: config.agentModel ?? "databricks-gpt-5-4",
			messages: cleanMessages,
			signal: turnAbort.signal
		});
	} catch (e) {
		const err = e;
		console.error("[chat-stream] streamAgentTurn threw uncaught", {
			name: err.name,
			message: err.message,
			stack: err.stack
		});
		const friendly = `Agent crashed: ${err.message || err.name || "unknown error"}`;
		sseError(res, friendly);
		out = {
			finalText: null,
			traceId: null,
			thinking: [],
			error: friendly,
			canceled: false,
			modelError: null
		};
	}
	let finalText = out.finalText;
	const traceId = out.traceId;
	const thinking = out.thinking;
	let errorText = out.error;
	const canceled = out.canceled;
	if (!finalText?.trim() && !errorText && !canceled) {
		const me = out.modelError;
		const fallback = me ? `Upstream model error ${me.code ?? `HTTP ${me.status}`}: ${me.message ?? me.bodyText.slice(0, 300)}` : "The agent finished without producing a response. This usually means an upstream tool returned no usable output. Check the server logs for the turn that just ran.";
		console.error("═══════════════════════════════════════════════════════════════");
		console.error("[chat-stream] EMPTY TURN — agent produced no response");
		console.error("  conversation_id:", conversationId);
		console.error("  user_message:", JSON.stringify(lastClean.content).slice(0, 200));
		console.error("  thinking_entries:", thinking.length);
		console.error("  thinking_kinds:", thinking.map((t) => t.kind).join(", ") || "(none)");
		if (me) {
			console.error("  upstream_status:", me.status);
			console.error("  upstream_url:", me.url);
			console.error("  upstream_code:", me.code);
			console.error("  upstream_message:", me.message);
			console.error("  upstream_body:", me.bodyText.slice(0, 2e3));
		} else if (thinking.length > 0) console.error("  thinking_dump:", JSON.stringify(thinking, null, 2).slice(0, 4e3));
		else {
			console.error("  ⚠ NO tool calls, NO reasoning, NO captured HTTP error.");
			console.error("  Likely causes: (1) model returned 200 with empty body, (2) system prompt forbids tool use, (3) the conversation history triggered a refusal.");
		}
		console.error("═══════════════════════════════════════════════════════════════");
		errorText = fallback;
		sseError(res, fallback);
	}
	if (conversationId && (finalText && finalText.trim().length > 0 || errorText || canceled)) try {
		await appendMessage(db, conversationId, "assistant", finalText ?? "", traceId ?? void 0, thinking, errorText ?? void 0, canceled);
	} catch (e) {
		const cause = e.cause;
		console.error("[db] persist assistant message failed", {
			drizzle_message: e.message,
			pg_code: cause?.code,
			pg_detail: cause?.detail,
			pg_hint: cause?.hint,
			pg_message: cause?.message
		});
		sseError(res, `Reply wasn't saved (${cause?.code ?? "db error"}). It's visible now but won't survive reload.`);
	}
	if (!res.writableEnded && !res.destroyed) {
		res.write("data: [DONE]\n\n");
		res.end();
	}
}

//#endregion
export { handleChatStream };