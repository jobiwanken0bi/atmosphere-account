import {
  type AtmosphereSelectionClaims,
  verifyAtmosphereSelectionToken,
} from "./atmosphere-login-sdk.ts";
import { generateEs256KeyPair, signEs256 } from "./jose.ts";

function assert(
  condition: unknown,
  message = "Assertion failed",
): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`Expected ${e}, got ${a}`);
}

async function signedSelection(
  claims: Partial<AtmosphereSelectionClaims> = {},
) {
  const { privateKey, publicJwk } = await generateEs256KeyPair();
  const payload: AtmosphereSelectionClaims = {
    iss: "https://atmosphereaccount.com",
    aud: "https://app.example/oauth/client-metadata.json",
    sub: "did:plc:user",
    handle: "user.example",
    pds_url: "https://pds.example",
    return_uri: "https://app.example/auth/atmosphere/selected",
    state: "state-123",
    app_name: "Example App",
    iat: 1_000,
    exp: 1_120,
    jti: "selection-12345",
    ...claims,
  };
  const token = await signEs256({
    header: { typ: "atmosphere-login+jwt", kid: "test" },
    payload: payload as unknown as Record<string, unknown>,
    privateKey,
  });
  return { token, publicJwk, payload };
}

Deno.test("verifyAtmosphereSelectionToken accepts a valid signed selection", async () => {
  const { token, publicJwk } = await signedSelection();
  const result = await verifyAtmosphereSelectionToken({
    token,
    publicJwk,
    expectedIssuer: "https://atmosphereaccount.com",
    expectedAudience: "https://app.example/oauth/client-metadata.json",
    expectedState: "state-123",
    expectedReturnUri: "https://app.example/auth/atmosphere/selected",
    nowSec: 1_010,
  });

  assert(result.ok, result.ok ? undefined : result.error);
  assertEquals(result.claims.sub, "did:plc:user");
  assertEquals(result.claims.pds_url, "https://pds.example");
});

Deno.test("verifyAtmosphereSelectionToken rejects state mismatch", async () => {
  const { token, publicJwk } = await signedSelection();
  const result = await verifyAtmosphereSelectionToken({
    token,
    publicJwk,
    expectedState: "other-state",
    nowSec: 1_010,
  });

  assertEquals(result.ok, false);
  assertEquals(result.ok ? null : result.error, "state mismatch");
});

Deno.test("verifyAtmosphereSelectionToken rejects malformed expected return URIs without throwing", async () => {
  const { token, publicJwk } = await signedSelection();
  const result = await verifyAtmosphereSelectionToken({
    token,
    publicJwk,
    expectedReturnUri: "not a url",
    nowSec: 1_010,
  });

  assertEquals(result.ok, false);
  assertEquals(result.ok ? null : result.error, "return URI mismatch");
});

Deno.test("verifyAtmosphereSelectionToken rejects expired selections", async () => {
  const { token, publicJwk } = await signedSelection();
  const result = await verifyAtmosphereSelectionToken({
    token,
    publicJwk,
    nowSec: 1_121,
  });

  assertEquals(result.ok, false);
  assertEquals(result.ok ? null : result.error, "expired token");
});

Deno.test("verifyAtmosphereSelectionToken rejects replayed selections when a replay store is supplied", async () => {
  const { token, publicJwk, payload } = await signedSelection();
  const seen = new Map<string, number>();
  const replayStore = {
    has(jti: string) {
      return seen.has(jti);
    },
    add(jti: string, expiresAtSec: number) {
      seen.set(jti, expiresAtSec);
    },
  };

  const first = await verifyAtmosphereSelectionToken({
    token,
    publicJwk,
    replayStore,
    nowSec: 1_010,
  });
  const second = await verifyAtmosphereSelectionToken({
    token,
    publicJwk,
    replayStore,
    nowSec: 1_011,
  });

  assert(first.ok, first.ok ? undefined : first.error);
  assertEquals(seen.get(payload.jti), payload.exp);
  assertEquals(second.ok, false);
  assertEquals(second.ok ? null : second.error, "replayed token");
});

Deno.test("verifyAtmosphereSelectionToken prefers atomic replay consumption", async () => {
  const { token, publicJwk, payload } = await signedSelection();
  const consumed = new Set<string>();
  const replayStore = {
    has(_jti: string) {
      throw new Error("has should not be called when consume is available");
    },
    add(_jti: string, _expiresAtSec: number) {
      throw new Error("add should not be called when consume is available");
    },
    consume(jti: string, expiresAtSec: number) {
      assertEquals(expiresAtSec, payload.exp);
      if (consumed.has(jti)) return false;
      consumed.add(jti);
      return true;
    },
  };

  const first = await verifyAtmosphereSelectionToken({
    token,
    publicJwk,
    replayStore,
    nowSec: 1_010,
  });
  const second = await verifyAtmosphereSelectionToken({
    token,
    publicJwk,
    replayStore,
    nowSec: 1_011,
  });

  assert(first.ok, first.ok ? undefined : first.error);
  assertEquals(consumed.has(payload.jti), true);
  assertEquals(second.ok, false);
  assertEquals(second.ok ? null : second.error, "replayed token");
});

Deno.test("verifyAtmosphereSelectionToken rejects malformed core claims", async () => {
  const { token, publicJwk } = await signedSelection({
    handle: "@user.example",
  });
  const result = await verifyAtmosphereSelectionToken({
    token,
    publicJwk,
    nowSec: 1_010,
  });

  assertEquals(result.ok, false);
  assertEquals(result.ok ? null : result.error, "invalid claims");
});

Deno.test("verifyAtmosphereSelectionToken rejects non-loopback HTTP claims", async () => {
  const { token, publicJwk } = await signedSelection({
    return_uri: "http://app.example/auth/atmosphere/selected",
  });
  const result = await verifyAtmosphereSelectionToken({
    token,
    publicJwk,
    nowSec: 1_010,
  });

  assertEquals(result.ok, false);
  assertEquals(result.ok ? null : result.error, "invalid claims");
});
