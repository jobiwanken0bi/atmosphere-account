import { define } from "../utils.ts";
import {
  DEFAULT_LOCALE,
  negotiateLocale,
  readLocaleCookie,
} from "./locales.ts";

/**
 * Resolves the active locale for every request and stashes it on
 * `ctx.state.locale` so layouts, routes, and server-rendered components
 * can read it via the I18n context.
 */
export const localeMiddleware = define.middleware((ctx) => {
  const cookieLocale = readLocaleCookie(ctx.req.headers.get("cookie"));
  const accept = ctx.req.headers.get("accept-language");
  ctx.state.locale = negotiateLocale(cookieLocale, accept) ?? DEFAULT_LOCALE;
  return ctx.next();
});
