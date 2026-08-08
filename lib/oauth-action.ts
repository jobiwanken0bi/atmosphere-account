import type { OAuthCapability } from "./oauth-scopes.ts";
import { isSafeRelativePath } from "./security.ts";

export const OAUTH_ACTIONS = [
  "account",
  "review",
  "review_manage",
  "legacy_review",
  "legacy_review_manage",
  "review_response",
  "report_review",
  "favorite",
  "app",
  "host_claim",
  "host_manage",
  "app_host",
  "profile",
  "developer",
  "passkey_manage",
  "relationship_confirm",
  "admin",
] as const;

export type OAuthAction = typeof OAUTH_ACTIONS[number];

/**
 * Browser-supplied action labels are presentation context, not permission
 * selectors. Keep the capability bundle for each label here so a caller cannot
 * combine reassuring copy for one action with the repository access of
 * another. Optional media access is only valid alongside the write capability
 * that can actually consume it.
 */
const OAUTH_ACTION_CAPABILITY_BUNDLES = {
  account: [["identity"]],
  review: [["review"]],
  review_manage: [["review_manage"]],
  legacy_review: [["legacy_review"]],
  legacy_review_manage: [["legacy_review_manage"]],
  review_response: [["identity"]],
  report_review: [["identity"]],
  favorite: [["favorite"]],
  app: [["app"], ["app", "media"]],
  host_claim: [["identity"]],
  host_manage: [["host"], ["host", "media"]],
  app_host: [["app", "host"], ["app", "host", "media"]],
  profile: [["profile"], ["profile", "media"]],
  developer: [["identity"]],
  passkey_manage: [["identity"]],
  relationship_confirm: [["identity"]],
  admin: [["identity"]],
} as const satisfies Record<
  OAuthAction,
  readonly (readonly OAuthCapability[])[]
>;

export function isOAuthAction(value: unknown): value is OAuthAction {
  return typeof value === "string" &&
    (OAUTH_ACTIONS as readonly string[]).includes(value);
}

export function isOAuthActionCapabilityRequest(
  action: unknown,
  capabilities: readonly OAuthCapability[],
): boolean {
  const normalizedAction = action == null
    ? "account"
    : isOAuthAction(action)
    ? action
    : null;
  if (!normalizedAction) return false;
  const requested = capabilitySetKey(capabilities);
  return OAUTH_ACTION_CAPABILITY_BUNDLES[normalizedAction].some(
    (allowed) => capabilitySetKey(allowed) === requested,
  );
}

export function safeOAuthTargetName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const name = [...value]
    .map((character) => isUnsafeLabelCharacter(character) ? " " : character)
    .join("")
    .replace(/\s+/g, " ")
    .trim();
  return name ? name.slice(0, 120) : undefined;
}

function isUnsafeLabelCharacter(character: string): boolean {
  const code = character.codePointAt(0) ?? 0;
  return code <= 0x1f || (code >= 0x7f && code <= 0x9f) ||
    code === 0x061c || (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2060 && code <= 0x206f) || code === 0xfeff;
}

interface ActionUrlInput {
  next: string;
  capabilities: readonly OAuthCapability[];
  action: OAuthAction;
  name?: string | null;
  intent?: "user" | "project";
}

export function oauthSigninUrl(input: ActionUrlInput): string {
  const params = actionParams(input);
  return `/signin?${params.toString()}`;
}

/** A protected action or PDS write explicitly determined that fresh
 * authorization is required. The marker prevents `/signin` from trusting a
 * token whose advertised scope was rejected by the PDS and auto-skipping the
 * retry. */
export function oauthReauthorizationUrl(input: ActionUrlInput): string {
  const params = actionParams(input);
  params.set("permission", "required");
  return `/signin?${params.toString()}`;
}

export function oauthLoginUrl(
  input: ActionUrlInput & { handle: string },
): string {
  const params = actionParams(input);
  params.set("handle", input.handle);
  return `/oauth/login?${params.toString()}`;
}

function actionParams(input: ActionUrlInput): URLSearchParams {
  if (!isSafeRelativePath(input.next)) {
    throw new TypeError("OAuth return target must be a local path");
  }
  if (!isOAuthActionCapabilityRequest(input.action, input.capabilities)) {
    throw new TypeError(
      `Invalid capability bundle for OAuth action "${input.action}"`,
    );
  }
  const params = new URLSearchParams({
    next: input.next,
    action: input.action,
  });
  const name = safeOAuthTargetName(input.name);
  if (name) params.set("name", name);
  if (input.intent) params.set("intent", input.intent);
  for (const capability of input.capabilities) {
    params.append("capability", capability);
  }
  return params;
}

function capabilitySetKey(
  capabilities: readonly OAuthCapability[],
): string {
  return [...new Set(capabilities)].sort().join("\n");
}
