/**
 * Locale registry. To add a new language:
 *   1. Add its tag here.
 *   2. Add a matching `i18n/messages/<tag>.ts` that satisfies the `Messages` type
 *      from `i18n/messages/en.ts`.
 *   3. Register it in `i18n/messages/index.ts`.
 *
 * Tags follow BCP 47 (e.g. "en", "es", "pt-BR").
 */
export const SUPPORTED_LOCALES = ["en"] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "en";

/** Cookie name used to persist a user's locale choice. */
export const LOCALE_COOKIE = "locale";

/** One year, in seconds. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" &&
    (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * Negotiate the best supported locale given an explicit preference and the
 * request headers. Resolution order:
 *   1. Explicit cookie (already validated).
 *   2. `Accept-Language` header — best matching base tag wins.
 *   3. {@link DEFAULT_LOCALE}.
 */
export function negotiateLocale(
  cookieValue: string | undefined,
  acceptLanguage: string | null,
): Locale {
  if (cookieValue && isLocale(cookieValue)) return cookieValue;

  if (acceptLanguage) {
    const ranked = parseAcceptLanguage(acceptLanguage);
    for (const tag of ranked) {
      if (isLocale(tag)) return tag;
      const base = tag.split("-")[0];
      if (isLocale(base)) return base;
    }
  }

  return DEFAULT_LOCALE;
}

/** Parse an Accept-Language header into tags ordered by descending q-value. */
function parseAcceptLanguage(header: string): string[] {
  return header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const qParam = params.find((p) => p.trim().startsWith("q="));
      const q = qParam ? Number(qParam.trim().slice(2)) : 1;
      return { tag: tag.toLowerCase(), q: Number.isFinite(q) ? q : 0 };
    })
    .filter((entry) => entry.tag && entry.q > 0)
    .sort((a, b) => b.q - a.q)
    .map((entry) => entry.tag);
}

/** Read the locale cookie out of a `Cookie` header value. */
export function readLocaleCookie(cookieHeader: string | null): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === LOCALE_COOKIE) return rest.join("=");
  }
  return undefined;
}
