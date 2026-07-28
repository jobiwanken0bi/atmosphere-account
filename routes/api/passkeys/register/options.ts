import { define } from "../../../../utils.ts";
import { getValidSession } from "../../../../lib/oauth.ts";
import { readPasskeyManagementTicket } from "../../../../lib/passkey-management.ts";
import { createPasskeyRegistrationOptions } from "../../../../lib/passkeys.ts";
import { passkeyRelyingPartyForRequest } from "../../../../lib/passkey-rp.ts";
import { enforceDurableRateLimit } from "../../../../lib/rate-limit.ts";
import {
  readJsonRequestWithLimit,
  rejectLargeRequest,
  RequestBodyTooLargeError,
} from "../../../../lib/security.ts";
import { devPickerAccountForDid } from "../../../../lib/dev-picker-demo.ts";
import { IS_DEV } from "../../../../lib/env.ts";

const MAX_BODY_BYTES = 8_192;

export const handler = define.handlers({
  async POST(ctx) {
    const relyingParty = await passkeyRelyingPartyForRequest(
      ctx.url,
      ctx.req.headers,
    ).catch(() => null);
    if (!relyingParty) return untrustedOrigin();
    const user = ctx.state.user;
    if (!user) return authError(null, 401);
    const ticket = await readPasskeyManagementTicket(ctx.req);
    const devAccount = IS_DEV ? devPickerAccountForDid(user.did) : null;
    if (
      (!ticket || ticket.did !== user.did) &&
      devAccount?.handle.toLowerCase() !== user.handle.toLowerCase()
    ) return authError(user.handle, 403);
    const limited = await enforceDurableRateLimit(ctx.req, {
      scope: "passkey-registration-options",
      capacity: 12,
      refillMs: 60_000,
    });
    if (limited) return limited;
    const large = rejectLargeRequest(ctx.req, MAX_BODY_BYTES);
    if (large) return large;
    try {
      await readJsonRequestWithLimit(ctx.req, MAX_BODY_BYTES);
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return json({ error: error.message }, 413);
      }
      return json({ error: "Invalid passkey request." }, 400);
    }
    const oauthSession = await getValidSession(user.did, { quiet: true });
    const linkedAccount = oauthSession ?? (devAccount
      ? {
        did: devAccount.did,
        handle: devAccount.handle,
      }
      : null);
    if (!linkedAccount) return authError(user.handle, 403);
    try {
      const result = await createPasskeyRegistrationOptions({
        did: linkedAccount.did,
        handle: linkedAccount.handle,
        displayName: linkedAccount.handle,
        rp: {
          rpId: relyingParty.id,
          rpName: relyingParty.name,
          origin: relyingParty.origin,
        },
      });
      return json({
        ceremony: result.ceremonyToken,
        options: result.options,
      });
    } catch (error) {
      return json({
        error: error instanceof Error
          ? error.message
          : "Passkey enrollment could not start.",
      }, 400);
    }
  },
});

function untrustedOrigin(): Response {
  return json(
    { error: "Passkeys are unavailable on this account address." },
    403,
  );
}

function authError(handle: string | null, status: number): Response {
  const redirectUrl = handle ? managementReauthUrl(handle) : null;
  return json({
    error: "Reconfirm with your account host before changing passkeys.",
    ...(redirectUrl ? { redirectUrl } : {}),
  }, status);
}

function managementReauthUrl(handle: string): string {
  const next = `/passkeys?handle=${encodeURIComponent(handle)}`;
  return `/oauth/login?${new URLSearchParams({ handle, next }).toString()}`;
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    },
  });
}
