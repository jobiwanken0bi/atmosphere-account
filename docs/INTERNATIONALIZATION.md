# Internationalization

Atmosphere Account uses a small, typed i18n layer rather than embedding a
translation service in the runtime. English (`en`) is currently the only shipped
locale. Public marketing, navigation, account, and much of the app directory UI
already use the catalog; some maintainer, admin, migration, and developer-debug
screens still contain English literals and should be migrated when those
surfaces are changed.

## Design

- Locale tags are canonical
  [BCP 47](https://www.rfc-editor.org/rfc/bcp/bcp47.txt) strings registered in
  `i18n/locales.ts`.
- Every registered locale declares `ltr` or `rtl` document direction.
- An explicit locale cookie wins over `Accept-Language`; unsupported tags fall
  back to English.
- Rendered documents emit `Content-Language`. When more than one locale exists
  they also vary cache entries on `Accept-Language` and `Cookie`; unrelated API
  and asset responses do not inherit locale cache variance.
- `i18n/messages/en.tsx` defines the catalog structure. Its message type widens
  text leaves to `string`, so translations must match keys and function
  signatures without being forced to repeat English values.
- Every catalog names every supported language in the language switcher.

## Add a locale

1. Add the canonical tag to `SUPPORTED_LOCALES` in `i18n/locales.ts`.
2. Add its `ltr` or `rtl` entry to `LOCALE_DIRECTIONS`.
3. Copy `i18n/messages/en.tsx` to a matching catalog such as
   `i18n/messages/es.tsx` and translate every message.
4. Import and register the catalog in `i18n/messages/index.ts`.
5. Add the new language name to `localeSwitcher.languageNames` in every catalog.
   Each language should name itself naturally.
6. Run `deno task i18n:check`, `deno task check`, and `deno task build`.
7. Review representative narrow, wide, and mobile layouts. RTL locales must be
   reviewed with the document direction active rather than by mirroring a
   screenshot.

A translated catalog should use `satisfies Messages` or an explicit `Messages`
annotation. Do not use `as Messages` to suppress missing keys.

## Message conventions

- Put public user-facing labels, errors, headings, descriptions, alt text, and
  ARIA labels in the catalog.
- Keep protocol names, DIDs, handles, URLs, record keys, and code examples
  unchanged unless the surrounding explanation is being translated.
- Preserve interpolation parameters and the meaning of JSX-producing message
  functions. Never insert translator-provided HTML with
  `dangerouslySetInnerHTML`.
- Avoid assembling sentences from translated fragments; use a function with
  named parameters so translators can choose word order.
- Prefer complete, contextual keys over a single generic word reused across
  unrelated screens.
- Do not translate logs, machine-readable API error codes, database values, or
  protocol wire formats.

## Pull requests

Translation pull requests should identify the language and reviewer context,
state whether the catalog is complete, and include screenshots of at least the
home page, app directory, sign-in flow, and locale switcher. Machine translation
can help draft text, but contributors must review every message for meaning,
tone, placeholders, security language, and layout.
