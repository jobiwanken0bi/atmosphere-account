import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  DEFAULT_OAUTH_SCOPE,
  hasOAuthCapabilities,
  IDENTITY_OAUTH_SCOPE,
  LEGACY_OAUTH_SCOPE,
  missingOAuthCapabilities,
  normalizeOAuthCapabilities,
  OAUTH_CLIENT_METADATA_SCOPE,
  scopeCoversScope,
  scopeForCapabilities,
  scopeSafelyCoversScope,
  scopeTokens,
  unionScopeStrings,
} from "./oauth-scopes.ts";

Deno.test("OAuth defaults to identity-only while metadata advertises the maximum", () => {
  assertEquals(DEFAULT_OAUTH_SCOPE, "atproto");
  assertEquals(IDENTITY_OAUTH_SCOPE, "atproto");
  const metadataTokens = scopeTokens(OAUTH_CLIENT_METADATA_SCOPE);
  assertEquals(
    metadataTokens.includes(
      "include:fyi.atstore.authThirdPartyReviews",
    ),
    true,
  );
  assertEquals(
    metadataTokens.includes("include:fyi.atstore.authBasic"),
    true,
  );
  assertEquals(
    metadataTokens.includes(
      "repo:account.atmosphere.host.service",
    ),
    true,
  );
  assertEquals(metadataTokens.includes("blob:image/*"), true);
  assertEquals(
    metadataTokens.includes(
      "repo:site.standard.document?action=create&action=update&action=delete",
    ),
    true,
  );
  assertEquals(
    metadataTokens.some((token) =>
      token.includes("com.atmosphereaccount.registry.update") ||
      token.includes("com.atmosphereaccount.registry.fullPermissions")
    ),
    true,
    "the rollout ceiling must accept both independently deployed runtimes",
  );
  const currentUpdateRequest = scopeTokens(
    scopeForCapabilities(["app_updates"]),
  );
  assertEquals(
    currentUpdateRequest.some((token) =>
      token.includes("com.atmosphereaccount.registry.update") ||
      token.includes("com.atmosphereaccount.registry.fullPermissions")
    ),
    false,
    "current authorization requests must not revive retired permissions",
  );
});

Deno.test("capability parser rejects raw or unknown browser values", () => {
  assertEquals(normalizeOAuthCapabilities([]), ["identity"]);
  assertEquals(normalizeOAuthCapabilities(["review", "review"]), ["review"]);
  assertEquals(normalizeOAuthCapabilities(["repo:*"]), null);
  assertEquals(normalizeOAuthCapabilities(["both"]), null);
  assertEquals(normalizeOAuthCapabilities(["profile"]), null);
});

Deno.test("review scope is narrow and media remains opt-in", () => {
  const scope = scopeForCapabilities(["review"]);
  assertEquals(scopeTokens(scope), [
    "atproto",
    "include:fyi.atstore.authThirdPartyReviews",
  ]);
  assertEquals(hasOAuthCapabilities(scope, ["review"]), true);
  assertEquals(hasOAuthCapabilities(scope, ["review_manage"]), false);
  assertEquals(hasOAuthCapabilities(scope, ["media"]), false);
});

Deno.test("scope upgrades retain existing capabilities without using metadata maximum", () => {
  const app = scopeForCapabilities(["app"]);
  const upgraded = scopeForCapabilities(["host"], app);
  assertEquals(hasOAuthCapabilities(upgraded, ["app", "host"]), true);
  assertEquals(hasOAuthCapabilities(upgraded, ["review", "favorite"]), false);
  assertEquals(scopeTokens(upgraded).includes("blob:image/*"), false);
  assertEquals(
    scopeTokens(upgraded).includes("include:fyi.atstore.authBasic"),
    false,
  );
});

