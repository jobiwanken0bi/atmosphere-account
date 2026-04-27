/**
 * Authenticated project-owner writes for What's New update records.
 *
 *   POST   /api/registry/profile/updates          create/update
 *   DELETE /api/registry/profile/updates?rkey=... delete
 */
import { define } from "../../../../utils.ts";
import { getEffectiveAccountType } from "../../../../lib/account-types.ts";
import { loadSession } from "../../../../lib/oauth.ts";
import { deleteUpdateRecord, putUpdateRecord } from "../../../../lib/pds.ts";
import { getProfileByDid } from "../../../../lib/registry.ts";
import {
  createUpdateRkey,
  getProfileUpdateByRkey,
  markProfileUpdateRemovedByRkey,
  updateUriForRkey,
  upsertProfileUpdate,
} from "../../../../lib/profile-updates.ts";
import { type UpdateRecord, validateUpdate } from "../../../../lib/lexicons.ts";

interface UpdatePayload {
  rkey?: unknown;
  title?: unknown;
  body?: unknown;
  version?: unknown;
  tangledCommitUrl?: unknown;
}

export const handler = define.handlers({
  async POST(ctx) {
    const user = ctx.state.user;
    if (!user) return jsonError(401, "not_authenticated");

    const accountType = await getEffectiveAccountType(user.did).catch(() =>
      null
    );
    if (accountType !== "project") return jsonError(403, "project_required");

    const [session, profile] = await Promise.all([
      loadSession(user.did),
      getProfileByDid(user.did, { includeTakenDown: true }).catch(() => null),
    ]);
    if (!session) return jsonError(401, "oauth_session_expired");
    if (!profile || profile.profileType !== "project") {
      return jsonError(403, "project_profile_required");
    }
    if (profile.takedownStatus === "taken_down") {
      return jsonError(403, "profile_taken_down");
    }

    const payload = await ctx.req.json().catch(() => null) as
      | UpdatePayload
      | null;
    if (!payload) return jsonError(400, "invalid_body");

    const rkey = typeof payload.rkey === "string" && payload.rkey.trim()
      ? payload.rkey.trim()
      : createUpdateRkey();
    const existing = await getProfileUpdateByRkey(user.did, rkey, {
      includeRemoved: true,
    }).catch(() => null);
    const now = new Date();
    const record: UpdateRecord = {
      title: typeof payload.title === "string" ? payload.title : "",
      body: typeof payload.body === "string" ? payload.body : "",
      version: typeof payload.version === "string"
        ? payload.version
        : undefined,
      tangledCommitUrl: typeof payload.tangledCommitUrl === "string"
        ? payload.tangledCommitUrl
        : undefined,
      tangledRepoUrl: profile.links.find((link) => link.kind === "tangled")
        ?.url ?? undefined,
      source: "manual",
      createdAt: existing
        ? new Date(existing.createdAt).toISOString()
        : now.toISOString(),
      updatedAt: now.toISOString(),
    };
    const validation = validateUpdate(record);
    if (!validation.ok || !validation.value) {
      return jsonResponse(400, {
        error: "invalid_update_record",
        detail: validation.error,
      });
    }

    const result = await putUpdateRecord(
      user.did,
      session.pdsUrl,
      rkey,
      validation.value,
    ).catch((err) => err instanceof Error ? err : new Error(String(err)));
    if (result instanceof Error) {
      return jsonResponse(502, {
        error: "put_record_failed",
        detail: result.message,
      });
    }

    const update = await upsertProfileUpdate({
      uri: updateUriForRkey(user.did, rkey),
      cid: result.cid,
      rkey,
      projectDid: user.did,
      title: validation.value.title,
      body: validation.value.body,
      version: validation.value.version ?? null,
      tangledCommitUrl: validation.value.tangledCommitUrl ?? null,
      tangledRepoUrl: validation.value.tangledRepoUrl ?? null,
      source: validation.value.source ?? "manual",
      createdAt: Date.parse(validation.value.createdAt) || Date.now(),
      updatedAt:
        Date.parse(validation.value.updatedAt ?? validation.value.createdAt) ||
        Date.now(),
    });
    return jsonResponse(200, { ok: true, update });
  },

  async DELETE(ctx) {
    const user = ctx.state.user;
    if (!user) return jsonError(401, "not_authenticated");

    const accountType = await getEffectiveAccountType(user.did).catch(() =>
      null
    );
    if (accountType !== "project") return jsonError(403, "project_required");

    const session = await loadSession(user.did);
    if (!session) return jsonError(401, "oauth_session_expired");

    const url = new URL(ctx.req.url);
    const rkey = url.searchParams.get("rkey")?.trim();
    if (!rkey) return jsonError(400, "missing_rkey");

    const deleted = await deleteUpdateRecord(user.did, session.pdsUrl, rkey)
      .then(() => null)
      .catch((err) => err instanceof Error ? err : new Error(String(err)));
    if (deleted) {
      return jsonResponse(502, {
        error: "delete_record_failed",
        detail: deleted.message,
      });
    }
    const removed = await markProfileUpdateRemovedByRkey(user.did, rkey);
    return jsonResponse(200, { ok: true, removed });
  },
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function jsonError(status: number, code: string): Response {
  return jsonResponse(status, { error: code });
}
