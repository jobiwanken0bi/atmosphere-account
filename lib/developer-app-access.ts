import { listManagedAppListingsByAccountDid } from "./app-directory.ts";

type ManagedAppLoader = (did: string) => Promise<readonly unknown[]>;

/**
 * Developer settings are subordinate to exactly one app profile. A DID with
 * no app starts in the public directory; grandfathered multi-app DIDs resolve
 * their portfolio before a login environment can be selected safely.
 */
export async function developerAppAccessRedirect(
  did: string,
  loadManagedApps: ManagedAppLoader = listManagedAppListingsByAccountDid,
): Promise<Response | null> {
  const apps = await loadManagedApps(did);
  if (apps.length === 1) return null;
  return developerAppAccessRedirectForCount(apps.length);
}

export function developerAppAccessRedirectForCount(count: number): Response {
  const location = count > 1 ? "/account/apps-hosts" : "/apps";
  return new Response(null, {
    status: 303,
    headers: {
      location,
      "cache-control": "no-store",
    },
  });
}
