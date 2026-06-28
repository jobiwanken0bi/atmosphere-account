/**
 * Update settings for the signed-in user's profile.
 * User accounts can edit their local/public display fields and choose whether
 * their microblog profile appears on their public Atmosphere profile.
 */
import { define } from "../../../utils.ts";
import {
  getAppUser,
  getEffectiveAccountType,
  updateAppUserSettings,
} from "../../../lib/account-types.ts";
import {
  DEFAULT_BSKY_CLIENT_ID,
  isProfileMicroblogViewerId,
} from "../../../lib/bsky-clients.ts";
import { loadSession } from "../../../lib/oauth.ts";
import {
  getProfileRecord,
  putProfileRecord,
  uploadBlob,
} from "../../../lib/pds.ts";
import { type ProfileRecord, validateProfile } from "../../../lib/lexicons.ts";
import { getProfileByDid, upsertProfile } from "../../../lib/registry.ts";
import { normalizeProfileWebsiteUrl } from "../../../lib/user-profile-links.ts";
import { rejectLargeRequest } from "../../../lib/security.ts";

const AVATAR_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const AVATAR_MAX_BYTES = 1_000_000;
const MAX_PROFILE_FORM_BYTES = AVATAR_MAX_BYTES + 64_000;

export const handler = define.handlers({
  async POST(ctx) {
    const large = rejectLargeRequest(ctx.req, MAX_PROFILE_FORM_BYTES);
    if (large) return large;

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
    const rawWebsite = String(form?.get("websiteUrl") ?? "").trim();
    const avatarFile = fileFromForm(form?.get("avatarUpload"));
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
    if (avatarFile && !AVATAR_MIME_TYPES.has(avatarFile.type)) {
      return new Response("avatar must be PNG, JPEG, or WebP", {
        status: 400,
      });
    }
    if (avatarFile && avatarFile.size > AVATAR_MAX_BYTES) {
      return new Response("avatar must be under 1 MB", { status: 400 });
    }

    const [session, appUser, existingProfile] = await Promise.all([
      loadSession(user.did),
      getAppUser(user.did),
      getProfileByDid(user.did, { profileType: "user" }).catch(() => null),
    ]);
    if (!session || !appUser) {
      return new Response("session not found", { status: 401 });
    }
    const clientId = typeof rawClient === "string"
      ? rawClient
      : appUser.bskyClientId;
    if (
      typeof rawClient === "string" && !isProfileMicroblogViewerId(rawClient)
    ) {
      return new Response("invalid microblog viewer", { status: 400 });
    }
    const safeClientId = isProfileMicroblogViewerId(clientId)
      ? clientId
      : DEFAULT_BSKY_CLIENT_ID;
    const visible = form?.has("bskyButtonVisible")
      ? form.getAll("bskyButtonVisible").includes("1")
      : appUser.bskyButtonVisible;
    const websiteVisible = form?.has("websiteVisible")
      ? form.getAll("websiteVisible").includes("1")
      : appUser.websiteVisible;
    const websiteResult = normalizeProfileWebsiteUrl(rawWebsite);
    if (!websiteResult.ok) {
      if (websiteVisible) {
        return new Response(websiteResult.message, { status: 400 });
      }
    }
    const safeWebsiteUrl = websiteResult.ok ? websiteResult.url : null;
    if (websiteVisible && !safeWebsiteUrl) {
      return new Response(
        "website URL is required when website link is shown",
        {
          status: 400,
        },
      );
    }
    const publicWebsiteUrl = websiteVisible ? safeWebsiteUrl : null;

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
    let avatar = existingRecord?.avatar;
    if (avatarFile) {
      try {
        const bytes = new Uint8Array(await avatarFile.arrayBuffer());
        avatar = await uploadBlob(
          user.did,
          session.pdsUrl,
          bytes,
          avatarFile.type,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return new Response(`avatar upload failed: ${message}`, {
          status: 502,
        });
      }
    }
    const draft: ProfileRecord = {
      profileType: "user",
      name: displayName,
      description: bio,
      avatar,
      mainLink: publicWebsiteUrl ?? undefined,
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
        bskyClientId: safeClientId,
        bskyButtonVisible: visible,
        websiteUrl: safeWebsiteUrl,
        websiteVisible: Boolean(publicWebsiteUrl),
        avatarCid: validation.value.avatar?.ref.$link,
        avatarMime: validation.value.avatar?.mimeType,
      }),
      upsertProfile({
        did: user.did,
        handle: user.handle,
        profileType: validation.value.profileType,
        name: validation.value.name,
        description: validation.value.description,
        mainLink: validation.value.mainLink ?? null,
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
      headers: { location: "/account" },
    });
  },
});

function fileFromForm(
  value: FormDataEntryValue | null | undefined,
): File | null {
  return value instanceof File && value.size > 0 ? value : null;
}
