import { define } from "../utils.ts";
import { isTrustedAtmosphereOrigin } from "./atmosphere-origins.ts";
import { IS_DEV, loginOrigin, siteOrigin } from "./env.ts";
import { readProxyClientKey } from "./proxy-client-key.ts";

const SAFE_METHODS = new Set(["GET", "HEAD"]);

interface CanonicalBrowserRequestOptions {
  dev?: boolean;
  site?: string;
  login?: string;
  /** Set only after both the edge signature and forwarded public origin have
   * been verified. This keeps the Deno -> AppView HTML hop working without
   * trusting browser-supplied forwarding headers. */
  verifiedProxyOrigin?: string | null;
}

/** Only canonicalize top-level HTML traffic. Railway health checks and the
 * edge's direct JSON reads intentionally use the service origin and must not
 * be redirected. */
export function isBrowserDocumentRequest(req: Request): boolean {
  if (req.headers.get("sec-fetch-dest")?.toLowerCase() === "document") {
    return true;
  }
  return (req.headers.get("accept") ?? "").toLowerCase().includes(
    "text/html",
  );
}

function normalizedOrigin(value: string): string | null {
  try {
    return new URL(value).origin.replace(/\/$/, "");
  } catch {
    return null;
  }
}

function canonicalOriginForPath(
  pathname: string,
  site: string,
  login: string,
): string {
  return pathname === "/login/select" ? login : site;
}

function matchesConfiguredOrigin(
  value: string,
  site: string,
  login: string,
): boolean {
  const normalized = normalizedOrigin(value);
  return normalized === normalizedOrigin(site) ||
    normalized === normalizedOrigin(login);
}

/** Decide whether an HTML request needs to leave a raw Deno/Railway hostname
 * before the page can render a cookie-backed form. Safe requests retain their
 * method with 308. Unsafe stale-page submissions use 303 so their body is
 * never replayed across origins; the canonical page simply renders again for
 * a safe retry. */
export function canonicalBrowserRedirect(
  req: Request,
  url: URL,
  options: CanonicalBrowserRequestOptions = {},
): Response | null {
  if (options.dev ?? IS_DEV) return null;
  const site = (options.site ?? siteOrigin()).replace(/\/$/, "");
  const login = (options.login ?? loginOrigin()).replace(/\/$/, "");
  if (matchesConfiguredOrigin(url.origin, site, login)) return null;
  if (!isBrowserDocumentRequest(req)) return null;

  const verifiedProxyOrigin = options.verifiedProxyOrigin
    ? normalizedOrigin(options.verifiedProxyOrigin)
    : null;
  if (
    verifiedProxyOrigin &&
    matchesConfiguredOrigin(verifiedProxyOrigin, site, login)
  ) {
    return null;
  }

  // Assign path and query after constructing the fixed origin. Passing an
  // incoming `//host/path` directly to the URL constructor would interpret it
  // as a protocol-relative authority and turn this boundary into an open
  // redirect.
  const target = new URL(
    "/",
    canonicalOriginForPath(url.pathname, site, login),
  );
  target.pathname = url.pathname;
  target.search = url.search;
  const method = req.method.toUpperCase();
  return new Response(null, {
    status: SAFE_METHODS.has(method) ? 308 : 303,
    headers: {
      location: target.toString(),
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}

async function verifiedForwardedPublicOrigin(req: Request): Promise<
  string | null
> {
  const forwarded = normalizedOrigin(
    req.headers.get("x-atmosphere-public-origin") ?? "",
  );
  if (!forwarded || !isTrustedAtmosphereOrigin(forwarded)) return null;
  return await readProxyClientKey(req).catch(() => null) ? forwarded : null;
}

export const canonicalOriginMiddleware = define.middleware(async (ctx) => {
  if (IS_DEV || isTrustedAtmosphereOrigin(ctx.url.origin)) {
    return await ctx.next();
  }

  const response = canonicalBrowserRedirect(ctx.req, ctx.url, {
    verifiedProxyOrigin: await verifiedForwardedPublicOrigin(ctx.req),
  });
  if (response) {
    console.warn(
      `[security] canonicalized browser request ${ctx.req.method} ${ctx.url.pathname}`,
    );
    return response;
  }
  return await ctx.next();
});
