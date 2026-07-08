type VerifyAtmosphereLoginCallback = (options: {
  url: string | URL;
  publicJwk: JsonWebKey;
  expectedIssuer: string;
  expectedClientId: string;
  expectedReturnUri: string;
  expectedState?: string | null;
}) => Promise<{ ok: boolean; error?: string }>;

function assertEquals(actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
  }
}

async function verifier(): Promise<VerifyAtmosphereLoginCallback> {
  const mod = await import("./atmosphere-login-server.js") as {
    verifyAtmosphereLoginCallback: VerifyAtmosphereLoginCallback;
  };
  return mod.verifyAtmosphereLoginCallback;
}

const VERIFY_BASE = {
  publicJwk: {} as JsonWebKey,
  expectedIssuer: "https://login.atmosphereaccount.com",
  expectedClientId: "https://app.example/client.json",
  expectedReturnUri: "https://app.example/callback",
};

Deno.test("static server helper rejects malformed callback URLs without throwing", async () => {
  const verify = await verifier();
  const result = await verify({
    ...VERIFY_BASE,
    url: "not a url",
  });

  assertEquals(result.ok, false);
  assertEquals(result.error, "invalid callback URL");
});

Deno.test("static server helper requires a state binding", async () => {
  const verify = await verifier();
  const url = new URL(VERIFY_BASE.expectedReturnUri);
  url.searchParams.set("selection_token", "not-a-real-token");
  url.searchParams.set("client_id", VERIFY_BASE.expectedClientId);

  const result = await verify({
    ...VERIFY_BASE,
    url,
  });

  assertEquals(result.ok, false);
  assertEquals(result.error, "missing state");
});
