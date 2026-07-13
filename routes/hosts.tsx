import { define } from "../utils.ts";
import Nav from "../components/Nav.tsx";
import Footer from "../components/Footer.tsx";
import AtmosphereHandle from "../components/AtmosphereHandle.tsx";
import HostMark from "../components/hosts/HostMark.tsx";
import { buildAccountMenuProps } from "../lib/account-menu-props.ts";
import type { AccountHost } from "../lib/account-hosts.ts";
import { listHostsFromAppview } from "../lib/appview-client.ts";
import { EdgeStaleCache } from "../lib/edge-cache.ts";
import { hostFriendlyProfile } from "../lib/host-friendly.ts";
import { hostHasCurrentConformance } from "../lib/host-conformance.ts";

const HOSTS_CACHE_TTL_MS = 2 * 60 * 1000;
const HOSTS_STALE_MS = 15 * 60 * 1000;
const HOSTS_CACHE_MAX_ENTRIES = 24;

const hostsCache = new EdgeStaleCache<AccountHost[]>({
  freshMs: HOSTS_CACHE_TTL_MS,
  staleMs: HOSTS_STALE_MS,
  maxEntries: HOSTS_CACHE_MAX_ENTRIES,
});

export default define.page(async function HostsPage(ctx) {
  const query = ctx.url.searchParams.get("q")?.trim() ?? "";
  const visibleHosts = await loadHostsResult(query).catch((err) => {
    console.warn("[hosts] appview host list failed:", err);
    return [];
  });
  return (
    <div id="page-top">
      <div class="content-layer">
        <Nav account={buildAccountMenuProps(ctx.state)} active="hosts" />
        <section class="hosts-section">
          <div class="container hosts-container">
            <header class="hosts-header">
              <div>
                <p class="text-eyebrow">Account hosts</p>
                <h1 class="text-section">Choose where your account lives.</h1>
                <p class="text-body mt-2">
                  Account hosts keep your Atmosphere account online so you can
                  use it across apps. Compare who each host is for, where
                  account data is hosted, and whether signup is open.
                </p>
              </div>
            </header>

            <div class="hosts-search-panel">
              <form
                class="explore-search-form hosts-search-form"
                method="GET"
                action="/hosts"
                role="search"
              >
                <label class="visually-hidden" for="hosts-search-input">
                  Search account hosts
                </label>
                <input
                  id="hosts-search-input"
                  class="explore-search-input"
                  name="q"
                  type="search"
                  value={query}
                  autoComplete="off"
                  spellcheck={false}
                  placeholder="Search account hosts..."
                />
                <button type="submit" class="explore-search-submit">
                  Search
                </button>
              </form>
            </div>

            {visibleHosts.length === 0
              ? (
                <div class="glass hosts-empty">
                  <p class="text-body">
                    {query
                      ? `No account hosts match "${query}".`
                      : "We couldn't load account hosts. Try refreshing in a moment."}
                  </p>
                </div>
              )
              : (
                <div class="hosts-grid">
                  {visibleHosts.map((host) => (
                    <HostCard key={host.host} host={host} />
                  ))}
                </div>
              )}
            <DirectoryRegisterCta
              href={registerHostHref()}
              label="Register a host"
            />
          </div>
        </section>
        <Footer variant="compact" />
      </div>
    </div>
  );
});

async function loadHostsResult(query: string): Promise<AccountHost[]> {
  const key = hostCacheKey(query);
  return await hostsCache.get(key, () => listHostsFromAppview({ query }));
}

function hostCacheKey(query: string): string {
  return query.trim().toLocaleLowerCase();
}

function DirectoryRegisterCta(
  { href, label }: { href: string; label: string },
) {
  return (
    <div class="directory-register-cta">
      <a href={href} class="directory-register-button">
        <span class="directory-register-button-icon" aria-hidden="true">
          +
        </span>
        <span>{label}</span>
      </a>
    </div>
  );
}

function HostCard({ host }: { host: AccountHost }) {
  const friendly = hostFriendlyProfile(host);
  return (
    <a
      href={`/hosts/${encodeURIComponent(host.host)}`}
      class="glass host-card"
    >
      <div class="host-card-top">
        <div class="host-card-identity">
          <HostMark host={host} />
          <div class="host-card-title-block">
            <span class="host-card-eyebrow">Account host</span>
            <h2>{host.displayName}</h2>
            {host.profileHandle && (
              <p class="host-card-handle">
                <AtmosphereHandle handle={host.profileHandle} />
              </p>
            )}
          </div>
        </div>
      </div>
      <p class="host-card-description">{friendly.summary}</p>
      <div class="host-card-tags" aria-label="Host facts">
        <span>{friendly.location}</span>
        <span>{friendly.signupLabel}</span>
        {hostHasCurrentConformance(host) && (
          <span class="host-card-conformance">Compatibility checked</span>
        )}
      </div>
    </a>
  );
}

function registerHostHref(): string {
  return "/hosts/register";
}
