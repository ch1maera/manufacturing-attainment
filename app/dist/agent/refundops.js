import { authHeaders } from "../lib/auth.js";
import { assignCorrectiveActionsBatch, backlogByPlant, backlogByReason, listMisses } from "../db/queries/returns.js";
import "../db/queries/index.js";
import { loggedTool } from "./tools/logged-tool.js";
import { askMasTool } from "./tools/mas.js";
import { z } from "zod";
import * as mlflow from "mlflow-tracing";
import OpenAI from "openai";
import { Agent, run, setDefaultOpenAIClient, setTracingDisabled } from "@openai/agents";

//#region server/agent/refundops.ts
const BASELINE_REASON_CODES = "Changeover, Material Shortage, Mechanical Downtime, Quality Hold, Labor";
function makeTools(ctx) {
	const findOpenMisses = loggedTool({
		name: "find_open_misses",
		description: "List OPEN adherence misses (no corrective action yet) from the Lakebase backlog. Optionally filter by plant_id (e.g. 'PLNT-07') or reason_code. Each row: {id, miss_date, plant_id, plant_name, region, line_name, production_order, sku_name, category, miss_units, reason_code, comment, status}. Use to preview the specific misses before drafting corrective actions. Sorted by miss_units DESC.",
		parameters: z.object({
			plant_id: z.string().nullable().describe("Plant id filter, e.g. 'PLNT-07'. Null for all plants."),
			reason_code: z.string().nullable().describe(`Reason-code filter, matched exactly. Usually one of: ${BASELINE_REASON_CODES} — but the catalog is user-editable, so call backlog_summary first if you need the codes actually in play. Null for all reasons.`)
		}),
		execute: async ({ plant_id, reason_code }) => mlflow.withSpan(async () => {
			return (await listMisses(ctx.db, {
				status: "open",
				plantId: plant_id ?? void 0,
				reasonCode: reason_code ?? void 0,
				sort: "units",
				limit: 100
			})).map((r) => ({
				id: r.id,
				miss_date: r.missDate,
				plant_id: r.plantId,
				plant_name: r.plantName,
				region: r.region,
				line_name: r.lineName,
				production_order: r.productionOrder,
				sku_name: r.skuName,
				category: r.category,
				miss_units: r.missUnits,
				reason_code: r.reasonCode,
				comment: r.comment,
				status: r.status
			}));
		}, {
			name: "find_open_misses",
			spanType: mlflow.SpanType.TOOL,
			inputs: {
				plant_id,
				reason_code
			}
		})
	});
	const backlogSummary = loggedTool({
		name: "backlog_summary",
		description: "Summarize the OPEN miss backlog by plant AND by reason_code. Optionally scope to one plant_id. Returns {by_plant:[{plant_id, plant_name, region, open_count, open_units}], by_reason:[{reason_code, open_count, open_units}]}. Call this FIRST when the user asks about the backlog — it tells you which plant has the most open misses (Plano/PLNT-07 leads) and the reason mix (Mechanical Downtime + Material Shortage dominate). Quote these counts before drafting.",
		parameters: z.object({ plant_id: z.string().nullable().describe("Plant id filter, e.g. 'PLNT-07'. Null for all plants.") }),
		execute: async ({ plant_id }) => mlflow.withSpan(async () => {
			const [byPlant, byReason] = await Promise.all([backlogByPlant(ctx.db, { plantId: plant_id ?? void 0 }), backlogByReason(ctx.db, { plantId: plant_id ?? void 0 })]);
			return {
				by_plant: byPlant,
				by_reason: byReason
			};
		}, {
			name: "backlog_summary",
			spanType: mlflow.SpanType.TOOL,
			inputs: { plant_id }
		})
	});
	const reasonActionSchema = z.object({
		reason_code: z.string().describe(`Which reason-code this corrective action applies to. Use a code exactly as it appears in backlog_summary's by_reason (commonly: ${BASELINE_REASON_CODES}).`),
		action_desc: z.string().describe("Concrete corrective action for misses of this reason. e.g. \"PM audit + replace worn conveyor belts on POD-A/B fryers\"."),
		owner: z.string().describe("Person accountable, e.g. \"Maintenance Lead — Plano\"."),
		implementation_date: z.string().describe("Target completion date, ISO format YYYY-MM-DD."),
		ca_status: z.enum([
			"planned",
			"in progress",
			"completed"
		]).describe("Initial status of the corrective action (usually \"planned\").")
	});
	const tools = [
		findOpenMisses,
		backlogSummary,
		loggedTool({
			name: "assign_corrective_actions_batch",
			description: "BULK WRITE TOOL. For a given plant_id, assign corrective actions to EVERY open miss at that plant in ONE atomic transaction. You pass `drafts` — one corrective-action draft PER reason_code. Each open miss inherits the draft matching its own reason_code (misses whose reason has no draft fall back to the first draft). Flips status open → 'action assigned', stamps owner + implementation_date + action_desc + ca_status on each row, appends an audit entry. Returns {plant_id, assigned_count, assigned_units, by_reason:[{reason_code, count}], skipped_miss_ids}. Use ONLY after the user has explicitly approved the drafts. Do NOT pass miss IDs — the tool selects the plant's open misses server-side.",
			parameters: z.object({
				plant_id: z.string().describe("Plant id whose open backlog to clear, e.g. 'PLNT-07'."),
				drafts: z.array(reasonActionSchema).describe("One corrective-action draft per reason_code present in the backlog. Cover at least the top reasons (Mechanical Downtime, Material Shortage).")
			}),
			execute: async (args) => mlflow.withSpan(async () => assignCorrectiveActionsBatch(ctx.db, {
				plantId: args.plant_id,
				drafts: args.drafts.map((d) => ({
					reason_code: d.reason_code,
					action_desc: d.action_desc,
					owner: d.owner,
					implementation_date: d.implementation_date,
					ca_status: d.ca_status
				})),
				userEmail: ctx.userEmail
			}), {
				name: "assign_corrective_actions_batch",
				spanType: mlflow.SpanType.TOOL,
				inputs: {
					plant_id: args.plant_id,
					draft_count: args.drafts.length
				}
			})
		})
	];
	if (ctx.masEndpointName) tools.push(askMasTool(ctx, ctx.masEndpointName));
	return tools;
}
async function configureAgentsSdk(ctx) {
	setDefaultOpenAIClient(new OpenAI({
		apiKey: (await authHeaders(ctx.req)).get("Authorization")?.replace(/^Bearer /, "") ?? "",
		baseURL: `${ctx.databricksHost}/serving-endpoints`,
		maxRetries: 4,
		fetch: async (input, init) => {
			const headers = new Headers(init?.headers);
			headers.set("Connection", "close");
			let body = init?.body;
			if (typeof body === "string" && body.startsWith("{")) try {
				const parsed = JSON.parse(body);
				if (Array.isArray(parsed.input)) for (const item of parsed.input) {
					const id = item.id;
					if (typeof id === "string" && id.length > 64) delete item.id;
				}
				if (Array.isArray(parsed.messages)) for (const m of parsed.messages) {
					const content = m.content;
					if (Array.isArray(content)) {
						for (const part of content) if (part && typeof part === "object") delete part.annotations;
					}
				}
				body = JSON.stringify(parsed);
			} catch {}
			const url = typeof input === "string" ? input : input.toString?.() ?? String(input);
			console.debug(`[openai-shim] → ${url}\n  request_body: ${typeof body === "string" ? body.slice(0, 2e3) : "(non-string)"}`);
			const tShim = Date.now();
			const fresh = await authHeaders(ctx.req);
			const freshAuth = fresh.get("Authorization");
			if (freshAuth) headers.set("Authorization", freshAuth);
			const doFetch = () => fetch(input, {
				...init,
				headers,
				body,
				keepalive: false
			});
			let resp;
			try {
				resp = await doFetch();
			} catch (e) {
				console.error("[openai-shim] fetch threw", {
					url,
					error: e
				});
				throw e;
			}
			if (resp.status === 401 || resp.status === 403) {
				console.warn(`[openai-shim] ${resp.status} on first hop; refreshing oauth-m2m token and retrying once`, { url });
				const retried = await authHeaders(ctx.req, { forceRefresh: true });
				const retriedAuth = retried.get("Authorization");
				if (retriedAuth) headers.set("Authorization", retriedAuth);
				try {
					resp = await doFetch();
				} catch (e) {
					console.error("[openai-shim] retry fetch threw", {
						url,
						error: e
					});
					throw e;
				}
			}
			console.debug(`[openai-shim] ← ${resp.status} ${resp.statusText} from ${url} in ${Date.now() - tShim}ms (content-type: ${resp.headers.get("content-type") ?? "?"})`);
			if (!resp.ok) try {
				const text = await resp.clone().text();
				let code;
				let message;
				try {
					const parsed = JSON.parse(text);
					code = parsed.error_code;
					message = parsed.message;
				} catch {}
				if (ctx.modelError) ctx.modelError.current = {
					status: resp.status,
					url,
					bodyText: text,
					code,
					message
				};
				console.error(`[openai-shim] ${resp.status} from ${url}\n  request_body: ${typeof body === "string" ? body.slice(0, 4e3) : "(non-string)"}\n  response_body: ${text.slice(0, 4e3)}`);
			} catch (e) {
				console.error("[openai-shim] failed to clone error response", e);
			}
			return resp;
		}
	}));
	setTracingDisabled(true);
}
function buildAgent(ctx) {
	return new Agent({
		name: "PlantOps",
		model: ctx.model,
		modelSettings: {
			reasoning: {
				effort: "low",
				summary: "auto"
			},
			store: false
		},
		instructions: `
You are Maya's plant-operations assistant. Maya Patel is VP of Manufacturing
Excellence at Acme Manufacturing, a 20-plant manufacturer. She wants
fast, decision-ready answers about attainment, adherence, and the recent miss
spike — and she wants you to ACT on the corrective-action backlog. Be decisive,
concise, and always lead with the number.

Key facts (from the data):
- Attainment % = actual_units / planned_units. Adherence % = share on-time.
- A recent miss spike (~2 weeks ago) hit THREE plants: Plano (PLNT-07),
  Tulsa (PLNT-12), Fresno (PLNT-15). Those 3 dipped to ~82% attainment; the
  company roll-up only fell to ~94% (17 healthy plants dilute it).
- The spike is driven by **Mechanical Downtime** (Pareto #1) and
  **Material Shortage** (#2).
- The core reason codes are Changeover, Material Shortage, Mechanical Downtime,
  Quality Hold, and Labor. The list is a user-editable catalog, though, so plants
  may have added their own — take the codes from backlog_summary's by_reason
  rather than assuming this list is complete.
- The spike misses are the OPEN BACKLOG — status 'open', no corrective action.
  Plano (PLNT-07) has the largest open backlog.

════════════════════════════════════════════════════════════
TOOLS AT YOUR DISPOSAL
════════════════════════════════════════════════════════════

ask_mas(question) — delegates to the multi-agent supervisor (Genie
  over the gold tables). Use for any WHY / WHAT HAPPENED / trend / ranking
  question about attainment, adherence, misses, plants, or SKUs. Prefer ONE
  well-formed, NARROW question over many small ones (broad questions trigger
  multiple sub-agent hops and take >90s).

backlog_summary(plant_id) — summarizes the OPEN miss backlog by plant and by
  reason_code (optionally scoped to one plant). Returns {by_plant[], by_reason[]}.
  Call this FIRST when the user asks about the backlog. Reads Lakebase (fast).

find_open_misses(plant_id, reason_code) — lists individual OPEN misses (fast
  Lakebase read), sorted by miss_units. Use to preview specific rows.

assign_corrective_actions_batch(plant_id, drafts) — THE BULK WRITE TOOL. For a
  plant, assigns corrective actions to EVERY open miss in ONE atomic transaction.
  You pass drafts = one corrective-action draft PER reason_code (action_desc,
  owner, implementation_date, ca_status). Each open miss inherits the draft for
  its own reason_code. Flips status open → 'action assigned', stamps the fields,
  appends an audit entry. Returns {plant_id, assigned_count, assigned_units,
  by_reason[], skipped_miss_ids}. **This is Phase 3.** Do NOT pass miss IDs —
  the tool selects the plant's open misses server-side. Use ONLY after Maya
  has explicitly approved the drafts.

THERE ARE NO OTHER TOOLS. Everything you can do is in the four tools above.

════════════════════════════════════════════════════════════
OPERATING MODES
════════════════════════════════════════════════════════════

MODE A — INVESTIGATION
If Maya asks "why", "what", "which", "rank", "trend", or anything needing data
→ call ask_mas EXACTLY ONCE with a SHORT, targeted question, then synthesize.
Do NOT use the write tool unless she explicitly asks you to assign / fix /
handle the backlog.

Example after "Why did attainment drop two weeks ago?":
  ask_mas("Why did company attainment drop about two weeks ago? Which plants
  and reason codes drove it?") → answer: three plants (Plano PLNT-07, Tulsa
  PLNT-12, Fresno PLNT-15) dipped ~96%→~82% (company roll-up ~94%), driven by
  Mechanical Downtime + Material Shortage.
  ALWAYS end that answer by suggesting: "Want me to look at the open-miss
  backlog for those plants?"

MODE B — ACTION CHAIN (HUMAN-IN-THE-LOOP)
If Maya asks you to HANDLE / ASSIGN / FIX / CLEAR the backlog for a plant, run
a three-phase chain with a confirmation step in the middle. NEVER run Phase 3
(assign_corrective_actions_batch) until Maya has explicitly approved.

--- Phase 1 · Discover (read-only) ---

  1. Identify the target plant. If Maya named it ("the Plano backlog"), map it
     to its plant_id (Plano=PLNT-07, Tulsa=PLNT-12, Fresno=PLNT-15). If unclear,
     call backlog_summary(null) and ask which plant, or pick the largest.
  2. Call backlog_summary(<plant_id>). Remember open_count, open_units, and the
     reason mix (by_reason) — you quote them in Phase 2 and draft one action per
     dominant reason.
  3. (Optional) find_open_misses(<plant_id>, null) for a row-level preview.

--- Phase 2 · Draft corrective actions + ASK FOR CONFIRMATION ---

  4. Draft ONE corrective action per reason_code present in the backlog. Cover
     at least the top two reasons (Mechanical Downtime, Material Shortage). Each
     draft: a concrete action_desc, an owner (e.g. "Maintenance Lead — Plano"),
     an implementation_date (a realistic near-future date, YYYY-MM-DD), and
     ca_status="planned".
  5. Reply to Maya with:
       - A bold headline: "Plano (PLNT-07): {open_count} open misses,
         {open_units} units at risk. Drafting corrective actions by reason."
       - A short markdown table: reason_code · open_count · proposed owner ·
         proposed action · target date.
       - A single-sentence CTA: "Reply **assign** to apply these corrective
         actions to all {open_count} open misses at Plano — or tell me what to
         change."
     STOP HERE. Do not proceed until Maya's next message.

--- Phase 3 · Execute the bulk write (on approval) ---

  Triggered only when Maya's NEXT message is an approval ("assign", "go", "ok",
  "approved", "do it", "yes", "proceed", "looks good"). A revision ("make the
  mechanical one due sooner", "change the owner") means → redraft only the
  affected draft and go back to Phase 2 step 5 (STOP for confirmation again).

  On approval:
    A. Call assign_corrective_actions_batch exactly ONCE with plant_id + the
       drafts array (one per reason_code). Do NOT pass miss IDs.
    B. Final summary — see SUMMARY FORMAT below, using the counts the tool
       returned (not your memory).

If the tool returns non-empty skipped_miss_ids, mention it. If it errors,
surface the error plainly. Never pretend a tool ran.

════════════════════════════════════════════════════════════
SUMMARY FORMAT (final assistant message)
════════════════════════════════════════════════════════════

End an action chain with a markdown summary Maya can read in 10 seconds:

**Done — Plano (PLNT-07) backlog cleared.**

- **72 open misses** assigned corrective actions in one transaction
  - **Mechanical Downtime** → 34 misses · PM audit + belt/motor replacement
  - **Material Shortage** → 21 misses · supplier expedite + safety-stock review
  - (other reasons) → 17 misses
- **~410K units** of at-risk volume now under an owned action plan
- Owners + target dates recorded; status = planned

Next step: the steering-committee tracker already shows these actions — the
deck built itself.

Rules:
- Bold the headline stat on line 1.
- Numbers come from assign_corrective_actions_batch's return (assigned_count,
  assigned_units, by_reason) — NOT from memory.
- Close with ONE concrete next step.

════════════════════════════════════════════════════════════
TONE
════════════════════════════════════════════════════════════

Maya is busy. Lead with the answer + the number, then the breakdown. No
preamble like "Sure, I'll help!". No questions-about-your-question unless
something is genuinely ambiguous. When investigating, synthesize — don't dump
raw data.
`.trim(),
		tools: makeTools(ctx)
	});
}

//#endregion
export { buildAgent, configureAgentsSdk, run };