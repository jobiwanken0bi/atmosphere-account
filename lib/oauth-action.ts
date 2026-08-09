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
  "host_transfer",
  "app_host",
  "developer",
  "relationship_confirm",
  "admin",
] as const;

export type OAuthAction = typeof OAUTH_ACTIONS[number];

export const ACCOUNT_CREATION_ACTIONS = [
  "account",
  "review",
  "legacy_review",
  "report_review",
  "favorite",
  "app",
  "host_claim",
  "host_transfer",
] as const satisfies readonly OAuthAction[];

export type AccountCreationError =
  | "authorization_cancelled"
  | "host_unavailable"
  | "creation_unavailable";

const ACCOUNT_CREATION_ERRORS = new Set<AccountCreationError>([
  "authorization_cancelled",
  "host_unavailable",
  "creation_unavailable",
]);

/**
 * App and host management are complete, understandable authorization jobs.
 * Image blobs are part of each public profile rather than a later progressive
 * upgrade, so every contextual entry point must request the matching bundle.
 */
export const APP_MANAGEMENT_CAPABILITIES = ["app", "media"] as const;
export const HOST_MANAGEMENT_CAPABILITIES = ["host", "media"] as const;
export const APP_HOST_MANAGEMENT_CAPABILITIES = [
  "app",
  "host",
  "media",
] as const;

/**
 * Browser-supplied action labels are presentation context, not permission
 * selectors. Keep the capability bundle for each label here so a caller cannot
 * combine reassuring copy for one action with the repository access of
 * another. App and host profile images are included in their complete
 * management jobs; media cannot be requested separately or deferred to a
 * predictable second prompt.
 */
const OAUTH_ACTION_CAPABILITY_BUNDLES = {
  account: [["identity"]],
  review: [["review"]],
  review_manage: [["review_manage"]],
  legacy_review: [["legacy_review"]],
  legacy_review_manage: [["legacy_review"]],
  review_response: [["identity"]],
  report_review: [["identity"]],
  favorite: [["favorite"]],
  app: [APP_MANAGEMENT_CAPABILITIES],
  host_claim: [HOST_MANAGEMENT_CAPABILITIES],
  host_manage: [HOST_MANAGEMENT_CAPABILITIES],
  host_transfer: [HOST_MANAGEMENT_CAPABILITIES],
  app_host: [APP_HOST_MANAGEMENT_CAPABILITIES],
  developer: [["identity"]],
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

/**
 * Creating a new DID can begin a new account, publish a review or favorite,
 * register an app, or claim/transfer host management. It cannot recover
 * ownership of an existing review/app/host or open developer settings, so
 * those management-only actions deliberately omit the create-account path.
 */
export function isAccountCreationAction(
  action: OAuthAction,
): boolean {
  return (ACCOUNT_CREATION_ACTIONS as readonly OAuthAction[]).includes(action);
}

export function isAccountCreationError(
  value: unknown,
): value is AccountCreationError {
  return typeof value === "string" &&
    ACCOUNT_CREATION_ERRORS.has(value as AccountCreationError);
}

export function accountCreationErrorMessage(
  error: AccountCreationError | null | undefined,
): string | null {
  switch (error) {
    case "authorization_cancelled":
      return "Account creation was cancelled. Nothing was changed; choose a host to try again.";
    case "host_unavailable":
      return "That host can no longer start account creation here. Choose another host to continue.";
    case "creation_unavailable":
      return "Account creation could not be started. Choose a host to try again, or come back shortly.";
    default:
      return null;
  }
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

export function oauthCreateAccountUrl(
  input: ActionUrlInput & { error?: AccountCreationError | null },
): string {
  if (!isAccountCreationAction(input.action)) {
    throw new TypeError(
      `Account creation is not available for OAuth action "${input.action}"`,
    );
  }
  const params = actionParams(input);
  params.set("mode", "create");
  if (input.error) params.set("create_error", input.error);
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
