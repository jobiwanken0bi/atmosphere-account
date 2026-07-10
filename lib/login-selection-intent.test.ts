import {
  createLoginSelectionIntent,
  verifyLoginSelectionIntent,
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
    await verifyLoginSelectionIntent(token, request, "did:plc:one", {
      now: now + 60_000,
      secret,
    }),
    true,
  );
  assertEquals(
    await verifyLoginSelectionIntent(token, request, "did:plc:two", {
      now,
      secret,
    }),
    false,
  );
  assertEquals(
    await verifyLoginSelectionIntent(
      token,
      { ...request, returnUri: "https://evil.example/callback" },
      "did:plc:one",
      { now, secret },
    ),
    false,
  );
});

Deno.test("selection intent rejects tampering and expiry", async () => {
  const token = await createLoginSelectionIntent(request, "did:plc:one", {
    now,
    secret,
  });
  const tampered = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;
  assertEquals(
    await verifyLoginSelectionIntent(tampered, request, "did:plc:one", {
      now,
      secret,
    }),
    false,
  );
  assertEquals(
    await verifyLoginSelectionIntent(token, request, "did:plc:one", {
      now: now + 6 * 60_000,
      secret,
    }),
    false,
  );
});
