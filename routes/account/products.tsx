import { define } from "../../utils.ts";

/** Compatibility redirect for the retired portfolio/organisation route. */
export const handler = define.handlers({
  GET(ctx) {
    return legacyProductsRedirectResponse(ctx.url);
  },
});

export function legacyProductsRedirectResponse(url: URL): Response {
  return new Response(null, {
    status: 308,
    headers: { location: legacyProductsRedirectLocation(url) },
  });
}

export function legacyProductsRedirectLocation(url: URL): string {
  return `/account/apps-hosts${url.search}`;
}
