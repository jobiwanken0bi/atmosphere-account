/**
 * Update settings for the signed-in user's profile.
 * User accounts can edit their local/public display fields and choose whether
 * their microblog profile appears on their public Atmosphere profile.
 */
import { define } from "../../../utils.ts";
import { proxyAppviewApiResponse } from "../../../lib/appview-client.ts";
import {
  getAppUser,
  getEffectiveAccountType,
  updateAppUserSettings,
} from "../../../lib/account-types.ts";
import {
  DEFAULT_BSKY_CLIENT_ID,
  isProfileMicroblogViewerId,
} from "../../../lib/bsky-clients.ts";
import { devPickerAccountForDid } from "../../../lib/dev-picker-demo.ts";
import { IS_DEV } from "../../../lib/env.ts";
import { getSessionForCapabilities } from "../../../lib/oauth.ts";
import { oauthReauthorizationUrl } from "../../../lib/oauth-action.ts";
import type { OAuthCapability } from "../../../lib/oauth-scopes.ts";
import {
  getBskyProfile,
  getProfileRecord,
  putProfileRecord,
  uploadBlob,
} from "../../../lib/pds.ts";
import {
  profilePdsFailureResponse,
  retryTransientProfileRead,
} from "../../../lib/profile-pds-resilience.ts";
import { type ProfileRecord, validateProfile } from "../../../lib/lexicons.ts";
import { getProfileByDid, upsertProfile } from "../../../lib/registry.ts";
import { normalizeProfileWebsiteUrl } from "../../../lib/user-profile-links.ts";
import {
  readFormDataRequestWithLimit,
  rejectLargeRequest,
  RequestBodyTooLargeError,
} from "../../../lib/security.ts";
import { userProfileWriteCapabilities } from "../../../lib/profile-write-capabilities.ts";
import { enforceDurableRateLimit } from "../../../lib/rate-limit.ts";
import { matchesRasterImageSignature } from "../../../lib/raster-image-security.ts";

const AVATAR_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const AVATAR_MAX_BYTES = 1_000_000;
const MAX_PROFILE_FORM_BYTES = AVATAR_MAX_BYTES + 64_000;

