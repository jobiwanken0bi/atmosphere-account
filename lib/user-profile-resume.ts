export const USER_PROFILE_RESUME_PARAM = "resume_user_profile";

export function userProfileResumePath(did: string): string {
  const query = new URLSearchParams({ [USER_PROFILE_RESUME_PARAM]: did });
  return `/account?${query.toString()}`;
}

export function userProfileResumeLocation(
  href: string,
  did: string,
): { hadMarker: boolean; shouldResume: boolean; cleanLocation: string } {
  const url = new URL(href, "https://atmosphere.invalid");
  const values = url.searchParams.getAll(USER_PROFILE_RESUME_PARAM);
  url.searchParams.delete(USER_PROFILE_RESUME_PARAM);
  return {
    hadMarker: values.length > 0,
    shouldResume: values.length === 1 && values[0] === did,
    cleanLocation: `${url.pathname}${url.search}${url.hash}`,
  };
}
