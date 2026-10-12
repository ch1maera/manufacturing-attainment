import { buildAgent, configureAgentsSdk, run } from "../agent/refundops.js";
import { fixMojibake } from "../lib/endpoint.js";
import { sseError, sseWrite } from "./sse.js";
import * as mlflow from "mlflow-tracing";

//#region server/chat-stream/agent-stream.ts
/**
* Drive the OpenAI Agents SDK loop and emit SSE events.
*
* The agent runs against Databricks' Foundation Model serving via the
* OpenAI-compatible interface (configured in refundops.ts → configureAgentsSdk).
*
* We tap THREE event sources from the SDK and translate them to our SSE
* taxonomy:
*
*   1. SDK-normalized text deltas (`output_text_delta`)
*      → SSE `response.output_text.delta`
*      Works for BOTH Responses-API and Chat-Completions models. This is
*      our primary path; we don't read the duplicate `model`-wrapper event.
*
*   2. Responses-API reasoning summaries (Sonnet/GPT5/etc. with reasoning)
*      → SSE `response.reasoning_summary_text.{delta,done}`
*      Only fires when the model is configured with reasoning. Chat-
*      completions models simply don't emit these.
*
*   3. SDK-level tool events (`tool_called`, `tool_output`)
*      → SSE `response.output_item.done` (function_call / function_call_output)
*      Plus our own `ctx.onToolProgress` for sub-agent activity bubbled up
*      from inside `ask_mas` (MAS sub-agents, Genie reasoning traces).
*
* The persisted `thinking` trail mirrors the SSE events so reload shows
* "▸ Reasoning · N tools" with the same content the user saw live.
*
* Error handling:
*   - The OpenAI SDK strips response bodies before throwing, so we install
*     a fetch shim in refundops.ts that captures the body to ctx.modelError.
*     The catch block below prefers that detail over the SDK's stripped
*     "400 status code (no body)" — what reaches the user is actionable.
*   - Whatever we put into the SSE `error` event is what the chat bubble
*     renders in its red panel (see useChatTurn → onError → patchLast).
*/
async function streamAgentTurn(args) {
	const { res, messages, signal } = args;
	const lastUser = messages[messages.length - 1];
	const userInput = lastUser?.role === "user" ? lastUser.content : "";
	let finalText = "";
	let reasoningBuffer = "";
	let traceId = null;
	let caughtError = null;
	let caughtCanceled = false;
	const thinking = [];
	let sawToolOutput = false;
	let sawFinalDelta = false;
	let runStartMs = 0;
	return await mlflow.withSpan(async (rootSpan) => {
		traceId = rootSpan.traceId ?? null;
		const modelError = { current: null };
		try {
			const ctx = {
				db: args.db,
				userEmail: args.userEmail,
				req: args.req,
				masEndpointName: args.masEndpointName,
				databricksHost: args.databricksHost,
				model: args.model,
				modelError,
				onToolProgress: (ev) => {
					if (ev.kind === "mas_tool_call") {
						thinking.push({
							kind: "tool_call",
							callId: ev.callId,
							name: `mas:${ev.subAgent}`,
							args: JSON.stringify({ query: ev.query })
						});
						sseWrite(res, {
							type: "response.output_item.done",
							item: {
								type: "function_call",
								call_id: ev.callId,
								name: `mas:${ev.subAgent}`,
								arguments: JSON.stringify({ query: ev.query })
							}
						});
					} else if (ev.kind === "mas_tool_output") {
						thinking.push({
							kind: "tool_output",
							callId: ev.callId,
							output: ev.snippet
						});
						sseWrite(res, {
							type: "response.output_item.done",
							item: {
								type: "function_call_output",
								call_id: ev.callId,
								output: ev.snippet
							}
						});
					} else if (ev.kind === "mas_narration") {
						thinking.push({
							kind: "intermediate_message",
							text: ev.text
						});
						sseWrite(res, {
							type: "response.reasoning_summary_text.done",
							text: ev.text
						});
					}
				}
			};
			await configureAgentsSdk(ctx);
			const agent = buildAgent(ctx);
			const history = messages.filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim().length > 0).map((m) => m.role === "assistant" ? {
				role: "assistant",
				content: [{
					type: "output_text",
					text: m.content
				}]
			} : {
				role: "user",
				content: m.content
			});
			const runInput = history.length > 1 ? history : userInput;
			runStartMs = Date.now();
			const roleSeq = Array.isArray(runInput) ? runInput.map((m) => m.role).join(",") : "single-string";
			console.debug(`[agent-stream] runAgent start — history_len=${messages.length} filtered_len=${Array.isArray(runInput) ? runInput.length : 1} input_chars=${userInput.length} roles=[${roleSeq}]`);
			const stream = await run(agent, runInput, {
				stream: true,
				signal
			});
			console.debug(`[agent-stream] runAgent returned stream in ${Date.now() - runStartMs}ms`);
			for await (const ev of stream) {
				if (ev.type === "raw_model_stream_event") {
					const data = ev.data;
					if (data.type === "output_text_delta" && typeof data.delta === "string" && data.delta.length > 0) {
						const delta = fixMojibake(data.delta);
						if (!sawFinalDelta) {
							sawFinalDelta = true;
							console.debug(`[agent-stream] first final-answer delta at +${Date.now() - runStartMs}ms`);
						}
						finalText += delta;
						sseWrite(res, {
							type: "response.output_text.delta",
							delta
						});
						continue;
					}
					const inner = data.type === "model" ? data.event ?? data : data;
					const t = inner.type;
					if (t === "response.reasoning_summary_text.delta" && inner.delta) {
						const delta = fixMojibake(inner.delta);
						reasoningBuffer += delta;
						sseWrite(res, {
							type: "response.reasoning_summary_text.delta",
							delta
						});
					} else if (t === "response.reasoning_summary_text.done") {
						const text = inner.text ?? reasoningBuffer;
						if (text) thinking.push({
							kind: "intermediate_message",
							text
						});
						reasoningBuffer = "";
						sseWrite(res, {
							type: "response.reasoning_summary_text.done",
							text
						});
					}
					continue;
				}
				if (ev.type === "run_item_stream_event") {
					const raw = ev.item.rawItem;
					if (!raw) continue;
					if (ev.name === "tool_called" && raw.type === "function_call") {
						thinking.push({
							kind: "tool_call",
							callId: raw.callId ?? "",
							name: raw.name ?? "",
							args: raw.arguments ?? ""
						});
						sseWrite(res, {
							type: "response.output_item.done",
							item: {
								type: "function_call",
								call_id: raw.callId ?? "",
								name: raw.name ?? "",
								arguments: raw.arguments ?? ""
							}
						});
					} else if (ev.name === "tool_output") {
						sawToolOutput = true;
						console.debug(`[agent-stream] tool_output received at +${Date.now() - runStartMs}ms (name=${raw.name ?? "?"})`);
						const out = typeof raw.output === "string" ? raw.output : JSON.stringify(raw.output);
						thinking.push({
							kind: "tool_output",
							callId: raw.callId ?? "",
							output: out
						});
						sseWrite(res, {
							type: "response.output_item.done",
							item: {
								type: "function_call_output",
								call_id: raw.callId ?? "",
								output: out
							}
						});
					}
				}
			}
			await stream.completed;
			console.debug(`[agent-stream] runAgent completed — finalText_len=${finalText.length}, thinking=${thinking.length}, saw_final_delta=${sawFinalDelta}, saw_tool_output=${sawToolOutput}, elapsed_ms=${runStartMs ? Date.now() - runStartMs : 0}`);
			rootSpan.setOutputs({ final_text: finalText });
			sseWrite(res, {
				type: "response.completed",
				databricks_output: traceId ? { trace: { info: { trace_id: traceId } } } : void 0
			});
		} catch (e) {
			const err = e;
			if (signal?.aborted || err.name === "AbortError") {
				console.debug(`[agent-stream] aborted at +${runStartMs ? Date.now() - runStartMs : 0}ms (finalText_len=${finalText.length}, thinking=${thinking.length})`);
				caughtCanceled = true;
				return {
					finalText: finalText || null,
					traceId,
					thinking,
					error: null,
					canceled: true,
					modelError: modelError.current
				};
			}
			rootSpan.setStatus(mlflow.SpanStatusCode.ERROR);
			const dump = {
				name: err.name,
				message: err.message,
				status: err.status,
				code: err.code,
				request_id: err.request_id,
				headers: err.headers,
				response_status: err.response?.status,
				response_body: err.response?.body,
				error_body: err.error,
				cause: err.cause instanceof Error ? {
					name: err.cause.name,
					message: err.cause.message,
					stack: err.cause.stack,
					code: err.cause.code,
					cause: err.cause.cause
				} : err.cause,
				stack: err.stack,
				finalText_len: finalText.length,
				thinking_count: thinking.length,
				saw_tool_output: sawToolOutput,
				saw_final_delta: sawFinalDelta,
				elapsed_ms: runStartMs ? Date.now() - runStartMs : null
			};
			console.error("[agent-stream] ERROR", JSON.stringify(dump, null, 2));
			const detail = modelError.current;
			if (detail) caughtError = detail.message ? `${detail.code ?? `HTTP ${detail.status}`}: ${detail.message}` : `HTTP ${detail.status} from ${detail.url}: ${detail.bodyText.slice(0, 500)}`;
			else caughtError = err.message || "Unknown error";
			sseError(res, caughtError);
		}
		return {
			finalText: finalText || null,
			traceId,
			thinking,
			error: caughtError,
			canceled: caughtCanceled,
			modelError: modelError.current
		};
	}, {
		name: "refundops.turn",
		spanType: mlflow.SpanType.AGENT,
		inputs: {
			user_input: userInput,
			history_len: messages.length
		}
	});
}

//#endregion
export { streamAgentTurn };