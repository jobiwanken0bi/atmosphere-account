type VerifyAtmosphereLoginCallback = (options: {
  url: string | URL;
  publicJwk: JsonWebKey;
  expectedIssuer: string;
  expectedClientId: string;
  expectedReturnUri: string;
  expectedState?: string | null;
}) => Promise<{ ok: boolean; error?: string }>;

type StaticServerHelperModule = {
  fetchAtmosphereLoginPublicJwk: (
    atmosphereOrigin?: string,
    options?: {
      kid?: string | null;
      fetchImpl?: typeof fetch;
    },
  ) => Promise<JsonWebKey>;
  fetchAtmosphereLoginPublicJwkForToken: (
    token: string,
    atmosphereOrigin?: string,
    options?: {
      fetchImpl?: typeof fetch;
    },
  ) => Promise<JsonWebKey>;
  readAtmosphereLoginTokenKid: (token: string) => string | null;
  selectAtmosphereLoginPublicJwk: (
    jwks: unknown,
    kid?: string | null,
  ) => JsonWebKey;
  verifyAtmosphereLoginCallback: VerifyAtmosphereLoginCallback;
};

function assertEquals(actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
  }
}

async function verifier(): Promise<VerifyAtmosphereLoginCallback> {
  const mod = await serverHelper();
  return mod.verifyAtmosphereLoginCallback;
}

async function serverHelper(): Promise<StaticServerHelperModule> {
  return await import(
    "./atmosphere-login-server.js"
  ) as StaticServerHelperModule;
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

Deno.test("static server helper selects the requested JWKS kid", async () => {
  const helper = await serverHelper();

  const selected = helper.selectAtmosphereLoginPublicJwk({
    keys: [
      { kid: "old", kty: "EC" },
      { kid: "current", kty: "EC" },
    ],
  }, "current");

  assertEquals(jwkKid(selected), "current");
});

Deno.test("static server helper fails when requested kid is absent", async () => {
  const helper = await serverHelper();

  try {
    helper.selectAtmosphereLoginPublicJwk({
      keys: [{ kid: "old", kty: "EC" }],
    }, "current");
  } catch (error) {
    assertEquals(
      error instanceof Error ? error.message : String(error),
      "Atmosphere Login JWKS did not include key current",
    );
    return;
  }
  throw new Error("Expected missing kid to throw");
});

Deno.test("static server helper reads kid from the token header", async () => {
  const helper = await serverHelper();
  const token = fakeToken({ alg: "ES256", kid: "current" });

  assertEquals(helper.readAtmosphereLoginTokenKid(token), "current");
});

Deno.test("static server helper fetches the requested kid from JWKS", async () => {
  const helper = await serverHelper();

  const selected = await helper.fetchAtmosphereLoginPublicJwk(
    "https://login.example",
    {
      kid: "current",
      fetchImpl: () =>
        Promise.resolve(
          new Response(JSON.stringify({
            keys: [
              { kid: "old", kty: "EC" },
              { kid: "current", kty: "EC" },
            ],
          })),
        ),
    },
  );

  assertEquals(jwkKid(selected), "current");
});

Deno.test("static server helper fetches the token kid from JWKS", async () => {
  const helper = await serverHelper();
  const token = fakeToken({ alg: "ES256", kid: "current" });

  const selected = await helper.fetchAtmosphereLoginPublicJwkForToken(
    token,
    "https://login.example",
    {
      fetchImpl: () =>
        Promise.resolve(
          new Response(JSON.stringify({
            keys: [
              { kid: "old", kty: "EC" },
              { kid: "current", kty: "EC" },
            ],
          })),
        ),
    },
  );

  assertEquals(jwkKid(selected), "current");
});

Deno.test("static server helper requires a token kid for token JWKS fetch", async () => {
  const helper = await serverHelper();
  const token = fakeToken({ alg: "ES256" });

  try {
    await helper.fetchAtmosphereLoginPublicJwkForToken(
      token,
      "https://login.example",
      {
        fetchImpl: () =>
          Promise.resolve(
            new Response(JSON.stringify({
              keys: [{ kid: "current", kty: "EC" }],
            })),
          ),
      },
    );
  } catch (error) {
    assertEquals(
      error instanceof Error ? error.message : String(error),
      "Atmosphere Login selection token did not include a kid",
    );
    return;
  }
  throw new Error("Expected missing token kid to throw");
});

function fakeToken(header: Record<string, unknown>): string {
  return `${b64uEncode(JSON.stringify(header))}.${
    b64uEncode(JSON.stringify({ sub: "did:example:test" }))
  }.signature`;
}

function b64uEncode(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(
    /=+$/,
    "",
  );
}

function jwkKid(jwk: JsonWebKey): string | undefined {
  const kid = (jwk as { kid?: unknown }).kid;
  return typeof kid === "string" ? kid : undefined;
}
