import { isSafeRelativePath } from "./security.ts";

export const APP_PROFILE_RESUME_PARAM = "app-profile-resume";
const FALLBACK_RETURN_TO = "/apps/manage";
const PARSE_ORIGIN = "https://atmosphere.invalid";

function relativeLocation(url: URL): string {
  return `${url.pathname}${url.search}${url.hash}`;
}

export function appProfileReturnToWithoutResume(returnTo: string): string {
  const safeReturnTo = isSafeRelativePath(returnTo)
    ? returnTo
    : FALLBACK_RETURN_TO;
  const url = new URL(safeReturnTo, PARSE_ORIGIN);
  url.searchParams.delete(APP_PROFILE_RESUME_PARAM);
  return relativeLocation(url);
}

export function appProfileResumeReturnTo(
  returnTo: string,
  did: string,
): string {
  const url = new URL(
    appProfileReturnToWithoutResume(returnTo),
    PARSE_ORIGIN,
  );
  url.searchParams.set(APP_PROFILE_RESUME_PARAM, did);
  return relativeLocation(url);
}

export function appProfilePendingKey(did: string, returnTo: string): string {
  return `app-profile:${did}:${appProfileReturnToWithoutResume(returnTo)}`;
}

export function appProfileResumeProofKey(pendingKey: string): string {
  return `atmosphere:oauth-resume-proof:app-profile:${
    encodeURIComponent(pendingKey)
  }`;
}

export interface AppProfileResumeLocation {
  hadMarker: boolean;
  shouldResume: boolean;
  cleanLocation: string;
}

export function appProfileResumeLocation(
  href: string,
  did: string,
): AppProfileResumeLocation {
  const url = new URL(href, PARSE_ORIGIN);
  const markers = url.searchParams.getAll(APP_PROFILE_RESUME_PARAM);
  url.searchParams.delete(APP_PROFILE_RESUME_PARAM);
  return {
    hadMarker: markers.length > 0,
    shouldResume: markers.length === 1 && markers[0] === did,
    cleanLocation: relativeLocation(url),
  };
}
