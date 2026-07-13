import {
  canonicalLocale,
  DEFAULT_LOCALE,
  isLocale,
  localeDirection,
  negotiateLocale,
  readLocaleCookie,
  SUPPORTED_LOCALES,
} from "./locales.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
  }
}

Deno.test("locale registry uses canonical BCP 47 tags", () => {
  for (const locale of SUPPORTED_LOCALES) {
    assertEquals(Intl.getCanonicalLocales(locale)[0], locale);
    assertEquals(canonicalLocale(locale.toUpperCase()), locale);
    assertEquals(isLocale(locale), true);
    assertEquals(["ltr", "rtl"].includes(localeDirection(locale)), true);
  }
});

Deno.test("locale negotiation honors cookie, q-values, and base tags", () => {
  assertEquals(negotiateLocale("EN", "fr;q=1"), "en");
  assertEquals(negotiateLocale(undefined, "fr;q=1, en-US;q=0.8"), "en");
  assertEquals(negotiateLocale(undefined, "en;q=0, fr;q=1"), DEFAULT_LOCALE);
  assertEquals(negotiateLocale(undefined, null), DEFAULT_LOCALE);
});

Deno.test("locale cookies are read without confusing similarly named keys", () => {
  assertEquals(readLocaleCookie("theme=sky; locale=en; session=abc"), "en");
  assertEquals(readLocaleCookie("my_locale=fr; theme=sky"), undefined);
  assertEquals(readLocaleCookie(null), undefined);
});
