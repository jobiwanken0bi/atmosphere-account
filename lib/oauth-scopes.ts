/**
 * OAuth capabilities used by Atmosphere Account's own authenticated actions.
 *
 * The public client metadata advertises the maximum union, while each OAuth
 * flow requests only the capabilities attached to the action that started it.
 * Raw scopes are never accepted from a browser request.
 */

export const OAUTH_CAPABILITIES = [
  "identity",
  "review",
  "review_manage",
  "legacy_review",
  "favorite",
  "app",
  "app_updates",
  "host",
  "media",
] as const;

export type OAuthCapability = typeof OAUTH_CAPABILITIES[number];

export const IDENTITY_OAUTH_SCOPE = "atproto";

const THIRD_PARTY_REVIEW_SCOPE = "include:fyi.atstore.authThirdPartyReviews";
const REVIEW_MANAGE_SCOPE =
  "repo:fyi.atstore.listing.review?action=update&action=delete";
const FAVORITE_SCOPE =
  "repo:fyi.atstore.listing.favorite?action=create&action=delete";
const LEGACY_REGISTRY_FULL_PERMISSIONS_SCOPE =
  "include:com.atmosphereaccount.registry.fullPermissions";
const LEGACY_REGISTRY_UPDATE_COLLECTION =
  "com.atmosphereaccount.registry.update";
const SAFE_LEGACY_REGISTRY_SCOPES = [
  "repo:com.atmosphereaccount.registry.profile",
  "repo:com.atmosphereaccount.registry.review",
] as const;

const CAPABILITY_SCOPES: Record<OAuthCapability, readonly string[]> = {
  identity: [],
  review: [THIRD_PARTY_REVIEW_SCOPE],
  review_manage: [REVIEW_MANAGE_SCOPE],
  legacy_review: ["repo:com.atmosphereaccount.registry.review"],
  favorite: [FAVORITE_SCOPE],
  app: [
    "repo:community.lexicon.app.profile",
    "repo:fyi.atstore.profile",
    "repo:fyi.atstore.listing.detail",
    // The legacy profile collection remains necessary while old listings can
    // still be edited. What's New uses Standard.site through its own narrowly
    // requested capability.
    "repo:com.atmosphereaccount.registry.profile",
  ],
  app_updates: [
    "repo:site.standard.publication?action=create&action=update",
    "repo:site.standard.document?action=create&action=update&action=delete",
  ],
  host: [
    "repo:account.atmosphere.host.profile",
    "repo:account.atmosphere.host.service",
  ],
  media: ["blob:image/*"],
};

/**
 * Scopes requested by the pre-progressive implementation. Keep this constant
 * for recognizing and sanitizing inherited grants and, temporarily, in the
 * rollout-safe metadata ceiling. Do not request the legacy union in new
 * authorization flows.
 */
export const LEGACY_OAUTH_SCOPE =
  "atproto include:com.atmosphereaccount.registry.fullPermissions include:fyi.atstore.authBasic repo:com.atmosphereaccount.registry.profile repo:com.atmosphereaccount.registry.review repo:com.atmosphereaccount.registry.update repo:fyi.atstore.profile repo:fyi.atstore.listing.detail repo:fyi.atstore.listing.review repo:fyi.atstore.listing.favorite repo:community.lexicon.app.profile repo:account.atmosphere.host.profile repo:account.atmosphere.host.service blob:image/*";

/** Default for a flow with no action attached: identity authentication only. */
export const DEFAULT_OAUTH_SCOPE = IDENTITY_OAUTH_SCOPE;

/**
 * Maximum scope union advertised in the OAuth client metadata.
 *
 * The public shell and authoritative AppView deploy independently, and OAuth
 * authorization servers cache this document. The expanded ceiling must go live
 * before an AppView starts requesting the new tokens. Once it has converged,
 * retaining the previous exact tokens keeps both AppView generations valid
 * during the rest of the rollout. Contextual authorization requests still use
 * only the current capability scopes, and inherited grants are sanitized by
 * inheritedScopeForCapabilities().
 */
export const OAUTH_CLIENT_METADATA_SCOPE = unionScopeStrings(
  LEGACY_OAUTH_SCOPE,
  ...Object.values(CAPABILITY_SCOPES).map((tokens) => tokens.join(" ")),
);

