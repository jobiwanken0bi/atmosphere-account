import { createContext, type VNode } from "preact";
import { useContext } from "preact/hooks";
import { DEFAULT_LOCALE, type Locale } from "./locales.ts";
import { getMessages, type Messages } from "./messages/index.ts";

interface I18nContextValue {
  locale: Locale;
  t: Messages;
}

const I18nContext = createContext<I18nContextValue>({
  locale: DEFAULT_LOCALE,
  t: getMessages(DEFAULT_LOCALE),
});

export interface I18nProviderProps {
  locale: Locale;
  children: VNode | VNode[] | string | null;
}

export function I18nProvider({ locale, children }: I18nProviderProps): VNode {
  const value: I18nContextValue = { locale, t: getMessages(locale) };
  return (
    <I18nContext.Provider value={value}>
      {children as VNode}
    </I18nContext.Provider>
  );
}

/**
 * Retrieve the active locale's message catalog. Components access keys
 * directly (e.g. `useT().nav.explore`) so TypeScript guarantees the key
 * exists in every locale.
 */
export function useT(): Messages {
  return useContext(I18nContext).t;
}

export function useLocale(): Locale {
  return useContext(I18nContext).locale;
}
