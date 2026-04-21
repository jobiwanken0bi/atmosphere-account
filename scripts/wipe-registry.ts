/**
 * Wipe the registry tables (profile + profile_fts + featured + jetstream
 * cursor) and let `lib/db.ts` recreate them with the current schema. Use
 * this whenever the schema changes in a way that ALTER TABLE can't
 * express (column drops, FTS column changes, etc.).
 *
 * Reads TURSO_DATABASE_URL / TURSO_AUTH_TOKEN from the environment.
 *
 * Usage:
 *   deno run -A --env-file=.env scripts/wipe-registry.ts
 *
 * Pass `--keep-oauth` to preserve oauth_session / oauth_state / oauth_key
 * tables (default keeps them — wiping those would log everyone out).
 */
import { createClient } from "@libsql/client";

const url = Deno.env.get("TURSO_DATABASE_URL");
const authToken = Deno.env.get("TURSO_AUTH_TOKEN");

if (!url) {
  console.error("TURSO_DATABASE_URL is not set. Pass --env-file=.env.");
  Deno.exit(1);
}

const client = createClient({ url, authToken });

const dropStatements = [
  // Drop FTS triggers first so dropping the source table doesn't fire them.
  `DROP TRIGGER IF EXISTS profile_au`,
  `DROP TRIGGER IF EXISTS profile_ad`,
  `DROP TRIGGER IF EXISTS profile_ai`,
  `DROP TABLE IF EXISTS profile_fts`,
  `DROP INDEX IF EXISTS profile_handle`,
  `DROP INDEX IF EXISTS profile_category`,
  `DROP TABLE IF EXISTS profile`,
  `DROP TABLE IF EXISTS featured`,
  `DROP TABLE IF EXISTS license`,
  // Reset the Jetstream cursor too so the indexer replays everything from
  // scratch on next start (which is what you want after wiping the index).
  `DROP TABLE IF EXISTS jetstream_cursor`,
];

console.log(`[wipe] connected to ${url}`);
for (const stmt of dropStatements) {
  console.log(`[wipe] ${stmt}`);
  await client.execute(stmt);
}

console.log(
  "[wipe] done. The next request to the app will re-run migrations and recreate the schema cleanly.",
);
