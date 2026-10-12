import { installLogger } from "./lib/logger.js";
import { createDb } from "./db/index.js";
import { runMigrations } from "./db/migrate.js";
import { seedReasonCodes } from "./db/seed.js";
import { syncFromDelta } from "./db/sync.js";
import { ensureMlflowExperiment } from "./lib/mlflow.js";
import { registerConfigRoutes } from "./routes/config.js";
import { registerChatRoutes } from "./routes/chat.js";
import { registerReturnsRoutes } from "./routes/returns.js";
import { registerActivityRoutes } from "./routes/activity.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { registerChartRoutes } from "./routes/charts.js";
import { registerDevLogRoutes } from "./routes/dev-log.js";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { analytics, createApp, getExecutionContext, lakebase, server } from "@databricks/appkit";
import { readFileSync } from "node:fs";
import { parse, printParseErrorCode } from "jsonc-parser";
import { z } from "zod";
import * as mlflow from "mlflow-tracing";

//#region server/server.ts
/**
* Server boot — the ONE place where all backend pieces get wired together.
*
* Template responsibilities, in order:
*   1. Read `config/app.json` (the use-case knobs — agent endpoint, warehouse,
*      dashboard, Delta sync tables, branding, scripted demo chain).
*   2. Create the AppKit app with the 3 plugins we rely on:
*        - server()     → Express, OBO auth forwarding, serve-the-client
*        - lakebase()   → Postgres pool backed by Databricks Lakebase
*        - analytics()  → SQL-warehouse-backed typed queries (AnalyticsView)
*   3. Run Drizzle migrations against Lakebase (safe-to-re-run on boot), then
*      seed app-owned reference data (`seedReasonCodes` — idempotent).
*   4. One-shot sync of Delta tables into the Lakebase mirror (`syncFromDelta`)
*      so the app has an OLTP-friendly local copy of the read-only lakehouse.
*   5. Get-or-create the MLflow experiment that will hold agent traces, then
*      `mlflow.init(...)` so `@openai/agents` runs are recorded automatically.
*   6. Register the Express routes (config, chat, domain CRUD, admin).
*
* ─────────────────────────────────────────────────────────────────────
* REPURPOSING THIS TEMPLATE
* ─────────────────────────────────────────────────────────────────────
* The structural wiring (boot order, plugin set, route registration) is
* use-case agnostic — leave it alone. Customization happens here:
*
*   • `config/app.json`              — branding, agent endpoint name OR
*                                       Genie space ID, MLflow experiment
*                                       path, dashboard id, Delta source
*                                       tables, scripted demo prompts.
*   • `db/schema.ts`                 — Lakebase OLTP tables (the writable
*                                       mirror the agent + UI both use).
*   • `db/sync.ts`                   — one-shot copy from Delta → Lakebase
*                                       at boot. Update the table list.
*   • `db/queries/returns.ts`        — domain queries; rename + rewrite.
*   • `agent/refundops.ts`           — the agent itself. Rename the file
*                                       to match your domain, update the
*                                       import below, and rewrite tools +
*                                       instructions.
*   • `routes/returns.ts`            — REST endpoints for the queue. Add
*                                       new routes for your domain.
*
* Cross-file: `client/src/shared/types.ts` is the single source of truth
* for the domain types and is the FIRST thing to update when swapping
* the data model.
*/
if (process.env.DATABRICKS_HOST) {
	let h = process.env.DATABRICKS_HOST.trim().replace(/\/+$/, "");
	if (!/^https?:\/\//i.test(h)) h = "https://" + h;
	process.env.DATABRICKS_HOST = h;
}
installLogger();
const tablesSchema = z.object({
	plants: z.string().min(1),
	misses: z.string().min(1),
	correctiveActions: z.string().min(1)
});
const appConfigSchema = z.object({
	masEndpointName: z.string().optional(),
	genieSpaceId: z.string().optional(),
	mlflowExperimentId: z.string().optional(),
	agentMlflowExperimentPath: z.string().optional(),
	agentModel: z.string().optional(),
	dashboardId: z.string(),
	pipelineId: z.string().optional(),
	warehouseId: z.string().optional(),
	kaEndpointName: z.string().optional(),
	lakebaseProjectId: z.string().optional(),
	appUrl: z.string().optional(),
	mlModelName: z.string().optional(),
	pdfVolumePath: z.string().optional(),
	branding: z.object({ appName: z.string().min(1) }),
	assistantScript: z.array(z.object({
		label: z.string().optional(),
		prompt: z.string().min(1),
		triggerAfter: z.array(z.string()).optional()
	})).optional(),
	data: z.object({
		catalog: z.string(),
		schema: z.string(),
		tables: tablesSchema
	}).optional()
});
const CONFIG_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../config/app.json");
function loadAppConfig() {
	let raw;
	try {
		raw = readFileSync(CONFIG_PATH, "utf8");
	} catch (e) {
		throw new Error(`[config] Could not read ${CONFIG_PATH}: ${e.message}`);
	}
	raw = raw.replace(/\$\{([A-Z_][A-Z0-9_]*)(?::([^}]*))?\}/g, (_, name, dflt) => {
		const v = process.env[name];
		return v !== void 0 && v !== "" ? v : dflt ?? "";
	});
	const errors = [];
	const parsed = parse(raw, errors, { allowTrailingComma: true });
	if (errors.length > 0) {
		const list = errors.map((e) => `  • offset ${e.offset}+${e.length}: ${printParseErrorCode(e.error)}`).join("\n");
		throw new Error(`[config] ${CONFIG_PATH} is not valid JSONC:\n${list}`);
	}
	const result = appConfigSchema.safeParse(parsed);
	if (!result.success) {
		const issues = result.error.issues.map((i) => `  • ${i.path.join(".") || "<root>"}: ${i.message}`).join("\n");
		throw new Error(`[config] ${CONFIG_PATH} failed validation:\n${issues}`);
	}
	const hasPlaceholder = (v) => typeof v === "string" && /<[^>]+>/.test(v);
	const warnPlaceholders = [["agentMlflowExperimentPath", result.data.agentMlflowExperimentPath], ["mlflowExperimentId", result.data.mlflowExperimentId]];
	for (const [k, v] of warnPlaceholders) if (hasPlaceholder(v)) console.warn(`[config] ${k} contains an unfilled <placeholder>: ${v} — feature will be skipped at boot.`);
	const unfilled = [
		["dashboardId", result.data.dashboardId],
		["branding.appName", result.data.branding?.appName],
		["data.catalog", result.data.data?.catalog],
		["data.schema", result.data.data?.schema]
	].filter(([, v]) => hasPlaceholder(v));
	if (unfilled.length > 0) {
		const list = unfilled.map(([k, v]) => `  • ${k} = ${v} (contains a <placeholder>)`).join("\n");
		throw new Error(`[config] ${CONFIG_PATH} has unfilled placeholders — replace them with real values:\n${list}`);
	}
	return result.data;
}
const appConfig = loadAppConfig();
let agentExperimentId = null;
function logErrorCompact(prefix, err) {
	const e = err;
	const parts = [truncate(e.message ?? String(err), 300)];
	if (e.cause?.code) parts.push(`pg=${e.cause.code}`);
	if (e.cause?.constraint) parts.push(`constraint=${e.cause.constraint}`);
	if (e.cause?.detail) parts.push(`detail=${truncate(e.cause.detail, 200)}`);
	if (e.query) parts.push(`query=${truncate(e.query, 200)}`);
	const header = `${prefix} ${parts.join(" | ")}`;
	const frames = e.stack ? e.stack.split("\n").filter((l) => l.trimStart().startsWith("at ")).slice(0, 12).map((l) => truncate(l.trimStart(), 300)).join("\n") : "";
	console.error(frames ? `${header}\n${frames}` : header);
}
function truncate(s, n) {
	return s.length > n ? `${s.slice(0, n)}… (+${s.length - n} chars)` : s;
}
process.on("unhandledRejection", (reason) => {
	logErrorCompact("[unhandledRejection]", reason);
});
process.on("uncaughtException", (err) => {
	logErrorCompact("[uncaughtException]", err);
});
const t0 = Date.now();
const ms = () => `${Date.now() - t0}ms`;
const STARTUP_SAFE_PATHS = new Set([
	"/api/config",
	"/api/me",
	"/api/warehouse"
]);
const STARTUP_SAFE_PREFIXES = ["/api/log/"];
let migrationsDone = false;
let migrationsFailure = null;
let migrationsReady = new Promise(() => {});
let db;
await createApp({
	plugins: [
		server(),
		lakebase(),
		analytics({})
	],
	onPluginsReady(appkit) {
		db = createDb(appkit.lakebase.pool);
		appkit.server.extend((app) => {
			app.use("/api", async (req, res, next) => {
				if (migrationsDone) return next();
				if (STARTUP_SAFE_PATHS.has(req.path)) return next();
				if (STARTUP_SAFE_PREFIXES.some((p) => req.path.startsWith(p))) return next();
				if (migrationsFailure) {
					res.status(503).json({ error: `Database initialization failed: ${migrationsFailure.message}` });
					return;
				}
				try {
					await Promise.race([migrationsReady, new Promise((_, rej) => setTimeout(() => rej(/* @__PURE__ */ new Error("startup-timeout")), 5e3))]);
					next();
				} catch (e) {
					const isTimeout = e instanceof Error && e.message === "startup-timeout";
					res.set("Retry-After", "2").status(503).json({ error: isTimeout ? "Database is still initializing — please retry in a moment." : `Database initialization failed: ${e.message}` });
				}
			});
			registerConfigRoutes(app, {
				appConfig,
				getAgentExperimentId: () => agentExperimentId
			});
			if (!appConfig.masEndpointName) console.warn("[boot] config.masEndpointName is empty — the agent won't have an ask_mas tool. Set it in config/app.json, or wire ask_genie if your demo uses Genie.");
			registerChatRoutes(app, {
				db,
				appConfig: {
					masEndpointName: appConfig.masEndpointName ?? "",
					agentModel: appConfig.agentModel
				}
			});
			registerReturnsRoutes(app, { db });
			registerActivityRoutes(app, { db });
			registerAdminRoutes(app, {
				db,
				data: appConfig.data
			});
			if (appConfig.data) registerChartRoutes(app, {
				query: (sql, params) => appkit.analytics.query(sql, params),
				catalog: appConfig.data.catalog,
				schema: appConfig.data.schema,
				queriesDir: resolve(dirname(fileURLToPath(import.meta.url)), "../config/queries")
			});
			if (process.env.DEV_CLIENT_ERROR_LOG === "1") {
				registerDevLogRoutes(app, logErrorCompact);
				console.log("[boot] DEV_CLIENT_ERROR_LOG=1 → /api/log/client-error enabled");
			}
			app.use((err, req, res, _next) => {
				logErrorCompact(`[500] ${req.method} ${req.path}`, err);
				if (!res.headersSent) res.status(500).json({ error: err.message });
			});
		});
		startBackgroundInit();
	}
});
console.log(`[boot +${ms()}] Server listening — background init in progress…`);
function startBackgroundInit() {
	const mlflowIdPromise = (async () => {
		const appName = (process.env.DATABRICKS_APP_NAME ?? "").trim();
		const experimentPath = appConfig.agentMlflowExperimentPath || (appName ? `/Shared/solution_builder/${appName}-agent-traces` : "");
		if (!experimentPath) {
			console.warn("[boot] no MLflow experiment path — agentMlflowExperimentPath is empty AND DATABRICKS_APP_NAME is unset, so nothing could be derived. Agent traces will NOT be recorded and the chat \"View trace\" link will show \"Trace pending…\". Set AGENT_MLFLOW_EXPERIMENT_PATH (e.g. /Shared/solution_builder/<app-name>-agent-traces).");
			return null;
		}
		const host = (process.env.DATABRICKS_HOST ?? "").replace(/\/$/, "");
		if (!host) {
			console.warn("[boot] DATABRICKS_HOST not set — skipping MLflow experiment bootstrap.");
			return null;
		}
		try {
			const id = await ensureMlflowExperiment(host, experimentPath);
			console.log(`[boot +${ms()}] MLflow experiment resolved (id=${id}) — traces will land at ${experimentPath}`);
			return id;
		} catch (e) {
			console.warn(`[boot] MLflow experiment bootstrap failed for ${experimentPath} — "View trace" link will show "Trace pending…":`, e.message);
			return null;
		}
	})();
	migrationsReady = (async () => {
		try {
			await runMigrations(db);
			console.log(`[boot +${ms()}] Migrations up to date`);
			await seedReasonCodes(db);
			if (appConfig.data) {
				await syncFromDelta(db, appConfig.data);
				console.log(`[boot +${ms()}] Delta sync done`);
			}
			migrationsDone = true;
		} catch (e) {
			migrationsFailure = e instanceof Error ? e : new Error(String(e));
			logErrorCompact("[boot] DB init failed:", e);
			throw migrationsFailure;
		}
	})();
	migrationsReady.catch(() => {});
	(async () => {
		await migrationsReady.catch(() => {});
		agentExperimentId = await mlflowIdPromise;
		if (agentExperimentId) {
			let mlflowHost;
			let mlflowToken;
			try {
				const { client } = getExecutionContext();
				const h = new Headers();
				await client.config.authenticate(h);
				mlflowToken = /^Bearer\s+(.+)$/i.exec(h.get("Authorization") ?? "")?.[1];
				mlflowHost = client.config.host ?? process.env.DATABRICKS_HOST;
			} catch (e) {
				console.warn("[boot] could not resolve MLflow exporter auth from the app client — trace upload may fail:", e.message);
			}
			mlflow.init({
				trackingUri: "databricks",
				experimentId: agentExperimentId,
				...mlflowHost && mlflowToken ? {
					host: mlflowHost,
					databricksToken: mlflowToken
				} : {}
			});
			console.log(`[boot +${ms()}] MLflow tracing active`);
			const origWarn = console.warn.bind(console);
			console.warn = (...args) => {
				const first = args[0];
				if (typeof first === "string" && first.includes("No trace ID found for span lakebase.query")) return;
				origWarn(...args);
			};
		}
	})();
}

//#endregion
export {  };