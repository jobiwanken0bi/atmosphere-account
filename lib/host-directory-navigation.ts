const HOSTS_DIRECTORY_PATH = "/hosts";
const RETURN_BASE = "https://atmosphere.invalid";

export function normalizeHostDirectoryReturnTo(
  value: string | null | undefined,
): string {
  const raw = value?.trim();
  if (!raw) return HOSTS_DIRECTORY_PATH;
  try {
    const url = new URL(raw, RETURN_BASE);
    if (url.origin !== RETURN_BASE || url.pathname !== HOSTS_DIRECTORY_PATH) {
      return HOSTS_DIRECTORY_PATH;
    }
    return `${HOSTS_DIRECTORY_PATH}${url.search}`;
  } catch {
    return HOSTS_DIRECTORY_PATH;
  }
}

export function hostDetailHref(host: string, returnTo: string): string {
  const detail = `/hosts/${encodeURIComponent(host)}`;
  const normalizedReturnTo = normalizeHostDirectoryReturnTo(returnTo);
  if (normalizedReturnTo === HOSTS_DIRECTORY_PATH) return detail;
  const params = new URLSearchParams({ from: normalizedReturnTo });
  return `${detail}?${params.toString()}`;
}
