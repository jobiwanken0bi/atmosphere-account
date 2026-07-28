import { define } from "../../../../utils.ts";
import {
  type LoginRequest,
  readLoginRequest,
  resolveLoginAppForRequest,
} from "../../../../lib/atmosphere-login.ts";
import { createPasskeyAuthenticationOptions } from "../../../../lib/passkeys.ts";
import { passkeyRelyingPartyForRequest } from "../../../../lib/passkey-rp.ts";
import { enforceDurableRateLimit } from "../../../../lib/rate-limit.ts";
import {
  readJsonRequestWithLimit,
  rejectLargeRequest,
  RequestBodyTooLargeError,
} from "../../../../lib/security.ts";

const MAX_BODY_BYTES = 16_384;

export const handler = define.handlers({
  async POST(ctx) {
    const relyingParty = await passkeyRelyingPartyForRequest(
      ctx.url,
      ctx.req.headers,
    ).catch(() => null);
    if (!relyingParty) return untrustedOrigin();
    const limited = await enforceDurableRateLimit(ctx.req, {
      scope: "passkey-authentication-options",
      capacity: 30,
      refillMs: 60_000,
    });
    if (limited) return limited;
    const large = rejectLargeRequest(ctx.req, MAX_BODY_BYTES);
    if (large) return large;

    try {
      const input = await readJsonObject(ctx.req);
      const request = loginRequestFromJson(input, ctx.url);
      await resolveLoginAppForRequest(request);
      const result = await createPasskeyAuthenticationOptions({
        rp: {
          rpId: relyingParty.id,
          rpName: relyingParty.name,
          origin: relyingParty.origin,
        },
        loginRequest: request,
      });
      return json({
        ceremony: result.ceremonyToken,
        options: result.options,
      });
    } catch (error) {
      return jsonError(
        error,
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
  },
});

function untrustedOrigin(): Response {
  return json(
    { error: "Passkeys are unavailable on this sign-in address." },
    403,
  );
}

function loginRequestFromJson(
  value: Record<string, unknown>,
  baseUrl: URL,
): LoginRequest {
  const requestUrl = new URL("/login/select", baseUrl);
  for (
    const [jsonKey, requestKey] of [
      ["client_id", "client_id"],
      ["return_uri", "return_uri"],
      ["state", "state"],
      ["scope", "scope"],
    ] as const
  ) {
    const item = value[jsonKey];
    if (typeof item === "string" && item) {
      requestUrl.searchParams.set(requestKey, item);
    }
  }
  return readLoginRequest(requestUrl);
}

async function readJsonObject(req: Request): Promise<Record<string, unknown>> {
  if (!(req.headers.get("content-type") ?? "").includes("application/json")) {
    throw new Error("Passkey request must use JSON.");
  }
  const value = await readJsonRequestWithLimit(req, MAX_BODY_BYTES);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid passkey request.");
  }
  return value as Record<string, unknown>;
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

function jsonError(error: unknown, status: number): Response {
  const message = error instanceof Error
    ? error.message
    : "Passkey request failed.";
  return json({ error: message }, status);
}
