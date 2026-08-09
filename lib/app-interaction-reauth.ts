import { favoriteResumeReturnPath } from "./favorite-resume.ts";
import { oauthReauthorizationUrl } from "./oauth-action.ts";

export const ACCOUNT_REVIEW_DELETE_PARAM = "delete_review";
export const REVIEW_RESPONSE_RESUME_PARAM = "review_response";

export function accountReviewDeleteReturnPath(reviewId: number): string {
  const query = new URLSearchParams({
    [ACCOUNT_REVIEW_DELETE_PARAM]: String(reviewId),
  });
  return `/account/reviews?${query.toString()}`;
}

export function accountReviewDeleteResumeLocation(
  href: string,
  reviewId: number,
): { shouldConfirm: boolean; cleanLocation: string } {
  const url = new URL(href, "https://atmosphere.invalid");
  const markers = url.searchParams.getAll(ACCOUNT_REVIEW_DELETE_PARAM);
  const shouldConfirm = markers.length === 1 &&
    markers[0] === String(reviewId);
  if (shouldConfirm) url.searchParams.delete(ACCOUNT_REVIEW_DELETE_PARAM);
  return {
    shouldConfirm,
    cleanLocation: `${url.pathname}${url.search}${url.hash}`,
  };
}

export function reviewResponseReturnPath(
  returnTo: string,
  reviewId: number,
): string {
  const url = new URL(returnTo, "https://atmosphere.invalid");
  url.searchParams.set(REVIEW_RESPONSE_RESUME_PARAM, String(reviewId));
  return `${url.pathname}${url.search}${url.hash}`;
}

export function reviewResponseResumeLocation(
  href: string,
  reviewId: number,
): { hadMarker: boolean; shouldResume: boolean; cleanLocation: string } {
  const url = new URL(href, "https://atmosphere.invalid");
  const markers = url.searchParams.getAll(REVIEW_RESPONSE_RESUME_PARAM);
  const expected = String(reviewId);
  const hadMarker = markers.includes(expected);
  // An app page can render several response composers. Only the island named
  // by the marker may consume it; a malformed multi-value marker is consumed
  // by the first matching island but never resumes anything.
  if (hadMarker) url.searchParams.delete(REVIEW_RESPONSE_RESUME_PARAM);
  return {
    hadMarker,
    shouldResume: markers.length === 1 && markers[0] === expected,
    cleanLocation: `${url.pathname}${url.search}${url.hash}`,
  };
}

export function appFavoriteReauthorizationUrl(
  identifier: string,
  displayName: string,
  intent: "save" | "remove",
): string {
  return oauthReauthorizationUrl({
    next: favoriteResumeReturnPath(identifier, intent),
    action: "favorite",
    capabilities: ["favorite"],
    name: displayName,
  });
}

export function appReviewReauthorizationUrl(
  identifier: string,
  displayName: string,
  capability: "review" | "review_manage",
): string {
  return oauthReauthorizationUrl({
    next: `/apps/${encodeURIComponent(identifier)}?review=compose`,
    action: capability,
    capabilities: [capability],
    name: displayName,
  });
}
