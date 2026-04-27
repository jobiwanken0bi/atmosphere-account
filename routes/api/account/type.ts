/**
 * Persist the signed-in account's local role: normal user or project.
 */
import { define } from "../../../utils.ts";
import {
  type AccountType,
  setAppUserType,
} from "../../../lib/account-types.ts";
import { loadSession } from "../../../lib/oauth.ts";
import { getBskyProfile, putProfileRecord } from "../../../lib/pds.ts";
import { getProfileByDid, upsertProfile } from "../../../lib/registry.ts";
import { type ProfileRecord, validateProfile } from "../../../lib/lexicons.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const user = ctx.state.user;
    if (!user) {
      return new Response("not authenticated", { status: 401 });
    }
    const form = await ctx.req.formData().catch(() => null);
    const raw = form?.get("accountType");
    const rawNext = form?.get("next");
    const next = typeof rawNext === "string" && rawNext.startsWith("/") &&
        !rawNext.startsWith("//")
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
      const now = new Date().toISOString();
      const draft: ProfileRecord = {
        profileType: "user",
        name: bskyProfile?.displayName?.trim() || user.handle,
        description: bskyProfile?.description?.trim() ?? "",
        avatar: bskyProfile?.avatar,
        createdAt: now,
      };
      const validation = validateProfile(draft);
      if (!validation.ok || !validation.value) {
        return new Response(`invalid user profile: ${validation.error}`, {
          status: 400,
        });
      }
      const result = await putProfileRecord(
        user.did,
        session.pdsUrl,
        validation.value,
      ).then((value) => value).catch((err) =>
        err instanceof Error ? err : new Error(String(err))
      );
      if (result instanceof Error) {
        return new Response(`putRecord failed: ${result.message}`, {
          status: 502,
        });
      }
      await upsertProfile({
        did: user.did,
        handle: user.handle,
        profileType: "user",
        name: validation.value.name,
        description: validation.value.description,
        categories: [],
        subcategories: [],
        links: [],
        screenshots: [],
        avatarCid: validation.value.avatar?.ref.$link ?? null,
        avatarMime: validation.value.avatar?.mimeType ?? null,
        pdsUrl: session.pdsUrl,
        recordCid: result.cid,
        recordRev: result.commit?.rev ?? result.cid,
        createdAt: Date.parse(validation.value.createdAt) || Date.now(),
      });
    }

    return new Response(null, {
      status: 303,
      headers: {
        location: accountType === "project"
          ? next ?? "/explore/manage"
          : next ?? "/account/reviews",
      },
    });
  },
});
