import type { ComponentChildren } from "preact";
import type { PageProps } from "fresh";
import { define, type State } from "../../utils.ts";
import Nav from "../../components/Nav.tsx";
import Footer from "../../components/Footer.tsx";
import AtmosphereHandle from "../../components/AtmosphereHandle.tsx";
import SignInForm from "../../islands/SignInForm.tsx";
import UserMicroblogViewerButton from "../../islands/UserMicroblogViewerButton.tsx";
import UpgradeToProjectModal from "../../islands/UpgradeToProjectModal.tsx";
import { buildAccountMenuProps } from "../../lib/account-menu-props.ts";
import { proxyAppviewPageResponse } from "../../lib/appview-client.ts";
import { getAppUser } from "../../lib/account-types.ts";
import {
  listLoginConnectionsForAccount,
  type LoginConnection,
} from "../../lib/atmosphere-login.ts";
import { bskyCdnAvatarUrl } from "../../lib/avatar.ts";
import {
  getAccountHost,
  listManagedAccountHosts,
} from "../../lib/account-hosts.ts";
import {
  buildHostAccountRoute,
  type HostAccountRouteState,
} from "../../lib/host-account-routing.ts";
import { isOAuthConfigured } from "../../lib/oauth.ts";
import type { RememberedAccount } from "../../lib/remembered-accounts.ts";
import { getProfileMicroblogViewer } from "../../lib/bsky-clients.ts";

function safeNext(raw: string | null): string | null {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return null;
  return raw;
}

function safeHandle(raw: string | null): string | undefined {
  const handle = raw?.trim().replace(/^@/, "").toLowerCase();
  if (
    !handle ||
    !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/
      .test(handle)
  ) {
    return undefined;
  }
  return handle;
}

const APP_UPGRADE_COPY = {
  button: "Register an app",
  modalTitle: "Use this account as an app profile?",
  modalBody:
    "This sets up the current Atmosphere account as an app profile and opens the app management tools. If this app should use a different account,",
  signInWithProjectLink: "sign in with that app's account here",
  signInWithProjectSuffix: ".",
  yes: "Yes, create app profile",
  cancel: "Cancel",
  submitting: "Creating app profile…",
  error: "Couldn't create the app profile.",
};

export const handler = define.handlers({
  async GET(ctx) {
    const proxied = await proxyAppviewPageResponse(ctx.url, ctx.req).catch(
      (err) => appviewUnavailable("account home", err),
    );
    if (proxied) return proxied;
    return ctx.render(await AccountPage(ctx));
  },
});

function appviewUnavailable(scope: string, err: unknown): Response {
  console.error(`[appview] ${scope} proxy failed:`, err);
  return new Response("Account home is temporarily unavailable.", {
    status: 503,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
    },
  });
}

