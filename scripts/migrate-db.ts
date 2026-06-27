import { checkDbHealth, migrate } from "../lib/db.ts";

await migrate();
const health = await checkDbHealth();
console.log(
  `[db:migrate] ok (${health.databaseKind}, ${health.latencyMs}ms)`,
);
