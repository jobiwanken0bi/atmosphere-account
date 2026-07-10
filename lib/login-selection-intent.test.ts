import {
  createLoginSelectionIntent,
  readLoginSelectionIntent,
} from "./login-selection-intent.ts";

const request = {
  clientId: "https://app.example/client.json",
  returnUri: "https://app.example/callback",
  state: "state-value",
  scope: "atproto",
};
const secret = "test-secret-with-enough-entropy";
const now = 1_800_000_000_000;

function assertEquals(actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
  }
}

Deno.test("selection intent is bound to the complete login request", async () => {
  const token = await createLoginSelectionIntent(request, "did:plc:one", {
    now,
    secret,
  });
  assertEquals(
    JSON.stringify(
      await readLoginSelectionIntent(token, {
        now: now + 60_000,
        secret,
      }),
    ),
    JSON.stringify({ did: "did:plc:one", request }),
  );
});

Deno.test("selection intent rejects tampering and expiry", async () => {
  const token = await createLoginSelectionIntent(request, "did:plc:one", {
    now,
    secret,
  });
  const tampered = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;
  assertEquals(
    await readLoginSelectionIntent(tampered, {
      now,
      secret,
    }),
    null,
  );
  assertEquals(
    await readLoginSelectionIntent(token, {
      now: now + 6 * 60_000,
      secret,
    }),
    null,
  );
});
