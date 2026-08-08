import type { RegistrationResponseJSON } from "@simplewebauthn/server";
import { define } from "../../../../utils.ts";
import { getValidSession } from "../../../../lib/oauth.ts";
import { readPasskeyManagementTicket } from "../../../../lib/passkey-management.ts";
import {
  type PasskeySummary,
  verifyPasskeyRegistration,
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

const MAX_BODY_BYTES = 96_000;

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
      scope: "passkey-registration-verify",
      capacity: 12,
      refillMs: 60_000,
    });
    if (limited) return limited;
    const large = rejectLargeRequest(ctx.req, MAX_BODY_BYTES);
    if (large) return large;
    if (
      !devAccount && !await getValidSession(user.did, { quiet: true })
    ) {
      return authError(user, 403);
    }

    try {
      const input = await readVerificationInput(ctx.req);
      const passkey = await verifyPasskeyRegistration({
        ceremonyToken: input.ceremony,
        response: input.response,
        expectedDid: user.did,
        name: input.name,
        rp: {
          rpId: relyingParty.id,
          rpName: relyingParty.name,
          origin: relyingParty.origin,
        },
      });
      return json({ passkey: passkeyJson(passkey) });
    } catch (error) {
      return json({
        error: error instanceof Error
          ? error.message
          : "Passkey enrollment could not be completed.",
      }, error instanceof RequestBodyTooLargeError ? 413 : 400);
    }
  },
});

function untrustedOrigin(): Response {
  return json(
    { error: "Passkeys are unavailable on this account address." },
    403,
  );
}

async function readVerificationInput(req: Request): Promise<{
  ceremony: string;
  response: RegistrationResponseJSON;
  name: string | null;
}> {
  if (!(req.headers.get("content-type") ?? "").includes("application/json")) {
    throw new Error("Passkey request must use JSON.");
  }
  const value = await readJsonRequestWithLimit(req, MAX_BODY_BYTES) as
    | { ceremony?: unknown; response?: unknown; name?: unknown }
    | null;
  if (
    !value || typeof value.ceremony !== "string" || !value.response ||
    typeof value.response !== "object" || Array.isArray(value.response)
  ) throw new Error("Invalid passkey response.");
  return {
    ceremony: value.ceremony,
    response: value.response as RegistrationResponseJSON,
    name: typeof value.name === "string" ? value.name : null,
  };
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