Deno.test("What's New uses Standard.site without restoring the legacy update grant", () => {
  const appScope = scopeForCapabilities(["app"]);
  assertEquals(
    scopeTokens(appScope).some((token) =>
      token.startsWith("repo:com.atmosphereaccount.registry.update")
    ),
    false,
  );
  assertEquals(hasOAuthCapabilities(appScope, ["app_updates"]), false);

  const updateScope = scopeForCapabilities(["app_updates"]);
  assertEquals(scopeTokens(updateScope), [
    "atproto",
    "repo:site.standard.publication?action=create&action=update",
    "repo:site.standard.document?action=create&action=update&action=delete",
  ]);
  assertEquals(hasOAuthCapabilities(updateScope, ["app_updates"]), true);
  assertEquals(hasOAuthCapabilities(updateScope, ["app"]), false);
});

Deno.test("What's New upgrades translate deprecated legacy grants without losing unrelated scope", () => {
  const updateScope = scopeForCapabilities(["app_updates"], LEGACY_OAUTH_SCOPE);
  const tokens = scopeTokens(updateScope);

  assertEquals(
    scopeCoversScope(OAUTH_CLIENT_METADATA_SCOPE, updateScope),
    true,
    "the metadata ceiling must cover every retained upgrade permission",
  );
  const metadataTokens = new Set(scopeTokens(OAUTH_CLIENT_METADATA_SCOPE));
  for (const token of tokens) {
    assertEquals(
      metadataTokens.has(token),
      true,
      `the authorization server requires exact metadata membership for ${token}`,
    );
  }

  assertEquals(
    tokens.some((token) =>
      token.split("?", 1)[0] ===
        "include:com.atmosphereaccount.registry.fullPermissions"
    ),
    false,
  );
  assertEquals(
    tokens.some((token) =>
      token.startsWith("repo:com.atmosphereaccount.registry.update")
    ),
    false,
  );
  for (
    const retained of [
      "repo:com.atmosphereaccount.registry.profile",
      "repo:com.atmosphereaccount.registry.review",
      "include:fyi.atstore.authBasic",
      "repo:account.atmosphere.host.profile",
      "blob:image/*",
    ]
  ) {
    assertEquals(tokens.includes(retained), true, `missing ${retained}`);
  }
  assertEquals(hasOAuthCapabilities(updateScope, ["app_updates"]), true);
  assertEquals(
    hasOAuthCapabilities(updateScope, ["app", "host", "media"]),
    true,
  );
});

Deno.test("ordinary app upgrades also retire inherited legacy update grants", () => {
  const appScope = scopeForCapabilities(["app"], LEGACY_OAUTH_SCOPE);
  const tokens = scopeTokens(appScope);
  assertEquals(
    tokens.some((token) =>
      token.includes("com.atmosphereaccount.registry.update") ||
      token.includes("com.atmosphereaccount.registry.fullPermissions")
    ),
    false,
  );
  assertEquals(hasOAuthCapabilities(appScope, ["app"]), true);
  assertEquals(hasOAuthCapabilities(appScope, ["legacy_review"]), true);
});

Deno.test("What's New upgrades preserve safe grants represented only by the legacy include", () => {
  const updateScope = scopeForCapabilities(
    ["app_updates"],
    "atproto include:com.atmosphereaccount.registry.fullPermissions blob:image/*",
  );
  assertEquals(scopeTokens(updateScope), [
    "atproto",
    "repo:com.atmosphereaccount.registry.profile",
    "repo:com.atmosphereaccount.registry.review",
    "blob:image/*",
    "repo:site.standard.publication?action=create&action=update",
    "repo:site.standard.document?action=create&action=update&action=delete",
  ]);
  assertEquals(
    hasOAuthCapabilities(updateScope, ["legacy_review", "media"]),
    true,
  );
});