export function isOAuthCapability(value: unknown): value is OAuthCapability {
  return typeof value === "string" &&
    (OAUTH_CAPABILITIES as readonly string[]).includes(value);
}

export function normalizeOAuthCapabilities(
  values: Iterable<unknown>,
): OAuthCapability[] | null {
  const out: OAuthCapability[] = [];
  for (const value of values) {
    if (value == null || value === "") continue;
    if (!isOAuthCapability(value)) return null;
    if (!out.includes(value)) out.push(value);
  }
  return out.length > 0 ? out : ["identity"];
}

export function scopeForCapabilities(
  capabilities: readonly OAuthCapability[],
  existingScope?: string | null,
): string {
  const additions = capabilities.flatMap((capability) =>
    CAPABILITY_SCOPES[capability]
  );
  return unionScopeStrings(
    IDENTITY_OAUTH_SCOPE,
    inheritedScopeForCapabilities(existingScope, capabilities),
    additions.join(" "),
  );
}

/**
 * Remove grants that the Standard.site migration deliberately supersedes from
 * an inherited authorization. The old full-permissions include also covered
 * profile and review records, so retain those known, unrelated permissions as
 * direct grants rather than silently narrowing the user's working session.
 *
 * Apply this to every product-capability upgrade. Identity-only flows never
 * union an existing product grant, while any write upgrade must avoid sending
 * the retired collection back to an authorization server.
 */
export function inheritedScopeForCapabilities(
  existingScope: string | null | undefined,
  capabilities: readonly OAuthCapability[],
): string {
  const tokens = scopeTokens(existingScope);
  if (!capabilities.some((capability) => capability !== "identity")) {
    return tokens.join(" ");
  }

  const retained: string[] = [];
  for (const token of tokens) {
    if (token.split("?", 1)[0] === LEGACY_REGISTRY_FULL_PERMISSIONS_SCOPE) {
      retained.push(...SAFE_LEGACY_REGISTRY_SCOPES);
      continue;
    }

    const repo = parseRepoScope(token);
    if (
      !repo || !repo.collections.includes(LEGACY_REGISTRY_UPDATE_COLLECTION)
    ) {
      retained.push(token);
      continue;
    }

    const collections = repo.collections.filter((collection) =>
      collection !== LEGACY_REGISTRY_UPDATE_COLLECTION
    );
    if (collections.length > 0) {
      retained.push(repoScopeToken(collections, repo.actions));
    }
  }
  return unionScopeStrings(retained.join(" "));
}

export function scopeTokens(scope: string | null | undefined): string[] {
  if (!scope?.trim()) return [];
  return [...new Set(scope.trim().split(/\s+/).filter(Boolean))];
}

export function unionScopeStrings(...scopes: string[]): string {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const scope of scopes) {
    for (const token of scopeTokens(scope)) {
      if (seen.has(token)) continue;
      seen.add(token);
      out.push(token);
    }
  }
  return out.join(" ");
}

export function hasOAuthCapabilities(
  grantedScope: string | null | undefined,
  capabilities: readonly OAuthCapability[],
): boolean {
  return missingOAuthCapabilities(grantedScope, capabilities).length === 0;
}

export function missingOAuthCapabilities(
  grantedScope: string | null | undefined,
  capabilities: readonly OAuthCapability[],
): OAuthCapability[] {
  const grants = expandedGrants(grantedScope);
  return capabilities.filter((capability) =>
    !capabilityIsGranted(grants, capability)
  );
}

/**
 * True when every permission represented by `candidate` is also represented
 * by `superset`. Used to prevent a narrower or racing OAuth callback from
 * replacing a more capable stored session.
 */
export function scopeCoversScope(
  superset: string | null | undefined,
  candidate: string | null | undefined,
): boolean {
  return scopeCoversScopeInternal(superset, candidate, false);
}

/**
 * Conservative scope comparison for replacing persisted authorization.
 *
 * Permission sets are resolved dynamically and can gain permissions over time.
 * A hand-maintained expansion therefore cannot prove that direct grants cover
 * an existing `include:` token. Session replacement and returned-scope ceiling
 * checks must retain those tokens exactly.
 */
export function scopeSafelyCoversScope(
  superset: string | null | undefined,
  candidate: string | null | undefined,
): boolean {
  return scopeCoversScopeInternal(superset, candidate, true);
}

