/**
 * OAuth redirect target. Exchanges the authorization code for tokens,
 * persists the session, and bounces the user into /explore/manage.
 *
 * Also appends the freshly-authenticated account to the per-device
 * `atmo_accounts` cookie so the AccountMenu switcher can offer
 * one-click sign-in for any account that has previously authorised
 * on this browser.
 */
import { define } from "../../utils.ts";
import { completeCallback, isOAuthConfigured } from "../../lib/oauth.ts";
import { buildSessionCookie, createSession } from "../../lib/session.ts";
import { getBskyProfile, putProfileRecord } from "../../lib/pds.ts";
import {
  addRememberedAccountCookie,
  readRememberedAccountsFromHeader,
} from "../../lib/remembered-accounts.ts";
import {
  type AccountType,
  getEffectiveAccountType,
  setAppUserType,
  updateAppUserProfile,
} from "../../lib/account-types.ts";
import { type ProfileRecord, validateProfile } from "../../lib/lexicons.ts";
import { upsertProfile } from "../../lib/registry.ts";

export const handler = define.handlers({
  async GET(ctx) {
    if (!isOAuthConfigured()) {
      return new Response("OAuth is not configured", { status: 503 });
    }
    const state = ctx.url.searchParams.get("state");
    const code = ctx.url.searchParams.get("code");
    const iss = ctx.url.searchParams.get("iss");
    const error = ctx.url.searchParams.get("error");
    if (error) {
      return new Response(`authorization denied: ${error}`, { status: 400 });
    }
    if (!state || !code || !iss) {
      return new Response("missing state, code, or iss", { status: 400 });
    }
    try {
      const result = await completeCallback({ state, code, iss });
      const sessionCookie = buildSessionCookie(
        await createSession({ did: result.did, handle: result.handle }),
      );

      /** Append to the per-device remembered list so the next visit
       *  can offer this account in the switcher even if the active
       *  session cookie has been cleared. */
      const remembered = await readRememberedAccountsFromHeader(
        ctx.req.headers.get("cookie"),
      );
      const rememberedCookie = await addRememberedAccountCookie(remembered, {
        did: result.did,
        handle: result.handle,
      });

      const bskyProfile = await getBskyProfile(result.pdsUrl, result.did).catch(
        () => null,
      );
      await updateAppUserProfile({
        did: result.did,
        handle: result.handle,
        displayName: bskyProfile?.displayName ?? null,
        bio: bskyProfile?.description ?? null,
        avatarCid: bskyProfile?.avatar?.ref.$link ?? null,
        avatarMime: bskyProfile?.avatar?.mimeType ?? null,
      }).catch(() => {});

      /**
       * Auto-classify newly signed-in DIDs based on the sign-in intent
       * carried through the OAuth flow:
       *  - `intent === "project"` (clicked "Submit your project")
       *      → mark as project, take them to the project dashboard.
       *  - `intent === "user"` or unset (header sign-in, review CTAs)
       *      → mark as user and publish a baseline user profile record.
       *
       * If the DID already has a type (re-sign-in or upgrade flows),
       * the intent is ignored and the existing classification stands.
       */
      let accountType: AccountType | null = await getEffectiveAccountType(
        result.did,
      ).catch(() => null);
      if (accountType == null) {
        const desired: AccountType = result.intent === "project"
          ? "project"
          : "user";
        await setAppUserType({
          did: result.did,
          handle: result.handle,
          displayName: bskyProfile?.displayName ?? null,
          bio: bskyProfile?.description ?? null,
          avatarCid: bskyProfile?.avatar?.ref.$link ?? null,
          avatarMime: bskyProfile?.avatar?.mimeType ?? null,
          accountType: desired,
        }).catch(() => {});
        accountType = desired;
      }
      if (accountType === "user") {
        const now = new Date().toISOString();
        const draft: ProfileRecord = {
          profileType: "user",
          name: bskyProfile?.displayName?.trim() || result.handle,
          description: bskyProfile?.description?.trim() ?? "",
          avatar: bskyProfile?.avatar,
          createdAt: now,
        };
        const validation = validateProfile(draft);
        if (validation.ok && validation.value) {
          const put = await putProfileRecord(
            result.did,
            result.pdsUrl,
            validation.value,
          ).catch(() => null);
          if (put) {
            await upsertProfile({
              did: result.did,
              handle: result.handle,
              profileType: "user",
              name: validation.value.name,
              description: validation.value.description,
              categories: [],
              subcategories: [],
              links: [],
              screenshots: [],
              avatarCid: validation.value.avatar?.ref.$link ?? null,
              avatarMime: validation.value.avatar?.mimeType ?? null,
              pdsUrl: result.pdsUrl,
              recordCid: put.cid,
              recordRev: put.commit?.rev ?? put.cid,
              createdAt: Date.parse(validation.value.createdAt) || Date.now(),
            }).catch(() => {});
          }
        }
      }
      const returnTo = result.returnTo && result.returnTo.startsWith("/") &&
          !result.returnTo.startsWith("//")
        ? result.returnTo
        : null;
      const defaultLanding = accountType === "project"
        ? "/explore/manage"
        : "/account/reviews";
      const headers = new Headers({
        location: returnTo ?? defaultLanding,
      });
      headers.append("set-cookie", sessionCookie);
      headers.append("set-cookie", rememberedCookie);
      return new Response(null, { status: 303, headers });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return new Response(`callback failed: ${message}`, { status: 400 });
    }
  },
});
