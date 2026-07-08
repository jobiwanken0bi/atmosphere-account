import type { AtmosphereSelectionClaims } from "../../../lib/atmosphere-login-sdk.ts";
import type { LoginApp } from "../../../lib/atmosphere-login.ts";
import {
  canOriginReadSelectionVerification,
  selectionCorsHeaders,
  verifySelectionBinding,
} from "./selection.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
  }
}

function claims(
  overrides: Partial<AtmosphereSelectionClaims> = {},
): AtmosphereSelectionClaims {
  return {
    iss: "https://atmosphereaccount.com",
    aud: "https://app.example.com/oauth/client-metadata.json",
    sub: "did:plc:account",
    handle: "account.example.com",
    return_uri: "https://app.example.com/auth/atmosphere/selected",
    state: "state-123",
    app_name: "Example App",
    iat: 1_700_000_000,
    exp: 1_700_000_300,
    jti: "selection-token-id",
    ...overrides,
  };
}

function app(overrides: Partial<LoginApp> = {}): LoginApp {
  return {
    clientId: "https://app.example.com/oauth/client-metadata.json",
    appName: "Example App",
    appUri: "https://app.example.com",
    logoUri: "https://app.example.com/icon.png",
    allowedReturnUris: [
      "https://app.example.com/auth/atmosphere/selected",
    ],
    allowedOrigins: [],
    status: "trusted",
    reviewStatus: "approved",
    reviewRequestedAt: null,
    reviewNotes: null,
    reviewDecisionAt: null,
    reviewDecisionBy: null,
    reviewDecisionReason: null,
    contactDid: "did:plc:owner",
    registered: true,
    ...overrides,
  };
}

Deno.test("verifySelectionBinding accepts matching expected values", () => {
  assertEquals(
    verifySelectionBinding(claims(), {
      token: "token",
      expectedIssuer: "https://atmosphereaccount.com",
      expectedClientId: "https://app.example.com/oauth/client-metadata.json",
      expectedReturnUri: "https://app.example.com/auth/atmosphere/selected",
      expectedState: "state-123",
    }),
    null,
  );
});

Deno.test("verifySelectionBinding ignores return URI fragments", () => {
  assertEquals(
    verifySelectionBinding(
      claims({
        return_uri: "https://app.example.com/auth/atmosphere/selected#ignored",
      }),
      {
        token: "token",
        expectedIssuer: null,
        expectedClientId: null,
        expectedReturnUri: "https://app.example.com/auth/atmosphere/selected",
        expectedState: null,
      },
    ),
    null,
  );
});

Deno.test("verifySelectionBinding reports the first binding mismatch", () => {
  assertEquals(
    verifySelectionBinding(claims(), {
      token: "token",
      expectedIssuer: "https://other.atmosphere.example",
      expectedClientId: "https://other.example.com/client.json",
      expectedReturnUri: "https://app.example.com/other",
      expectedState: "other-state",
    }),
    "issuer mismatch",
  );
});

Deno.test("verifySelectionBinding reports audience mismatch after issuer matches", () => {
  assertEquals(
    verifySelectionBinding(claims(), {
      token: "token",
      expectedIssuer: "https://atmosphereaccount.com",
      expectedClientId: "https://other.example.com/client.json",
      expectedReturnUri: "https://app.example.com/other",
      expectedState: "other-state",
    }),
    "audience mismatch",
  );
});

Deno.test("verifySelectionBinding reports return URI mismatch", () => {
  assertEquals(
    verifySelectionBinding(claims(), {
      token: "token",
      expectedIssuer: null,
      expectedClientId: null,
      expectedReturnUri: "https://app.example.com/other",
      expectedState: null,
    }),
    "return URI mismatch",
  );
});

Deno.test("verifySelectionBinding treats malformed expected return URIs as mismatches", () => {
  assertEquals(
    verifySelectionBinding(claims(), {
      token: "token",
      expectedIssuer: null,
      expectedClientId: null,
      expectedReturnUri: "not a url",
      expectedState: null,
    }),
    "return URI mismatch",
  );
});

