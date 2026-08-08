import { isSafeRelativePath } from "./security.ts";
import {
  isOAuthAction,
  isOAuthActionCapabilityRequest,
  type OAuthAction,
  oauthReauthorizationUrl,
  safeOAuthTargetName,
} from "./oauth-action.ts";
import {
  normalizeOAuthCapabilities,
  type OAuthCapability,
} from "./oauth-scopes.ts";

const PARSE_ORIGIN = "https://atmosphere.invalid";

export interface ContextualReauthorization {
  fallbackHref: string;
  returnTo: string;
  action: OAuthAction;
  capabilities: OAuthCapability[];
  targetName: string;
  intent?: "user" | "project";
}

interface ContextualReauthorizationInput {
  returnTo: string;
  action: OAuthAction;
  capabilities: readonly OAuthCapability[];
  targetName?: string | null;
  intent?: "user" | "project";
}

/** Build the same fail-closed context locally when the page session expires
 * before an API can return its usual reauthorization URL. */
export function contextualReauthorization(
  input: ContextualReauthorizationInput,
): ContextualReauthorization | null {
  if (!isSafeRelativePath(input.returnTo)) return null;
  const capabilities = normalizeOAuthCapabilities(input.capabilities);
  if (
    !capabilities ||
    !isOAuthActionCapabilityRequest(input.action, capabilities)
  ) {
    return null;
  }
  const targetName = safeOAuthTargetName(input.targetName) ?? "";
  const fallbackHref = oauthReauthorizationUrl({
    next: input.returnTo,
    action: input.action,
    capabilities,
    name: targetName,
    intent: input.intent,
  });
  return {
    fallbackHref,
    returnTo: input.returnTo,
    action: input.action,
    capabilities,
    targetName,
    ...(input.intent ? { intent: input.intent } : {}),
  };
}

/**
 * Extract a same-site reauthorization destination from an API error body.
 * API payloads are still treated as untrusted input in the browser so an
 * unexpected absolute or protocol-relative URL cannot become an open redirect.
 */
export function reauthUrlFromApiPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }
  const value = (payload as Record<string, unknown>).reauthUrl;
  if (typeof value !== "string") return null;
  return isSafeRelativePath(value) ? value : null;
}

/**
 * Parse the server-provided full-page recovery URL into the narrow inputs used
 * by the in-page account chooser. The URL is still untrusted browser input:
 * only the contextual `/signin` recovery route, an explicit safe return path,
 * and an allowlisted action/capability bundle are accepted.
 */
export function contextualReauthorizationFromApiPayload(
  payload: unknown,
): ContextualReauthorization | null {
  if (
    !payload || typeof payload !== "object" || Array.isArray(payload) ||
    (payload as Record<string, unknown>).error !== "reauth_required"
  ) {
    return null;
  }
  const fallbackHref = reauthUrlFromApiPayload(payload);
  if (!fallbackHref) return null;

  const url = new URL(fallbackHref, PARSE_ORIGIN);
  if (
    url.pathname !== "/signin" || url.hash ||
    url.searchParams.get("permission") !== "required" ||
    url.searchParams.getAll("permission").length !== 1 ||
    url.searchParams.has("scope")
  ) {
    return null;
  }

  const nextValues = url.searchParams.getAll("next");
  const actionValues = url.searchParams.getAll("action");
  const nameValues = url.searchParams.getAll("name");
  const intentValues = url.searchParams.getAll("intent");
  const capabilityValues = url.searchParams.getAll("capability");
  if (
    nextValues.length !== 1 || !isSafeRelativePath(nextValues[0]) ||
    actionValues.length !== 1 || !isOAuthAction(actionValues[0]) ||
    nameValues.length > 1 || intentValues.length > 1 ||
    capabilityValues.length === 0
  ) {
    return null;
  }

  const capabilities = normalizeOAuthCapabilities(capabilityValues);
  const action = actionValues[0];
  if (
    !capabilities ||
    !isOAuthActionCapabilityRequest(action, capabilities)
  ) {
    return null;
  }

  const rawIntent = intentValues[0];
  const intent = rawIntent === "user" || rawIntent === "project"
    ? rawIntent
    : undefined;
  if (rawIntent && !intent) return null;
  const rawTargetName = nameValues[0];
  const targetName = rawTargetName == null
    ? ""
    : safeOAuthTargetName(rawTargetName);
  if (rawTargetName != null && !targetName) return null;

  return {
    fallbackHref,
    returnTo: nextValues[0],
    action,
    capabilities,
    targetName: targetName ?? "",
    ...(intent ? { intent } : {}),
  };
}
