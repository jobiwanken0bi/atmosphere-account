import { isSafeRelativePath } from "./security.ts";

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
