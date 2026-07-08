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
      "Atmosphere Login JWKS did not include key current",
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

Deno.test("fetchAtmosphereLoginPublicJwkForToken selects the token kid from JWKS", async () => {
  clearAtmosphereLoginJwksCache();
  const token = fakeToken({ alg: "ES256", kid: "current" });

  const selected = await fetchAtmosphereLoginPublicJwkForToken(
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

Deno.test("fetchAtmosphereLoginPublicJwk caches JWKS within the cache TTL", async () => {
  clearAtmosphereLoginJwksCache();
  let fetchCount = 0;
  const fetchImpl = (): Promise<Response> => {
    fetchCount++;
    return Promise.resolve(
      new Response(JSON.stringify({
        keys: [{ kid: "current", kty: "EC" }],
      })),
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
    return Promise.resolve(new Response(JSON.stringify({ keys })));
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

function fakeToken(header: Record<string, unknown>): string {
  return `${b64uEncode(JSON.stringify(header))}.${
    b64uEncode(JSON.stringify({ sub: "did:example:test" }))
  }.signature`;
}

function jwkKid(jwk: JsonWebKey): string | undefined {
  const kid = (jwk as { kid?: unknown }).kid;
  return typeof kid === "string" ? kid : undefined;
}
