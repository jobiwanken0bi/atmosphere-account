import { define } from "../../../../utils.ts";
import { proxyAppviewApiResponse } from "../../../../lib/appview-client.ts";
import { withRateLimit } from "../../../../lib/rate-limit.ts";
import {
  getAppListingByIdentifier,
  getOwnAppReview,
  upsertAppReview,
} from "../../../../lib/app-directory.ts";
import { ATSTORE_REVIEW_NSID } from "../../../../lib/app-lexicons.ts";
import { ensureAtstoreReviewerProfile } from "../../../../lib/atstore-profile.ts";
import { getValidSession } from "../../../../lib/oauth.ts";
import { putRecord } from "../../../../lib/pds.ts";
import { createAtprotoTid } from "../../../../lib/tid.ts";
import { rejectLargeRequest } from "../../../../lib/security.ts";

interface ReviewPayload {
  rating?: unknown;
  body?: unknown;
}

const MAX_REVIEW_REQUEST_BYTES = 16_384;

export const handler = define.handlers({
  POST: withRateLimit(async (ctx) => {
    const proxied = await proxyAppviewApiResponse(ctx.url, ctx.req).catch(
      (err) => appviewProxyError(err),
    );
    if (proxied) return proxied;

    const large = rejectLargeRequest(ctx.req, MAX_REVIEW_REQUEST_BYTES);
    if (large) return large;

    const user = ctx.state.user;
    if (!user) return jsonError(401, "not_authenticated");

    const app = await getAppListingByIdentifier(ctx.params.identifier).catch(
      () => null,
    );
    if (!app || !app.atstoreListingUri) {
      return jsonError(404, "shared_app_record_not_found");
    }
    if (
      app.productDid === user.did || app.profileDid === user.did ||
      app.legacyProfileDid === user.did
    ) {
      return jsonError(400, "cannot_review_self");
    }

    const session = await getValidSession(user.did);
    if (!session) return jsonError(401, "oauth_session_expired");

    const body = await ctx.req.json().catch(() => null) as
      | ReviewPayload
      | null;
    if (!body) return jsonError(400, "invalid_body");

    const rating = parseRating(body.rating);
    if (!rating) return jsonError(400, "invalid_rating");
    const text = normalizeReviewText(body.body);
    if (text == null) return jsonError(400, "body_too_long");

    await ensureAtstoreReviewerProfile({
      did: user.did,
      handle: user.handle,
      pdsUrl: session.pdsUrl,
    }).catch((err) => {
      console.warn("[apps/reviews] could not ensure ATStore profile:", err);
    });

    const existing = await getOwnAppReview(app.id, user.did).catch(() => null);
    const now = Date.now();
    const rkey = existing?.rkey ?? createAtprotoTid();
    const createdAt = existing?.createdAt
      ? new Date(existing.createdAt).toISOString()
      : new Date(now).toISOString();
    const record = {
      subject: app.atstoreListingUri,
      rating,
      ...(text ? { text } : {}),
      createdAt,
    };

    const result = await putRecord(
      user.did,
      session.pdsUrl,
      ATSTORE_REVIEW_NSID,
      rkey,
      record,
    ).catch((err) => err instanceof Error ? err : new Error(String(err)));
    if (result instanceof Error) {
      return jsonResponse(502, {
        error: "put_record_failed",
        detail: result.message,
      });
    }

    const uri = result.uri ||
      `at://${user.did}/${ATSTORE_REVIEW_NSID}/${rkey}`;
    await upsertAppReview({
      sourceType: "atstore_review",
      uri,
      cid: result.cid,
      repoDid: user.did,
      rkey,
      subject: app.atstoreListingUri,
      rating,
      body: text,
      createdAt: Date.parse(createdAt) || now,
      updatedAt: now,
    });
    return jsonResponse(200, { ok: true, uri, cid: result.cid });
  }),
});

function parseRating(value: unknown): 1 | 2 | 3 | 4 | 5 | null {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5
    ? value
    : null;
}

function normalizeReviewText(value: unknown): string | null {
  if (typeof value !== "string") return "";
  const text = value.trim();
  return text.length <= 8000 ? text : null;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function jsonError(status: number, code: string): Response {
  return jsonResponse(status, { error: code });
}

function appviewProxyError(err: unknown): Response {
  console.warn("[api/apps/reviews] appview proxy failed:", err);
  return jsonResponse(503, { error: "appview_unavailable" });
}
