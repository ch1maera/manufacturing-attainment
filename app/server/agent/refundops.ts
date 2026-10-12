/**
 * The action-taking agent — this is the DEMO'S DEFINING PIECE.
 *
 * Built on `@openai/agents` (OpenAI Agents SDK) pointed at Databricks'
 * Responses API (`setOpenAIAPI('responses')` lets us stream reasoning
 * summaries alongside final text). Tools capture `db` + `userEmail` via
 * closure so every action is attributed to the viewing user.
 *
 * WHY THIS FILE IS LOAD-BEARING FOR THE TEMPLATE STORY:
 *   The whole pitch is "AI that not only tells you what's wrong, but can
 *   act on it end-to-end, with the human in the loop." That translates to:
 *     1. An investigation tool that delegates to the Databricks
 *        Multi-Agent Supervisor (`ask_mas` → MAS) for open-ended "why"
 *        questions backed by SQL + KA retrieval.
 *     2. Lookup tools that read the local Lakebase mirror (fast OLTP).
 *     3. A *write* tool that mutates state in one transaction.
 *   The agent instructions below are phased deliberately: Mode A for pure
 *   investigation; Mode B for write-intent with a mandatory confirmation
 *   step before anything destructive runs.
 *
 * REPURPOSING: to build a different use case:
 *   - Replace `makeTools(ctx)` with your own tools (Zod-schema'd).
 *   - Rewrite `buildAgent()`'s `instructions` string for your domain.
 *   - Keep `configureAgentsSdk()` as-is — it handles the Databricks
 *     Responses API wiring, the `Connection: close` workaround for stale
 *     sockets, and the 64-char `input[*].id` strip (see comments below).
 *   - The data-backend tool (`ask_mas` here) is registered via the
 *     reusable factories in `agent/tools/{mas,genie}.ts`. Pick the one
 *     that matches your demo:
 *       • MAS only      → use `askMasTool(ctx, ctx.masEndpointName)`
 *       • Genie only    → use `askGenieTool(ctx, ctx.genieSpaceId)`
 *                          (and rename the AgentContext field accordingly)
 *       • Both          → register both factories with distinct names,
 *                          and tell the model in instructions when to
 *                          prefer each.
 *
 * Name: the file is called `refundops` because this use case is refund
 * operations. Rename to match your own agent (e.g. `claimsops`,
 * `billingops`, `supporttriage`) and update the import in
 * `chat-stream/agent-stream.ts`.
 */
import type { Request } from 'express';
import OpenAI from 'openai';
import {
  Agent,
  run,
  setDefaultOpenAIClient,
  setTracingDisabled,
} from '@openai/agents';
import type { Tool } from '@openai/agents';
import { loggedTool as tool } from './tools/logged-tool.js';
import * as mlflow from 'mlflow-tracing';
import { z } from 'zod';
import { authHeaders } from '../lib/auth.js';
import type { AppDb } from '../db/index.js';
import {
  listMisses,
  backlogByPlant,
  backlogByReason,
  assignCorrectiveActionsBatch,
} from '../db/queries/index.js';
// Data-backend tool factories. The template demo uses MAS, but if your
// demo has only a Genie space, swap `askMasTool` → `askGenieTool` and
// update the AgentContext field below (masEndpointName → genieSpaceId).
// If your demo has BOTH, register both tools and tell the model in the
// agent instructions when to prefer each.
import { askMasTool } from './tools/mas.js';
export type { ToolProgressEvent } from './tools/types.js';

/** Captured detail of the last failing call to the model serving endpoint.
 * The OpenAI SDK strips the response body before throwing, so we stash it
 * here from the fetch shim and let the outer catch block read it to build a
 * useful error message for the user. */
export type ModelErrorDetail = {
  status: number;
  url: string;
  bodyText: string;
  /** Parsed `error_code` if the body was Databricks-style JSON. */
  code?: string;
  /** Parsed `message` if the body was Databricks-style JSON. */
  message?: string;
};

