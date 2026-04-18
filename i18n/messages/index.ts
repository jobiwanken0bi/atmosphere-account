import { DEFAULT_LOCALE, type Locale } from "../locales.ts";
import en, { type Messages } from "./en.tsx";

/**
 * Map of locale → message catalog. New locales are registered here once
 * their `<locale>.ts` file exists and satisfies `Messages`.
 */
const catalogs: Record<Locale, Messages> = {
  en,
};

export function getMessages(locale: Locale): Messages {
  return catalogs[locale] ?? catalogs[DEFAULT_LOCALE];
}

export type { Messages };
