import { define } from "../../utils.ts";
import {
  isLocale,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
} from "../../i18n/mod.ts";

/**
 * Persist a locale choice as a cookie and bounce the user back to where
 * they came from. Accepts either GET (no-JS form submit) or POST (fetch).
 *
 * Query params:
 *   - `to`: target locale tag. Must be a supported locale.
 *   - `return`: relative path to redirect back to (defaults to `/`).
 */
function handle(ctx: { url: URL; req: Request }): Response {
  const to = ctx.url.searchParams.get("to");
  if (!isLocale(to)) {
    return new Response("Unsupported locale", { status: 400 });
  }

  const requested = ctx.url.searchParams.get("return") ?? "/";
  const safeReturn = isSafeRedirect(requested) ? requested : "/";

  const headers = new Headers({
    location: safeReturn,
    "set-cookie":
      `${LOCALE_COOKIE}=${to}; Path=/; Max-Age=${LOCALE_COOKIE_MAX_AGE}; SameSite=Lax`,
  });
  return new Response(null, { status: 303, headers });
}

/** Only allow same-origin relative paths to avoid open-redirects. */
function isSafeRedirect(value: string): boolean {
  return value.startsWith("/") && !value.startsWith("//");
}

export const handler = define.handlers({
  GET: handle,
  POST: handle,
});
