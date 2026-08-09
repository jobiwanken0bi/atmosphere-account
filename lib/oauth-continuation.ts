import { readLoginRequest } from "./atmosphere-login.ts";
import type { OAuthAction } from "./oauth-action.ts";
import type { OAuthCapability } from "./oauth-scopes.ts";

/**
 * A universal-login continuation is intentionally identity-only and must
 * carry a complete, locally routed picker request. This prevents an ordinary
 * site authorization from being mislabeled non-persistent (or vice versa).
 */
export function isValidLoginSelectionContinuation(
  returnTo: string | null,
  intent: "user" | "project" | null,
  action: OAuthAction | null,
  capabilities: readonly OAuthCapability[],
): boolean {
  if (
    !returnTo || intent !== null || capabilities.length !== 1 ||
    capabilities[0] !== "identity" ||
    (action !== null && action !== "account")
  ) return false;
  try {
    const url = new URL(returnTo, "https://login.invalid");
    if (
      url.origin !== "https://login.invalid" || url.pathname !== "/login/select"
    ) return false;
    readLoginRequest(url);
    return true;
  } catch {
    return false;
  }
}

export function isLoginSelectionReturnPath(
  returnTo: string | null | undefined,
): boolean {
  if (!returnTo) return false;
  try {
    const url = new URL(returnTo, "https://login.invalid");
    return url.origin === "https://login.invalid" &&
      url.pathname === "/login/select";
  } catch {
    return false;
  }
}

export function hasValidLoginSelectionContinuationBinding(
  returnTo: string | null,
  continuation: "login_selection" | null | undefined,
  intent: "user" | "project" | null,
  action: OAuthAction | null,
  capabilities: readonly OAuthCapability[],
): boolean {
  const pickerReturn = isLoginSelectionReturnPath(returnTo);
  if (pickerReturn !== (continuation === "login_selection")) return false;
  return continuation !== "login_selection" ||
    isValidLoginSelectionContinuation(
      returnTo,
      intent,
      action,
      capabilities,
    );
}
