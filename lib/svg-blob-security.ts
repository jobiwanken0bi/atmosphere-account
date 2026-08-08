import { verifyAtprotoBlobCid } from "./atproto-blob-security.ts";
import { readResponseBytesWithLimit } from "./security.ts";
import { sanitizeSvgBytes } from "./svg-sanitize.ts";

export const MAX_SVG_ICON_BYTES = 200_000;

export type SecureSvgBlobResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; status: number; reason: string };

/** Re-verify and sanitize a content-addressed SVG at the serve boundary.
 * Upload validation is not enough: the remote PDS is outside our trust
 * boundary and must not be able to substitute active or unbounded content. */
export async function readSecureSvgBlob(
  upstream: Response,
  cid: string,
  maxBytes = MAX_SVG_ICON_BYTES,
): Promise<SecureSvgBlobResult> {
  if (!upstream.ok || !upstream.body) {
    await upstream.body?.cancel().catch(() => {});
    return { ok: false, status: 404, reason: "not found" };
  }
  const bounded = await readResponseBytesWithLimit(upstream, maxBytes);
  if (!bounded.ok) {
    return {
      ok: false,
      status: bounded.error === "response too large" ? 413 : 502,
      reason: bounded.error === "response too large"
        ? "icon too large"
        : "icon unavailable",
    };
  }
  if (!await verifyAtprotoBlobCid(cid, bounded.bytes)) {
    return { ok: false, status: 502, reason: "icon integrity check failed" };
  }
  try {
    return { ok: true, bytes: sanitizeSvgBytes(bounded.bytes) };
  } catch {
    return { ok: false, status: 415, reason: "invalid SVG icon" };
  }
}

export function secureSvgErrorResponse(
  result: Extract<SecureSvgBlobResult, { ok: false }>,
): Response {
  return new Response(result.reason, {
    status: result.status,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}