export type AgentContext = {
  db: AppDb;
  userEmail: string;
  req: Request;
  /** MAS serving-endpoint name the `ask_mas` tool talks to. Set in
   * `config/app.json` as `masEndpointName`. The template demo uses MAS;
   * if your demo uses Genie instead, replace this field with
   * `genieSpaceId: string` and swap `askMasTool` → `askGenieTool` in
   * makeTools below. See server/agent/tools/{mas,genie}.ts. */
  masEndpointName: string;
  databricksHost: string;
  model: string;
  /** Called by long-running tools to surface progress to the UI. */
  onToolProgress?: (ev: import('./tools/types.js').ToolProgressEvent) => void;
  /** Mutated by the OpenAI fetch shim on any non-2xx so the outer catch
   * block can surface Databricks' actual error_code/message instead of the
   * SDK's stripped "400 status code (no body)". */
  modelError?: { current: ModelErrorDetail | null };
};


// ────────────────────────────────────────────────────────────────────────────
// Adding / editing tools — read this before touching `parameters: z.object(...)`.
//
// The Agents SDK ships every tool's zod schema to the Responses API with
// `strict: true`. Strict mode requires every property to appear in `required`.
// If you write `.optional()` on a field, zod-to-json-schema drops it from
// `required`, OpenAI rejects the schema with a 400, and Databricks' proxy
// masks the 400 as a bare 502 INTERNAL_ERROR — you get no clue what's wrong.
//
//   ❌  reason: z.string().optional()                 // breaks with strict:true
//   ✅  reason: z.string().nullable()                 // field required, value may be null
//   ✅  reason: z.string().nullable().describe('…')
//
// Other gotchas for new tools:
//   • Every `z.object({...})` field needs a `.describe('…')` — the model uses
//     it to decide when/how to call the tool. Missing descriptions = bad calls.
//   • Keep property names snake_case. OpenAI's tool calls sometimes normalize
//     casing and mixing conventions causes subtle argument-parsing bugs.
//   • Don't use `z.union([...])` at the top level of parameters — Responses
//     API strict mode requires a single object schema.
//   • `tool` here is the `loggedTool` wrapper from ./tools/logged-tool.ts: it
//     logs thrown errors via console.error (caught by lib/logger.ts) BEFORE
//     returning the SDK's recovery hint to the model. Don't import the raw
//     `tool` from '@openai/agents' directly — you'll silently lose the logs.
// ────────────────────────────────────────────────────────────────────────────
// Reason codes are NOT a fixed enum: they live in the `app.reason_codes`
// catalog in Lakebase and users add/rename/retire them in-app. So these tool
// params take a free string and lean on the description to steer the model,
// rather than a z.enum that would go stale the moment someone adds a code.
// The seeded baseline below is only for prompting.
const BASELINE_REASON_CODES =
  'Changeover, Material Shortage, Mechanical Downtime, Quality Hold, Labor';