async function AccountPage(
  ctx: PageProps<unknown, State>,
) {
  const account = buildAccountMenuProps(ctx.state);
  const user = ctx.state.user;
  const next = safeNext(ctx.url.searchParams.get("next")) ?? "/account";
  const initialHandle = safeHandle(ctx.url.searchParams.get("handle"));
  const upgradeIntent = ctx.url.searchParams.get("upgrade") === "app"
    ? "app"
    : null;
  if (!user) {
    return (
      <div id="page-top">
        <div class="content-layer">
          <Nav account={account} />
          <section class="account-home-section">
            <div class="container account-home-container">
              <p class="text-eyebrow">Manage account</p>
              <h1 class="text-section">Sign in to manage your account</h1>
              <p class="text-body mt-2">
                See which Atmosphere account you are using, where it is hosted,
                and the apps you have continued into with Atmosphere.
              </p>
              <div class="glass signin-page-card">
                {isOAuthConfigured()
                  ? (
                    <SignInForm
                      returnTo={next}
                      rememberedAccounts={account.rememberedAccounts}
                      initialHandle={initialHandle}
                    />
                  )
                  : <p class="text-body">Sign in is not ready yet.</p>}
              </div>
            </div>
          </section>
          <Footer variant="compact" />
        </div>
      </div>
    );
  }

  const profile = await getAppUser(user.did).catch(() => null);
  const displayName = profile?.displayName || user.handle;
  const avatarUrl = profile?.avatarCid && profile.avatarMime
    ? bskyCdnAvatarUrl(profile.did, profile.avatarCid)
    : account.avatarUrl;
  const accountHost = account.accountHost;
  const fullHost = accountHost
    ? await getAccountHost(accountHost.host).catch(() => null)
    : null;
  const hostRoute = buildHostAccountRoute({
    host: fullHost,
    lookup: accountHost,
  });
  const loginConnections = await listLoginConnectionsForAccount(user.did).catch(
    () => [],
  );
  const managedHosts = await listManagedAccountHosts(user.did).catch(() => []);
  const primaryManagedHost = managedHosts[0] ?? null;
  const managesHost = managedHosts.length > 0;
  const isAppAccount = ctx.state.accountType === "project";
  const autoOpenAppUpgrade = upgradeIntent === "app" && !isAppAccount;
  const showAdvancedDetails = isAppAccount || managesHost;
  const rememberedAccounts = account.rememberedAccounts;
  const hasKnownHost = Boolean(accountHost?.displayName);
  const hostedBy = accountHost?.displayName ?? "Account host not detected";
  const hostStatusLabel = hasKnownHost
    ? `Hosted by ${hostedBy}`
    : "Account host not detected";
  const hostDirectoryUrl = hostRoute?.directoryUrl ?? "/hosts";
  const browserLabel = currentBrowserLabel(ctx.req.headers);
  const roleLabels = [
    ...(isAppAccount ? ["App account"] : []),
    ...(managesHost ? ["Host account"] : []),
  ];
  const microblogViewer = getProfileMicroblogViewer(
    profile?.bskyClientId ?? null,
  );
  const publicProfileUrl = microblogViewer.profileUrl(user.handle);

  return (
    <div id="page-top">
      <div class="content-layer">
        <Nav account={account} />
        <section class="account-home-section account-dashboard-section">
          <div class="container account-dashboard-container">
            <header class="account-dashboard-page-head">
              <div class="account-dashboard-page-head-row">
                <h1>Account home</h1>
                {!isAppAccount && (
                  <div class="account-dashboard-page-head-action">
                    <UserMicroblogViewerButton
                      selectedClientId={profile?.bskyClientId ?? null}
                      visible={profile?.bskyButtonVisible ?? true}
                    />
                  </div>
                )}
              </div>
              {!isAppAccount && (
                <div class="account-dashboard-upgrade-anchor">
                  <UpgradeToProjectModal
                    initiallyOpen={autoOpenAppUpgrade}
                    copy={APP_UPGRADE_COPY}
                  />
                </div>
              )}
              <p>
                Your home base for Atmosphere. See your handle, your account
                host, saved accounts on this browser, and apps you have opened
                with Continue with Atmosphere.
              </p>
            </header>

            <article id="account" class="glass account-dashboard-hero">
              <div class="account-dashboard-hero-main">
                <div class="account-home-avatar account-dashboard-avatar">
                  {avatarUrl
                    ? (
                      <img
                        src={avatarUrl}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        width={82}
                        height={82}
                      />
                    )
                    : <span>{initialFor(displayName)}</span>}
                </div>
                <div class="account-dashboard-identity">
                  <p class="text-eyebrow">Profile</p>
                  <h2>{displayName}</h2>
                  <p class="account-home-handle">
                    <AtmosphereHandle handle={user.handle} />
                  </p>
                  <div class="account-dashboard-identity-tags">
                    <span class="account-home-pill">{hostStatusLabel}</span>
                    {roleLabels.map((label) => (
                      <span class="account-home-pill" key={label}>{label}</span>
                    ))}
                  </div>
                </div>
              </div>
              <div class="account-dashboard-hero-side">
                <div class="account-dashboard-actions">
                  {isAppAccount
                    ? (
                      <a
                        href="/apps/manage"
                        class="account-dashboard-button account-dashboard-button--primary"
                      >
                        <AccountIcon name="edit" />
                        <span>Edit app profile</span>
                      </a>
                    )
                    : (
                      <ProfileSourcePanel
                        profileUrl={publicProfileUrl}
                        profileViewerName={microblogViewer.name}
                        hostManagementUrl={hostRoute?.accountManagementUrl ??
                          null}
                      />
                    )}
                  {managesHost && primaryManagedHost && (
                    <a
                      href={`/hosts/${
                        encodeURIComponent(primaryManagedHost.host)
                      }/manage`}
                      class="account-dashboard-button account-dashboard-button--secondary"
                    >
                      <AccountIcon name="host" />
                      <span>Manage host profile</span>
                    </a>
                  )}
                </div>
              </div>
            </article>

            <main class="account-dashboard-main">
              <div class="account-dashboard-primary-grid">
                <HostAccountRouterPanel
                  route={hostRoute}
                  hostedBy={hostedBy}
                  hasKnownHost={hasKnownHost}
                  hostDirectoryUrl={hostDirectoryUrl}
                />

                <DashboardSection
                  id="applications"
                  eyebrow="Apps"
                  title="Connected apps"
                  icon="apps"
                  description="Apps you open with Continue with Atmosphere will appear here."
                  badge={loginConnections.length > 0
                    ? `${loginConnections.length} connected`
                    : "None yet"}
                >
                  <ApplicationsPanel
                    connections={loginConnections}
                    showDeveloperAction={isAppAccount}
                  />
                </DashboardSection>
              </div>

              <DashboardSection
                id="saved-accounts"
                eyebrow="This browser"
                title="Saved accounts"
                icon="browser"
                description="Atmosphere can offer these accounts when you switch accounts on this browser."
                badge={rememberedCountLabel(rememberedAccounts.length)}
              >
                <div class="account-dashboard-browser-summary">
                  <span
                    class="account-dashboard-browser-summary-icon"
                    aria-hidden="true"
                  >
                    <AccountIcon name="browser" />
                  </span>
                  <span class="account-dashboard-browser-summary-copy">
                    <strong>{browserLabel}</strong>
                    <span>Current browser</span>
                  </span>
                </div>
                <RememberedAccountsPanel
                  accounts={rememberedAccounts}
                  currentDid={user.did}
                  currentDisplayName={displayName}
                />
              </DashboardSection>

              {showAdvancedDetails && (
                <details class="glass account-home-details account-dashboard-details">
                  <summary>Advanced details</summary>
                  <dl>
                    <div>
                      <dt>DID</dt>
                      <dd>{user.did}</dd>
                    </div>
                    <div>
                      <dt>Host endpoint</dt>
                      <dd>{accountHost?.endpoint ?? "Unknown"}</dd>
                    </div>
                  </dl>
                </details>
              )}
            </main>
          </div>
        </section>
        <Footer variant="compact" />
      </div>
    </div>
  );
}

