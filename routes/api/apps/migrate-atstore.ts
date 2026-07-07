import { define } from "../../../utils.ts";
import { proxyAppviewApiResponse } from "../../../lib/appview-client.ts";
import {
  type AtstoreMigrationPublishResult,
  findExistingAtstoreListingForProfile,
  getAtstoreMigrationReadiness,
  indexAtstoreListingMigrationRecord,
  publishAtstoreListingMigration,
} from "../../../lib/atstore-migration.ts";
import {
  findExistingCommunityAppProfile,
  publishCommunityAppProfileFromProfileRecord,
} from "../../../lib/community-app-profile.ts";
import { getAppListingByIdentifier } from "../../../lib/app-directory.ts";
import { getEffectiveAccountType } from "../../../lib/account-types.ts";
import { loadSession } from "../../../lib/oauth.ts";
import { getProfileRecord } from "../../../lib/pds.ts";
import { getProfileByDid } from "../../../lib/registry.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const proxied = await proxyAppviewApiResponse(ctx.url, ctx.req).catch(
      (err) => {
        console.error("[appview] migrate atstore proxy failed:", err);
        return new Response(JSON.stringify({ error: "appview_unavailable" }), {
          status: 503,
          headers: { "content-type": "application/json" },
        });
      },
    );
    if (proxied) return proxied;

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
      const existingCommunity = await findExistingCommunityAppProfile(
        user.did,
        session.pdsUrl,
      ).catch(() => null);
      const community = await publishCommunityAppProfileFromProfileRecord({
        did: user.did,
        handle: user.handle,
        pdsUrl: session.pdsUrl,
        record: sourceRecord,
        existingRecord: existingCommunity,
      });

      let alreadyMigrated = Boolean(existingListing?.atstoreListingUri);
      let result: AtstoreMigrationPublishResult | null =
        existingListing?.atstoreListingUri
          ? {
            uri: existingListing.atstoreListingUri,
            cid: "",
            rkey: existingListing.atstoreListingUri.split("/").at(-1) ?? "",
            slug: existingListing.slug,
          }
          : null;

      if (!result) {
        const existingRemote = await findExistingAtstoreListingForProfile(
          user.did,
          session.pdsUrl,
        ).catch(() => null);
        if (existingRemote) {
          result = await indexAtstoreListingMigrationRecord(
            existingRemote,
            user.did,
          );
          alreadyMigrated = Boolean(result);
        }
      }

      if (!result) {
        result = await publishAtstoreListingMigration({
          did: user.did,
          pdsUrl: session.pdsUrl,
          profile,
          sourceRecord,
        });
      }
      if (!result) {
        throw new Error("The ATStore record could not be indexed.");
      }

      return jsonResponse(200, {
        ok: true,
        uri: result.uri,
        cid: result.cid,
        slug: result.slug,
        alreadyMigrated,
        communityProfileUri: community.uri,
        communityProfileCid: community.cid,
      });
    } catch (err) {
      console.error("[shared-record-migration] putRecord failed:", err);
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
