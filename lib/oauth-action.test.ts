import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { OAuthCapability } from "./oauth-scopes.ts";
import {
  accountCreationErrorMessage,
  APP_HOST_MANAGEMENT_CAPABILITIES,
  APP_MANAGEMENT_CAPABILITIES,
  HOST_MANAGEMENT_CAPABILITIES,
  isAccountCreationAction,
  isOAuthActionCapabilityRequest,
  type OAuthAction,
  oauthCreateAccountUrl,
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

Deno.test("canonical create-account URLs preserve exact action context", () => {
  const href = oauthCreateAccountUrl({
    next: "/apps/tangled?review=compose",
    intent: "user",
    action: "review",
    name: "Tangled",
    capabilities: ["review"],
  });
  const url = new URL(href, "https://atmosphereaccount.com");
  assertEquals(url.pathname, "/signin");
  assertEquals(url.searchParams.get("mode"), "create");
  assertEquals(url.searchParams.get("next"), "/apps/tangled?review=compose");
  assertEquals(url.searchParams.get("action"), "review");
  assertEquals(url.searchParams.get("name"), "Tangled");
  assertEquals(url.searchParams.get("intent"), "user");
  assertEquals(url.searchParams.getAll("capability"), ["review"]);
});

Deno.test("account creation is limited to actions a new DID can complete", () => {
  for (
    const action of [
      "account",
      "review",
      "legacy_review",
      "favorite",
      "app",
      "host_claim",
      "host_transfer",
    ] as const
  ) {
    assertEquals(isAccountCreationAction(action), true, action);
  }
  for (
    const action of [
      "review_manage",
      "legacy_review_manage",
      "host_manage",
      "app_host",
      "developer",
    ] as const
  ) {
    assertEquals(isAccountCreationAction(action), false, action);
  }
  assertThrows(
    () =>
      oauthCreateAccountUrl({
        next: "/account/developer/apps",
        action: "developer",
        capabilities: ["identity"],
      }),
    TypeError,
    'Account creation is not available for OAuth action "developer"',
  );
});

Deno.test("account-creation errors map to safe retry copy", () => {
  assertEquals(
    accountCreationErrorMessage("authorization_cancelled")?.includes(
      "cancelled",
    ),
    true,
  );
  assertEquals(accountCreationErrorMessage(null), null);
});

Deno.test("combined actions keep each capability as a repeated parameter", () => {
  assertEquals(
    oauthLoginUrl({
      handle: "alice.example",
      next: "/account/apps-hosts",
      action: "app_host",
      capabilities: ["app", "host", "media"],
    }),
    "/oauth/login?next=%2Faccount%2Fapps-hosts&action=app_host&capability=app&capability=host&capability=media&handle=alice.example",
  );
});

Deno.test("contextual URLs never accept or emit a raw scope", () => {
  const href = oauthSigninUrl({
    next: "/hosts/example.com/manage",
    action: "host_manage",
    capabilities: HOST_MANAGEMENT_CAPABILITIES,
  });
  const params = new URL(href, "https://atmosphereaccount.com").searchParams;
  assertEquals(params.get("scope"), null);
  assertEquals(params.getAll("capability"), ["host", "media"]);
});

Deno.test("each OAuth action accepts only its intended capability bundles", () => {
  const valid: Array<{
    action: OAuthAction | null;
    capabilities: OAuthCapability[];
  }> = [
    { action: null, capabilities: ["identity"] },
    { action: "account", capabilities: ["identity"] },
    { action: "review", capabilities: ["review"] },
    { action: "review_manage", capabilities: ["review_manage"] },
    { action: "legacy_review", capabilities: ["legacy_review"] },
    { action: "legacy_review_manage", capabilities: ["legacy_review"] },
    { action: "favorite", capabilities: ["favorite"] },
    { action: "app", capabilities: [...APP_MANAGEMENT_CAPABILITIES] },
    {
      action: "host_claim",
      capabilities: [...HOST_MANAGEMENT_CAPABILITIES],
    },
    {
      action: "host_manage",
      capabilities: [...HOST_MANAGEMENT_CAPABILITIES],
    },
    {
      action: "host_transfer",
      capabilities: [...HOST_MANAGEMENT_CAPABILITIES],
    },
    { action: "app_host", capabilities: ["media", "host", "app"] },
    { action: "developer", capabilities: ["identity"] },
  ];

  for (const request of valid) {
    assertEquals(
      isOAuthActionCapabilityRequest(request.action, request.capabilities),
      true,
      `${request.action ?? "default"}: ${request.capabilities.join(",")}`,
    );
  }

  // Repeated parameters are normalized before this check at HTTP boundaries,
  // but treating them as a set also keeps the policy stable for internal URLs.
  assertEquals(
    isOAuthActionCapabilityRequest("app", [
      ...APP_MANAGEMENT_CAPABILITIES,
      "app",
    ]),
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
    { action: "app", capabilities: ["app"] },
    { action: "app", capabilities: ["media"] },
    { action: "host_claim", capabilities: ["identity"] },
    { action: "host_claim", capabilities: ["host"] },
    { action: "host_manage", capabilities: ["host"] },
    { action: "host_manage", capabilities: ["media"] },
    { action: "host_transfer", capabilities: ["host"] },
    { action: "app", capabilities: ["app", "host"] },
    { action: "app_host", capabilities: ["app"] },
    { action: "account", capabilities: ["media"] },
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
  assertEquals(
    isOAuthActionCapabilityRequest("profile", ["identity"]),
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
      capabilities: ["legacy_review"],
    }),
    "/signin?next=%2Fapps%2Flegacy&action=legacy_review_manage&capability=legacy_review",
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
  assertEquals(
    oauthSigninUrl({
      next: "/apps/example",
      action: "app",
      capabilities: APP_MANAGEMENT_CAPABILITIES,
      name: "Safe\u202e\nname",
    }).includes("name=Safe+name"),
    true,
  );
});

Deno.test("complete management jobs cannot regress to progressive media prompts", () => {
  assertEquals(
    isOAuthActionCapabilityRequest("app", APP_MANAGEMENT_CAPABILITIES),
    true,
  );
  assertEquals(
    isOAuthActionCapabilityRequest("host_claim", HOST_MANAGEMENT_CAPABILITIES),
    true,
  );
  assertEquals(
    isOAuthActionCapabilityRequest("host_manage", HOST_MANAGEMENT_CAPABILITIES),
    true,
  );
  assertEquals(
    isOAuthActionCapabilityRequest(
      "host_transfer",
      HOST_MANAGEMENT_CAPABILITIES,
    ),
    true,
  );
  assertEquals(
    isOAuthActionCapabilityRequest(
      "app_host",
      APP_HOST_MANAGEMENT_CAPABILITIES,
    ),
    true,
  );
  for (
    const [action, capabilities] of [
      ["app", ["app"]],
      ["host_claim", ["identity"]],
      ["host_claim", ["host"]],
      ["host_manage", ["host"]],
      ["host_transfer", ["host"]],
      ["app_host", ["app", "host"]],
    ] as const
  ) {
    assertEquals(
      isOAuthActionCapabilityRequest(action, capabilities),
      false,
      `${action} accepted an incomplete management job`,
    );
  }
});
