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

export const handler = define.handlers({
  async POST(ctx) {
    const user = ctx.state.user;
    if (!user) {
      return new Response("not authenticated", { status: 401 });
    }
    const form = await ctx.req.formData().catch(() => null);
    const raw = form?.get("accountType");
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
    const bskyProfile = session
      ? await getBskyProfile(session.pdsUrl, user.did).catch(() => null)
      : null;

    await setAppUserType({
      did: user.did,
      handle: user.handle,
      displayName: bskyProfile?.displayName ?? null,
      accountType,
    });

    return new Response(null, {
      status: 303,
      headers: {
        location: accountType === "project"
          ? "/explore/manage"
          : "/account/reviews",
      },
    });
  },
});
