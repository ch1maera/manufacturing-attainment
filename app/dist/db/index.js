import { schema_exports } from "./schema.js";
import { drizzle } from "drizzle-orm/node-postgres";

//#region server/db/index.ts
function createDb(pool) {
	return drizzle(pool, {
		schema: schema_exports,
		logger: false
	});
}

//#endregion
export { createDb };