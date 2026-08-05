import {
  attachPostgresPoolErrorHandler,
  postgresPoolOptions,
  runPostgresTransactionForTest,
} from "./postgres.ts";

Deno.test("Postgres transactions roll back failed multi-statement writes on one connection", async () => {
  const statements: string[] = [];
  let released = false;
  const failure = new Error("second statement failed");
  const pool = {
    connect: () =>
      Promise.resolve({
        query(statement: string) {
          statements.push(statement);
          return Promise.resolve({ rows: [], rowCount: 1 });
        },
        release() {
          released = true;
        },
      }),
  };

  let caught: unknown = null;
  try {
    await runPostgresTransactionForTest(pool, async (transaction) => {
      await transaction.execute("UPDATE account_host_claim SET updated_at = 1");
      throw failure;
    });
  } catch (error) {
    caught = error;
  }

  if (caught !== failure) {
    throw new Error("expected the original write failure");
  }
  if (
    statements.join("|") !==
      "BEGIN|UPDATE account_host_claim SET updated_at = 1|ROLLBACK"
  ) {
    throw new Error(`unexpected transaction sequence: ${statements.join("|")}`);
  }
  if (!released) {
    throw new Error("expected the transaction connection to release");
  }
});

Deno.test("Postgres transactions destroy a connection when rollback fails", async () => {
  const writeFailure = new Error("write failed");
  const rollbackFailure = new Error("connection lost during rollback");
  let releasedWith: Error | undefined;
  const pool = {
    connect: () =>
      Promise.resolve({
        query(statement: string) {
          if (statement === "ROLLBACK") return Promise.reject(rollbackFailure);
          return Promise.resolve({ rows: [], rowCount: 1 });
        },
        release(error?: Error) {
          releasedWith = error;
        },
      }),
  };

  try {
    await runPostgresTransactionForTest(
      pool,
      () => Promise.reject(writeFailure),
    );
  } catch (error) {
    if (error !== writeFailure) throw error;
  }

  if (releasedWith !== rollbackFailure) {
    throw new Error("expected the broken connection to be destroyed");
  }
});

Deno.test("Postgres pool handles failed idle clients without a process-level error", () => {
  let event: string | null = null;
  let listener: ((error: Error) => void) | null = null;
  attachPostgresPoolErrorHandler({
    on(name, callback) {
      event = name;
      listener = callback;
    },
  });

  if (event !== "error" || listener == null) {
    throw new Error("expected an idle-client error listener");
  }
});

Deno.test("Postgres pool keeps idle connections to prevent Deno socket churn", () => {
  const options = postgresPoolOptions(
    "postgres://postgres@127.0.0.1:5432/atmosphere",
    "3",
  );

  if (options.idleTimeoutMillis !== 0) {
    throw new Error(
      `expected idle eviction to be disabled, got ${options.idleTimeoutMillis}`,
    );
  }
  if (options.max !== 3) {
    throw new Error(`expected configured pool max 3, got ${options.max}`);
  }
  if (options.ssl !== false) {
    throw new Error("expected loopback Postgres connections to omit TLS");
  }
});

Deno.test("Postgres pool rejects invalid maximum sizes", () => {
  for (const value of ["0", "-1", "1.5", "not-a-number"]) {
    const options = postgresPoolOptions(
      "postgres://postgres@127.0.0.1:5432/atmosphere",
      value,
    );
    if (options.max !== 5) {
      throw new Error(`expected safe default for ${value}, got ${options.max}`);
    }
  }
});
