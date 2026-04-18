import { SUPPORTED_LOCALES, useLocale, useT } from "../i18n/mod.ts";

/**
 * JS-free language switcher. Renders nothing while only one locale is
 * registered, so it stays out of the way until more translations land.
 *
 * The form GETs `/api/locale`, which writes the cookie and redirects back
 * to the page that submitted it.
 */
export default function LocaleSwitcher({ returnTo }: { returnTo?: string }) {
  if (SUPPORTED_LOCALES.length < 2) return null;

  const t = useT();
  const current = useLocale();
  const names = t.localeSwitcher.languageNames as Record<string, string>;

  return (
    <form
      method="get"
      action="/api/locale"
      class="locale-switcher"
      aria-label={t.localeSwitcher.label}
    >
      <label class="locale-switcher-label">
        <span class="visually-hidden">{t.localeSwitcher.label}</span>
        <select name="to" class="locale-switcher-select" aria-label={t.localeSwitcher.label}>
          {SUPPORTED_LOCALES.map((loc) => (
            <option key={loc} value={loc} selected={loc === current}>
              {names[loc] ?? loc}
            </option>
          ))}
        </select>
      </label>
      {returnTo ? <input type="hidden" name="return" value={returnTo} /> : null}
      <button type="submit" class="locale-switcher-submit">
        {t.localeSwitcher.label}
      </button>
    </form>
  );
}
