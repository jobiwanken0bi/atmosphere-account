import { define } from "../../../../utils.ts";
import {
  getPublicHostDetail,
  proxyAppviewResponse,
  type PublicHostDetail,
} from "../../../../lib/appview-client.ts";
import { EdgeStaleCache } from "../../../../lib/edge-cache.ts";
import { withRateLimit } from "../../../../lib/rate-limit.ts";
import { isHandle } from "../../../../lib/identity.ts";

const hostDetailCache = new EdgeStaleCache<PublicHostDetail>({
  freshMs: 60_000,
  staleMs: 5 * 60_000,
  maxEntries: 256,
});

export const handler = define.handlers({
  GET: withRateLimit(async (ctx): Promise<Response> => {
    const proxied = await proxyAppviewResponse(
      `${ctx.url.pathname}${ctx.url.search}`,
      ctx.url,
      ctx.req.headers,
    );
    if (proxied) return proxied;

    const hostId = normalizePublicHostParam(ctx.params.host);
    if (!hostId) {
      return json({ host: null, claim: null }, {
        status: 404,
        headers: { "cache-control": "public, max-age=15" },
      });
    }
    return await hostDetailResponse(
      hostId,
      hostDetailCache,
      () => getPublicHostDetail(hostId),
    );
  }, {
    scope: "appview-host-detail",
    capacity: 120,
    refillMs: 60_000,
  }),
});

function normalizePublicHostParam(raw: string): string | null {
  try {
    const host = decodeURIComponent(raw).toLowerCase().replace(/\.$/, "");
    return isHandle(host) ? host : null;
  } catch {
    return null;
  }
}

export function normalizePublicHostParamForTest(raw: string): string | null {
  return normalizePublicHostParam(raw);
}

async function hostDetailResponse(
  hostId: string,
  cache: EdgeStaleCache<PublicHostDetail>,
  load: () => Promise<PublicHostDetail>,
): Promise<Response> {
  try {
    const detail = await cache.get(hostId, load);
    return json(detail, {
      status: detail.host ? 200 : 404,
      headers: {
        "cache-control": detail.host
          ? "public, max-age=60, stale-while-revalidate=300"
          : "public, max-age=15, stale-while-revalidate=60",
      },
    });
  } catch (err) {
    console.error("[appview] host detail unavailable:", err);
    return json({ error: "host_detail_unavailable" }, {
      status: 503,
      headers: { "cache-control": "no-store" },
    });
  }
}

export function hostDetailResponseForTest(
  hostId: string,
  cache: EdgeStaleCache<PublicHostDetail>,
  load: () => Promise<PublicHostDetail>,
): Promise<Response> {
  return hostDetailResponse(hostId, cache, load);
}

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(init.headers ?? {}),
    },
  });
}