function makeTools(ctx: AgentContext) {
  const findOpenMisses = tool({
    name: 'find_open_misses',
    description:
      "List OPEN adherence misses (no corrective action yet) from the Lakebase backlog. Optionally filter by plant_id (e.g. 'PLNT-07') or reason_code. Each row: {id, miss_date, plant_id, plant_name, region, line_name, production_order, sku_name, category, miss_units, reason_code, comment, status}. Use to preview the specific misses before drafting corrective actions. Sorted by miss_units DESC.",
    parameters: z.object({
      plant_id: z
        .string()
        .nullable()
        .describe("Plant id filter, e.g. 'PLNT-07'. Null for all plants."),
      reason_code: z
        .string()
        .nullable()
        .describe(
          `Reason-code filter, matched exactly. Usually one of: ${BASELINE_REASON_CODES} — but the catalog is user-editable, so call backlog_summary first if you need the codes actually in play. Null for all reasons.`,
        ),
    }),
    execute: async ({ plant_id, reason_code }) =>
      mlflow.withSpan(
        async () => {
          const rows = await listMisses(ctx.db, {
            status: 'open',
            plantId: plant_id ?? undefined,
            reasonCode: reason_code ?? undefined,
            sort: 'units',
            limit: 100,
          });
          return rows.map((r) => ({
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
            status: r.status,
          }));
        },
        {
          name: 'find_open_misses',
          spanType: mlflow.SpanType.TOOL,
          inputs: { plant_id, reason_code },
        },
      ),
  });

  const backlogSummary = tool({
    name: 'backlog_summary',
    description:
      "Summarize the OPEN miss backlog by plant AND by reason_code. Optionally scope to one plant_id. Returns {by_plant:[{plant_id, plant_name, region, open_count, open_units}], by_reason:[{reason_code, open_count, open_units}]}. Call this FIRST when the user asks about the backlog — it tells you which plant has the most open misses (Plano/PLNT-07 leads) and the reason mix (Mechanical Downtime + Material Shortage dominate). Quote these counts before drafting.",
    parameters: z.object({
      plant_id: z
        .string()
        .nullable()
        .describe("Plant id filter, e.g. 'PLNT-07'. Null for all plants."),
    }),
    execute: async ({ plant_id }) =>
      mlflow.withSpan(
        async () => {
          const [byPlant, byReason] = await Promise.all([
            backlogByPlant(ctx.db, { plantId: plant_id ?? undefined }),
            backlogByReason(ctx.db, { plantId: plant_id ?? undefined }),
          ]);
          return { by_plant: byPlant, by_reason: byReason };
        },
        {
          name: 'backlog_summary',
          spanType: mlflow.SpanType.TOOL,
          inputs: { plant_id },
        },
      ),
  });

  const reasonActionSchema = z.object({
    reason_code: z
      .string()
      .describe(
        `Which reason-code this corrective action applies to. Use a code exactly as it appears in backlog_summary's by_reason (commonly: ${BASELINE_REASON_CODES}).`,
      ),
    action_desc: z
      .string()
      .describe(
        'Concrete corrective action for misses of this reason. e.g. "PM audit + replace worn conveyor belts on POD-A/B fryers".',
      ),
    owner: z
      .string()
      .describe('Person accountable, e.g. "Maintenance Lead — Plano".'),
    implementation_date: z
      .string()
      .describe('Target completion date, ISO format YYYY-MM-DD.'),
    ca_status: z
      .enum(['planned', 'in progress', 'completed'])
      .describe('Initial status of the corrective action (usually "planned").'),
  });

  const assignBatch = tool({
    name: 'assign_corrective_actions_batch',
    description:
      "BULK WRITE TOOL. For a given plant_id, assign corrective actions to EVERY open miss at that plant in ONE atomic transaction. You pass `drafts` — one corrective-action draft PER reason_code. Each open miss inherits the draft matching its own reason_code (misses whose reason has no draft fall back to the first draft). Flips status open → 'action assigned', stamps owner + implementation_date + action_desc + ca_status on each row, appends an audit entry. Returns {plant_id, assigned_count, assigned_units, by_reason:[{reason_code, count}], skipped_miss_ids}. Use ONLY after the user has explicitly approved the drafts. Do NOT pass miss IDs — the tool selects the plant's open misses server-side.",
    parameters: z.object({
      plant_id: z
        .string()
        .describe("Plant id whose open backlog to clear, e.g. 'PLNT-07'."),
      drafts: z
        .array(reasonActionSchema)
        .describe(
          'One corrective-action draft per reason_code present in the backlog. Cover at least the top reasons (Mechanical Downtime, Material Shortage).',
        ),
    }),
    execute: async (args) =>
      mlflow.withSpan(
        async () =>
          assignCorrectiveActionsBatch(ctx.db, {
            plantId: args.plant_id,
            drafts: args.drafts.map((d) => ({
              reason_code: d.reason_code,
              action_desc: d.action_desc,
              owner: d.owner,
              implementation_date: d.implementation_date,
              ca_status: d.ca_status,
            })),
            userEmail: ctx.userEmail,
          }),
        {
          name: 'assign_corrective_actions_batch',
          spanType: mlflow.SpanType.TOOL,
          inputs: { plant_id: args.plant_id, draft_count: args.drafts.length },
        },
      ),
  });

  // The data-backend tool → the MAS ("ask_mas"). Skip registration
  // if no endpoint is configured (avoids a POST to /serving-endpoints//invocations).
  const tools: Tool[] = [findOpenMisses, backlogSummary, assignBatch];
  if (ctx.masEndpointName) {
    tools.push(askMasTool(ctx, ctx.masEndpointName));
  }
  return tools;
}