Deno.test("verifySelectionBinding treats malformed token return URIs as mismatches", () => {
  assertEquals(
    verifySelectionBinding(claims({ return_uri: "not a url" }), {
      token: "token",
      expectedIssuer: null,
      expectedClientId: null,
      expectedReturnUri: "https://app.example.com/auth/atmosphere/selected",
      expectedState: null,
    }),
    "return URI mismatch",
  );
});

Deno.test("selection verifier CORS allows a registered app return origin", () => {
  assertEquals(
    canOriginReadSelectionVerification(
      "https://app.example.com",
      {
        token: "token",
        expectedIssuer: null,
        expectedClientId: "https://app.example.com/oauth/client-metadata.json",
        expectedReturnUri:
          "https://app.example.com/auth/atmosphere/selected#ignored",
        expectedState: "state-123",
      },
      app(),
    ),
    true,
  );
});

Deno.test("selection verifier CORS rejects sibling origins and unregistered production apps", () => {
  const input = {
    token: "token",
    expectedIssuer: null,
    expectedClientId: "https://app.example.com/oauth/client-metadata.json",
    expectedReturnUri: "https://app.example.com/auth/atmosphere/selected",
    expectedState: "state-123",
  };
  assertEquals(
    canOriginReadSelectionVerification(
      "https://evil.example.com",
      input,
      app(),
    ),
    false,
  );
  assertEquals(
    canOriginReadSelectionVerification(
      "https://app.example.com",
      input,
      null,
      { dev: false },
    ),
    false,
  );
});

Deno.test("selection verifier CORS rejects blocked apps", () => {
  assertEquals(
    canOriginReadSelectionVerification(
      "https://app.example.com",
      {
        token: "token",
        expectedIssuer: null,
        expectedClientId: "https://app.example.com/oauth/client-metadata.json",
        expectedReturnUri: "https://app.example.com/auth/atmosphere/selected",
        expectedState: "state-123",
      },
      app({ status: "blocked" }),
    ),
    false,
  );
});

Deno.test("selection verifier CORS permits loopback-only unregistered dev apps", () => {
  assertEquals(
    canOriginReadSelectionVerification(
      "http://127.0.0.1:5173",
      {
        token: "token",
        expectedIssuer: null,
        expectedClientId:
          "http://localhost/?redirect_uri=http%3A%2F%2F127.0.0.1%3A5173%2Fcallback",
        expectedReturnUri: "http://127.0.0.1:5173/callback",
        expectedState: "state-123",
      },
      null,
      { dev: true },
    ),
    true,
  );
});

Deno.test("selectionCorsHeaders reflects only allowed actual request origins", async () => {
  const req = new Request(
    "https://login.atmosphereaccount.com/api/login/selection",
    {
      method: "POST",
      headers: { origin: "https://app.example.com" },
    },
  );
  const headers = await selectionCorsHeaders(req, {
    token: "token",
    expectedIssuer: null,
    expectedClientId: "https://app.example.com/oauth/client-metadata.json",
    expectedReturnUri: "https://app.example.com/auth/atmosphere/selected",
    expectedState: "state-123",
  }, {
    getLoginApp: () => Promise.resolve(app()),
  });
  assertEquals(
    headers.get("access-control-allow-origin"),
    "https://app.example.com",
  );
  assertEquals(headers.get("vary"), "origin");
});

Deno.test("selectionCorsHeaders does not expose actual responses to mismatched origins", async () => {
  const req = new Request(
    "https://login.atmosphereaccount.com/api/login/selection",
    {
      method: "POST",
      headers: { origin: "https://evil.example.com" },
    },
  );
  const headers = await selectionCorsHeaders(req, {
    token: "token",
    expectedIssuer: null,
    expectedClientId: "https://app.example.com/oauth/client-metadata.json",
    expectedReturnUri: "https://app.example.com/auth/atmosphere/selected",
    expectedState: "state-123",
  }, {
    getLoginApp: () => Promise.resolve(app()),
  });
  assertEquals(headers.get("access-control-allow-origin"), null);
  assertEquals(headers.get("vary"), "origin");
});
