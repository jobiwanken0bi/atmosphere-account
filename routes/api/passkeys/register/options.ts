import { define } from "../../../../utils.ts";
import { getValidSession } from "../../../../lib/oauth.ts";
import { readPasskeyManagementTicket } from "../../../../lib/passkey-management.ts";
import {
  createPasskeyRegistrationOptions,
  PasskeyError,
} from "../../../../lib/passkeys.ts";
import { passkeyRelyingPartyForRequest } from "../../../../lib/passkey-rp.ts";
import { passkeyAuthorizationUrl } from "../../../../lib/passkey-authorization.ts";
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
    ) return authError(user, 403);
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
      const failure = publicPasskeyRegistrationOptionsFailure(error);
      return json(failure.body, failure.status);
    }
    const oauthSession = await getValidSession(user.did, { quiet: true });
    const linkedAccount = oauthSession ?? (devAccount
      ? {
        did: devAccount.did,
        handle: devAccount.handle,
      }
      : null);
    if (!linkedAccount) return authError(user, 403);
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
      const failure = publicPasskeyRegistrationOptionsFailure(error);
      return json(failure.body, failure.status);
    }
  },
});

function untrustedOrigin(): Response {
  return json(
    { error: "Passkeys are unavailable on this account address." },
    403,
  );
}

function authError(
  account: { did: string; handle: string } | null,
  status: number,
): Response {
  const redirectUrl = account ? managementReauthUrl(account) : null;
  return json({
    error: "Reconfirm with your account host before changing passkeys.",
    ...(redirectUrl ? { redirectUrl } : {}),
  }, status);
}

function managementReauthUrl(account: { did: string; handle: string }): string {
  const next = `/passkeys?handle=${encodeURIComponent(account.handle)}`;
  return passkeyAuthorizationUrl(account.did, next, {
    targetName: account.handle,
  });
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

export function publicPasskeyRegistrationOptionsFailure(
  error: unknown,
): PublicPasskeyFailure {
  if (error instanceof RequestBodyTooLargeError) {
    return passkeyFailure(
      413,
      "request_body_too_large",
      "Passkey request is too large.",
    );
  }
  if (error instanceof PasskeyError && error.code === "invalid_input") {
    return passkeyFailure(
      400,
      "invalid_passkey_request",
      "Passkey enrollment request is invalid.",
    );
  }
  return passkeyFailure(
    503,
    "passkey_enrollment_unavailable",
    "Passkey enrollment is temporarily unavailable.",
    true,
  );
}

interface PublicPasskeyFailure {
  status: number;
  body: { error: string; code: string; retryable: boolean };
}

function passkeyFailure(
  status: number,
  code: string,
  error: string,
  retryable = false,
): PublicPasskeyFailure {
  return { status, body: { error, code, retryable } };
}
