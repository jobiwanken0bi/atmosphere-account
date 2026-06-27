import { define } from "../../../utils.ts";
import {
  findExistingAtstoreListingForProfile,
  getAtstoreMigrationReadiness,
  indexAtstoreListingMigrationRecord,
  publishAtstoreListingMigration,
} from "../../../lib/atstore-migration.ts";
import { getAppListingByIdentifier } from "../../../lib/app-directory.ts";
import { getEffectiveAccountType } from "../../../lib/account-types.ts";
import { loadSession } from "../../../lib/oauth.ts";
import { getProfileRecord } from "../../../lib/pds.ts";
import { getProfileByDid } from "../../../lib/registry.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const user = ctx.state.user;
    if (!user) return jsonError(401, "not_authenticated");
    const accountType = await getEffectiveAccountType(user.did).catch(() =>
      null
    );
    if (accountType !== "project") {
      return jsonError(403, "project_account_required");
    }

    const session = await loadSession(user.did);
    if (!session) return jsonError(401, "reauth_required");

    const profile = await getProfileByDid(user.did, {
      includeTakenDown: true,
    }).catch(() => null);
    if (!profile) return jsonError(404, "profile_not_found");

    const existingListing = await getAppListingByIdentifier(profile.handle)
      .catch(() => null);
    if (existingListing?.atstoreListingUri) {
      return jsonResponse(200, {
        ok: true,
        alreadyMigrated: true,
        uri: existingListing.atstoreListingUri,
        slug: existingListing.slug,
      });
    }

    const existingRemote = await findExistingAtstoreListingForProfile(
      user.did,
      session.pdsUrl,
    ).catch(() => null);
    if (existingRemote) {
      const indexed = await indexAtstoreListingMigrationRecord(
        existingRemote,
        user.did,
      );
      if (indexed) {
        return jsonResponse(200, {
          ok: true,
          alreadyMigrated: true,
          uri: indexed.uri,
          cid: indexed.cid,
          slug: indexed.slug,
        });
      }
    }

    const sourceRecord = await getProfileRecord(user.did, session.pdsUrl)
      .catch(() => null);
    const readiness = getAtstoreMigrationReadiness(profile, sourceRecord);
    if (!readiness.ok || !sourceRecord) {
      return jsonResponse(400, {
        error: "not_ready",
        issues: readiness.issues,
      });
    }

    try {
      const result = await publishAtstoreListingMigration({
        did: user.did,
        pdsUrl: session.pdsUrl,
        profile,
        sourceRecord,
      });
      return jsonResponse(200, {
        ok: true,
        uri: result.uri,
        cid: result.cid,
        slug: result.slug,
      });
    } catch (err) {
      console.error("[atstore-migration] putRecord failed:", err);
      return jsonResponse(502, {
        error: "publish_failed",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  },
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function jsonError(status: number, code: string): Response {
  return jsonResponse(status, { error: code });
}
