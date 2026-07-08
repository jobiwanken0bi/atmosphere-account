import { define } from "../../../utils.ts";
import type { AtmosphereSelectionClaims } from "../../../lib/atmosphere-login-sdk.ts";
import { verifyLoginSelectionTokenDetailed } from "../../../lib/atmosphere-login.ts";
import { rejectLargeRequest } from "../../../lib/security.ts";

export interface SelectionVerificationInput {
  token: string | null;
  expectedClientId: string | null;
  expectedReturnUri: string | null;
  expectedState: string | null;
  expectedIssuer: string | null;
}

const MAX_SELECTION_TOKEN_LENGTH = 8_192;
const MAX_SELECTION_REQUEST_BODY_BYTES = 16_384;

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      ...(init.headers ?? {}),
    },
  });
}

function readInputFromSearchParams(
  params: URLSearchParams,
): SelectionVerificationInput {
  return {
    token: params.get("token")?.trim() || null,
    expectedClientId: params.get("client_id")?.trim() || null,
    expectedReturnUri: params.get("return_uri")?.trim() || null,
    expectedState: params.get("state")?.trim() || null,
    expectedIssuer: params.get("iss")?.trim() || null,
  };
}

function readInputFromRecord(
  body: Record<string, unknown> | null,
): SelectionVerificationInput {
  return {
    token: stringField(body, "token"),
    expectedClientId: stringField(body, "client_id") ??
      stringField(body, "expectedClientId"),
    expectedReturnUri: stringField(body, "return_uri") ??
      stringField(body, "expectedReturnUri"),
    expectedState: stringField(body, "state") ??
      stringField(body, "expectedState"),
    expectedIssuer: stringField(body, "iss") ??
      stringField(body, "expectedIssuer"),
  };
}

function stringField(
  body: Record<string, unknown> | null,
  key: string,
): string | null {
  const value = body?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function readInput(
  req: Request,
  url: URL,
): Promise<SelectionVerificationInput> {
  const qs = {
    ...readInputFromSearchParams(url.searchParams),
    token: null,
  };
  const ct = (req.headers.get("content-type") ?? "").toLowerCase();
  if (ct.includes("application/json")) {
    const body = await req.json().catch(() => null);
    return readInputFromRecord(
      body && typeof body === "object" && !Array.isArray(body)
        ? body as Record<string, unknown>
        : null,
    );
  }
  if (
    ct.includes("application/x-www-form-urlencoded")
  ) {
    const form = await req.formData().catch(() => null);
    if (!form) return qs;
    const params = new URLSearchParams();
    for (const key of ["token", "client_id", "return_uri", "state", "iss"]) {
      const value = form.get(key);
      if (typeof value === "string") params.set(key, value);
    }
    return readInputFromSearchParams(params);
  }
  return qs;
}

async function handle(ctx: { req: Request; url: URL }): Promise<Response> {
  const large = rejectLargeRequest(ctx.req, MAX_SELECTION_REQUEST_BODY_BYTES);
  if (large) {
    return json({ active: false, error: "request body too large" }, {
      status: 413,
    });
  }
  const input = await readInput(ctx.req, ctx.url);
  const token = input.token;
  if (!token) {
    return json({ active: false, error: "missing token" }, { status: 400 });
  }
  if (token.length > MAX_SELECTION_TOKEN_LENGTH) {
    return json({ active: false, error: "token is too long" }, { status: 400 });
  }
  const hasBindingExpectation = Boolean(
    input.expectedClientId || input.expectedReturnUri ||
      input.expectedState || input.expectedIssuer,
  );
  if (!hasBindingExpectation) {
    return json({
      active: false,
      bound: false,
      error:
        "binding expectations are required: provide client_id, return_uri, state, or iss",
    }, { status: 400 });
  }
  const result = await verifyLoginSelectionTokenDetailed(token, {
    expectedIssuer: input.expectedIssuer ?? undefined,
  });
  if (!result.ok) {
    return json({
      active: false,
      bound: false,
      error: result.error,
    }, { status: 401 });
  }
  const bindingError = verifySelectionBinding(result.claims, input);
  if (bindingError) {
    return json({
      active: true,
      bound: false,
      error: bindingError,
    }, { status: 200 });
  }
  return json({
    active: true,
    bound: true,
    payload: result.claims,
  });
}

export function verifySelectionBinding(
  claims: AtmosphereSelectionClaims,
  input: SelectionVerificationInput,
): string | null {
  if (input.expectedIssuer && claims.iss !== input.expectedIssuer) {
    return "issuer mismatch";
  }
  if (input.expectedClientId && claims.aud !== input.expectedClientId) {
    return "audience mismatch";
  }
  if (input.expectedState && claims.state !== input.expectedState) {
    return "state mismatch";
  }
  if (input.expectedReturnUri) {
    const claimReturnUri = normalizeReturnUri(claims.return_uri);
    const expectedReturnUri = normalizeReturnUri(input.expectedReturnUri);
    if (!claimReturnUri || !expectedReturnUri) {
      return "return URI mismatch";
    }
    if (claimReturnUri !== expectedReturnUri) {
      return "return URI mismatch";
    }
  }
  return null;
}

function normalizeReturnUri(value: string): string | null {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export const handler = define.handlers({
  GET() {
    return json({
      active: false,
      error:
        "selection tokens must be verified with POST so they are not placed in URLs",
    }, {
      status: 405,
      headers: { allow: "POST, OPTIONS" },
    });
  },
  POST: handle,
  OPTIONS() {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-allow-headers": "content-type",
        "access-control-max-age": "86400",
      },
    });
  },
});
