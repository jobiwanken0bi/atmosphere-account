const HOSTS_DIRECTORY_PATH = "/hosts";
const RETURN_BASE = "https://atmosphere.invalid";

export interface AppDetailBackNavigation {
  href: string;
  label: "Back to apps" | "Back to host";
}

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

/** Link from a host profile to its related app without losing the page the
 * visitor came from. The app page validates this value again before rendering
 * it as a backlink. */
export function relatedAppHrefFromHost(
  appSlug: string,
  host: string,
  hostDirectoryReturnTo = HOSTS_DIRECTORY_PATH,
): string {
  const appDetail = `/apps/${encodeURIComponent(appSlug)}`;
  const from = hostDetailHref(host, hostDirectoryReturnTo);
  return `${appDetail}?${new URLSearchParams({ from }).toString()}`;
}

/** Only an exact public host-detail route may replace the app directory as an
 * app page's backlink. Claim/manage paths and external URLs fail closed. */
export function appDetailBackNavigation(
  value: string | null | undefined,
): AppDetailBackNavigation {
  const hostDetail = normalizeHostDetailReturnTo(value);
  return hostDetail
    ? { href: hostDetail, label: "Back to host" }
    : { href: "/apps", label: "Back to apps" };
}

function normalizeHostDetailReturnTo(
  value: string | null | undefined,
): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw, RETURN_BASE);
    if (url.origin !== RETURN_BASE) return null;
    const match = /^\/hosts\/([^/]+)$/.exec(url.pathname);
    if (!match) return null;
    const host = decodeURIComponent(match[1]).toLowerCase();
    if (!isHostname(host)) return null;
    return hostDetailHref(
      host,
      normalizeHostDirectoryReturnTo(url.searchParams.get("from")),
    );
  } catch {
    return null;
  }
}

function isHostname(value: string): boolean {
  if (value.length > 253 || !value.includes(".")) return false;
  return value.split(".").every((label) =>
    label.length > 0 && label.length <= 63 &&
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
  );
}
