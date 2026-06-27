import {
  type AtmosphereSelectionClaims,
  verifyAtmosphereSelectionToken,
} from "./atmosphere-login-sdk.ts";
import {
  buildExampleAppSessionCookie,
  buildExampleOAuthStartPath,
  exampleAtprotoOAuthCallbackUri,
  exampleAtprotoOAuthClientId,
  readExampleAppSession,
} from "./example-atproto-oauth.ts";
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

Deno.test("example handoff verifies selection and builds app OAuth start URL", async () => {
  const origin = "http://127.0.0.1:5174";
  const { privateKey, publicJwk } = await generateEs256KeyPair();
  const claims: AtmosphereSelectionClaims = {
    iss: origin,
    aud: new URL(
      "/examples/atmosphere-login/client-metadata.json",
      origin,
    ).toString(),
    sub: "did:plc:user",
    handle: "user.example",
    pds_url: "https://bsky.social",
    return_uri: new URL("/examples/atmosphere-login/callback", origin)
      .toString(),
    state: "state-123",
    app_name: "Atmosphere Login reference app",
    iat: 1_000,
    exp: 1_120,
    jti: "selection-123",
  };
  const token = await signEs256({
    header: { typ: "atmosphere-login+jwt", kid: "test" },
    payload: claims as unknown as Record<string, unknown>,
    privateKey,
  });

  const verified = await verifyAtmosphereSelectionToken({
    token,
    publicJwk,
    expectedIssuer: origin,
    expectedAudience: claims.aud,
    expectedState: claims.state,
    expectedReturnUri: claims.return_uri,
    nowSec: 1_010,
  });

  assert(verified.ok, verified.ok ? undefined : verified.error);
  assertEquals(
    buildExampleOAuthStartPath({
      handle: verified.claims.handle,
      did: verified.claims.sub,
    }),
    "/examples/atmosphere-login/oauth/start?handle=user.example&did=did%3Aplc%3Auser",
  );
});

Deno.test("example OAuth metadata helpers use the example app routes", () => {
  const origin = "https://app.example";
  assertEquals(
    exampleAtprotoOAuthClientId(origin),
    "https://app.example/examples/atmosphere-login/oauth/client-metadata.json",
  );
  assertEquals(
    exampleAtprotoOAuthCallbackUri(origin),
    "https://app.example/examples/atmosphere-login/oauth/callback",
  );
});

Deno.test("example app session cookie is separate and readable", async () => {
  const cookie = await buildExampleAppSessionCookie({
    did: "did:plc:user",
    handle: "user.example",
    pdsUrl: "https://bsky.social",
  });
  const cookiePair = cookie.split(";")[0];
  const session = await readExampleAppSession(
    new Request("https://app.example/examples/atmosphere-login/app", {
      headers: { cookie: cookiePair },
    }),
  );

  assert(session, "expected example app session");
  assertEquals(session.did, "did:plc:user");
  assertEquals(session.handle, "user.example");
  assertEquals(session.pdsUrl, "https://bsky.social");
});