export const handler = define.handlers({
  async POST(ctx) {
    const proxied = await proxyAppviewApiResponse(ctx.url, ctx.req).catch(
      (err) => appviewUnavailable("account profile update", err),
    );
    if (proxied) return proxied;

    const large = rejectLargeRequest(ctx.req, MAX_PROFILE_FORM_BYTES);
    if (large) return large;

    const user = ctx.state.user;
    if (!user) return new Response("not authenticated", { status: 401 });
    const limited = await enforceDurableRateLimit(ctx.req, {
      scope: "account-profile-write",
      capacity: 20,
      refillMs: 60_000,
    });
    if (limited) return limited;
    const accountType = await getEffectiveAccountType(user.did).catch(() =>
      null
    );
    if (accountType !== "user") {
      return new Response("user account required", { status: 403 });
    }

    let form: FormData | null;
    try {
      form = await readFormDataRequestWithLimit(
        ctx.req,
        MAX_PROFILE_FORM_BYTES,
      );
    } catch (error) {
      return new Response(
        error instanceof RequestBodyTooLargeError
          ? "request body too large"
          : "invalid profile form",
        { status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
      );
    }
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

    const requiredCapabilities = userProfileWriteCapabilities(!!avatarFile);
    const [session, appUser, existingProfile] = await Promise.all([
      getSessionForCapabilities(user.did, requiredCapabilities),
      getAppUser(user.did),
      getProfileByDid(user.did, { profileType: "user" }).catch(() => null),
    ]);
    const devAccount = IS_DEV ? devPickerAccountForDid(user.did) : null;
    if (!appUser) return new Response("account not found", { status: 401 });
    if (!session && !devAccount) {
      return profileReauthRequired({
        capabilities: requiredCapabilities,
        name: displayName || user.handle,
      });
    }
    const profilePdsUrl = session?.pdsUrl ?? devAccount!.pdsUrl!;
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

    const existingRecord = session
      ? await retryTransientProfileRead(() =>
        getProfileRecord(user.did, session.pdsUrl)
      ).catch((err) => profilePdsFailureResponse("read", err))
      : null;
    if (existingRecord instanceof Response) return existingRecord;
    const createdAt = existingRecord?.createdAt ??
      (existingProfile
        ? new Date(existingProfile.createdAt).toISOString()
        : new Date().toISOString());
    let avatar = existingRecord?.avatar;
    if (session && !existingRecord && !avatarFile) {
      const microblogProfile = await getBskyProfile(session.pdsUrl, user.did)
        .catch(() => null);
      avatar = microblogProfile?.avatar;
    }
    if (avatarFile) {
      if (!session) {
        return new Response(
          "avatar uploads require a real account in the local preview",
          { status: 400 },
        );
      }
      try {
        const bytes = new Uint8Array(await avatarFile.arrayBuffer());
        if (!matchesRasterImageSignature(bytes, avatarFile.type)) {
          return new Response(
            "avatar contents do not match the selected image type",
            { status: 400 },
          );
        }
        avatar = await uploadBlob(
          user.did,
          session.pdsUrl,
          bytes,
          avatarFile.type,
        );
      } catch (err) {
        return profilePdsFailureResponse("avatar", err);
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

    const put = session
      ? await putProfileRecord(
        user.did,
        session.pdsUrl,
        validation.value,
      ).catch((err) => profilePdsFailureResponse("write", err))
      : { cid: `dev-profile-${Date.now()}`, commit: undefined };
    if (put instanceof Response) return put;

    try {
      await updateAppUserSettings({
        did: user.did,
        displayName,
        bio,
        bskyClientId: safeClientId,
        bskyButtonVisible: visible,
        websiteUrl: safeWebsiteUrl,
        websiteVisible: Boolean(publicWebsiteUrl),
        avatarCid: validation.value.avatar?.ref.$link,
        avatarMime: validation.value.avatar?.mimeType,
      });
    } catch (err) {
      console.error(
        "[profile] PDS record saved but local display settings failed:",
        err,
      );
      return new Response(
        "Your profile was saved to your account host, but its display settings were not confirmed. Retry the save.",
        {
          status: 503,
          headers: {
            "cache-control": "no-store",
            "content-type": "text/plain; charset=utf-8",
            "x-atmosphere-error-code": "local_settings_incomplete",
          },
        },
      );
    }

    // This table is a local projection of the canonical PDS record. A failed
    // immediate upsert must not turn a successful PDS write into a false save
    // failure: Jetstream will reconcile the projection from the saved record.
    await upsertProfile({
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
      pdsUrl: profilePdsUrl,
      recordCid: put.cid,
      recordRev: put.commit?.rev ?? put.cid,
      createdAt: Date.parse(validation.value.createdAt) || Date.now(),
    }).catch((err) => {
      if (!session) throw err;
      console.warn(
        "[profile] immediate projection failed; awaiting Jetstream reconciliation:",
        err,
      );
    });

    return new Response(null, {
      status: 303,
      headers: { location: "/account" },
    });
  },
});

function appviewUnavailable(scope: string, err: unknown): Response {
  console.error(`[appview] ${scope} proxy failed:`, err);
  return new Response("Updating this profile is temporarily unavailable.", {
    status: 503,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
    },
  });
}

function fileFromForm(
  value: FormDataEntryValue | null | undefined,
): File | null {
  return value instanceof File && value.size > 0 ? value : null;
}

function profileReauthRequired(input: {
  capabilities: readonly OAuthCapability[];
  name: string;
}): Response {
  return new Response(
    JSON.stringify({
      error: "reauth_required",
      reauthUrl: oauthReauthorizationUrl({
        next: "/account",
        action: "profile",
        capabilities: input.capabilities,
        name: input.name,
      }),
    }),
    {
      status: 403,
      headers: { "content-type": "application/json; charset=utf-8" },
    },
  );
}
