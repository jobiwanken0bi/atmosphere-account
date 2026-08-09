type VerifyAtmosphereLoginCallback = (options: {
  url: string | URL;
  publicJwk: JsonWebKey;
  expectedIssuer: string;
  expectedClientId: string;
  expectedReturnUri: string;
  expectedState: string;
}) => Promise<{ ok: boolean; error?: string }>;

type StaticServerHelperModule = {
  clearAtmosphereLoginJwksCache: () => void;
  fetchAtmosphereLoginPublicJwk: (
    atmosphereOrigin?: string,
    options?: {
      kid?: string | null;
      cache?: boolean;
      cacheTtlMs?: number;
      maxResponseBytes?: number;
      timeoutMs?: number;
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
  expectedState: "expected-state",
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

Deno.test("static server helper requires caller-retained state", async () => {
  const verify = await verifier();
  const url = new URL(VERIFY_BASE.expectedReturnUri);
  url.searchParams.set("selection_token", "not-a-real-token");
  url.searchParams.set("client_id", VERIFY_BASE.expectedClientId);

  const result = await verify({
    ...VERIFY_BASE,
    url,
    expectedState: "",
  });

  assertEquals(result.ok, false);
  assertEquals(result.error, "missing expected state");
});

Deno.test("static server helper rejects duplicate and oversized callback tokens", async () => {
  const verify = await verifier();
  const duplicate = await verify({
    ...VERIFY_BASE,
    url:
      `${VERIFY_BASE.expectedReturnUri}?selection_token=one&selection_token=two&client_id=${
        encodeURIComponent(VERIFY_BASE.expectedClientId)
      }&state=expected-state`,
  });
  assertEquals(duplicate.error, "duplicate callback parameter");

  const url = new URL(VERIFY_BASE.expectedReturnUri);
  url.searchParams.set("selection_token", "x".repeat(8_193));
  url.searchParams.set("client_id", VERIFY_BASE.expectedClientId);
  url.searchParams.set("state", VERIFY_BASE.expectedState);
  const oversized = await verify({ ...VERIFY_BASE, url });
  assertEquals(oversized.error, "selection_token is too large");
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
      "Login with Atmosphere JWKS did not include key current",
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
  helper.clearAtmosphereLoginJwksCache();

  const selected = await helper.fetchAtmosphereLoginPublicJwk(
    "https://login.example",
    {
      kid: "current",
      fetchImpl: () =>
        Promise.resolve(
          jsonResponse({
            keys: [
              { kid: "old", kty: "EC" },
              { kid: "current", kty: "EC" },
            ],
          }),
        ),
    },
  );

  assertEquals(jwkKid(selected), "current");
});

Deno.test("static server helper fetches the token kid from JWKS", async () => {
  const helper = await serverHelper();
  helper.clearAtmosphereLoginJwksCache();
  const token = fakeToken({ alg: "ES256", kid: "current" });

  const selected = await helper.fetchAtmosphereLoginPublicJwkForToken(
    token,
    "https://login.example",
    {
      fetchImpl: () =>
        Promise.resolve(
          jsonResponse({
            keys: [
              { kid: "old", kty: "EC" },
              { kid: "current", kty: "EC" },
            ],
          }),
        ),
    },
  );

  assertEquals(jwkKid(selected), "current");
});

Deno.test("static server helper requires a token kid for token JWKS fetch", async () => {
  const helper = await serverHelper();
  helper.clearAtmosphereLoginJwksCache();
  const token = fakeToken({ alg: "ES256" });

  try {
    await helper.fetchAtmosphereLoginPublicJwkForToken(
      token,
      "https://login.example",
      {
        fetchImpl: () =>
          Promise.resolve(
            jsonResponse({
              keys: [{ kid: "current", kty: "EC" }],
            }),
          ),
      },
    );
  } catch (error) {
    assertEquals(
      error instanceof Error ? error.message : String(error),
      "Login with Atmosphere selection token did not include a kid",
    );
    return;
  }
  throw new Error("Expected missing token kid to throw");
});

Deno.test("static server helper caches JWKS within the cache TTL", async () => {
  const helper = await serverHelper();
  helper.clearAtmosphereLoginJwksCache();
  let fetchCount = 0;
  const fetchImpl = (): Promise<Response> => {
    fetchCount++;
    return Promise.resolve(
      jsonResponse({
        keys: [{ kid: "current", kty: "EC" }],
      }),
    );
  };

  await helper.fetchAtmosphereLoginPublicJwk("https://login.example", {
    kid: "current",
    fetchImpl,
  });
  await helper.fetchAtmosphereLoginPublicJwk("https://login.example", {
    kid: "current",
    fetchImpl,
  });

  assertEquals(fetchCount, 1);
});

Deno.test("static server helper refreshes cached JWKS on kid miss", async () => {
  const helper = await serverHelper();
  helper.clearAtmosphereLoginJwksCache();
  let fetchCount = 0;
  const fetchImpl = (): Promise<Response> => {
    fetchCount++;
    const keys = fetchCount === 1
      ? [{ kid: "old", kty: "EC" }]
      : [{ kid: "current", kty: "EC" }];
    return Promise.resolve(jsonResponse({ keys }));
  };

  await helper.fetchAtmosphereLoginPublicJwk("https://login.example", {
    kid: "old",
    fetchImpl,
  });
  const selected = await helper.fetchAtmosphereLoginPublicJwk(
    "https://login.example",
    {
      kid: "current",
      fetchImpl,
    },
  );

  assertEquals(jwkKid(selected), "current");
  assertEquals(fetchCount, 2);
});

Deno.test("static server helper requires a JSON JWKS media type", async () => {
  const helper = await serverHelper();
  helper.clearAtmosphereLoginJwksCache();
  try {
    await helper.fetchAtmosphereLoginPublicJwk("https://login.example", {
      cache: false,
      fetchImpl: () =>
        Promise.resolve(
          new Response('{"keys":[]}', {
            headers: { "content-type": "text/html" },
          }),
        ),
    });
  } catch (error) {
    assertEquals(
      error instanceof Error ? error.message : String(error),
      "Atmosphere Login JWKS response was not JSON",
    );
    return;
  }
  throw new Error("Expected a non-JSON JWKS response to be rejected");
});

Deno.test("static server helper bounds streamed JWKS bodies", async () => {
  const helper = await serverHelper();
  helper.clearAtmosphereLoginJwksCache();
  try {
    await helper.fetchAtmosphereLoginPublicJwk("https://login.example", {
      cache: false,
      maxResponseBytes: 16,
      fetchImpl: () =>
        Promise.resolve(jsonResponse({
          keys: [{ kid: "current", kty: "EC" }],
        })),
    });
  } catch (error) {
    assertEquals(
      error instanceof Error ? error.message : String(error),
      "Atmosphere Login JWKS response was too large",
    );
    return;
  }
  throw new Error("Expected an oversized JWKS response to be rejected");
});

Deno.test("static server helper times out a stalled JWKS body", async () => {
  const helper = await serverHelper();
  helper.clearAtmosphereLoginJwksCache();
  try {
    await helper.fetchAtmosphereLoginPublicJwk("https://login.example", {
      cache: false,
      timeoutMs: 5,
      fetchImpl: () => Promise.resolve(stalledJsonResponse()),
    });
  } catch (error) {
    assertEquals(
      error instanceof Error ? error.message : String(error),
      "Atmosphere Login JWKS request timed out",
    );
    return;
  }
  throw new Error("Expected a stalled JWKS response to time out");
});

function fakeToken(header: Record<string, unknown>): string {
  return `${b64uEncode(JSON.stringify(header))}.${
    b64uEncode(JSON.stringify({ sub: "did:example:test" }))
  }.signature`;
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    headers: { "content-type": "application/json" },
  });
}

function stalledJsonResponse(): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"keys":['));
      },
    }),
    { headers: { "content-type": "application/json" } },
  );
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
