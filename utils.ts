import { createDefine } from "fresh";
import type { Locale } from "./i18n/locales.ts";
import type { RememberedAccount } from "./lib/remembered-accounts.ts";

export interface SessionUser {
  did: string;
  handle: string;
}

export interface State {
  /** Active locale for this request. Set by the locale middleware. */
  locale: Locale;
  /** Logged-in registry account, or null when signed out. Set by sessionMiddleware. */
  user: SessionUser | null;
  /** Accounts that have completed OAuth on this device, in
   *  most-recently-used order. Populated by sessionMiddleware so
   *  routes can hand the list to AccountMenu for the switcher. */
  rememberedAccounts: RememberedAccount[];
  // deno-lint-ignore no-explicit-any
  [key: string]: any;
}

export const define = createDefine<State>();
