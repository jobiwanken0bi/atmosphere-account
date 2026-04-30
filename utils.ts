import { createDefine } from "fresh";
import type { Locale } from "./i18n/locales.ts";
import type { RememberedAccount } from "./lib/remembered-accounts.ts";
import type { AccountType } from "./lib/account-types.ts";

export interface SessionUser {
  did: string;
  handle: string;
}

/**
 * Per-page social/Open Graph overrides. Routes can set `state.pageMeta`
 * inside their handler to make `_app.tsx` emit page-specific OG tags
 * (page title, description, share image). Used by project pages so the
 * project's banner becomes the link-card preview when the URL is shared.
 */
export interface PageMeta {
  /** Replaces the document <title>. */
  title?: string;
  /** Replaces meta[name=description] and og:description. */
  description?: string;
  /** Absolute (or root-relative) URL of the share image. */
  imageUrl?: string;
  /** Alt text for the share image. */
  imageAlt?: string;
  /** OG image dimensions, when known. Defaults match the site-wide OG image. */
  imageWidth?: number;
  imageHeight?: number;
  /** Override og:type (defaults to "website"; project pages use "profile"). */
  ogType?: string;
}

export interface State {
  /** Active locale for this request. Set by the locale middleware. */
  locale: Locale;
  /** Logged-in registry account, or null when signed out. Set by sessionMiddleware. */
  user: SessionUser | null;
  /** Local account role: users manage reviews, projects manage registry profiles. */
  accountType: AccountType | null;
  /** Accounts that have completed OAuth on this device, in
   *  most-recently-used order. Populated by sessionMiddleware so
   *  routes can hand the list to AccountMenu for the switcher. */
  rememberedAccounts: RememberedAccount[];
  /** Optional per-page social/OG meta overrides; see {@link PageMeta}. */
  pageMeta?: PageMeta;
  // deno-lint-ignore no-explicit-any
  [key: string]: any;
}

export const define = createDefine<State>();
