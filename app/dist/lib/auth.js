import { getExecutionContext } from "@databricks/appkit";
import { WorkspaceClient } from "@databricks/sdk-experimental";

//#region server/lib/auth.ts
const REFRESH_SKEW_MS = 2 * 60 * 1000;
let appClient;
let loggedAuthPath = false;
function servingClient() {
	const host = process.env.DATABRICKS_HOST;
	const clientId = process.env.DATABRICKS_CLIENT_ID;
	const clientSecret = process.env.DATABRICKS_CLIENT_SECRET;
	if (host && clientId && clientSecret) {
		appClient ??= new WorkspaceClient({
			host,
			clientId,
			clientSecret,
			authType: "oauth-m2m"
		});
		return appClient;
	}
	return getExecutionContext().client;
}
function jwtExpMs(token) {
	try {
		const payload = token.split(".")[1];
		if (!payload) return undefined;
		const json = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
		return typeof json.exp === "number" ? json.exp * 1e3 : undefined;
	} catch {
		return undefined;
	}
}
function tokenFrom(headers) {
	return (headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
}
async function authHeaders(_req, opts) {
	if (opts?.forceRefresh) appClient = undefined;
	const h = new Headers();
	let client = servingClient();
	await client.config.authenticate(h);
	let token = tokenFrom(h);
	const exp = jwtExpMs(token);
	const stale = !opts?.forceRefresh && client === appClient && (exp == null || exp - Date.now() < REFRESH_SKEW_MS);
	if (stale) {
		const prevExpInS = exp == null ? "none" : Math.round((exp - Date.now()) / 1e3);
		appClient = undefined;
		client = servingClient();
		h.delete("Authorization");
		await client.config.authenticate(h);
		token = tokenFrom(h);
		console.log(`[auth] refreshed oauth-m2m token; prev_exp_in_s=${prevExpInS}`);
	}
	if (!loggedAuthPath) {
		loggedAuthPath = true;
		const path = client === appClient ? "oauth-m2m app SP" : "AppKit default chain";
		const expMs = jwtExpMs(token);
		const expInS = expMs == null ? "none" : Math.round((expMs - Date.now()) / 1e3);
		console.log(`[auth] outbound Databricks calls use ${path}; token_len=${token.length} jwt=${token.startsWith("eyJ")} exp_in_s=${expInS}`);
	}
	return h;
}

//#endregion
export { authHeaders };
