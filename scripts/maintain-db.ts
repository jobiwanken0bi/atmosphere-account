import { loadDotEnvIfPresent } from "../lib/cli-env.ts";
import { runDatabaseMaintenance } from "../lib/db-maintenance.ts";

await loadDotEnvIfPresent();
await runDatabaseMaintenance();
// Do not emit OAuth/session maintenance details to shared job logs. The
// command's successful exit is the operational signal automation needs.
console.log("Database maintenance complete.");
