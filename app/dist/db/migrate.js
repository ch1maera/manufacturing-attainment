import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";

//#region server/db/migrate.ts
/**
* Runs committed SQL migrations from ./drizzle/ at app startup.
*
* - Safe to call on every boot: Drizzle's migrator tracks applied migrations
*   in a meta table and is a no-op if everything is up to date.
* - In dev, the current user is the project owner (DDL allowed).
* - In prod, the service principal runs this on first deploy, becomes the
*   owner of `app` schema, and can run future migrations.
*
* NB: the migrations folder path is computed relative to this source file so
* it resolves both under tsx-watch (dev) and tsdown-bundled (prod).
*/
async function runMigrations(db) {
	const here = dirname(fileURLToPath(import.meta.url));
	const candidates = [resolve(here, "../../drizzle"), resolve(here, "../drizzle")];
	const fs = await import("node:fs");
	const migrationsFolder = candidates.find((p) => fs.existsSync(p));
	if (!migrationsFolder) throw new Error(`No Drizzle migrations folder found. Tried: ${candidates.join(", ")}. Run \`npm run db:generate\` first.`);
	await migrate(db, { migrationsFolder });
}

//#endregion
export { runMigrations };