function scopeCoversScopeInternal(
  superset: string | null | undefined,
  candidate: string | null | undefined,
  requireExactIncludes: boolean,
): boolean {
  const candidateTokens = scopeTokens(candidate);
  if (candidateTokens.length === 0) return true;
  const supersetGrants = expandedGrants(superset, !requireExactIncludes);
  for (const token of candidateTokens) {
    if (token === "atproto") {
      if (!supersetGrants.identity) return false;
      continue;
    }
    const repo = parseRepoScope(token);
    if (repo) {
      for (const collection of repo.collections) {
        if (!repoActionsGranted(supersetGrants, collection, repo.actions)) {
          return false;
        }
      }
      continue;
    }
    if (token.startsWith("blob:")) {
      if (!blobScopeGranted(supersetGrants.blobs, token.slice(5))) {
        return false;
      }
      continue;
    }
    if (token.startsWith("include:") && requireExactIncludes) {
      if (!supersetGrants.tokens.has(token)) return false;
      continue;
    }
    // Capability checks can expand permission sets whose published contents
    // are known. Persisted-session comparisons use the exact branch above.
    if (token.startsWith("include:") && isKnownPermissionSet(token)) {
      const required = expandedGrants(token);
      for (const [collection, actions] of required.repo) {
        if (!repoActionsGranted(supersetGrants, collection, [...actions])) {
          return false;
        }
      }
      continue;
    }
    if (!supersetGrants.tokens.has(token)) return false;
  }
  return true;
}

interface ExpandedGrants {
  identity: boolean;
  tokens: Set<string>;
  repo: Map<string, Set<RepoAction>>;
  blobs: Set<string>;
}

type RepoAction = "create" | "update" | "delete";
const ALL_REPO_ACTIONS: readonly RepoAction[] = [
  "create",
  "update",
  "delete",
];

function expandedGrants(
  scope: string | null | undefined,
  expandPermissionSets = true,
): ExpandedGrants {
  const tokens = new Set(scopeTokens(scope));
  const grants: ExpandedGrants = {
    identity: tokens.has("atproto"),
    tokens,
    repo: new Map(),
    blobs: new Set(),
  };

  for (const token of tokens) {
    const repo = parseRepoScope(token);
    if (repo) {
      for (const collection of repo.collections) {
        addRepoGrant(grants.repo, collection, repo.actions);
      }
      continue;
    }
    if (token.startsWith("blob:")) {
      grants.blobs.add(token.slice(5));
      continue;
    }
    if (expandPermissionSets) expandKnownPermissionSet(grants.repo, token);
  }
  return grants;
}

function capabilityIsGranted(
  grants: ExpandedGrants,
  capability: OAuthCapability,
): boolean {
  switch (capability) {
    case "identity":
      return grants.identity;
    case "review":
      return repoActionsGranted(grants, "fyi.atstore.profile", ["create"]) &&
        repoActionsGranted(
          grants,
          "fyi.atstore.listing.review",
          ["create"],
        );
    case "review_manage":
      return repoActionsGranted(
        grants,
        "fyi.atstore.listing.review",
        ["update", "delete"],
      );
    case "legacy_review":
      return repoActionsGranted(
        grants,
        "com.atmosphereaccount.registry.review",
        ALL_REPO_ACTIONS,
      );
    case "favorite":
      return repoActionsGranted(
        grants,
        "fyi.atstore.listing.favorite",
        ["create", "delete"],
      );
    case "app":
      return [
        "community.lexicon.app.profile",
        "fyi.atstore.profile",
        "fyi.atstore.listing.detail",
        "com.atmosphereaccount.registry.profile",
      ].every((collection) =>
        repoActionsGranted(grants, collection, ALL_REPO_ACTIONS)
      );
    case "app_updates":
      return repoActionsGranted(
        grants,
        "site.standard.publication",
        ["create", "update"],
      ) && repoActionsGranted(
        grants,
        "site.standard.document",
        ["create", "update", "delete"],
      );
    case "host":
      return [
        "account.atmosphere.host.profile",
        "account.atmosphere.host.service",
      ].every((collection) =>
        repoActionsGranted(grants, collection, ALL_REPO_ACTIONS)
      );
    case "media":
      return blobScopeGranted(grants.blobs, "image/*");
  }
}

