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

Deno.test("account navigation names the listings workspace clearly", () => {
  assert(
    getMessages("en").nav.account.managedProducts === "Manage listings",
    "listing management label drifted",
  );
});

Deno.test("host preview account totals use compact numbers", () => {
  const compact = getMessages("en").hostsDirectory.compactAccountCount;
  assert(compact(4_200_000) === "4.2M", "millions should use one decimal");
  assert(compact(42_000_000) === "42M", "whole millions should stay concise");
});

Deno.test("contextual account actions use the universal login product name", () => {
  const messages = getMessages("en");
  assert(
    messages.reviews.app.like.signInTitle === "Login with Atmosphere",
    "favorite login title drifted from the product name",
  );
  assert(
    messages.developerResources.badgeAlt === "Login with Atmosphere",
    "developer badge label drifted from the product name",
  );
  assert(
    messages.explore.create.signInLabel === "Atmosphere handle",
    "the handle field should be labelled as a field, not a competing action",
  );
  assert(
    messages.reviews.app.like.signIn ===
      "Login with Atmosphere to like this app",
    "contextual login triggers drifted back to Sign in",
  );
});

Deno.test("home explanation keeps the agreed account and open-internet language", () => {
  const source = Deno.readTextFileSync(
    new URL("./en.tsx", import.meta.url),
  );
  assert(
    /Your\s*<strong>Atmosphere Account<\/strong>[\s\S]{0,40}is your passport/
      .test(source),
    "Atmosphere Account passport paragraph is missing",
  );
  assert(
    source.includes("<strong>it’s an open social internet</strong>"),
    "open social internet conclusion is missing",
  );
  assert(
    !source.includes("open social web") &&
      !source.includes("Of course, you can have"),
    "superseded home copy returned",
  );
});
