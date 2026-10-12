import { getCurrentUserInfo } from "../lib/user.js";
import { getExecutionContext } from "@databricks/appkit";

//#region server/routes/config.ts
/** Compose a deep-link URL from the workspace host + resource id. Returns
*  an empty string if either is missing so the client can render the tile
*  inert without an extra null check. */
function composeUrl(host, path, id) {
	if (!host || !id) return "";
	return `${host}${path}${id}`;
}
/** Build the full resources map, one entry per resource. Server-side
*  composition keeps URL templates in ONE place and the client never has
*  to know what host it's on. */
function buildResources(host, cfg) {
	const catalog = cfg.data?.catalog ?? "";
	const schema = cfg.data?.schema ?? "";
	const catalogPath = catalog && schema ? `/explore/data/${catalog}/${schema}` : "";
	const modelPath = cfg.mlModelName ? `/explore/data/models/${cfg.mlModelName.replace(/\./g, "/")}` : "";
	const volumeUiPath = cfg.pdfVolumePath ? cfg.pdfVolumePath.replace(/^\/Volumes\//, "/explore/data/volumes/") : "";
	return {
		dashboard: {
			id: cfg.dashboardId ?? "",
			url: composeUrl(host, "/dashboardsv3/", cfg.dashboardId)
		},
		genie: {
			id: cfg.genieSpaceId ?? "",
			url: composeUrl(host, "/genie/rooms/", cfg.genieSpaceId)
		},
		pipeline: {
			id: cfg.pipelineId ?? "",
			url: composeUrl(host, "/pipelines/", cfg.pipelineId)
		},
		warehouse: {
			id: cfg.warehouseId ?? "",
			url: host ? `${host}/compute/sql-warehouses` : ""
		},
		lakebase: {
			id: cfg.lakebaseProjectId ?? "",
			url: composeUrl(host, "/lakebase/projects/", cfg.lakebaseProjectId)
		},
		mas: {
			id: cfg.masEndpointName ?? "",
			url: composeUrl(host, "/ml/endpoints/", cfg.masEndpointName)
		},
		ka: {
			id: cfg.kaEndpointName ?? "",
			url: composeUrl(host, "/ml/endpoints/", cfg.kaEndpointName)
		},
		gateway: {
			id: "",
			url: host ? `${host}/ml/ai-gateway` : ""
		},
		databricksOne: {
			id: "",
			url: host ? `${host}/one` : ""
		},
		agentBricks: {
			id: "",
			url: host ? `${host}/ml/agents` : ""
		},
		catalog: {
			id: `${catalog}.${schema}`,
			url: host && catalogPath ? `${host}${catalogPath}` : ""
		},
		model: {
			id: cfg.mlModelName ?? "",
			url: host && modelPath ? `${host}${modelPath}` : ""
		},
		volume: {
			id: cfg.pdfVolumePath ?? "",
			url: host && volumeUiPath ? `${host}${volumeUiPath}` : ""
		},
		app: {
			id: cfg.appUrl ?? "",
			url: cfg.appUrl ?? ""
		}
	};
}
function registerConfigRoutes(app, deps) {
	app.get("/api/config", (_req, res) => {
		const { appConfig, getAgentExperimentId } = deps;
		res.json({
			mlflowExperimentId: appConfig.mlflowExperimentId ?? null,
			agentMlflowExperimentId: getAgentExperimentId(),
			dashboardId: appConfig.dashboardId,
			branding: appConfig.branding,
			assistantScript: appConfig.assistantScript ?? []
		});
	});
	app.get("/api/me", (req, res) => {
		const info = getCurrentUserInfo(req);
		const ctx = getExecutionContext();
		const isUserContext = "isUserContext" in ctx && ctx.isUserContext === true;
		res.json({
			...info,
			isUserContext
		});
	});
	const WAREHOUSE_CACHE_TTL_MS = 3e4;
	let warehouseCache = null;
	app.get("/api/warehouse", async (_req, res) => {
		const id = process.env.DATABRICKS_WAREHOUSE_ID;
		if (!id) {
			res.json({
				id: null,
				name: null,
				state: null
			});
			return;
		}
		const now = Date.now();
		if (warehouseCache && warehouseCache.id === id && warehouseCache.expiresAt > now) {
			const { expiresAt: _e, ...payload } = warehouseCache;
			res.json(payload);
			return;
		}
		const { client } = getExecutionContext();
		const w = await client.warehouses.get({ id });
		warehouseCache = {
			id,
			name: w.name ?? id,
			state: w.state ?? "UNKNOWN",
			expiresAt: now + WAREHOUSE_CACHE_TTL_MS
		};
		const { expiresAt: _e, ...payload } = warehouseCache;
		res.json(payload);
	});
	app.get("/api/resources", (_req, res) => {
		const host = (process.env.DATABRICKS_HOST ?? "").replace(/\/+$/, "");
		res.json(buildResources(host, deps.appConfig));
	});
}

//#endregion
export { registerConfigRoutes };