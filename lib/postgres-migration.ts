/**
 * One cluster-wide key used only to serialize Atmosphere schema migrations.
 *
 * Railway can deploy the web and indexer services from the same commit at the
 * same time. A transaction-scoped advisory lock lets either service migrate
 * first while the other waits, then safely reruns the idempotent baseline.
 */
export const POSTGRES_SCHEMA_MIGRATION_LOCK_ID = "470758442001";

export const POSTGRES_SCHEMA_MIGRATION_LOCK_SQL =
  `SELECT pg_advisory_xact_lock(CAST(${POSTGRES_SCHEMA_MIGRATION_LOCK_ID} AS bigint));`;

/**
 * Add the deployment lock to an explicitly transactional Postgres schema.
 *
 * The lock is injected by the generic Postgres runner instead of being stored
 * in the shared SQL file. That keeps the Neon statement-by-statement migration
 * path unchanged while guaranteeing that the lock lives until COMMIT on
 * Railway Postgres.
 */
export function withPostgresSchemaMigrationLock(schema: string): string {
  const beginMatches = transactionBoundaryMatches(schema, "BEGIN");
  const commitMatches = transactionBoundaryMatches(schema, "COMMIT");

  if (beginMatches.length !== 1 || commitMatches.length !== 1) {
    throw new Error(
      "Postgres deployment migrations require exactly one explicit BEGIN and COMMIT",
    );
  }
  if (beginMatches[0].index >= commitMatches[0].index) {
    throw new Error(
      "Postgres deployment migration COMMIT must follow BEGIN",
    );
  }
  if (schema.includes(POSTGRES_SCHEMA_MIGRATION_LOCK_SQL)) {
    throw new Error("Postgres deployment migration lock is already present");
  }

  const insertAt = beginMatches[0].index + beginMatches[0].text.length;
  return schema.slice(0, insertAt) + "\n\n" +
    POSTGRES_SCHEMA_MIGRATION_LOCK_SQL + schema.slice(insertAt);
}

interface BoundaryMatch {
  index: number;
  text: string;
}

function transactionBoundaryMatches(
  schema: string,
  keyword: "BEGIN" | "COMMIT",
): BoundaryMatch[] {
  const pattern = new RegExp(
    `^[ \\t]*${keyword}[ \\t]*;[ \\t]*\\r?$`,
    "gim",
  );
  return [...schema.matchAll(pattern)].map((match) => ({
    index: match.index,
    text: match[0],
  }));
}
