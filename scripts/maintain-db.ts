import { loadDotEnvIfPresent } from "../lib/cli-env.ts";
import { runDatabaseMaintenance } from "../lib/db-maintenance.ts";

await loadDotEnvIfPresent();
const result = await runDatabaseMaintenance();
console.log(JSON.stringify(result, null, 2));
