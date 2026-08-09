import {
  clearAtmosphereLoginJwksCache,
  fetchAtmosphereLoginPublicJwk,
  fetchAtmosphereLoginPublicJwkForToken,
  readAtmosphereLoginTokenKid,
  selectAtmosphereLoginPublicJwk,
  verifyAtmosphereLoginCallback,
} from "./atmosphere-login-verifier.ts";
import { b64uEncode } from "./jose.ts";

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
  expectedState: "expected-state",
};

Deno.test("verifyAtmosphereLoginCallback rejects malformed callback URLs without throwing", async () => {
  const result = await verifyAtmosphereLoginCallback({
    ...VERIFY_BASE,
    url: "not a url",
  });

  assertEquals(result.ok, false);
  assertEquals(result.ok ? null : result.error, "invalid callback URL");
});

Deno.test("verifyAtmosphereLoginCallback requires caller-retained state", async () => {
  const url = new URL(VERIFY_BASE.expectedReturnUri);
  url.searchParams.set("selection_token", "not-a-real-token");
  url.searchParams.set("client_id", VERIFY_BASE.expectedClientId);

  const result = await verifyAtmosphereLoginCallback({
    ...VERIFY_BASE,
    url,
    expectedState: "",
  });

  assertEquals(result.ok, false);
  assertEquals(result.ok ? null : result.error, "missing expected state");
});

Deno.test("verifyAtmosphereLoginCallback rejects duplicate and oversized callback tokens", async () => {
  const duplicate = await verifyAtmosphereLoginCallback({
    ...VERIFY_BASE,
    url:
      `${VERIFY_BASE.expectedReturnUri}?selection_token=one&selection_token=two&client_id=${
        encodeURIComponent(VERIFY_BASE.expectedClientId)
      }&state=expected-state`,
  });
  assertEquals(
    duplicate.ok ? null : duplicate.error,
    "duplicate callback parameter",
  );

  const url = new URL(VERIFY_BASE.expectedReturnUri);
  url.searchParams.set("selection_token", "x".repeat(8_193));
  url.searchParams.set("client_id", VERIFY_BASE.expectedClientId);
  url.searchParams.set("state", VERIFY_BASE.expectedState);
  const oversized = await verifyAtmosphereLoginCallback({
    ...VERIFY_BASE,
    url,
  });
  assertEquals(
    oversized.ok ? null : oversized.error,
    "selection_token is too large",
  );
});

Deno.test("selectAtmosphereLoginPublicJwk selects the requested kid", () => {
  const selected = selectAtmosphereLoginPublicJwk({
    keys: [
      { kid: "old", kty: "EC" },
      { kid: "current", kty: "EC" },
    ],
  }, "current");

  assertEquals(jwkKid(selected), "current");
});

Deno.test("selectAtmosphereLoginPublicJwk fails when the requested kid is absent", () => {
  try {
    selectAtmosphereLoginPublicJwk(
      { keys: [{ kid: "old", kty: "EC" }] },
      "current",
    );
  } catch (error) {
    assertEquals(
      error instanceof Error ? error.message : String(error),
      "Login with Atmosphere JWKS did not include key current",
    );
    return;
  }
  throw new Error("Expected missing kid to throw");
});

Deno.test("readAtmosphereLoginTokenKid reads kid from the token header", () => {
  const token = fakeToken({ alg: "ES256", kid: "current" });

  assertEquals(readAtmosphereLoginTokenKid(token), "current");
});

Deno.test("fetchAtmosphereLoginPublicJwk selects the requested kid from JWKS", async () => {
  clearAtmosphereLoginJwksCache();
  const selected = await fetchAtmosphereLoginPublicJwk(
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

Deno.test("fetchAtmosphereLoginPublicJwkForToken selects the token kid from JWKS", async () => {
  clearAtmosphereLoginJwksCache();
  const token = fakeToken({ alg: "ES256", kid: "current" });

  const selected = await fetchAtmosphereLoginPublicJwkForToken(
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

Deno.test("fetchAtmosphereLoginPublicJwkForToken requires a token kid", async () => {
  clearAtmosphereLoginJwksCache();
  const token = fakeToken({ alg: "ES256" });

  try {
    await fetchAtmosphereLoginPublicJwkForToken(
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

Deno.test("fetchAtmosphereLoginPublicJwk caches JWKS within the cache TTL", async () => {
  clearAtmosphereLoginJwksCache();
  let fetchCount = 0;
  const fetchImpl = (): Promise<Response> => {
    fetchCount++;
    return Promise.resolve(
      jsonResponse({
        keys: [{ kid: "current", kty: "EC" }],
      }),
    );
  };

  await fetchAtmosphereLoginPublicJwk("https://login.example", {
    kid: "current",
    fetchImpl,
  });
  await fetchAtmosphereLoginPublicJwk("https://login.example", {
    kid: "current",
    fetchImpl,
  });

  assertEquals(fetchCount, 1);
});

Deno.test("fetchAtmosphereLoginPublicJwk refreshes cached JWKS on kid miss", async () => {
  clearAtmosphereLoginJwksCache();
  let fetchCount = 0;
  const fetchImpl = (): Promise<Response> => {
    fetchCount++;
    const keys = fetchCount === 1
      ? [{ kid: "old", kty: "EC" }]
      : [{ kid: "current", kty: "EC" }];
    return Promise.resolve(jsonResponse({ keys }));
  };

  await fetchAtmosphereLoginPublicJwk("https://login.example", {
    kid: "old",
    fetchImpl,
  });
  const selected = await fetchAtmosphereLoginPublicJwk(
    "https://login.example",
    {
      kid: "current",
      fetchImpl,
    },
  );

  assertEquals(jwkKid(selected), "current");
  assertEquals(fetchCount, 2);
});

Deno.test("fetchAtmosphereLoginPublicJwk requires a JSON media type", async () => {
  clearAtmosphereLoginJwksCache();
  try {
    await fetchAtmosphereLoginPublicJwk("https://login.example", {
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

Deno.test("fetchAtmosphereLoginPublicJwk bounds streamed JWKS bodies", async () => {
  clearAtmosphereLoginJwksCache();
  try {
    await fetchAtmosphereLoginPublicJwk("https://login.example", {
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

Deno.test("fetchAtmosphereLoginPublicJwk times out a stalled JWKS body", async () => {
  clearAtmosphereLoginJwksCache();
  try {
    await fetchAtmosphereLoginPublicJwk("https://login.example", {
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

function jwkKid(jwk: JsonWebKey): string | undefined {
  const kid = (jwk as { kid?: unknown }).kid;
  return typeof kid === "string" ? kid : undefined;
}