export async function configureAgentsSdk(ctx: AgentContext): Promise<void> {
  // Build a fresh auth header each configure; OpenAI SDK holds the key at
  // client construction time, so we reconfigure per request to pick up a
  // fresh bearer. (setDefaultOpenAIClient is idempotent.)
  const headers = await authHeaders(ctx.req);
  const bearer = headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
  // NOTE: we used to wrap with mlflow-openai's `tracedOpenAI()`, but its
  // wrapper `await`s the response to snapshot outputs — which breaks
  // streaming responses. Skip it; we still get agent-level spans via the
  // root `refundops.turn` and per-tool `withSpan` wrappers.
  //
  // Use a custom fetch that forces a fresh TCP connection per call and
  // disables keep-alive. Without this, after a long-running tool call
  // (ask_mas → MAS takes ~90s), the second Responses API call reuses a
  // stale socket that the Databricks gateway has half-closed, which
  // surfaces as a bare 502 (no headers/body) ~3s into the call. Also bump
  // maxRetries since 502s are transient gateway failures.
  // ──────────────────────────────────────────────────────────────────
  // 64-char input[*].id workaround for Databricks' Responses API
  // ──────────────────────────────────────────────────────────────────
  //
  // Problem:
  //   On the synthesis turn (after a tool output is fed back), the agent
  //   run fails with `502 status code (no body)` after ~3s. The failure
  //   is deterministic, not transient — retries don't help.
  //
  // Root cause:
  //   The @openai/agents SDK assigns long IDs (e.g. `fc_013bda62…` ~190
  //   chars) to `reasoning` and `function_call` items in the conversation
  //   history. On round 2, the SDK echoes those items back in `input[]`.
  //   Databricks' Responses API enforces a 64-char max on `input[*].id`
  //   and returns `400 Invalid 'input[N].id': string too long`. The
  //   streaming gateway then masks that 400 as a bare 502. (Reproduced
  //   by flipping `stream: true` → `stream: false` in `scripts/repro-502.ts`:
  //   the 502 becomes a clean 400 with the real message.)
  //
  // Fix:
  //   Intercept outgoing request bodies and delete any `input[i].id`
  //   longer than 64 chars. Databricks treats missing ids as freshly
  //   generated, so this is safe — the conversation continuity is
  //   carried by `call_id` (short) for function calls, not `id`.
  //
  // Remove this wrapper once Databricks lifts the 64-char limit.
  // ──────────────────────────────────────────────────────────────────
  const client = new OpenAI({
    apiKey: bearer,
    baseURL: `${ctx.databricksHost}/serving-endpoints`,
    maxRetries: 4,
    fetch: async (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set('Connection', 'close');
      let body = init?.body;
      if (typeof body === 'string' && body.startsWith('{')) {
        try {
          const parsed = JSON.parse(body) as {
            input?: Array<Record<string, unknown>>;
            messages?: Array<Record<string, unknown>>;
          };
          // Responses-API: strip long opaque ids the SDK echoes back.
          if (Array.isArray(parsed.input)) {
            for (const item of parsed.input) {
              const id = item.id;
              if (typeof id === 'string' && id.length > 64) {
                delete item.id;
              }
            }
          }
          // Chat-completions: Anthropic-via-Bedrock rejects unknown keys
          // on assistant message content parts. The SDK adds
          // `annotations: []` to text parts when replaying assistant
          // history (turn 2+ of an agent loop). Strip them.
          //   400: "messages.N.content.0.text.annotations: Extra inputs are not permitted"
          if (Array.isArray(parsed.messages)) {
            for (const m of parsed.messages) {
              const content = (m as { content?: unknown }).content;
              if (Array.isArray(content)) {
                for (const part of content as Array<Record<string, unknown>>) {
                  if (part && typeof part === 'object') {
                    delete part.annotations;
                  }
                }
              }
            }
          }
          body = JSON.stringify(parsed);
        } catch {
          /* not JSON — pass through */
        }
      }
      // Always log the URL + status so failures show up in server logs.
      // The OpenAI SDK rethrows non-2xx as `APIError(... no body)` because
      // it consumes the body for retry decisions before we see it. Tee a
      // clone of the body on error so we can log Databricks' actual reason.
      const url =
        typeof input === 'string'
          ? input
          : (input as URL | Request).toString?.() ?? String(input);
      // Log every outgoing request — URL + payload preview. Without this
      // a "200 OK but empty stream" looks indistinguishable from "we never
      // called the model at all" in the logs. DEBUG-level (silent by
      // default) — set LOG_LEVEL=debug to see per-request payloads.
      console.debug(
        `[openai-shim] → ${url}\n  request_body: ${typeof body === 'string' ? body.slice(0, 2000) : '(non-string)'}`,
      );
      const tShim = Date.now();
      const fresh = await authHeaders(ctx.req);
      const freshAuth = fresh.get('Authorization');
      if (freshAuth) headers.set('Authorization', freshAuth);
      const doFetch = () =>
        fetch(input as Parameters<typeof fetch>[0], {
          ...init,
          headers,
          body,
          keepalive: false,
        });
      let resp: Response;
      try {
        resp = await doFetch();
      } catch (e) {
        console.error('[openai-shim] fetch threw', { url, error: e });
        throw e;
      }
      if (resp.status === 401 || resp.status === 403) {
        console.warn(
          `[openai-shim] ${resp.status} on first hop; refreshing oauth-m2m token and retrying once`,
          { url },
        );
        const retried = await authHeaders(ctx.req, { forceRefresh: true });
        const retriedAuth = retried.get('Authorization');
        if (retriedAuth) headers.set('Authorization', retriedAuth);
        try {
          resp = await doFetch();
        } catch (e) {
          console.error('[openai-shim] retry fetch threw', { url, error: e });
          throw e;
        }
      }
      console.debug(
        `[openai-shim] ← ${resp.status} ${resp.statusText} from ${url} in ${Date.now() - tShim}ms (content-type: ${resp.headers.get('content-type') ?? '?'})`,
      );
      if (!resp.ok) {
        try {
          const text = await resp.clone().text();
          let code: string | undefined;
          let message: string | undefined;
          try {
            const parsed = JSON.parse(text) as { error_code?: string; message?: string };
            code = parsed.error_code;
            message = parsed.message;
          } catch {
            /* body wasn't JSON — keep raw text */
          }
          if (ctx.modelError) {
            ctx.modelError.current = {
              status: resp.status,
              url,
              bodyText: text,
              code,
              message,
            };
          }
          console.error(
            `[openai-shim] ${resp.status} from ${url}\n  request_body: ${typeof body === 'string' ? body.slice(0, 4000) : '(non-string)'}\n  response_body: ${text.slice(0, 4000)}`,
          );
        } catch (e) {
          console.error('[openai-shim] failed to clone error response', e);
        }
      }
      return resp;
    },
  });
  setDefaultOpenAIClient(client);
  // Use the Responses API (the SDK's default — we leave setOpenAIAPI alone).
  // This template ships with `databricks-gpt-5-4` as the baseline agent model
  // because it supports both the Responses API passthrough AND the SDK-native
  // `response.reasoning_summary_text.*` event stream (which the UI subscribes to
  // for the live "thinking" panel). A newer GPT endpoint with `/responses`
  // enabled works too — the requirement is the Responses API, not this version.
  //
  // Why not Claude (Sonnet 4.6 etc)? Databricks gates the Responses API
  // route per-model: Anthropic models on FMAPI return 400 BAD_REQUEST on
  // `/serving-endpoints/responses`. They DO work on `chat-completions`, but
  // the OpenAI Agents SDK doesn't surface Anthropic's thinking blocks as
  // typed events on that route, so the live reasoning UI goes silent.
  // Wiring it up (fetch-shim injection of extra_body.thinking + parse the
  // chunk stream → emit synthetic reasoning_summary_text events) is doable
  // but ~60-100 lines we haven't written. For now: GPT-5-4 only.
  setTracingDisabled(true); // disable OpenAI's tracing backend; we use MLflow
}

export function buildAgent(ctx: AgentContext): Agent {
  return new Agent({
    name: 'PlantOps',
    model: ctx.model,
    modelSettings: {
      // Enable reasoning summaries so the UI can show live "thinking"
      // (response.reasoning_summary_text.delta events). `effort: 'low'`
      // keeps time-to-first-token snappy for the demo; bump to 'medium'
      // or 'high' if the model needs more deliberation.
      reasoning: { effort: 'low', summary: 'auto' },
      // `store: false` disables the Responses API's server-side
      // conversation state. Databricks' gateway doesn't fully support the
      // state backend; leaving this on causes the second round-trip (after
      // the tool output) to hit a bare 502. Stateless runs work fine.
      store: false,
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
    tools: makeTools(ctx),
  });
}

export { run };
