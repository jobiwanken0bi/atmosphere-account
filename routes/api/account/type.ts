/**
 * Persist the signed-in account's local role: normal user or project.
 */
import { define } from "../../../utils.ts";
import { proxyAppviewApiResponse } from "../../../lib/appview-client.ts";
import {
  type AccountType,
  setAppUserType,
} from "../../../lib/account-types.ts";
import { loadSession } from "../../../lib/oauth.ts";
import { getBskyProfile } from "../../../lib/pds.ts";
import { getProfileByDid } from "../../../lib/registry.ts";
import {
  isSafeRelativePath,
  readFormDataRequestWithLimit,
  rejectLargeRequest,
  RequestBodyTooLargeError,
} from "../../../lib/security.ts";

const MAX_ACCOUNT_TYPE_FORM_BYTES = 8_192;

export const handler = define.handlers({
  async POST(ctx) {
    const proxied = await proxyAppviewApiResponse(ctx.url, ctx.req).catch(
      (err) => appviewUnavailable("account type update", err),
    );
    if (proxied) return proxied;

    const large = rejectLargeRequest(ctx.req, MAX_ACCOUNT_TYPE_FORM_BYTES);
    if (large) return large;

    const user = ctx.state.user;
    if (!user) {
      return new Response("not authenticated", { status: 401 });
    }
    let form: FormData | null;
    try {
      form = await readFormDataRequestWithLimit(
        ctx.req,
        MAX_ACCOUNT_TYPE_FORM_BYTES,
      );
    } catch (error) {
      return new Response(
        error instanceof RequestBodyTooLargeError
          ? "request body too large"
          : "invalid request",
        { status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
      );
    }
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

    const [bskyProfile, atmosphereProfile] = await Promise.all([
      session
        ? getBskyProfile(session.pdsUrl, user.did).catch(() => null)
        : Promise.resolve(null),
      getProfileByDid(user.did, {
        includeTakenDown: true,
        profileType: "user",
      }).catch(() => null),
    ]);
    const identityProfile = accountType === "user" && atmosphereProfile
      ? {
        displayName: atmosphereProfile.name,
        bio: atmosphereProfile.description,
        avatarCid: atmosphereProfile.avatarCid,
        avatarMime: atmosphereProfile.avatarMime,
      }
      : {
        displayName: bskyProfile?.displayName ?? null,
        bio: bskyProfile?.description ?? null,
        avatarCid: bskyProfile?.avatar?.ref.$link ?? null,
        avatarMime: bskyProfile?.avatar?.mimeType ?? null,
      };

    await setAppUserType({
      did: user.did,
      handle: user.handle,
      ...identityProfile,
      accountType,
    });

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

function appviewUnavailable(scope: string, err: unknown): Response {
  console.error(`[appview] ${scope} proxy failed:`, err);
  return new Response("Updating this account is temporarily unavailable.", {
    status: 503,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
    },
  });
}
