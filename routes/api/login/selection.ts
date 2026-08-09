import { define } from "../../../utils.ts";
import type { AtmosphereSelectionClaims } from "../../../lib/atmosphere-login-sdk.ts";
import {
  getLoginApp,
  isUnregisteredDevLoginReturnAllowed,
  type LoginApp,
  verifyLoginSelectionTokenDetailed,
} from "../../../lib/atmosphere-login.ts";
import { checkDurableRateLimit } from "../../../lib/rate-limit.ts";
import {
  readFormDataRequestWithLimit,
  readJsonRequestWithLimit,
  rejectLargeRequest,
  RequestBodyTooLargeError,
} from "../../../lib/security.ts";
import {
  InvalidOAuthRequestInputError,
  optionalJsonString,
  plainJsonRecord,
  singleFormString,
  singleSearchValue,
} from "../../../lib/oauth-request-input.ts";

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
    token: singleSearchValue(params, "token")?.trim() || null,
    expectedClientId: singleSearchValue(params, "client_id")?.trim() || null,
    expectedReturnUri: singleSearchValue(params, "return_uri")?.trim() || null,
    expectedState: singleSearchValue(params, "state")?.trim() || null,
    expectedIssuer: singleSearchValue(params, "iss")?.trim() || null,
  };
}

function readInputFromRecord(
  body: Record<string, unknown>,
): SelectionVerificationInput {
  return {
    token: optionalJsonString(body, "token")?.trim() || null,
    expectedClientId: exclusiveJsonString(
      body,
      "client_id",
      "expectedClientId",
    ),
    expectedReturnUri: exclusiveJsonString(
      body,
      "return_uri",
      "expectedReturnUri",
    ),
    expectedState: exclusiveJsonString(body, "state", "expectedState"),
    expectedIssuer: exclusiveJsonString(body, "iss", "expectedIssuer"),
  };
}

function exclusiveJsonString(
  body: Record<string, unknown>,
  primary: string,
  alias: string,
): string | null {
  if (Object.hasOwn(body, primary) && Object.hasOwn(body, alias)) {
    throw new InvalidOAuthRequestInputError();
  }
  return (optionalJsonString(body, primary) ?? optionalJsonString(body, alias))
    ?.trim() || null;
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
    return readInputFromRecord(
      plainJsonRecord(
        await readJsonRequestWithLimit(req, MAX_SELECTION_REQUEST_BODY_BYTES),
      ),
    );
  }
  if (
    ct.includes("application/x-www-form-urlencoded")
  ) {
    const form = await readFormDataRequestWithLimit(
      req,
      MAX_SELECTION_REQUEST_BODY_BYTES,
    );
    if (!form) throw new InvalidOAuthRequestInputError();
    const params = new URLSearchParams();
    for (const key of ["token", "client_id", "return_uri", "state", "iss"]) {
      const value = singleFormString(form, key);
      if (value !== null) params.set(key, value);
    }
    return readInputFromSearchParams(params);
  }
  return qs;
}

async function handle(ctx: { req: Request; url: URL }): Promise<Response> {
  const limited = await checkDurableRateLimit(
    ctx.req,
    SELECTION_VERIFICATION_RATE_LIMIT,
  );
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
  let input: SelectionVerificationInput;
  try {
    input = await readInput(ctx.req, ctx.url);
  } catch (error) {
    return json({
      active: false,
      error: error instanceof RequestBodyTooLargeError
        ? "request body too large"
        : "invalid request",
    }, { status: error instanceof RequestBodyTooLargeError ? 413 : 400 });
  }
  const normalizedClientId = normalizeUrl(input.expectedClientId);
  const currentApp = normalizedClientId
    ? await getLoginApp(normalizedClientId)
    : null;
  const corsHeaders = await selectionCorsHeaders(ctx.req, input, {
    getLoginApp: () => Promise.resolve(currentApp),
  });
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
  if (!hasCompleteSelectionBinding(input)) {
    return json(
      {
        active: false,
        bound: false,
        error:
          "complete binding expectations are required: provide client_id, return_uri, state, and iss",
      },
      { status: 400 },
      corsHeaders,
    );
  }
  if (!canAppVerifySelection(input, currentApp)) {
    return json(
      {
        active: false,
        bound: false,
        error: "login environment is unavailable",
      },
      { status: 403 },
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

export function hasCompleteSelectionBinding(
  input: SelectionVerificationInput,
): boolean {
  return Boolean(
    input.expectedClientId && input.expectedReturnUri &&
      input.expectedState && input.expectedIssuer,
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
  return canAppVerifySelection(input, app, options);
}

/**
 * Require the current app registration to remain eligible before token
 * verification. This protects server-to-server callers as well as browsers;
 * CORS alone is not an authorization boundary.
 */
export function canAppVerifySelection(
  input: SelectionVerificationInput,
  app: LoginApp | null,
  options: { dev?: boolean } = {},
): boolean {
  const clientId = normalizeUrl(input.expectedClientId);
  const returnUri = normalizeUrl(input.expectedReturnUri);
  if (!clientId || !returnUri) return false;
  if (app) {
    return app.identityAvailable && app.loginAvailability === "available" &&
      app.status !== "blocked" &&
      app.clientId === clientId &&
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
