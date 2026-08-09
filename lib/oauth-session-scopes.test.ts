import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  classifySessionScopeReplacementForTest,
  deleteSessionIfUnchangedForTest,
  grantedScopeForSession,
  oauthClientIdForSessionForTest,
  persistentExistingSessionPolicyForTest,
  sameRefreshAuthorizationForTest,
  type SessionData,
  shouldPersistOAuthSessionForTest,
  tokenResponseScopeForTest,
} from "./oauth.ts";

function session(scope?: string): SessionData {
  return {
    did: "did:plc:alice",
    handle: "alice.example",
    pdsUrl: "https://pds.example",
    asIssuer: "https://auth.example",
    accessToken: "access",
    refreshToken: "refresh",
    expiresAt: Date.now() + 60_000,
    dpopPrivateJwk: {},
    dpopPublicJwk: {},
    scope,
  };
}

Deno.test("pre-progressive sessions are conservatively identity-only", () => {
  assertEquals(grantedScopeForSession(session()), "atproto");
});

Deno.test("scope replacement preserves broader and racing grants", () => {
  const app = "atproto repo:community.lexicon.app.profile";
  const host = "atproto repo:account.atmosphere.host.profile";
  const both = `${app} repo:account.atmosphere.host.profile`;

  assertEquals(
    classifySessionScopeReplacementForTest(app, both),
    "replace",
  );
  assertEquals(
    classifySessionScopeReplacementForTest(both, app),
    "narrower",
  );
  assertEquals(
    classifySessionScopeReplacementForTest(app, host),
    "conflict",
  );
});

Deno.test("scope replacement does not equate dynamic includes with direct grants", () => {
  const include = "atproto include:fyi.atstore.authThirdPartyReviews";
  const direct =
    "atproto repo:fyi.atstore.profile?action=create repo:fyi.atstore.listing.review?action=create";
  assertEquals(
    classifySessionScopeReplacementForTest(direct, include),
    "conflict",
  );
  assertEquals(
    classifySessionScopeReplacementForTest(include, direct),
    "conflict",
  );
});

Deno.test("login-selection OAuth never persists its token session", () => {
  assertEquals(
    shouldPersistOAuthSessionForTest(undefined, "login_selection"),
    false,
  );
  assertEquals(
    shouldPersistOAuthSessionForTest(true, "login_selection"),
    false,
  );
  assertEquals(shouldPersistOAuthSessionForTest(undefined, undefined), true);
  assertEquals(shouldPersistOAuthSessionForTest(false, undefined), false);
});

Deno.test("persistent identity login validates stale rows without unioning their scopes", () => {
  assertEquals(
    persistentExistingSessionPolicyForTest(["identity"], true, undefined),
    { validateForReplacement: true, unionValidScope: false },
  );
  assertEquals(
    persistentExistingSessionPolicyForTest(["app"], true, undefined),
    { validateForReplacement: true, unionValidScope: true },
  );
  assertEquals(
    persistentExistingSessionPolicyForTest(["app"], true, false),
    { validateForReplacement: true, unionValidScope: false },
  );
  assertEquals(
    persistentExistingSessionPolicyForTest(["app"], false, undefined),
    { validateForReplacement: false, unionValidScope: false },
  );
});

Deno.test("refresh authorization retains the exact issuing OAuth client", () => {
  const legacy = session("atproto");
  const legacyDefault = oauthClientIdForSessionForTest(legacy);
  const explicitDefault = { ...legacy, oauthClientId: legacyDefault };
  const loginOrigin = {
    ...legacy,
    oauthClientId:
      "https://login.atmosphereaccount.com/oauth/client-metadata.json",
  };

  assertEquals(
    oauthClientIdForSessionForTest(loginOrigin),
    loginOrigin.oauthClientId,
  );
  assertEquals(
    sameRefreshAuthorizationForTest(legacy, explicitDefault),
    true,
  );
  assertEquals(
    sameRefreshAuthorizationForTest(explicitDefault, loginOrigin),
    false,
  );
});

Deno.test("invalid-session deletion is compare-and-swap guarded", async () => {
  const current = session("atproto repo:example.collection");
  const calls: Array<{ sql: string; args: unknown[] }> = [];
  const deleted = await deleteSessionIfUnchangedForTest(
    {
      execute(query) {
        calls.push(query);
        return Promise.resolve({ rowsAffected: 1 });
      },
    },
    current,
  );
  assertEquals(deleted, true);
  assertEquals(calls, [{
    sql: "DELETE FROM oauth_session WHERE did = ? AND value = ?",
    args: [current.did, JSON.stringify(current)],
  }]);

  const raced = await deleteSessionIfUnchangedForTest(
    {
      execute: () => Promise.resolve({ rowsAffected: 0 }),
    },
    current,
  );
  assertEquals(raced, false);
});

Deno.test("token responses require one consistent normative scope field", () => {
  const valid = {
    access_token: "access",
    refresh_token: "refresh",
    token_type: "DPoP",
    expires_in: 300,
    scope: "atproto repo:example.collection",
    sub: "did:plc:alice",
  };
  assertEquals(
    tokenResponseScopeForTest(valid),
    "atproto repo:example.collection",
  );
  assertEquals(
    tokenResponseScopeForTest({
      ...valid,
      scopes: "repo:example.collection atproto",
    }),
    "atproto repo:example.collection",
  );
  assertThrows(
    () => tokenResponseScopeForTest({ ...valid, scope: undefined }),
    Error,
    "missing scope",
  );
  assertThrows(
    () =>
      tokenResponseScopeForTest({
        ...valid,
        scopes: "atproto repo:other.collection",
      }),
    Error,
    "inconsistent scope fields",
  );
});
