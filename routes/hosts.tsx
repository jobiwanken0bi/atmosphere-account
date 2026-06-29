import { define } from "../utils.ts";
import Nav from "../components/Nav.tsx";
import Footer from "../components/Footer.tsx";
import AtmosphereHandle from "../components/AtmosphereHandle.tsx";
import HostMark from "../components/hosts/HostMark.tsx";
import { buildAccountMenuProps } from "../lib/account-menu-props.ts";
import {
  type AccountHost,
  type HostSignupStatus,
  listAccountHosts,
  warmAccountHostProfiles,
} from "../lib/account-hosts.ts";
import { hostFriendlyProfile } from "../lib/host-friendly.ts";

const signupOptions: Array<HostSignupStatus | "all"> = [
  "all",
  "open",
  "invite_required",
  "closed",
];

function readSignup(value: string | null): HostSignupStatus | "all" {
  return value === "open" || value === "invite_required" ||
      value === "closed"
    ? value
    : "all";
}

export default define.page(async function HostsPage(ctx) {
  const query = ctx.url.searchParams.get("q")?.trim() ?? "";
  const signupStatus = readSignup(ctx.url.searchParams.get("signup"));
  const hosts = await listAccountHosts({
    query,
    signupStatus,
  }).catch((err) => {
    console.warn("[hosts] list account hosts failed:", err);
    return [];
  });
  if (hosts.length > 0) {
    warmAccountHostProfiles(hosts).catch((err) => {
      console.warn("[hosts] warm profile avatars failed:", err);
    });
  }
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
                {signupStatus !== "all" && (
                  <input type="hidden" name="signup" value={signupStatus} />
                )}
                <button type="submit" class="explore-search-submit">
                  Search
                </button>
              </form>

              <div class="hosts-filter-groups">
                <div class="hosts-filter-group">
                  <span class="hosts-filter-label">Signup</span>
                  <nav class="explore-category-tabs" aria-label="Signup status">
                    {signupOptions.map((option) => (
                      <a
                        href={buildHostsHref({
                          query,
                          signupStatus: option,
                        })}
                        class={`explore-category-tab ${
                          option === signupStatus ? "is-active" : ""
                        }`}
                      >
                        {signupLabel(option)}
                      </a>
                    ))}
                  </nav>
                </div>
              </div>
            </div>

            {hosts.length === 0
              ? (
                <div class="glass hosts-empty">
                  <p class="text-body">No account hosts match those filters.</p>
                </div>
              )
              : (
                <div class="hosts-grid">
                  {hosts.map((host) => (
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
      </div>
    </a>
  );
}

function buildHostsHref(opts: {
  query: string;
  signupStatus: HostSignupStatus | "all";
}): string {
  const params = new URLSearchParams();
  if (opts.query) params.set("q", opts.query);
  if (opts.signupStatus !== "all") params.set("signup", opts.signupStatus);
  const qs = params.toString();
  return `/hosts${qs ? `?${qs}` : ""}`;
}

function registerHostHref(): string {
  return "/hosts/register";
}

function signupLabel(status: HostSignupStatus | "all"): string {
  switch (status) {
    case "open":
      return "Open signup";
    case "invite_required":
      return "Invite required";
    case "closed":
      return "Closed";
    case "unknown":
      return "Signup to confirm";
    default:
      return "All";
  }
}
