/**
 * Persist the signed-in account's local role: normal user or project.
 */
import { define } from "../../../utils.ts";
import {
  type AccountType,
  setAppUserType,
} from "../../../lib/account-types.ts";
import { loadSession } from "../../../lib/oauth.ts";
import { getBskyProfile } from "../../../lib/pds.ts";
import { getProfileByDid } from "../../../lib/registry.ts";
import {
  isSafeRelativePath,
  rejectLargeRequest,
} from "../../../lib/security.ts";
import { ensureUserProfileRecord } from "../../../lib/user-profile-records.ts";

const MAX_ACCOUNT_TYPE_FORM_BYTES = 8_192;

export const handler = define.handlers({
  async POST(ctx) {
    const large = rejectLargeRequest(ctx.req, MAX_ACCOUNT_TYPE_FORM_BYTES);
    if (large) return large;

    const user = ctx.state.user;
    if (!user) {
      return new Response("not authenticated", { status: 401 });
    }
    const form = await ctx.req.formData().catch(() => null);
    const raw = form?.get("accountType");
    const rawNext = form?.get("next");
    const next = typeof rawNext === "string" && isSafeRelativePath(rawNext)
      ? rawNext
      : null;
    const accountType = raw === "project" || raw === "user"
      ? raw as AccountType
      : null;
    if (!accountType) {
      return new Response("invalid account type", { status: 400 });
    }
    if (accountType === "user") {
      const existingProject = await getProfileByDid(user.did, {
        includeTakenDown: true,
      }).catch(() => null);
      if (existingProject) {
        return new Response(
          "This account already has a project profile. Delete the project profile before switching it to a user account.",
          { status: 409 },
        );
      }
    }

    const session = await loadSession(user.did).catch(() => null);
    if (accountType === "user" && !session) {
      return new Response("OAuth session expired, please sign in again", {
        status: 401,
      });
    }

    const bskyProfile = session
      ? await getBskyProfile(session.pdsUrl, user.did).catch(() => null)
      : null;

    await setAppUserType({
      did: user.did,
      handle: user.handle,
      displayName: bskyProfile?.displayName ?? null,
      bio: bskyProfile?.description ?? null,
      avatarCid: bskyProfile?.avatar?.ref.$link ?? null,
      avatarMime: bskyProfile?.avatar?.mimeType ?? null,
      accountType,
    });

    if (accountType === "user" && session) {
      const result = await ensureUserProfileRecord({
        did: user.did,
        handle: user.handle,
        pdsUrl: session.pdsUrl,
        fallbackName: bskyProfile?.displayName ?? null,
        fallbackDescription: bskyProfile?.description ?? null,
        fallbackAvatar: bskyProfile?.avatar ?? null,
      }).then(() => null).catch((err) =>
        err instanceof Error ? err : new Error(String(err))
      );
      if (result) {
        return new Response(`user profile setup failed: ${result.message}`, {
          status: 502,
        });
      }
    }

    return new Response(null, {
      status: 303,
      headers: {
        location: accountType === "project"
          ? next ?? "/apps/manage"
          : next ?? "/account",
      },
    });
  },
});