Deno.test("What's New upgrades remove only the deprecated collection from compound repo grants", () => {
  const updateScope = scopeForCapabilities(
    ["app_updates"],
    "atproto repo?collection=com.atmosphereaccount.registry.update&collection=example.keep&action=create",
  );
  const tokens = scopeTokens(updateScope);
  assertEquals(tokens.includes("repo:example.keep?action=create"), true);
  assertEquals(
    tokens.some((token) =>
      token.includes("com.atmosphereaccount.registry.update")
    ),
    false,
  );
});

Deno.test("review management adds only update and delete to a prior create grant", () => {
  const create = scopeForCapabilities(["review"]);
  const manage = scopeForCapabilities(["review_manage"], create);
  assertEquals(hasOAuthCapabilities(manage, ["review", "review_manage"]), true);
  assertEquals(
    scopeTokens(manage).includes(
      "repo:fyi.atstore.listing.review?action=update&action=delete",
    ),
    true,
  );
});

Deno.test("legacy broad grants satisfy the progressive capability checks", () => {
  assertEquals(
    hasOAuthCapabilities(LEGACY_OAUTH_SCOPE, [
      "identity",
      "review",
      "review_manage",
      "legacy_review",
      "favorite",
      "app",
      "host",
      "media",
    ]),
    true,
  );
});

Deno.test("scope coverage understands action attenuation and known permission sets", () => {
  assertEquals(
    scopeCoversScope(
      "atproto repo:example.collection",
      "atproto repo:example.collection?action=create",
    ),
    true,
  );
  assertEquals(
    scopeCoversScope(
      "atproto repo:example.collection?action=create",
      "atproto repo:example.collection?action=update",
    ),
    false,
  );
  assertEquals(
    scopeCoversScope(
      LEGACY_OAUTH_SCOPE,
      "atproto include:fyi.atstore.authThirdPartyReviews",
    ),
    true,
  );
});

Deno.test("persisted scope replacement retains permission-set includes exactly", () => {
  const include = "atproto include:fyi.atstore.authThirdPartyReviews";
  const direct =
    "atproto repo:fyi.atstore.profile?action=create repo:fyi.atstore.listing.review?action=create";

  // Capability checks may use the known expansion, but it is not authoritative
  // enough to replace a dynamic permission-set grant in either direction.
  assertEquals(scopeCoversScope(direct, include), true);
  assertEquals(scopeSafelyCoversScope(direct, include), false);
  assertEquals(scopeSafelyCoversScope(include, direct), false);
  assertEquals(scopeSafelyCoversScope(include, include), true);
});

Deno.test("returned grants must stay within the requested authorization ceiling", () => {
  const requested =
    "atproto repo:example.collection?action=create&action=update";
  assertEquals(
    scopeSafelyCoversScope(
      requested,
      "atproto repo:example.collection?action=create",
    ),
    true,
  );
  assertEquals(
    scopeSafelyCoversScope(requested, "atproto repo:example.collection"),
    false,
  );
  assertEquals(
    scopeSafelyCoversScope(requested, "atproto transition:generic"),
    false,
  );
});

Deno.test("malformed repo scope parameters never become repository grants", () => {
  const malformed = [
    "repo:fyi.atstore.listing.review?action=bogus",
    "repo:fyi.atstore.listing.review?action=update&action=update",
    "repo:fyi.atstore.listing.review?collection=other.collection",
    "repo:fyi.atstore.listing.review?unexpected=value",
  ];
  for (const token of malformed) {
    assertEquals(
      hasOAuthCapabilities(`atproto ${token}`, ["review_manage"]),
      false,
    );
    assertEquals(
      scopeCoversScope(
        `atproto ${token}`,
        "atproto repo:fyi.atstore.listing.review?action=update",
      ),
      false,
    );
  }
});

Deno.test("scope union is deterministic and de-duplicates tokens", () => {
  assertEquals(
    unionScopeStrings("atproto repo:a", "repo:a atproto repo:b"),
    "atproto repo:a repo:b",
  );
  assertEquals(missingOAuthCapabilities("atproto", ["identity", "host"]), [
    "host",
  ]);
});
