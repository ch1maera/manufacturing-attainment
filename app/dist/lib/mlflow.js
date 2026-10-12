import { authHeaders } from "./auth.js";
import { getExecutionContext } from "@databricks/appkit";

//#region server/lib/mlflow.ts
async function ensureMlflowExperiment(host, experimentPath) {
	const h = new Headers();
	const { client } = getExecutionContext();
	await client.config.authenticate(h);
	h.set("Content-Type", "application/json");
	const base = host.replace(/\/$/, "");
	const timeout = () => AbortSignal.timeout(30 * 1e3);
	const getUrl = `${base}/api/2.0/mlflow/experiments/get-by-name?experiment_name=${encodeURIComponent(experimentPath)}`;
	const getResp = await fetch(getUrl, {
		method: "GET",
		headers: h,
		signal: timeout()
	});
	if (getResp.ok) {
		const id = (await getResp.json()).experiment?.experiment_id;
		if (id) return id;
	} else if (getResp.status !== 404 && getResp.status !== 400) {
		const errText = await getResp.text();
		throw new Error(`mlflow get-by-name failed: ${getResp.status} ${errText}`);
	}
	const doCreate = () => fetch(`${base}/api/2.0/mlflow/experiments/create`, {
		method: "POST",
		headers: h,
		signal: timeout(),
		body: JSON.stringify({ name: experimentPath })
	});
	let createResp = await doCreate();
	if (!createResp.ok) {
		let errText = await createResp.text();
		if (/RESOURCE_ALREADY_EXISTS/i.test(errText)) {
			const retry = await fetch(getUrl, {
				method: "GET",
				headers: h,
				signal: timeout()
			});
			if (retry.ok) {
				const id = (await retry.json()).experiment?.experiment_id;
				if (id) return id;
			}
		}
		if (/Parent directory does not exist/i.test(errText)) {
			const parent = experimentPath.slice(0, experimentPath.lastIndexOf("/"));
			if (parent) {
				await fetch(`${base}/api/2.0/workspace/mkdirs`, {
					method: "POST",
					headers: h,
					signal: timeout(),
					body: JSON.stringify({ path: parent })
				});
				createResp = await doCreate();
			}
		}
		if (!createResp.ok) {
			errText = await createResp.text();
			throw new Error(`mlflow create failed: ${createResp.status} ${errText}`);
		}
	}
	const createBody = await createResp.json();
	if (!createBody.experiment_id) throw new Error("mlflow create returned no experiment_id");
	return createBody.experiment_id;
}
/**
* Best-effort POST of a user-feedback assessment to an MLflow trace.
* Returns the created `assessment_id`, or `null` on any failure (caller
* should log + keep going — the local audit row is still written).
*/
async function postMlflowAssessment(args) {
	const { req, host, traceId, userEmail, value, rationale } = args;
	try {
		const base = host.replace(/\/$/, "");
		const headers = await authHeaders(req);
		headers.set("Content-Type", "application/json");
		const url = `${base}/api/2.0/mlflow/traces/${traceId}/assessments`;
		const resp = await fetch(url, {
			method: "POST",
			headers,
			signal: AbortSignal.timeout(30 * 1e3),
			body: JSON.stringify({ assessment: {
				trace_id: traceId,
				assessment_name: "user_feedback",
				source: {
					source_type: "HUMAN",
					source_id: userEmail
				},
				feedback: { value: value === "up" },
				...rationale ? { rationale } : {}
			} })
		});
		if (!resp.ok) {
			console.warn("[mlflow] assessment post failed", resp.status, await resp.text().catch(() => ""));
			return null;
		}
		return (await resp.json()).assessment?.assessment_id ?? null;
	} catch (e) {
		console.warn("[mlflow] assessment post threw", e.message);
		return null;
	}
}

//#endregion
export { ensureMlflowExperiment, postMlflowAssessment };