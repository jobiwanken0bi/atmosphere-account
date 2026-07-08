import type { AtmosphereSelectionClaims } from "../../../lib/atmosphere-login-sdk.ts";
import { verifySelectionBinding } from "./selection.ts";

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
