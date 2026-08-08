import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import { define } from "../../../../utils.ts";
import {
  appendSelectionToReturnUri,
  LoginRequestError,
  loginRequestToPath,
  recordLoginSelection,
  resolveLoginAppForRequest,
  signLoginSelection,
} from "../../../../lib/atmosphere-login.ts";
import { getValidSession } from "../../../../lib/oauth.ts";
import {
  PasskeyError,
  verifyPasskeyAuthentication,
} from "../../../../lib/passkeys.ts";
import { passkeyRelyingPartyForRequest } from "../../../../lib/passkey-rp.ts";
import { enforceDurableRateLimit } from "../../../../lib/rate-limit.ts";
import {
  addRememberedAccountCookies,
  readRememberedAccountsFromHeader,
} from "../../../../lib/remembered-accounts.ts";
import {
  buildSessionCookie,
  createSession,
  destroySession,
} from "../../../../lib/session.ts";
import {
  readJsonRequestWithLimit,
  rejectLargeRequest,
  RequestBodyTooLargeError,
} from "../../../../lib/security.ts";
import { devPickerAccountForDid } from "../../../../lib/dev-picker-demo.ts";
import { IS_DEV } from "../../../../lib/env.ts";
import { clearPasskeyManagementCookie } from "../../../../lib/passkey-management.ts";
import { passkeyAuthorizationUrl } from "../../../../lib/passkey-authorization.ts";

const MAX_BODY_BYTES = 96_000;

export const handler = define.handlers({
  async POST(ctx) {
    const relyingParty = await passkeyRelyingPartyForRequest(
      ctx.url,
      ctx.req.headers,
    ).catch(() => null);
    if (!relyingParty) return untrustedOrigin();
    const limited = await enforceDurableRateLimit(ctx.req, {
      scope: "passkey-authentication-verify",
      capacity: 30,
      refillMs: 60_000,
    });
    if (limited) return limited;
    const large = rejectLargeRequest(ctx.req, MAX_BODY_BYTES);
    if (large) return large;

    try {
      const input = await readVerificationInput(ctx.req);
      const verified = await verifyPasskeyAuthentication({
        ceremonyToken: input.ceremony,
        response: input.response,
        rp: {
          rpId: relyingParty.id,
          rpName: relyingParty.name,
          origin: relyingParty.origin,
        },
      });
      if (!verified.loginRequest) {
        throw new PasskeyError(
          "ceremony_invalid_or_expired",
          "Passkey sign in was not bound to an app request.",
        );
      }

      const request = verified.loginRequest;
      const { app, returnUri } = await resolveLoginAppForRequest(request);
      const oauthSession = await getValidSession(verified.did, { quiet: true });
      const devAccount = IS_DEV ? devPickerAccountForDid(verified.did) : null;
      const linkedAccount = oauthSession ?? (devAccount
        ? {
          did: devAccount.did,
          handle: devAccount.handle,
          pdsUrl: `https://${devAccount.handle}`,
        }
        : null);
      if (!linkedAccount) {
        return json(
          {
            error:
              "Your Atmosphere account needs to be reconnected to its account host.",
            redirectUrl: buildRelinkUrl(verified.did, request),
          },
          403,
        );
      }

      const issuer = relyingParty.origin;
      const { token } = await signLoginSelection({
        app,
        did: linkedAccount.did,
        handle: linkedAccount.handle,
        issuer,
        pdsUrl: linkedAccount.pdsUrl,
        returnUri: returnUri.toString(),
        state: request.state,
        scope: request.scope,
      });
      await recordLoginSelection({
        clientId: app.clientId,
        did: linkedAccount.did,
        handle: linkedAccount.handle,
      }).catch(() => {});
      const redirectUrl = appendSelectionToReturnUri({
        returnUri,
        clientId: app.clientId,
        did: linkedAccount.did,
        handle: linkedAccount.handle,
        issuer,
        state: request.state,
        token,
      });

      const remembered = await readRememberedAccountsFromHeader(
        ctx.req.headers.get("cookie"),
      );
      const rememberedCookies = await addRememberedAccountCookies(remembered, {
        did: linkedAccount.did,
        handle: linkedAccount.handle,
        pdsUrl: linkedAccount.pdsUrl,
      });
      const sessionCookie = buildSessionCookie(
        await createSession({
          did: linkedAccount.did,
          handle: linkedAccount.handle,
        }),
      );
      // Replacement creation happens first, but the old SID must be revoked
      // before the new account cookie is delivered. A failed rotation returns
      // an error through the outer handler and leaves the current session in
      // place instead of keeping two identities active.
      await destroySession(ctx.req);
      const headers = new Headers({
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
      });
      headers.append("set-cookie", sessionCookie);
      headers.append("set-cookie", clearPasskeyManagementCookie());
      for (const cookie of rememberedCookies) {
        headers.append("set-cookie", cookie);
      }
      return new Response(JSON.stringify({ redirectUrl }), { headers });
    } catch (error) {
      const failure = publicPasskeyAuthenticationFailure(error);
      return json({ error: failure.message }, failure.status);
    }
  },
});

function untrustedOrigin(): Response {
  return json(
    { error: "Passkeys are unavailable on this sign-in address." },
    403,
  );
}

function buildRelinkUrl(
  did: string,
  request: Parameters<typeof loginRequestToPath>[0],
): string {
  return passkeyAuthorizationUrl(did, loginRequestToPath(request), {
    continuation: "login_selection",
  });
}

async function readVerificationInput(req: Request): Promise<{
  ceremony: string;
  response: AuthenticationResponseJSON;
}> {
  if (!(req.headers.get("content-type") ?? "").includes("application/json")) {
    throw new Error("Passkey request must use JSON.");
  }
  const value = await readJsonRequestWithLimit(req, MAX_BODY_BYTES) as
    | { ceremony?: unknown; response?: unknown }
    | null;
  if (
    !value || typeof value.ceremony !== "string" || !value.response ||
    typeof value.response !== "object" || Array.isArray(value.response)
  ) {
    throw new Error("Invalid passkey response.");
  }
  return {
    ceremony: value.ceremony,
    response: value.response as AuthenticationResponseJSON,
  };
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

export function publicPasskeyAuthenticationFailure(
  error: unknown,
): { status: number; message: string } {
  if (error instanceof RequestBodyTooLargeError) {
    return { status: 413, message: error.message };
  }
  if (error instanceof LoginRequestError) {
    return { status: error.status, message: error.message };
  }
  if (error instanceof PasskeyError) {
    if (
      error.code === "credential_not_found" ||
      error.code === "verification_failed" ||
      error.code === "concurrent_authentication"
    ) {
      // Do not reveal whether a caller-supplied credential ID exists.
      return {
        status: 401,
        message: "Passkey verification was not accepted.",
      };
    }
    return {
      status: 400,
      message: "Passkey request is invalid or expired.",
    };
  }
  return { status: 400, message: "Passkey sign in could not be completed." };
}
