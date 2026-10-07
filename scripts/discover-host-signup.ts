/** Refresh the same durable OAuth signup evidence used by directory maintenance. */
import { refreshHostOAuthCreationEvidence } from "../lib/host-oauth-creation.ts";
import { withDb } from "../lib/db.ts";
import { closePostgresExecuteClient } from "../lib/postgres.ts";
try {
  console.log(JSON.stringify(
    await refreshHostOAuthCreationEvidence({
      force: Deno.args.includes("--force"),
      signal: AbortSignal.timeout(120_000),
    }),
  ));
} finally {
  await withDb(closePostgresExecuteClient);
}
