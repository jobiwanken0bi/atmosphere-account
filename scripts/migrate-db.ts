import { loadDotEnvIfPresent } from "../lib/cli-env.ts";
import { checkDbHealth, migrate } from "../lib/db.ts";

await loadDotEnvIfPresent();
if (!Deno.env.get("ATMOSPHERE_DB_BACKEND")) {
  Deno.env.set("ATMOSPHERE_DB_BACKEND", "turso");
}
await migrate();
const health = await checkDbHealth();
console.log(
  `[db:migrate] ok (${health.databaseKind}, ${health.latencyMs}ms)`,
);
