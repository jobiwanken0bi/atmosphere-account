/**
 * Update settings for the signed-in user's profile.
 * User accounts can edit their local/public display fields and Bluesky
 * button preferences from /account/reviews.
 */
import { define } from "../../../utils.ts";
import {
  getAppUser,
  getEffectiveAccountType,
  updateAppUserSettings,
} from "../../../lib/account-types.ts";
import { BSKY_CLIENT_IDS } from "../../../lib/bsky-clients.ts";
import { loadSession } from "../../../lib/oauth.ts";
import { getProfileRecord, putProfileRecord } from "../../../lib/pds.ts";
import { type ProfileRecord, validateProfile } from "../../../lib/lexicons.ts";
import { getProfileByDid, upsertProfile } from "../../../lib/registry.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const user = ctx.state.user;
    if (!user) return new Response("not authenticated", { status: 401 });
    const accountType = await getEffectiveAccountType(user.did).catch(() =>
      null
    );
    if (accountType !== "user") {
      return new Response("user account required", { status: 403 });
    }

    const form = await ctx.req.formData().catch(() => null);
    const displayName = String(form?.get("displayName") ?? "").trim();
    const bio = String(form?.get("bio") ?? "").trim();
    const rawClient = form?.get("bskyClientId");
    const visible = form?.getAll("bskyButtonVisible").includes("1") ?? false;
    if (!displayName || displayName.length > 60) {
      return new Response("display name must be 1-60 characters", {
        status: 400,
      });
    }
    if (bio.length > 500) {
      return new Response("bio must be 500 characters or fewer", {
        status: 400,
      });
    }
    if (
      typeof rawClient !== "string" ||
      !BSKY_CLIENT_IDS.includes(rawClient as typeof BSKY_CLIENT_IDS[number])
    ) {
      return new Response("invalid Bluesky client", { status: 400 });
    }

    const [session, appUser, existingProfile] = await Promise.all([
      loadSession(user.did),
      getAppUser(user.did),
      getProfileByDid(user.did, { profileType: "user" }).catch(() => null),
    ]);
    if (!session || !appUser) {
      return new Response("session not found", { status: 401 });
    }

    const existingRecord = await getProfileRecord(user.did, session.pdsUrl)
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        return new Response(`getRecord failed: ${message}`, { status: 502 });
      });
    if (existingRecord instanceof Response) return existingRecord;
    const createdAt = existingRecord?.createdAt ??
      (existingProfile
        ? new Date(existingProfile.createdAt).toISOString()
        : new Date().toISOString());
    const draft: ProfileRecord = {
      profileType: "user",
      name: displayName,
      description: bio,
      avatar: existingRecord?.avatar,
      createdAt,
    };
    const validation = validateProfile(draft);
    if (!validation.ok || !validation.value) {
      return new Response(`invalid profile: ${validation.error}`, {
        status: 400,
      });
    }

    const put = await putProfileRecord(
      user.did,
      session.pdsUrl,
      validation.value,
    )
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        return new Response(`putRecord failed: ${message}`, { status: 502 });
      });
    if (put instanceof Response) return put;

    await Promise.all([
      updateAppUserSettings({
        did: user.did,
        displayName,
        bio,
        bskyClientId: rawClient,
        bskyButtonVisible: visible,
      }),
      upsertProfile({
        did: user.did,
        handle: user.handle,
        profileType: validation.value.profileType,
        name: validation.value.name,
        description: validation.value.description,
        mainLink: null,
        iosLink: null,
        androidLink: null,
        categories: [],
        subcategories: [],
        links: [],
        screenshots: [],
        avatarCid: validation.value.avatar?.ref.$link ?? null,
        avatarMime: validation.value.avatar?.mimeType ?? null,
        iconCid: null,
        iconMime: null,
        iconBwCid: null,
        iconBwMime: null,
        pdsUrl: session.pdsUrl,
        recordCid: put.cid,
        recordRev: put.commit?.rev ?? put.cid,
        createdAt: Date.parse(validation.value.createdAt) || Date.now(),
      }),
    ]);

    return new Response(null, {
      status: 303,
      headers: { location: "/account/reviews" },
    });
  },
});
