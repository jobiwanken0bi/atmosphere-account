import { define } from "../../../../utils.ts";
import { inferHostNetworkLocation } from "../../../../lib/host-location-inference.ts";
import {
  readJsonRequestWithLimit,
  rejectLargeRequest,
  RequestBodyTooLargeError,
} from "../../../../lib/security.ts";
import { withRateLimit } from "../../../../lib/rate-limit.ts";

interface InferRequestBody {
  host?: string;
  serviceEndpoint?: string;
}

const MAX_LOCATION_INFER_BODY_BYTES = 8_192;

export const handler = define.handlers({
  POST: withRateLimit(async (ctx) => {
    if (!ctx.state.user) {
      return json({ ok: false, message: "Sign in to infer host location." }, {
        status: 401,
      });
    }
    const large = rejectLargeRequest(ctx.req, MAX_LOCATION_INFER_BODY_BYTES);
    if (large) return large;
    let body: InferRequestBody | null;
    try {
      body = await readBody(ctx.req);
    } catch (error) {
      return json({
        ok: false,
        message: error instanceof RequestBodyTooLargeError
          ? "Request too large."
          : "Invalid request.",
      }, { status: error instanceof RequestBodyTooLargeError ? 413 : 400 });
    }
    const result = await inferHostNetworkLocation({
      host: body?.host,
      serviceEndpoint: body?.serviceEndpoint,
    });
    return json(result, { status: result.ok ? 200 : 422 });
  }, {
    scope: "host-location-infer",
    capacity: 20,
    refillMs: 60_000,
  }),
});

async function readBody(req: Request): Promise<InferRequestBody | null> {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) return null;
  const value = await readJsonRequestWithLimit(
    req,
    MAX_LOCATION_INFER_BODY_BYTES,
  );
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  return {
    host: typeof data.host === "string" ? data.host : undefined,
    serviceEndpoint: typeof data.serviceEndpoint === "string"
      ? data.serviceEndpoint
      : undefined,
  };
}

function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data), { ...init, headers });
}
