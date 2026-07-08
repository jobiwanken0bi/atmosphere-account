import { verifyAtmosphereLoginCallback } from "./atmosphere-login-verifier.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
  }
}

const VERIFY_BASE = {
  publicJwk: {} as JsonWebKey,
  expectedIssuer: "https://login.atmosphereaccount.com",
  expectedClientId: "https://app.example/client.json",
  expectedReturnUri: "https://app.example/callback",
};

Deno.test("verifyAtmosphereLoginCallback rejects malformed callback URLs without throwing", async () => {
  const result = await verifyAtmosphereLoginCallback({
    ...VERIFY_BASE,
    url: "not a url",
  });

  assertEquals(result.ok, false);
  assertEquals(result.ok ? null : result.error, "invalid callback URL");
});

Deno.test("verifyAtmosphereLoginCallback requires a state binding", async () => {
  const url = new URL(VERIFY_BASE.expectedReturnUri);
  url.searchParams.set("selection_token", "not-a-real-token");
  url.searchParams.set("client_id", VERIFY_BASE.expectedClientId);

  const result = await verifyAtmosphereLoginCallback({
    ...VERIFY_BASE,
    url,
  });

  assertEquals(result.ok, false);
  assertEquals(result.ok ? null : result.error, "missing state");
});
