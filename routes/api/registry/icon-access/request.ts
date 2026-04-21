/**
 * Authenticated user submits a verification request for SVG-icon
 * uploads on their own profile.
 *
 *   POST /api/registry/icon-access/request   { email }
 *
 * The DID is taken from the OAuth session, never from the body — the
 * request always targets the caller's own profile. The user must have
 * a published profile already; we refuse otherwise so the request row
 * has somewhere to live.
 *
 * Allowed transitions are enforced inside `requestIconAccess`:
 *   - `null` or `denied` → `requested` (succeeds)
 *   - `requested` → no-op (returns 200 idempotently)
 *   - `granted` → 409 (caller is already verified)
 */
import { define } from "../../../../utils.ts";
import {
  getProfileByDid,
  requestIconAccess,
} from "../../../../lib/registry.ts";

interface RequestPayload {
  email?: unknown;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const handler = define.handlers({
  async POST(ctx) {
    const user = ctx.state.user;
    if (!user) return jsonError(401, "not_authenticated");

    const body = await ctx.req.json().catch(() => null) as
      | RequestPayload
      | null;
    if (!body || typeof body.email !== "string") {
      return jsonError(400, "missing_email");
    }
    const email = body.email.trim().slice(0, 320);
    if (!EMAIL_RE.test(email)) return jsonError(400, "invalid_email");

    const existing = await getProfileByDid(user.did, { includeTakenDown: true })
      .catch(() => null);
    if (!existing) {
      return jsonError(
        409,
        "no_profile",
        "Publish your profile before requesting verification.",
      );
    }
    if (existing.takedownStatus === "taken_down") {
      return jsonError(403, "taken_down");
    }
    if (existing.iconAccessStatus === "granted") {
      return jsonError(409, "already_granted");
    }
    if (existing.iconAccessStatus === "requested") {
      // Idempotent — same email may have been submitted twice; we don't
      // want the client to surface this as an error.
      return jsonOk({ ok: true, status: "requested" });
    }

    try {
      await requestIconAccess(user.did, email);
    } catch (err) {
      const m = err instanceof Error ? err.message : String(err);
      return jsonError(500, "request_failed", m);
    }
    return jsonOk({ ok: true, status: "requested" });
  },
});

function jsonOk(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
function jsonError(status: number, code: string, detail?: string): Response {
  return new Response(
    JSON.stringify(detail ? { error: code, detail } : { error: code }),
    {
      status,
      headers: { "content-type": "application/json; charset=utf-8" },
    },
  );
}
