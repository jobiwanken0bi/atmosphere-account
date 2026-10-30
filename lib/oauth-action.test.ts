import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { OAuthCapability } from "./oauth-scopes.ts";
import {
  isOAuthActionCapabilityRequest,
  OAUTH_ACTIONS,
  type OAuthAction,
  oauthLoginUrl,
  oauthReauthorizationUrl,
  oauthSigninUrl,
} from "./oauth-action.ts";

Deno.test("contextual sign-in URLs preserve the action and allowlisted capabilities", () => {
  assertEquals(
    oauthSigninUrl({
      next: "/apps/grain?from=featured",
      action: "review",
      name: " Grain ",
      capabilities: ["review"],
    }),
    "/signin?next=%2Fapps%2Fgrain%3Ffrom%3Dfeatured&action=review&name=Grain&capability=review",
  );
});

Deno.test("combined actions keep each capability as a repeated parameter", () => {
  assertEquals(
    oauthLoginUrl({
      handle: "alice.example",
      next: "/account/products",
      action: "app_host",
      capabilities: ["app", "host"],
    }),
    "/oauth/login?next=%2Faccount%2Fproducts&action=app_host&capability=app&capability=host&handle=alice.example",
  );
});

Deno.test("contextual URLs never accept or emit a raw scope", () => {
  const href = oauthSigninUrl({
    next: "/hosts/example.com/manage",
    action: "host_manage",
    capabilities: ["host"],
  });
  const params = new URL(href, "https://atmosphereaccount.com").searchParams;
  assertEquals(params.get("scope"), null);
  assertEquals(params.getAll("capability"), ["host"]);
});

Deno.test("each OAuth action accepts only its intended capability bundles", () => {
  const validByAction = {
    account: [["identity"]],
    review: [["review"]],
    review_manage: [["review_manage"]],
    legacy_review: [["legacy_review"]],
    legacy_review_manage: [["legacy_review_manage"]],
    review_response: [["identity"]],
    report_review: [["identity"]],
    favorite: [["favorite"]],
    app: [["app"]],
    host_claim: [["host"]],
    host_transfer: [["host"]],
    host_manage: [["host"]],
    app_host: [["app", "host"]],
    developer: [["identity"]],
    relationship_confirm: [["identity"]],
    admin: [["identity"]],
  } as const satisfies Record<
    OAuthAction,
    readonly (readonly OAuthCapability[])[]
  >;

  // Iterating the exported catalog makes this test fail at compile time and
  // runtime when a new action is added without an explicit policy fixture.
  for (const action of OAUTH_ACTIONS) {
    for (const capabilities of validByAction[action]) {
      assertEquals(
        isOAuthActionCapabilityRequest(action, capabilities),
        true,
        `${action}: ${capabilities.join(",")}`,
      );
    }
  }

  assertEquals(isOAuthActionCapabilityRequest(null, ["identity"]), true);

  // Repeated parameters are normalized before this check at HTTP boundaries,
  // but treating them as a set also keeps the policy stable for internal URLs.
  assertEquals(
    isOAuthActionCapabilityRequest("app_host", ["host", "app", "app"]),
    true,
  );
});

Deno.test("OAuth action policy rejects cross-action and additive mismatches", () => {
  const invalid: Array<{
    action: OAuthAction | null;
    capabilities: OAuthCapability[];
  }> = [
    { action: null, capabilities: ["app"] },
    { action: "review", capabilities: ["legacy_review"] },
    { action: "legacy_review", capabilities: ["review"] },
    { action: "review_manage", capabilities: ["review"] },
    { action: "legacy_review_manage", capabilities: ["legacy_review"] },
    { action: "report_review", capabilities: ["review"] },
    { action: "host_claim", capabilities: ["identity"] },
    { action: "host_manage", capabilities: ["favorite"] },
    { action: "host_manage", capabilities: ["host", "identity"] },
    { action: "app", capabilities: ["app", "identity"] },
    { action: "app", capabilities: ["app", "host"] },
    { action: "app_host", capabilities: ["app"] },
    { action: "developer", capabilities: ["app"] },
    { action: "relationship_confirm", capabilities: ["host"] },
    { action: "admin", capabilities: ["app"] },
  ];

  for (const request of invalid) {
    assertEquals(
      isOAuthActionCapabilityRequest(request.action, request.capabilities),
      false,
      `${request.action ?? "default"}: ${request.capabilities.join(",")}`,
    );
  }

  assertEquals(
    isOAuthActionCapabilityRequest("not-an-action", ["identity"]),
    false,
  );
});

Deno.test("contextual URL builders fail closed on mismatched capabilities", () => {
  assertThrows(
    () =>
      oauthSigninUrl({
        next: "/apps/legacy",
        action: "review",
        capabilities: ["legacy_review"],
      }),
    TypeError,
    'Invalid capability bundle for OAuth action "review"',
  );

  assertEquals(
    oauthSigninUrl({
      next: "/apps/legacy",
      action: "legacy_review_manage",
      capabilities: ["legacy_review_manage"],
    }),
    "/signin?next=%2Fapps%2Flegacy&action=legacy_review_manage&capability=legacy_review_manage",
  );
});

Deno.test("contextual URL builders reject non-local return targets", () => {
  for (
    const next of [
      "https://evil.example/steal",
      "//evil.example/steal",
      "/\\evil.example/steal",
      "/account\nset-cookie: attacker=1",
    ]
  ) {
    assertThrows(
      () =>
        oauthSigninUrl({
          next,
          action: "account",
          capabilities: ["identity"],
        }),
      TypeError,
      "OAuth return target must be a local path",
    );
  }
});

Deno.test("review reporting requests identity only and keeps its action context", () => {
  assertEquals(
    oauthSigninUrl({
      next: "/apps/example.test",
      action: "report_review",
      name: "Example",
      capabilities: ["identity"],
    }),
    "/signin?next=%2Fapps%2Fexample.test&action=report_review&name=Example&capability=identity",
  );
  assertThrows(
    () =>
      oauthSigninUrl({
        next: "/apps/example.test",
        action: "report_review",
        capabilities: ["legacy_review"],
      }),
    TypeError,
    'Invalid capability bundle for OAuth action "report_review"',
  );
});

Deno.test("reauthorization URLs prevent a stale semantic grant from auto-continuing", () => {
  const href = oauthReauthorizationUrl({
    next: "/apps/example?review=compose",
    action: "review",
    capabilities: ["review"],
  });
  const params = new URL(href, "https://atmosphereaccount.com").searchParams;
  assertEquals(params.get("permission"), "required");
  assertEquals(params.get("next"), "/apps/example?review=compose");
});

Deno.test("OAuth target labels strip control and bidi formatting characters", () => {
  const hidden =
    "\u061c\u200b\u200c\u200d\u200e\u200f\u202a\u202b\u202c\u202d\u202e\u2060\u2061\u2062\u2063\u2064\u2065\u2066\u2067\u2068\u2069\u206a\u206b\u206c\u206d\u206e\u206f\ufeff";
  assertEquals(
    oauthSigninUrl({
      next: "/apps/example",
      action: "app",
      capabilities: ["app"],
      name: `Safe${hidden}\nname`,
    }).includes("name=Safe+name"),
    true,
  );
});
