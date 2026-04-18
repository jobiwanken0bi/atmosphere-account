import { createDefine } from "fresh";
import type { Locale } from "./i18n/locales.ts";

export interface State {
  /** Active locale for this request. Set by the locale middleware. */
  locale: Locale;
  // deno-lint-ignore no-explicit-any
  [key: string]: any;
}

export const define = createDefine<State>();