export default define.page(AccountPage);

function ProfileSourcePanel(
  { profileUrl, profileViewerName, hostManagementUrl }: {
    profileUrl: string;
    profileViewerName: string;
    hostManagementUrl: string | null;
  },
) {
  return (
    <div class="account-dashboard-profile-source">
      <div>
        <p class="text-eyebrow">Profile</p>
        <strong>Shown from your account</strong>
        <p>
          Your name, avatar, and bio come from your Atmosphere profile. Change
          them in your account host or microblog app.
        </p>
      </div>
      <div class="account-dashboard-actions">
        <a
          href={profileUrl}
          target="_blank"
          rel="noopener noreferrer"
          class="account-dashboard-button account-dashboard-button--primary"
        >
          <AccountIcon name="external" />
          <span>Open in {profileViewerName}</span>
        </a>
        {hostManagementUrl && (
          <a
            href={hostManagementUrl}
            target="_blank"
            rel="noopener noreferrer"
            class="account-dashboard-button account-dashboard-button--secondary"
          >
            <AccountIcon name="host" />
            <span>Manage at host</span>
          </a>
        )}
      </div>
    </div>
  );
}

function DashboardSection(
  { id, eyebrow, title, icon, description, badge, children }: {
    id: string;
    eyebrow: string;
    title: string;
    icon: AccountIconName;
    description: string;
    badge?: string;
    children: ComponentChildren;
  },
) {
  return (
    <section id={id} class="glass account-dashboard-panel">
      <div class="account-dashboard-section-head">
        <div class="account-dashboard-section-title">
          <span class="account-dashboard-section-icon" aria-hidden="true">
            <AccountIcon name={icon} />
          </span>
          <div>
            <p class="text-eyebrow">{eyebrow}</p>
            <h2>{title}</h2>
            <p>{description}</p>
          </div>
        </div>
        {badge && <span class="account-home-pill">{badge}</span>}
      </div>
      {children}
    </section>
  );
}

