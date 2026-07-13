import { SUPPORTED_LOCALES } from "../locales.ts";
import en, { type Messages } from "./en.tsx";
import { getMessages } from "./index.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function countMessageLeaves(value: unknown, path = "messages"): number {
  if (typeof value === "string") {
    assert(value.trim().length > 0, `${path} must not be blank`);
    return 1;
  }
  if (typeof value === "function") return 1;
  if (Array.isArray(value)) {
    assert(value.length > 0, `${path} must not be an empty list`);
    return value.reduce(
      (total, item, index) =>
        total + countMessageLeaves(item, `${path}[${index}]`),
      0,
    );
  }
  if (value && typeof value === "object") {
    return Object.entries(value).reduce(
      (total, [key, item]) =>
        total + countMessageLeaves(item, `${path}.${key}`),
      0,
    );
  }
  throw new Error(`${path} has unsupported message value ${String(value)}`);
}

Deno.test("every registered catalog is complete and names every locale", () => {
  const englishLeafCount = countMessageLeaves(en, "en");
  assert(englishLeafCount > 100, "English catalog unexpectedly small");

  for (const locale of SUPPORTED_LOCALES) {
    const catalog = getMessages(locale);
    assert(
      countMessageLeaves(catalog, locale) === englishLeafCount,
      `${locale} catalog shape differs from English`,
    );
    for (const namedLocale of SUPPORTED_LOCALES) {
      assert(
        catalog.localeSwitcher.languageNames[namedLocale]?.trim().length > 0,
        `${locale} must name ${namedLocale} in the language switcher`,
      );
    }
  }
});

Deno.test("translated catalogs may change text while preserving shape", () => {
  const translated = {
    ...en,
    meta: { ...en.meta, title: "Translated title" },
  } satisfies Messages;
  assert(translated.meta.title === "Translated title", "translation rejected");
});
