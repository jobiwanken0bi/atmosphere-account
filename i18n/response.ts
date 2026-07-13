import type { Locale } from "./locales.ts";

/** Only rendered documents consume the message catalog today. */
export function isLocalizedDocumentResponse(response: Response): boolean {
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]
    .trim()
    .toLowerCase();
  return contentType === "text/html" || contentType === "application/xhtml+xml";
}

/**
 * Add language metadata without mutating a potentially immutable upstream
 * response. Once multiple locales are registered, caches must vary on both
 * browser negotiation and the explicit locale cookie.
 */
export function withLocaleResponseHeaders(
  response: Response,
  locale: Locale,
  varyByPreference: boolean,
): Response {
  const headers = new Headers(response.headers);
  headers.set("content-language", locale);
  if (varyByPreference) {
    const vary = (headers.get("vary") ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (!vary.includes("*")) {
      for (const field of ["Accept-Language", "Cookie"]) {
        if (
          !vary.some((value) => value.toLowerCase() === field.toLowerCase())
        ) {
          vary.push(field);
        }
      }
    }
    headers.set("vary", vary.includes("*") ? "*" : vary.join(", "));
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