function parseRepoScope(token: string): {
  collections: string[];
  actions: RepoAction[];
} | null {
  if (!token.startsWith("repo:") && !token.startsWith("repo?")) return null;
  const question = token.indexOf("?");
  const head = question === -1 ? token : token.slice(0, question);
  const query = question === -1 ? "" : token.slice(question + 1);
  const params = new URLSearchParams(query);
  let positional = "";
  if (head.startsWith("repo:")) {
    try {
      positional = decodeURIComponent(head.slice(5));
    } catch {
      return null;
    }
  }
  const allowedParams = new Set(["collection", "action"]);
  for (const [key, value] of params) {
    if (!allowedParams.has(key) || !value) return null;
    if (key === "action" && !isRepoAction(value)) return null;
  }
  if (positional && params.has("collection")) return null;
  const collections = positional ? [positional] : params.getAll("collection");
  if (
    collections.length === 0 ||
    new Set(collections).size !== collections.length
  ) {
    return null;
  }
  const actions = params.getAll("action") as RepoAction[];
  if (new Set(actions).size !== actions.length) return null;
  return {
    collections,
    actions: actions.length > 0 ? actions : [...ALL_REPO_ACTIONS],
  };
}

function repoScopeToken(
  collections: readonly string[],
  actions: readonly RepoAction[],
): string {
  if (collections.length === 1) {
    const params = new URLSearchParams();
    for (const action of actions) params.append("action", action);
    const query = params.toString();
    return `repo:${collections[0]}${query ? `?${query}` : ""}`;
  }
  const params = new URLSearchParams();
  for (const collection of collections) params.append("collection", collection);
  for (const action of actions) params.append("action", action);
  return `repo?${params.toString()}`;
}

function isRepoAction(value: string): value is RepoAction {
  return value === "create" || value === "update" || value === "delete";
}

function addRepoGrant(
  grants: Map<string, Set<RepoAction>>,
  collection: string,
  actions: readonly RepoAction[],
): void {
  const current = grants.get(collection) ?? new Set<RepoAction>();
  for (const action of actions) current.add(action);
  grants.set(collection, current);
}

function repoActionsGranted(
  grants: ExpandedGrants,
  collection: string,
  actions: readonly RepoAction[],
): boolean {
  const exact = grants.repo.get(collection);
  const wildcard = grants.repo.get("*");
  return actions.every((action) => exact?.has(action) || wildcard?.has(action));
}

function expandKnownPermissionSet(
  grants: Map<string, Set<RepoAction>>,
  token: string,
): void {
  const id = token.split("?", 1)[0];
  if (id === "include:fyi.atstore.authThirdPartyReviews") {
    addRepoGrant(grants, "fyi.atstore.profile", ["create"]);
    addRepoGrant(grants, "fyi.atstore.listing.review", ["create"]);
    return;
  }
  if (id === "include:fyi.atstore.authBasic") {
    for (
      const collection of [
        "fyi.atstore.profile",
        "fyi.atstore.listing.detail",
        "fyi.atstore.listing.review",
        "fyi.atstore.listing.reviewReply",
        "fyi.atstore.listing.favorite",
      ]
    ) {
      addRepoGrant(grants, collection, ALL_REPO_ACTIONS);
    }
    return;
  }
  if (id === "include:com.atmosphereaccount.registry.fullPermissions") {
    for (
      const collection of [
        "com.atmosphereaccount.registry.profile",
        "com.atmosphereaccount.registry.review",
        "com.atmosphereaccount.registry.update",
      ]
    ) {
      addRepoGrant(grants, collection, ALL_REPO_ACTIONS);
    }
  }
}

function isKnownPermissionSet(token: string): boolean {
  const id = token.split("?", 1)[0];
  return id === "include:fyi.atstore.authThirdPartyReviews" ||
    id === "include:fyi.atstore.authBasic" ||
    id === "include:com.atmosphereaccount.registry.fullPermissions";
}

function blobScopeGranted(granted: Set<string>, required: string): boolean {
  if (granted.has(required) || granted.has("*/*")) return true;
  const [requiredType] = required.split("/", 1);
  return granted.has(`${requiredType}/*`);
}
