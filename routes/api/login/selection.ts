import { define } from "../../../utils.ts";
import type { AtmosphereSelectionClaims } from "../../../lib/atmosphere-login-sdk.ts";
import {
  getLoginApp,
  isUnregisteredDevLoginReturnAllowed,
  type LoginApp,
  verifyLoginSelectionTokenDetailed,
} from "../../../lib/atmosphere-login.ts";
import { checkRateLimit } from "../../../lib/rate-limit.ts";
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
const SELECTION_VERIFICATION_RATE_LIMIT = {
  scope: "login-selection-verification",
  capacity: 120,
  refillMs: 60_000,
} as const;

function json(
  body: unknown,
  init: ResponseInit = {},
  corsHeaders: HeadersInit = {},
): Response {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json; charset=utf-8");
  }
  if (!headers.has("cache-control")) {
    headers.set("cache-control", "no-store");
  }
  for (const [name, value] of new Headers(corsHeaders)) {
    headers.set(name, value);
  }
  return new Response(JSON.stringify(body), {
    ...init,
    headers,
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
  const limited = checkRateLimit(ctx.req, SELECTION_VERIFICATION_RATE_LIMIT);
  if (!limited.ok) {
    return json({ active: false, error: "rate_limited" }, {
      status: 429,
      headers: { "retry-after": String(limited.retryAfter) },
    });
  }
  const large = rejectLargeRequest(ctx.req, MAX_SELECTION_REQUEST_BODY_BYTES);
  if (large) {
    return json({ active: false, error: "request body too large" }, {
      status: 413,
    });
  }
  const input = await readInput(ctx.req, ctx.url);
  const corsHeaders = await selectionCorsHeaders(ctx.req, input);
  const token = input.token;
  if (!token) {
    return json(
      { active: false, error: "missing token" },
      { status: 400 },
      corsHeaders,
    );
  }
  if (token.length > MAX_SELECTION_TOKEN_LENGTH) {
    return json(
      { active: false, error: "token is too long" },
      { status: 400 },
      corsHeaders,
    );
  }
  const hasBindingExpectation = Boolean(
    input.expectedClientId || input.expectedReturnUri ||
      input.expectedState || input.expectedIssuer,
  );
  if (!hasBindingExpectation) {
    return json(
      {
        active: false,
        bound: false,
        error:
          "binding expectations are required: provide client_id, return_uri, state, or iss",
      },
      { status: 400 },
      corsHeaders,
    );
  }
  const result = await verifyLoginSelectionTokenDetailed(token, {
    expectedIssuer: input.expectedIssuer ?? undefined,
  });
  if (!result.ok) {
    return json(
      {
        active: false,
        bound: false,
        error: result.error,
      },
      { status: 401 },
      corsHeaders,
    );
  }
  const bindingError = verifySelectionBinding(result.claims, input);
  if (bindingError) {
    return json(
      {
        active: true,
        bound: false,
        error: bindingError,
      },
      { status: 200 },
      corsHeaders,
    );
  }
  return json(
    {
      active: true,
      bound: true,
      payload: result.claims,
    },
    {},
    corsHeaders,
  );
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

function normalizeOrigin(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function normalizeUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function registeredAppAllowsReturnUri(
  app: LoginApp,
  expectedReturnUri: string,
): boolean {
  const expected = normalizeUrl(expectedReturnUri);
  if (!expected) return false;
  return app.allowedReturnUris.some((allowed) =>
    normalizeUrl(allowed) === expected
  );
}

export function canOriginReadSelectionVerification(
  origin: string | null,
  input: SelectionVerificationInput,
  app: LoginApp | null,
  options: { dev?: boolean } = {},
): boolean {
  const normalizedOrigin = normalizeOrigin(origin);
  const clientId = normalizeUrl(input.expectedClientId);
  const returnUri = normalizeUrl(input.expectedReturnUri);
  if (!normalizedOrigin || !clientId || !returnUri) return false;
  if (normalizeOrigin(returnUri) !== normalizedOrigin) return false;
  if (app) {
    return app.status !== "blocked" && app.clientId === clientId &&
      registeredAppAllowsReturnUri(app, returnUri);
  }
  return isUnregisteredDevLoginReturnAllowed(clientId, returnUri, {
    dev: options.dev,
  });
}

export async function selectionCorsHeaders(
  req: Request,
  input: SelectionVerificationInput | null,
  options: {
    getLoginApp?: typeof getLoginApp;
    dev?: boolean;
  } = {},
): Promise<Headers> {
  const headers = new Headers();
  const origin = normalizeOrigin(req.headers.get("origin"));
  if (!origin) return headers;
  headers.set("vary", "origin");

  if (req.method.toUpperCase() === "OPTIONS") {
    headers.set("access-control-allow-origin", origin);
    headers.set("access-control-allow-methods", "POST, OPTIONS");
    headers.set("access-control-allow-headers", "content-type");
    headers.set("access-control-max-age", "86400");
    return headers;
  }

  if (!input) return headers;
  const clientId = normalizeUrl(input.expectedClientId);
  const app = clientId
    ? await (options.getLoginApp ?? getLoginApp)(clientId)
    : null;
  if (canOriginReadSelectionVerification(origin, input, app, options)) {
    headers.set("access-control-allow-origin", origin);
  }
  return headers;
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
  async OPTIONS(ctx) {
    const corsHeaders = await selectionCorsHeaders(ctx.req, null);
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  },
});