function HostAccountRouterPanel(
  { route, hostedBy, hasKnownHost, hostDirectoryUrl }: {
    route: HostAccountRouteState | null;
    hostedBy: string;
    hasKnownHost: boolean;
    hostDirectoryUrl: string;
  },
) {
  const accountUrl = route?.accountManagementUrl ?? null;
  return (
    <section
      id="host-controls"
      class="glass account-dashboard-panel account-dashboard-host-router"
    >
      <div class="account-dashboard-host-router-body">
        <span class="account-dashboard-host-orb" aria-hidden="true">
          <AccountIcon name="host" />
        </span>
        <div class="account-dashboard-host-router-copy">
          <p class="text-eyebrow">Account host</p>
          <h2>{hostedBy}</h2>
          {hasKnownHost
            ? (
              <p>
                Your account host keeps your account online. Use host management
                for sign-in settings, help, and account changes.
              </p>
            )
            : (
              <p>
                Atmosphere could not identify where this account is hosted yet.
                Host management will appear here when we know where the account
                lives.
              </p>
            )}
          <div class="account-dashboard-host-router-actions">
            {accountUrl
              ? (
                <a
                  href={accountUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="account-dashboard-button account-dashboard-button--primary"
                >
                  <AccountIcon name="external" />
                  <span>Host management</span>
                </a>
              )
              : (
                <span
                  class="account-dashboard-button account-dashboard-button--secondary account-dashboard-button--disabled"
                  aria-disabled="true"
                >
                  <AccountIcon name="host" />
                  <span>Host management unavailable</span>
                </span>
              )}
            <a
              href={hostDirectoryUrl}
              class="account-dashboard-button account-dashboard-button--secondary"
            >
              <AccountIcon name="directory" />
              <span>{hasKnownHost ? "View host profile" : "Browse hosts"}</span>
            </a>
          </div>
        </div>
      </div>
      {route?.manifestUrl && (
        <details class="account-dashboard-host-router-details">
          <summary>App compatibility</summary>
          <p>
            This host shares extra information for Atmosphere-compatible apps.
          </p>
        </details>
      )}
    </section>
  );
}

function ApplicationsPanel(
  { connections, showDeveloperAction }: {
    connections: LoginConnection[];
    showDeveloperAction: boolean;
  },
) {
  if (connections.length === 0) {
    return (
      <div class="account-dashboard-app-list">
        <article class="glass account-dashboard-app account-dashboard-app--empty">
          <div class="account-home-connection-row account-dashboard-app-link">
            <span class="account-home-connection-mark" aria-hidden="true">
              <AccountIcon name="apps" />
            </span>
            <span class="account-home-connection-copy">
              <strong>No connected apps yet</strong>
              <span>
                Apps opened with Continue with Atmosphere will appear here.
              </span>
            </span>
          </div>
        </article>
        {showDeveloperAction && (
          <div class="account-dashboard-panel-actions">
            <a
              href="/account/developer/apps"
              class="account-dashboard-button account-dashboard-button--secondary"
            >
              <AccountIcon name="code" />
              <span>Register an app</span>
            </a>
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <div class="account-dashboard-app-list">
        {connections.map((connection) => (
          <article
            key={connection.clientId}
            class="glass account-dashboard-app"
          >
            <a
              class="account-home-connection-row account-dashboard-app-link"
              href={connection.appUri ?? connection.clientId}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span
                class="account-home-connection-mark"
                aria-hidden="true"
              >
                {connection.logoUri
                  ? (
                    <img
                      src={connection.logoUri}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      width={40}
                      height={40}
                    />
                  )
                  : <span>{initialFor(connection.appName)}</span>}
              </span>
              <span class="account-home-connection-copy">
                <strong>{connection.appName}</strong>
                <span class="account-dashboard-app-subline">
                  {friendlyConnectionSubtitle(connection)} ·{" "}
                  {selectionCountLabel(connection.selectedCount)} · Last used
                  {" "}
                  {formatWhen(connection.lastSelectedAt)}
                </span>
              </span>
            </a>
            <form
              method="post"
              action="/account/apps/disconnect"
              class="account-dashboard-app-actions"
            >
              <input
                type="hidden"
                name="client_id"
                value={connection.clientId}
              />
              <button type="submit" class="account-dashboard-mini-button">
                Remove
              </button>
            </form>
          </article>
        ))}
      </div>
      {showDeveloperAction && (
        <div class="account-dashboard-panel-actions">
          <a
            href="/account/developer/apps"
            class="account-dashboard-button account-dashboard-button--secondary"
          >
            <AccountIcon name="code" />
            <span>Register an app</span>
          </a>
        </div>
      )}
    </>
  );
}

function RememberedAccountsPanel(
  { accounts, currentDid, currentDisplayName }: {
    accounts: RememberedAccount[];
    currentDid: string;
    currentDisplayName: string;
  },
) {
  if (accounts.length === 0) return null;

  return (
    <div class="account-dashboard-saved-list">
      {accounts.map((account) => {
        const isCurrent = account.did === currentDid;
        const name = isCurrent
          ? currentDisplayName
          : displayNameFromHandle(account.handle);
        return (
          <article
            key={account.did}
            class="glass account-dashboard-saved-account"
          >
            <div class="account-dashboard-saved-copy">
              <span class="account-dashboard-saved-avatar">
                {initialFor(account.handle)}
              </span>
              <div class="account-dashboard-saved-identity">
                <strong>{name}</strong>
                <span class="account-dashboard-saved-handle">
                  <AtmosphereHandle handle={account.handle} />
                </span>
              </div>
            </div>
            <span class="account-dashboard-saved-status">
              {isCurrent ? "Using now" : "Saved account"}
            </span>
            <div class="account-dashboard-saved-actions">
              {isCurrent
                ? (
                  <form method="post" action="/oauth/logout">
                    <button type="submit" class="account-dashboard-mini-button">
                      Sign out
                    </button>
                  </form>
                )
                : (
                  <form method="post" action="/oauth/switch">
                    <input type="hidden" name="did" value={account.did} />
                    <input type="hidden" name="next" value="/account" />
                    <button type="submit" class="account-dashboard-mini-button">
                      Switch
                    </button>
                  </form>
                )}
              <form method="post" action="/oauth/forget">
                <input type="hidden" name="did" value={account.did} />
                <button type="submit" class="account-dashboard-mini-button">
                  Remove
                </button>
              </form>
            </div>
          </article>
        );
      })}
    </div>
  );
}

type AccountIconName =
  | "apps"
  | "browser"
  | "code"
  | "directory"
  | "edit"
  | "external"
  | "host";

function AccountIcon(
  { name, class: className = "" }: { name: AccountIconName; class?: string },
) {
  const common = {
    class: className,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "1.8",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "aria-hidden": "true",
  } as const;

  switch (name) {
    case "apps":
      return (
        <svg {...common}>
          <rect x="4" y="4" width="6.5" height="6.5" rx="1.8" />
          <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.8" />
          <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.8" />
          <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.8" />
        </svg>
      );
    case "browser":
      return (
        <svg {...common}>
          <rect x="3.5" y="5" width="17" height="14" rx="3" />
          <path d="M3.5 9h17" />
          <path d="M7 7h.01" />
          <path d="M10 7h.01" />
        </svg>
      );
    case "code":
      return (
        <svg {...common}>
          <path d="m9 8-4 4 4 4" />
          <path d="m15 8 4 4-4 4" />
          <path d="m13 5-2 14" />
        </svg>
      );
    case "directory":
      return (
        <svg {...common}>
          <path d="M4 6.5h6l1.6 2H20v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
          <path d="M4 10h16" />
        </svg>
      );
    case "edit":
      return (
        <svg {...common}>
          <path d="M12 20h8" />
          <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z" />
        </svg>
      );
    case "external":
      return (
        <svg {...common}>
          <path d="M14 5h5v5" />
          <path d="m19 5-8 8" />
          <path d="M19 14v3.5A1.5 1.5 0 0 1 17.5 19h-11A1.5 1.5 0 0 1 5 17.5v-11A1.5 1.5 0 0 1 6.5 5H10" />
        </svg>
      );
    case "host":
      return (
        <svg {...common}>
          <path d="M4.5 10.5 12 4l7.5 6.5" />
          <path d="M6.5 9.5V19h11V9.5" />
          <path d="M10 19v-5h4v5" />
        </svg>
      );
  }
}

function initialFor(value: string): string {
  return value.replace(/^@/, "").trim().slice(0, 1).toUpperCase() || "A";
}

function rememberedCountLabel(count: number): string {
  if (count <= 0) return "None saved";
  return count === 1 ? "1 saved" : `${count} saved`;
}

function displayNameFromHandle(handle: string): string {
  const firstLabel = handle.replace(/^@/, "").split(".")[0]?.trim();
  if (!firstLabel) return "Saved account";
  return firstLabel
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function friendlyConnectionSubtitle(connection: LoginConnection): string {
  const label = readableHost(connection.appUri ?? connection.clientId);
  return label ? label : "Connected with Atmosphere";
}

function selectionCountLabel(count: number): string {
  const safeCount = Math.max(1, Math.round(count || 1));
  return safeCount === 1 ? "Used once" : `Used ${safeCount} times`;
}

function readableHost(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function currentBrowserLabel(headers: Headers): string {
  const browser = browserFromClientHints(headers.get("sec-ch-ua")) ??
    browserFromUserAgent(headers.get("user-agent"));
  const platform = platformFromClientHints(headers.get("sec-ch-ua-platform")) ??
    platformFromUserAgent(headers.get("user-agent"));

  if (browser && platform) return `${browser} on ${platform}`;
  if (browser) return browser;
  if (platform) return `This browser on ${platform}`;
  return "This browser";
}

function browserFromClientHints(value: string | null): string | null {
  const brands = parseClientHintBrands(value).map((brand) =>
    brand.toLowerCase()
  );
  if (brands.some((brand) => brand.includes("microsoft edge"))) {
    return "Edge";
  }
  if (brands.some((brand) => brand.includes("google chrome"))) {
    return "Chrome";
  }
  if (brands.some((brand) => brand.includes("chromium"))) return "Chromium";
  return null;
}

function parseClientHintBrands(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((part) => part.match(/"([^"]+)"/)?.[1]?.trim())
    .filter((brand): brand is string =>
      !!brand && !/not.?a.?brand/i.test(brand)
    );
}

function browserFromUserAgent(value: string | null): string | null {
  const ua = value ?? "";
  if (!ua) return null;
  if (/Edg\//.test(ua)) return "Edge";
  if (/CriOS\//.test(ua)) return "Chrome";
  if (/FxiOS\//.test(ua)) return "Firefox";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Chrome\//.test(ua) && !/Chromium\//.test(ua)) return "Chrome";
  if (/Chromium\//.test(ua)) return "Chromium";
  if (/Version\/[\d.]+.*Safari\//.test(ua)) return "Safari";
  if (/Safari\//.test(ua)) return "Safari";
  return null;
}

function platformFromClientHints(value: string | null): string | null {
  const platform = value?.replaceAll('"', "").trim();
  if (!platform) return null;
  if (/macOS/i.test(platform)) return "macOS";
  if (/iOS/i.test(platform)) return "iPhone";
  if (/Windows/i.test(platform)) return "Windows";
  if (/Android/i.test(platform)) return "Android";
  if (/Linux/i.test(platform)) return "Linux";
  return platform;
}

function platformFromUserAgent(value: string | null): string | null {
  const ua = value ?? "";
  if (!ua) return null;
  if (/iPhone|iPod/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  if (/Mac OS X|Macintosh/.test(ua)) return "macOS";
  if (/Windows NT/.test(ua)) return "Windows";
  if (/Linux/.test(ua)) return "Linux";
  return null;
}

function formatWhen(value: number): string {
  if (!value) return "recently";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "recently";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === new Date().getFullYear()
      ? undefined
      : "numeric",
  }).format(date);
}
