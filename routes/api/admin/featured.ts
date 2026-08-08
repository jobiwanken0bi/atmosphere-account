/**
 * Admin: replace the curated featured directory.
 *
 *   POST /api/admin/featured
 *   { entries: [{ did, badges?, position? }, ...] }
 *
 * Mirrors `scripts/publish-featured.ts` — validates the payload against
 * the featured lexicon, then writes `com.atmosphereaccount.registry.
 * featured/self` to the Atmosphere account's PDS using its existing
 * OAuth session. The Jetstream indexer picks up the new record within
 * seconds and replaces the local `featured` table.
 */
import { define } from "../../../utils.ts";
import { requireAdminApi } from "../../../lib/admin.ts";
import {
  FEATURED_BADGES,
  FEATURED_NSID,
  validateFeatured,
} from "../../../lib/lexicons.ts";
import { putRecord } from "../../../lib/pds.ts";
import { getValidSession } from "../../../lib/oauth.ts";
import { ATMOSPHERE_DID } from "../../../lib/env.ts";
import { readAdminJsonRequest } from "../../../lib/admin-request.ts";

interface PayloadEntry {
  did?: unknown;
  badges?: unknown;
  position?: unknown;
}

export const handler = define.handlers({
  async POST(ctx) {
    const gate = requireAdminApi(ctx);
    if (!gate.ok) return gate.response;

    if (!ATMOSPHERE_DID) {
      return jsonError(500, "atmosphere_did_unset");
    }

    const parsed = await readAdminJsonRequest(ctx.req);
    if (!parsed.ok) return parsed.response;
    const body = parsed.value as { entries?: PayloadEntry[] };
    if (!Array.isArray(body.entries)) {
      return jsonError(400, "invalid_body");
    }

    const entries: { did: string; badges?: string[]; position?: number }[] = [];
    for (const [i, raw] of body.entries.entries()) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return jsonError(400, `invalid_entry_at_${i}`);
      }
      const did = typeof raw.did === "string" ? raw.did.trim() : "";
      if (!did.startsWith("did:")) {
        return jsonError(400, `invalid_did_at_${i}`);
      }
      const badges = Array.isArray(raw.badges)
        ? raw.badges
          .filter((b): b is string => typeof b === "string")
          .filter((b) => (FEATURED_BADGES as readonly string[]).includes(b))
        : [];
      const positionRaw = typeof raw.position === "number"
        ? raw.position
        : Number(raw.position);
      const position = Number.isFinite(positionRaw) ? positionRaw : i;
      entries.push({ did, badges, position });
    }

    const record = { entries };
    const validation = validateFeatured(record);
    if (!validation.ok || !validation.value) {
      return jsonError(400, "invalid_record");
    }

    const session = await getValidSession(ATMOSPHERE_DID);
    if (!session) {
      return jsonError(401, "atmosphere_session_missing");
    }

    let result: Awaited<ReturnType<typeof putRecord>>;
    try {
      result = await putRecord(
        ATMOSPHERE_DID,
        session.pdsUrl,
        FEATURED_NSID,
        "self",
        record as unknown as Record<string, unknown>,
      );
    } catch {
      console.error("[admin] featured directory publish failed");
      return jsonError(502, "put_record_failed");
    }

    return new Response(
      JSON.stringify({ ok: true, uri: result.uri, cid: result.cid }),
      {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8" },
      },
    );
  },
});

function jsonError(status: number, code: string): Response {
  return new Response(
    JSON.stringify({ error: code }),
    {
      status,
      headers: { "content-type": "application/json; charset=utf-8" },
    },
  );
}
