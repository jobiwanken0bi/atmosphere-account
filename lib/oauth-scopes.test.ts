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
  assertEquals(
    scopeTokens(OAUTH_CLIENT_METADATA_SCOPE).includes(
      "include:fyi.atstore.authThirdPartyReviews",
    ),
    true,
  );
  assertEquals(
    scopeTokens(OAUTH_CLIENT_METADATA_SCOPE).includes(
      "repo:account.atmosphere.host.service",
    ),
    true,
  );
  assertEquals(
    scopeTokens(OAUTH_CLIENT_METADATA_SCOPE).includes("blob:image/*"),
    true,
  );
});

Deno.test("capability parser rejects raw or unknown browser values", () => {
  assertEquals(normalizeOAuthCapabilities([]), ["identity"]);
  assertEquals(normalizeOAuthCapabilities(["review", "review"]), ["review"]);
  assertEquals(normalizeOAuthCapabilities(["repo:*"]), null);
  assertEquals(normalizeOAuthCapabilities(["both"]), null);
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

Deno.test("legacy review creation and management stay action-attenuated", () => {
  const create = scopeForCapabilities(["legacy_review"]);
  const manage = scopeForCapabilities(["legacy_review_manage"]);
  assertEquals(hasOAuthCapabilities(create, ["legacy_review"]), true);
  assertEquals(hasOAuthCapabilities(create, ["legacy_review_manage"]), false);
  assertEquals(hasOAuthCapabilities(manage, ["legacy_review"]), false);
  assertEquals(hasOAuthCapabilities(manage, ["legacy_review_manage"]), true);
  assertEquals(
    scopeTokens(create).includes(
      "repo:com.atmosphereaccount.registry.review?action=create",
    ),
    true,
  );
  assertEquals(
    scopeTokens(manage).includes(
      "repo:com.atmosphereaccount.registry.review?action=update&action=delete",
    ),
    true,
  );
});

Deno.test("user profile editing never requests delete access", () => {
  const profile = scopeForCapabilities(["profile"]);
  assertEquals(hasOAuthCapabilities(profile, ["profile"]), true);
  assertEquals(
    scopeTokens(profile).includes(
      "repo:com.atmosphereaccount.registry.profile?action=create&action=update",
    ),
    true,
  );
  assertEquals(
    scopeCoversScope(
      profile,
      "atproto repo:com.atmosphereaccount.registry.profile?action=delete",
    ),
    false,
  );
});

Deno.test("legacy broad grants satisfy the progressive capability checks", () => {
  assertEquals(
    hasOAuthCapabilities(LEGACY_OAUTH_SCOPE, [
      "identity",
      "review",
      "review_manage",
      "legacy_review",
      "legacy_review_manage",
      "favorite",
      "app",
      "host",
      "profile",
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

Deno.test("modified include tokens never inherit a known permission set", () => {
  const modified =
    "atproto include:fyi.atstore.authThirdPartyReviews?unexpected=value";
  assertEquals(hasOAuthCapabilities(modified, ["review"]), false);
  assertEquals(
    scopeCoversScope(
      modified,
      "atproto include:fyi.atstore.authThirdPartyReviews",
    ),
    false,
  );
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
