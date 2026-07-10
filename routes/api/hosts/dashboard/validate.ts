import { define } from "../../../../utils.ts";
import {
  fetchHostDashboardManifest,
  hostDashboardManifestUrl,
  validateHostDashboardManifest,
} from "../../../../lib/host-dashboard.ts";
import {
  isPrivateNetworkUrl,
  rejectLargeRequest,
} from "../../../../lib/security.ts";
import { withRateLimit } from "../../../../lib/rate-limit.ts";

const MAX_HOST_DASHBOARD_MANIFEST_BODY_BYTES = 64_000;

export const handler = define.handlers({
  GET: withRateLimit(async (ctx): Promise<Response> => {
    const host = ctx.url.searchParams.get("host")?.trim();
    const url = ctx.url.searchParams.get("url")?.trim();
    const input = url || host;
    if (!input) {
      return json({
        ok: false,
        issues: [{
          severity: "error",
          path: "$",
          message:
            "Provide host=example.social or url=https://example.social/.well-known/atmosphere-host-dashboard.json.",
        }],
      }, { status: 400 });
    }
    const manifestUrl = hostDashboardManifestUrl(input);
    if (!manifestUrl || isPrivateNetworkUrl(manifestUrl, { allowHttp: true })) {
      return json({
        ok: false,
        issues: [{
          severity: "error",
          path: "$",
          message: "Manifest URL must be public HTTP(S).",
        }],
      }, { status: 400 });
    }
    const result = await fetchHostDashboardManifest(manifestUrl, {
      expectedHost: host ?? undefined,
      timeoutMs: 5000,
    });
    return json(result, { status: result.ok ? 200 : 422 });
  }, {
    scope: "host-dashboard-fetch",
    capacity: 30,
    refillMs: 60_000,
  }),

  POST: withRateLimit(async (ctx): Promise<Response> => {
    const large = rejectLargeRequest(
      ctx.req,
      MAX_HOST_DASHBOARD_MANIFEST_BODY_BYTES,
    );
    if (large) return large;

    const body = await ctx.req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return json({
        ok: false,
        issues: [{
          severity: "error",
          path: "$",
          message: "Request body must be a manifest JSON object.",
        }],
      }, { status: 400 });
    }
    const expectedHost = ctx.url.searchParams.get("host")?.trim() ||
      undefined;
    const result = validateHostDashboardManifest(body, { expectedHost });
    return json(result, { status: result.ok ? 200 : 422 });
  }, {
    scope: "host-dashboard-validate",
    capacity: 60,
    refillMs: 60_000,
  }),
});

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body, null, 2), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(init.headers ?? {}),
    },
  });
}
