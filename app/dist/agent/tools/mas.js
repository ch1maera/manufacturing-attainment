import { authHeaders } from "../../lib/auth.js";
import { loggedTool } from "./logged-tool.js";
import { z } from "zod";
import * as mlflow from "mlflow-tracing";

//#region server/agent/tools/mas.ts
/**
* `ask_mas` — query a Databricks Multi-Agent Supervisor (MAS) endpoint
* from inside the agent loop.
*
* MAS is a Databricks Mosaic Agent Framework supervisor that itself
* routes between sub-agents (data_analyst → Genie, incident_expert → KA
* retrieval, etc.) and returns a single synthesized answer. We POST to
* `/serving-endpoints/<name>/invocations` with `stream:true` and forward
* the supervisor's narration + sub-agent activity to the Thinking panel
* as it arrives — this is the core "watch the agent work" demo moment.
*
* USAGE — registering this tool in your agent:
*
*   import { askMasTool } from './tools/mas.js';
*   ...
*   function makeTools(ctx: AgentContext) {
*     return [
*       askMasTool(ctx, ctx.masEndpointName),
*       // your other tools…
*     ];
*   }
*
* If your demo has BOTH a Genie space AND a MAS endpoint, register
* both this tool AND `askGenieTool` from `./genie.ts` — give them
* distinct names and tell the model in the agent instructions when to
* prefer each.
*/
/**
* Low-level helper: POST to a MAS serving endpoint and stream-forward
* the supervisor + sub-agent events. Exported so tests / alternate tool
* wrappers can reuse it without going through the OpenAI Agents SDK.
*/
async function callMasEndpoint(ctx, endpointName, question) {
	function emit(ev) {
		try {
			ctx.onToolProgress?.(ev);
		} catch (e) {
			console.error("[onToolProgress] callback threw — fix the handler", e);
		}
	}
	const headers = await authHeaders(ctx.req);
	headers.set("Content-Type", "application/json");
	headers.set("Accept", "text/event-stream");
	const abort = AbortSignal.timeout(600 * 1e3);
	const url = `${ctx.databricksHost}/serving-endpoints/${endpointName}/invocations`;
	const resp = await fetch(url, {
		method: "POST",
		headers,
		signal: abort,
		body: JSON.stringify({
			input: [{
				role: "user",
				content: question
			}],
			databricks_options: { return_trace: true },
			stream: true
		})
	});
	if (!resp.ok || !resp.body) {
		const t = await resp.text().catch(() => "");
		console.error("[ask_mas] endpoint bad response", {
			status: resp.status,
			body: t.slice(0, 500)
		});
		return {
			answer: `MAS call failed: HTTP ${resp.status} ${t.slice(0, 300)}`,
			trace_id: null
		};
	}
	console.log("[ask_mas] stream opened, reading events…");
	const reader = resp.body.getReader();
	const dec = new TextDecoder();
	let buf = "";
	let trace_id = null;
	let lastStepText = null;
	const deltaBuf = [];
	let currentSubAgent = null;
	const callSubAgent = /* @__PURE__ */ new Map();
	let lastToolCallId = null;
	try {
		while (true) {
			let chunk;
			try {
				chunk = await reader.read();
			} catch (e) {
				if (e.name === "AbortError") {
					console.error("[ask_mas] stream timed out after 10 minutes");
					return {
						answer: "MAS call timed out after 10 minutes. The supervisor may be stuck on a long sub-agent hop — try a narrower question.",
						trace_id: null
					};
				}
				throw e;
			}
			const { value, done } = chunk;
			if (done) break;
			buf += dec.decode(value, { stream: true });
			const parts = buf.split("\n\n");
			buf = parts.pop() ?? "";
			for (const p of parts) {
				const line = p.split("\n").find((l) => l.startsWith("data: "));
				if (!line) continue;
				const data = line.slice(6);
				if (!data || data === "[DONE]") continue;
				let ev;
				try {
					ev = JSON.parse(data);
				} catch {
					continue;
				}
				if (ev.type === "response.completed") {
					trace_id = ev.databricks_output?.trace?.info?.trace_id ?? trace_id;
					continue;
				}
				if (ev.type === "response.output_text.delta" && typeof ev.delta === "string") {
					deltaBuf.push(ev.delta);
					continue;
				}
				if (ev.type !== "response.output_item.done") continue;
				const item = ev.item;
				if (!item) continue;
				if (item.type === "message" && Array.isArray(item.content)) {
					const text = item.content.find((c) => c?.type === "output_text")?.text;
					if (!text) continue;
					const tagMatch = text.trim().match(/^<name>([^<]+)<\/name>$/);
					if (tagMatch) {
						currentSubAgent = tagMatch[1];
						continue;
					}
					if (typeof ev.step === "number") {
						lastStepText = text;
						emit({
							kind: "mas_narration",
							text
						});
						currentSubAgent = null;
					} else {
						emit({
							kind: "mas_tool_output",
							callId: lastToolCallId ?? `mas-orphan-${Date.now()}`,
							subAgent: currentSubAgent ?? "data",
							snippet: text
						});
						currentSubAgent = null;
					}
				} else if (item.type === "function_call") {
					const subAgent = item.name ?? "data";
					const callId = item.call_id ?? `mas-${Date.now()}-${Math.random()}`;
					callSubAgent.set(callId, subAgent);
					let query = "";
					try {
						const parsed = JSON.parse(item.arguments ?? "{}");
						query = parsed.genie_query || parsed.ka_query || parsed.query || parsed.question || item.arguments || "";
					} catch {
						query = item.arguments ?? "";
					}
					lastToolCallId = callId;
					emit({
						kind: "mas_tool_call",
						callId,
						subAgent,
						query
					});
				} else if (item.type === "function_call_output" && item.call_id) {
					const subAgent = callSubAgent.get(item.call_id) ?? "data";
					const out = item.content?.find((c) => c?.type === "output_text")?.text ?? "";
					emit({
						kind: "mas_tool_output",
						callId: item.call_id,
						subAgent,
						snippet: out
					});
				}
			}
		}
	} finally {
		try {
			reader.releaseLock();
		} catch {}
	}
	const answer = lastStepText || deltaBuf.join("") || "(no answer)";
	console.log(`[ask_mas] stream closed — answer_len=${answer.length}ch trace_id=${trace_id}`);
	return {
		answer,
		trace_id
	};
}
/**
* OpenAI Agents SDK tool wrapper. Closes over `ctx` + `endpointName` so
* the agent only needs to pass the `question`.
*/
function askMasTool(ctx, endpointName) {
	return loggedTool({
		name: "ask_mas",
		description: "Ask an open-ended question that may require SQL data lookups, document/knowledge retrieval, or both. Routes to a Databricks Multi-Agent Supervisor that orchestrates between sub-agents (data_analyst, incident_expert, etc.) and returns a synthesized answer. Use for any \"why\" / \"what happened\" / investigative question.",
		parameters: z.object({ question: z.string().describe("A clear, focused English question. Narrow questions finish in 20–40s; broad multi-part questions can take 90s+ as the supervisor hops between sub-agents.") }),
		execute: async ({ question }) => mlflow.withSpan(async () => callMasEndpoint(ctx, endpointName, question), {
			name: "ask_mas",
			spanType: mlflow.SpanType.TOOL,
			inputs: { question }
		})
	});
}

//#endregion
export { askMasTool };