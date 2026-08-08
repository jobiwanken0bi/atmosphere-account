import { define } from "../../utils.ts";
import {
  listPasskeys,
  type PasskeySummary,
  revokePasskey,
} from "../../lib/passkeys.ts";
import { readPasskeyManagementTicket } from "../../lib/passkey-management.ts";
import { enforceDurableRateLimit } from "../../lib/rate-limit.ts";
import {
  readJsonRequestWithLimit,
  rejectLargeRequest,
  RequestBodyTooLargeError,
} from "../../lib/security.ts";
import { devPickerAccountForDid } from "../../lib/dev-picker-demo.ts";
import { IS_DEV } from "../../lib/env.ts";
import { passkeyRelyingPartyForRequest } from "../../lib/passkey-rp.ts";
import { passkeyAuthorizationUrl } from "../../lib/passkey-authorization.ts";

const MAX_BODY_BYTES = 8_192;

export const handler = define.handlers({
  async GET(ctx) {
    if (!await trustedPasskeyRequest(ctx.url, ctx.req.headers)) {
      return untrustedOrigin();
    }
    const user = ctx.state.user;
    if (!user) return authError(null, 401);
    const ticket = await readPasskeyManagementTicket(ctx.req);
    if (
      (!ticket || ticket.did !== user.did) &&
      !isDevPasskeyAccount(user.did, user.handle)
    ) return authError(user, 403);
    const passkeys = await listPasskeys(user.did).catch(() => null);
    return passkeys
      ? json({ passkeys: passkeys.map(passkeyJson) })
      : json({ error: "Passkeys could not be loaded." }, 503);
  },

  async DELETE(ctx) {
    if (!await trustedPasskeyRequest(ctx.url, ctx.req.headers)) {
      return untrustedOrigin();
    }
    const user = ctx.state.user;
    if (!user) return authError(null, 401);
    const ticket = await readPasskeyManagementTicket(ctx.req);
    if (
      (!ticket || ticket.did !== user.did) &&
      !isDevPasskeyAccount(user.did, user.handle)
    ) return authError(user, 403);
    const limited = await enforceDurableRateLimit(ctx.req, {
      scope: "passkey-management-delete",
      capacity: 12,
      refillMs: 60_000,
    });
    if (limited) return limited;
    const large = rejectLargeRequest(ctx.req, MAX_BODY_BYTES);
    if (large) return large;
    let rawBody: unknown;
    try {
      rawBody = await readJsonRequestWithLimit(ctx.req, MAX_BODY_BYTES);
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return json({ error: error.message }, 413);
      }
      return json({ error: "Invalid passkey request." }, 400);
    }
    const body = rawBody as
      | { credentialId?: unknown }
      | null;
    if (!body || typeof body.credentialId !== "string") {
      return json({ error: "Missing passkey ID." }, 400);
    }
    const revoked = await revokePasskey({
      did: user.did,
      credentialId: body.credentialId,
    }).catch(() => false);
    return revoked
      ? json({ ok: true })
      : json({ error: "Passkey was not found." }, 404);
  },
});

async function trustedPasskeyRequest(
  url: URL,
  headers: Headers,
): Promise<boolean> {
  return await passkeyRelyingPartyForRequest(url, headers).then(
    () => true,
    () => false,
  );
}

function untrustedOrigin(): Response {
  return json(
    { error: "Passkeys are unavailable on this account address." },
    403,
  );
}

function passkeyJson(passkey: PasskeySummary) {
  return {
    credentialId: passkey.credentialId,
    name: passkey.name,
    createdAt: passkey.createdAt,
    lastUsedAt: passkey.lastUsedAt,
    deviceType: passkey.deviceType,
    backedUp: passkey.backedUp,
    backupEligible: passkey.deviceType === "multiDevice",
    backupState: passkey.backedUp,
    transports: passkey.transports,
  };
}

function authError(
  account: { did: string; handle: string } | null,
  status: number,
): Response {
  const redirectUrl = account ? managementReauthUrl(account) : null;
  return json({
    error: status === 401
      ? "Sign in with your account host to manage passkeys."
      : "Reconfirm with your account host to change passkeys.",
    ...(redirectUrl ? { redirectUrl } : {}),
  }, status);
}

function managementReauthUrl(account: { did: string; handle: string }): string {
  const next = `/passkeys?handle=${encodeURIComponent(account.handle)}`;
  return passkeyAuthorizationUrl(account.did, next, {
    targetName: account.handle,
  });
}

function isDevPasskeyAccount(did: string, handle: string): boolean {
  const account = IS_DEV ? devPickerAccountForDid(did) : null;
  return account?.handle.toLowerCase() === handle.toLowerCase();
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
