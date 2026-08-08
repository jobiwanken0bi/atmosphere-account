import {
  bindAppSessionGrantForClient,
  shouldHydrateAccountDetails,
} from "./session.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
  }
}

Deno.test("session details fully hydrate when no appview is configured", () => {
  assertEquals(shouldHydrateAccountDetails("/", false), true);
  assertEquals(shouldHydrateAccountDetails("/docs", false), true);
  assertEquals(shouldHydrateAccountDetails("/signin", false), true);
  assertEquals(shouldHydrateAccountDetails("/apps/manage", false), true);
});

Deno.test("session details stay lightweight for Deno shell pages when appview is configured", () => {
  assertEquals(shouldHydrateAccountDetails("/", true), false);
  assertEquals(shouldHydrateAccountDetails("/docs", true), false);
  assertEquals(shouldHydrateAccountDetails("/signin", true), false);
  assertEquals(
    shouldHydrateAccountDetails("/examples/atmosphere-login/app", true),
    false,
  );
});

Deno.test("session details fully hydrate inside the appview origin", () => {
  assertEquals(
    shouldHydrateAccountDetails("/account", true, true),
    true,
  );
  assertEquals(
    shouldHydrateAccountDetails("/apps/manage", true, true),
    true,
  );
  assertEquals(
    shouldHydrateAccountDetails("/hosts/example.com/manage", true, true),
    true,
  );
});

Deno.test("session details keep full hydration for dev-only local helpers", () => {
  assertEquals(shouldHydrateAccountDetails("/dev/account-demo", true), true);
});

Deno.test("app sessions bind only grants owned by the same DID", async () => {
  const calls: Array<{ sql: string; args: unknown[] }> = [];
  await bindAppSessionGrantForClient(
    {
      execute(query) {
        calls.push(query);
        return Promise.resolve({ rowsAffected: 1 });
      },
    },
    "session-a",
    {
      did: "did:plc:alice",
      oauthGrantId: "grant-a",
    },
  );
  assertEquals(calls.length, 1);
  assertEquals(
    calls[0].sql.includes("WHERE grant_id = ? AND did = ?"),
    true,
  );
  assertEquals(
    JSON.stringify(calls[0].args),
    JSON.stringify(["session-a", "grant-a", "did:plc:alice"]),
  );
});

Deno.test("app session binding fails closed when the grant is absent", async () => {
  let failed = false;
  try {
    await bindAppSessionGrantForClient(
      {
        execute: () => Promise.resolve({ rowsAffected: 0 }),
      },
      "session-a",
      {
        did: "did:plc:alice",
        oauthGrantId: "grant-other",
      },
    );
  } catch {
    failed = true;
  }
  assertEquals(failed, true);
});
