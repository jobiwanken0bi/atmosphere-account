import { define } from "../utils.ts";
import {
  DEFAULT_LOCALE,
  negotiateLocale,
  readLocaleCookie,
  SUPPORTED_LOCALES,
} from "./locales.ts";
import {
  isLocalizedDocumentResponse,
  withLocaleResponseHeaders,
} from "./response.ts";

export {
  isLocalizedDocumentResponse,
  withLocaleResponseHeaders,
} from "./response.ts";

/**
 * Resolves the active locale for every request and stashes it on
 * `ctx.state.locale` so layouts, routes, and server-rendered components
 * can read it via the I18n context.
 */
export const localeMiddleware = define.middleware(async (ctx) => {
  const cookieLocale = readLocaleCookie(ctx.req.headers.get("cookie"));
  const accept = ctx.req.headers.get("accept-language");
  ctx.state.locale = negotiateLocale(cookieLocale, accept) ?? DEFAULT_LOCALE;
  const response = await ctx.next();
  if (!isLocalizedDocumentResponse(response)) return response;
  return withLocaleResponseHeaders(
    response,
    ctx.state.locale,
    SUPPORTED_LOCALES.length > 1,
  );
});
