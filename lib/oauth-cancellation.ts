import type { OAuthAction } from "./oauth-action.ts";
import { APP_PROFILE_RESUME_PARAM } from "./app-profile-resume.ts";
import { HOST_PROFILE_RESUME_PARAM } from "./host-profile-resume.ts";
import { isSafeRelativePath } from "./security.ts";
import {
  ACCOUNT_REVIEW_DELETE_PARAM,
  REVIEW_RESPONSE_RESUME_PARAM,
} from "./app-interaction-reauth.ts";
import { USER_PROFILE_RESUME_PARAM } from "./user-profile-resume.ts";

const PARSE_ORIGIN = "https://atmosphere.invalid";

export const OAUTH_CANCELLATION_PARAM = "oauth_cancelled";

export type OAuthCancellationKind =
  | "favorite"
  | "review-draft"
  | "review-response"
  | "report-draft"
  | "microblog-viewer"
  | "app-profile"
  | "host-profile"
  | "user-profile";

function cancellationValue(
  kind: OAuthCancellationKind,
  resource?: string | null,
): string {
  return resource ? `${kind}:${resource}` : kind;
}

function relativeLocation(url: URL): string {
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * Build the destination for a recovery screen's “Not now” link.
 *
 * OAuth return locations can intentionally contain one-shot markers that
 * replay the write which originally needed more permission. Leaving through
 * the recovery screen is an explicit cancellation, so those markers must not
 * survive the link. A typed cancellation marker lets the destination discard
 * any browser-stored draft associated with that replay without affecting
 * unrelated pending work.
 */
export function oauthAuthorizationExitHref(
  returnTo: string,
  action: OAuthAction,
): string {
  const safeReturnTo = isSafeRelativePath(returnTo) ? returnTo : "/account";
  const url = new URL(safeReturnTo, PARSE_ORIGIN);
  const cancellations = new Set<string>();

  if (url.searchParams.has("favorite")) {
    url.searchParams.delete("favorite");
    cancellations.add("favorite");
  }
  // These markers only reopen UI rather than replaying a write, but “Not now”
  // should still leave the canceled review/report flow instead of immediately
  // presenting the same dialog again.
  if (url.searchParams.has("review")) {
    url.searchParams.delete("review");
    cancellations.add("review-draft");
  }
  if (url.searchParams.has(REVIEW_RESPONSE_RESUME_PARAM)) {
    const reviewId = url.searchParams.get(REVIEW_RESPONSE_RESUME_PARAM);
    url.searchParams.delete(REVIEW_RESPONSE_RESUME_PARAM);
    if (reviewId && /^[1-9]\d*$/.test(reviewId)) {
      cancellations.add(cancellationValue("review-response", reviewId));
    }
  }
  url.searchParams.delete(ACCOUNT_REVIEW_DELETE_PARAM);
  if (url.searchParams.has("report")) {
    const reviewId = url.searchParams.get("report");
    url.searchParams.delete("report");
    if (reviewId && /^[1-9]\d*$/.test(reviewId)) {
      cancellations.add(cancellationValue("report-draft", reviewId));
    }
  }
  if (url.searchParams.has("resume_viewer")) {
    url.searchParams.delete("resume_viewer");
    cancellations.add("microblog-viewer");
  }
  if (url.searchParams.has(APP_PROFILE_RESUME_PARAM)) {
    url.searchParams.delete(APP_PROFILE_RESUME_PARAM);
    cancellations.add("app-profile");
  }
  if (url.searchParams.has(HOST_PROFILE_RESUME_PARAM)) {
    url.searchParams.delete(HOST_PROFILE_RESUME_PARAM);
    cancellations.add("host-profile");
  }
  if (url.searchParams.has(USER_PROFILE_RESUME_PARAM)) {
    url.searchParams.delete(USER_PROFILE_RESUME_PARAM);
    cancellations.add("user-profile");
  } else if (action === "profile") {
    // Keep handling in-flight authorization links from older deployments.
    cancellations.add("user-profile");
  }

  // Never allow a return path to inject or retain a stale cancellation. Only
  // the exact markers derived above are emitted by this exit link.
  url.searchParams.delete(OAUTH_CANCELLATION_PARAM);
  for (const cancellation of cancellations) {
    url.searchParams.append(OAUTH_CANCELLATION_PARAM, cancellation);
  }
  return relativeLocation(url);
}

export interface OAuthCancellationLocation {
  wasCancelled: boolean;
  cleanLocation: string;
}

/** Consume one kind of cancellation while retaining any marker owned by a
 * different island on the same page. */
export function oauthCancellationLocation(
  href: string,
  kind: OAuthCancellationKind,
  resource?: string,
): OAuthCancellationLocation {
  const url = new URL(href, PARSE_ORIGIN);
  const values = url.searchParams.getAll(OAUTH_CANCELLATION_PARAM);
  const scopedValue = cancellationValue(kind, resource);
  // Accept the former unscoped marker for an in-flight authorization started
  // before this deployment, but all newly emitted review/report markers are
  // resource-bound so one island cannot consume another island's cancellation.
  const matchedValue = values.includes(scopedValue)
    ? scopedValue
    : resource && values.includes(kind)
    ? kind
    : null;
  const wasCancelled = matchedValue !== null;
  if (wasCancelled) {
    url.searchParams.delete(OAUTH_CANCELLATION_PARAM);
    for (const value of values) {
      if (value !== matchedValue) {
        url.searchParams.append(OAUTH_CANCELLATION_PARAM, value);
      }
    }
  }
  return { wasCancelled, cleanLocation: relativeLocation(url) };
}
