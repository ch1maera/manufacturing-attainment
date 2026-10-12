import { tool } from "@openai/agents";

//#region server/agent/tools/logged-tool.ts
/**
* `loggedTool` — drop-in replacement for `tool()` from `@openai/agents`
* that ALSO logs the error to the server console when a tool throws.
*
* Why this exists:
*   The SDK's default behavior on a thrown tool error is to return
*   `"An error occurred while running the tool. Please try again. Error: <…>"`
*   to the model so it can recover gracefully. The error never reaches
*   our server logs — so a query that always fails (bad schema, missing
*   table, etc.) shows up only as a vague chat message and the operator
*   has nothing to debug from.
*
*   This wrapper injects an `errorFunction` that:
*     1. Logs the error (full stack + cause + Drizzle query metadata) via
*        console.error → picked up by the unified logger in lib/logger.ts.
*     2. Falls back to the SDK's default behavior so the model still sees
*        the same message and can recover.
*
*   If a caller passes their own `errorFunction`, we wrap it: log first,
*   then delegate to the caller's function so they can customize the
*   string returned to the model.
*/
/**
* Trim a tool-error string before handing it to the model. Drizzle/pg
* wraps the full SQL + every bound parameter into `err.message`, which
* can be 100k+ chars on a bulk insert — sending that to the model
* burns the context window and leaks internal table/column names. The
* model only needs a short, actionable hint; the full error already
* went to console.error for the operator.
*/
function sanitizeForModel(err) {
	const firstLine = (err instanceof Error ? err.message : String(err)).split("\n", 1)[0] ?? "";
	const trimmed = firstLine.split(/params:|query:/i)[0]?.trim() ?? firstLine;
	return trimmed.length > 240 ? `${trimmed.slice(0, 240)}…` : trimmed;
}
function loggedTool(args) {
	const userErrorFunction = args.errorFunction;
	return tool({
		...args,
		errorFunction: (context, err) => {
			console.error(`[tool:${args.name}] threw`, err);
			if (typeof userErrorFunction === "function") return userErrorFunction(context, err);
			return `An error occurred while running the tool. Please try again. Error: ${sanitizeForModel(err)}`;
		}
	});
}

//#endregion
export { loggedTool };