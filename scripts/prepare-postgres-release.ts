import { syncSeededAccountHosts } from "../lib/account-hosts.ts";
import { withDb } from "../lib/db.ts";
import { closePostgresExecuteClient } from "../lib/postgres.ts";
import { migratePostgresSchema } from "./migrate-postgres.ts";

/** One blocking Railway release gate: schema first, then fast seed upgrades. */
export async function preparePostgresRelease(): Promise<void> {
  const startedAt = Date.now();
  let migration: Awaited<ReturnType<typeof migratePostgresSchema>> | null =
    null;
  let seededHosts = 0;
  try {
    // migratePostgresSchema owns and closes its direct client in a `finally`.
    migration = await migratePostgresSchema();
    seededHosts = await syncReleaseSeeds();
    console.log(JSON.stringify({
      event: "postgres_release_prepared",
      durationMs: Date.now() - startedAt,
      migrationStatements: migration.statements,
      migrationElapsedMs: migration.elapsedMs,
      seededHosts,
    }));
  } catch (error) {
    console.error(JSON.stringify({
      event: "postgres_release_prepare_failed",
      durationMs: Date.now() - startedAt,
      migrationCompleted: migration != null,
      seededHosts,
      errorKind: error instanceof Error ? error.name : "unknown_error",
    }));
    throw error;
  }
}

async function syncReleaseSeeds(): Promise<number> {
  try {
    return await syncSeededAccountHosts();
  } finally {
    await closeReleaseDatabase();
  }
}

async function closeReleaseDatabase(): Promise<void> {
  await withDb(closePostgresExecuteClient);
}

if (import.meta.main) await preparePostgresRelease();
