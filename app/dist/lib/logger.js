import util from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";

//#region server/lib/logger.ts
/**
* Unified server logging. Patches console.{log,info,warn,error,debug} AND the
* raw process.{stdout,stderr}.write streams so every line — ours, third-party,
* and Node's own warnings — gets a timestamp + level prefix.
*
* Format (prefix appears ONCE per log call; continuation lines are indented):
*   2026-04-24T11:28:51.494Z ERROR routes/activity.ts:15  Unhandled rejection
*     DrizzleQueryError: Failed query: SELECT ...
*         at NodePgPreparedQuery.queryWithCache (.../session.ts:73:11)
*         at async recentActivity (.../queries/turbines.ts:294:18)
*
* Design notes:
*  - We render the whole entry (prefix + body, continuation lines indented 2 sp)
*    as one string and write it in a single call. `grep ERROR` still finds the
*    entry, and copy/paste gives a clean, readable stack trace.
*  - `callerFrame()` skips any frame inside this file so the prefix points at
*    the real call site — not logger.ts itself.
*  - The stream-level patch (process.{stdout,stderr}.write) only prefixes
*    third-party raw writes. Console-originated writes carry a sentinel so
*    they pass through unchanged.
*
* Errors we can't reach:
*  - Module-resolution errors (missing exports, bad imports). Node throws those
*    before any app code runs; nothing in-process can catch them.
*  - Output from `npm` / the shell itself. Those write before this module loads.
*/
const LEVEL_COLORS = {
	DEBUG: "\x1B[90m",
	INFO: "\x1B[36m",
	WARN: "\x1B[33m",
	ERROR: "\x1B[31m"
};
const LEVEL_RANK = {
	DEBUG: 10,
	INFO: 20,
	WARN: 30,
	ERROR: 40
};
const MIN_LEVEL = (() => {
	const raw = (process.env.LOG_LEVEL ?? "INFO").toUpperCase();
	return [
		"DEBUG",
		"INFO",
		"WARN",
		"ERROR"
	].includes(raw) ? raw : "INFO";
})();
function shouldEmit(level) {
	return LEVEL_RANK[level] >= LEVEL_RANK[MIN_LEVEL];
}
const DIM = "\x1B[2m";
const RESET = "\x1B[0m";
const SELF_TAG = "\0logger\0";
const CONT_INDENT = "    ";
const THIS_FILE = fileURLToPath(import.meta.url);
const THIS_BASENAME = path.basename(THIS_FILE);
let installed = false;
function installLogger() {
	if (installed) return;
	installed = true;
	const useColor = process.stdout.isTTY === true;
	const origStdoutWrite = process.stdout.write.bind(process.stdout);
	const origStderrWrite = process.stderr.write.bind(process.stderr);
	const colorLevel = (level) => useColor ? `${LEVEL_COLORS[level]}${level.padEnd(5)}${RESET}` : level.padEnd(5);
	const colorTs = (ts) => useColor ? `${DIM}${ts}${RESET}` : ts;
	const colorCaller = (caller) => useColor ? `${DIM}${caller}${RESET}` : caller;
	/**
	* Best-effort caller location ("server.ts:42") from new Error().stack.
	* Skips any frame whose file matches THIS_FILE so we never land on
	* logger.ts itself, no matter how deep the patch chain goes.
	*/
	function callerFrame() {
		const stack = (/* @__PURE__ */ new Error()).stack;
		if (!stack) return "";
		const lines = stack.split("\n");
		for (const line of lines) {
			const m = line.match(/\(?(?:file:\/\/)?([^\s()]+\.(?:ts|js|mjs|cjs)):(\d+):\d+\)?/);
			if (!m) continue;
			const file = m[1];
			if (file.endsWith(THIS_BASENAME)) continue;
			if (file.startsWith("node:")) continue;
			return `${file.split("/").slice(-2).join("/")}:${m[2]}`;
		}
		return "";
	}
	/** Build prefix: "<ts> <LEVEL> <caller>  " — appears once per log entry. */
	function prefix(level, caller) {
		const ts = (/* @__PURE__ */ new Date()).toISOString();
		const callerPad = caller ? ` ${caller.padEnd(22)}` : "";
		return `${colorTs(ts)} ${colorLevel(level)}${colorCaller(callerPad)}  `;
	}
	/** util.inspect, but Errors print stack only (avoids duplicated message). */
	function formatArg(a) {
		if (typeof a === "string") return a;
		if (a instanceof Error) return a.stack ?? `${a.name}: ${a.message}`;
		return util.inspect(a, {
			colors: useColor,
			depth: 4,
			breakLength: 120
		});
	}
	/**
	* Render one log call: prefix on the first line, CONT_INDENT on the rest.
	* `args` mirror console.*'s variadic form. Empty trailing lines are dropped
	* so we don't emit a stray prefix-only blank line.
	*/
	function render(level, args) {
		const lines = args.map(formatArg).join(" ").split("\n");
		while (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
		const p = prefix(level, callerFrame());
		return SELF_TAG + (lines.length === 1 ? p + lines[0] : p + lines[0] + "\n" + lines.slice(1).map((l) => CONT_INDENT + l).join("\n")) + "\n";
	}
	const makeConsoleMethod = (level, write) => (...args) => {
		if (!shouldEmit(level)) return;
		write(render(level, args).slice(8));
	};
	const stdoutSink = (s) => origStdoutWrite(s);
	const stderrSink = (s) => origStderrWrite(s);
	console.log = makeConsoleMethod("INFO", stdoutSink);
	console.info = makeConsoleMethod("INFO", stdoutSink);
	console.debug = makeConsoleMethod("DEBUG", stdoutSink);
	console.warn = makeConsoleMethod("WARN", stderrSink);
	console.error = makeConsoleMethod("ERROR", stderrSink);
	const patchWrite = (level, orig) => {
		return (chunk, ...rest) => {
			let s = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
			if (s.startsWith(SELF_TAG)) return orig(s.slice(8), ...rest);
			const endsWithNL = s.endsWith("\n");
			const lines = (endsWithNL ? s.slice(0, -1) : s).split("\n");
			while (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
			const p = prefix(level, callerFrame());
			return orig((lines.length === 1 ? p + lines[0] : p + lines[0] + "\n" + lines.slice(1).map((l) => CONT_INDENT + l).join("\n")) + (endsWithNL ? "\n" : ""), ...rest);
		};
	};
	process.stdout.write = patchWrite("INFO", origStdoutWrite);
	process.stderr.write = patchWrite("ERROR", origStderrWrite);
}

//#endregion
export { installLogger };