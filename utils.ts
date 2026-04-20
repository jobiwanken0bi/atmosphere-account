import { createDefine } from "fresh";
import type { Locale } from "./i18n/locales.ts";

export interface SessionUser {
  did: string;
  handle: string;
}

export interface State {
  /** Active locale for this request. Set by the locale middleware. */
  locale: Locale;
  /** Logged-in registry account, or null when signed out. Set by sessionMiddleware. */
  user: SessionUser | null;
  // deno-lint-ignore no-explicit-any
  [key: string]: any;
}

export const define = createDefine<State>();
