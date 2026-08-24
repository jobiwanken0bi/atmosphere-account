import Nav from "../../components/Nav.tsx";
import Footer from "../../components/Footer.tsx";
import HostMark from "../../components/hosts/HostMark.tsx";
import { define } from "../../utils.ts";
import { buildAccountMenuProps } from "../../lib/account-menu-props.ts";
import {
  type AccountHost,
  listManagedAccountHosts,
} from "../../lib/account-hosts.ts";
import type { AppListing } from "../../lib/app-directory.ts";
import {
  listLoginAppsForOwner,
  type LoginApp,
  loginAppDetailPath,
} from "../../lib/atmosphere-login.ts";
import {
  loginEnvironmentLabel,
  loginEnvironmentStatusLabel,
} from "../../lib/login-environment-display.ts";
import {
  type DirectoryEntityAppLink,
  listDirectoryEntityLinksForApp,
  listDirectoryEntityLinksForHost,
} from "../../lib/directory-entity-links.ts";
import { appImageUrl } from "../../lib/media.ts";
import { loadManagedAppPortfolio } from "../../lib/managed-products.ts";
import { loadSession } from "../../lib/oauth.ts";
import { proxyAppviewPageResponse } from "../../lib/appview-client.ts";

interface AppsHostsPageProps {
  account: ReturnType<typeof buildAccountMenuProps>;
  apps: AppListing[];
  hosts: AccountHost[];
  loginApps: LoginApp[];
  appLinks: Record<string, DirectoryEntityAppLink[]>;
  hostLinks: Record<string, DirectoryEntityAppLink[]>;
  discoveredAtstoreCount: number;
  syncUnavailable: boolean;
}

export const handler = define.handlers({
  async GET(ctx) {
    const proxied = await proxyAppviewPageResponse(ctx.url, ctx.req).catch(
      (error) => appviewUnavailable(error),
    );
    if (proxied) return proxied;
    const user = ctx.state.user;
    if (!user) return redirectToSignin(ctx.url);
    const session = await loadSession(user.did).catch(() => null);
    let portfolio: Awaited<ReturnType<typeof loadManagedAppPortfolio>>;
    let hosts: AccountHost[];
    try {
      [portfolio, hosts] = await Promise.all([
        loadManagedAppPortfolio({ did: user.did, pdsUrl: session?.pdsUrl }),
        listManagedAccountHosts(user.did),
      ]);
    } catch (error) {
      return appviewUnavailable(error);
    }
    const accessRedirect = appsHostsAccessRedirect(portfolio.apps, hosts);
    if (accessRedirect) return redirect(accessRedirect);
    const loginApps = portfolio.apps.length === 1
      ? await listLoginAppsForOwner(user.did).catch(() => [])
      : [];
    const [appLinkRows, hostLinkRows] = await Promise.all([
      Promise.all(portfolio.apps.map(async (app) => {
        const links = await listDirectoryEntityLinksForApp(app.id).catch(
          () => [],
        );
        return [app.id, links] as [string, DirectoryEntityAppLink[]];
      })),
      Promise.all(hosts.map(async (host) => {
        const links = await listDirectoryEntityLinksForHost(host.host).catch(
          () => [],
        );
        return [host.host, links] as [string, DirectoryEntityAppLink[]];
      })),
    ]);
    return ctx.render(
      <AppsHostsPage
        account={{
          ...buildAccountMenuProps(ctx.state),
          hasManagedAppProfile: portfolio.apps.length > 0,
          hasManagedHostProfiles: hosts.length > 0,
          hasManagedProfiles: true,
        }}
        apps={portfolio.apps}
        hosts={hosts}
        loginApps={loginApps}
        appLinks={Object.fromEntries(appLinkRows)}
        hostLinks={Object.fromEntries(hostLinkRows)}
        discoveredAtstoreCount={portfolio.discoveredAtstoreCount}
        syncUnavailable={portfolio.syncUnavailable}
      />,
    );
  },
});

export function AppsHostsPage(props: AppsHostsPageProps) {
  const {
    account,
    apps,
    hosts,
    loginApps,
    appLinks,
    hostLinks,
    discoveredAtstoreCount,
    syncUnavailable,
  } = props;
  return (
    <div id="page-top">
      <div class="content-layer">
        <Nav account={account} />
        <main class="account-products-section" id="main-content">
          <div class="container account-products-container">
            <a href="/account" class="text-link-button">
              ← Back to account home
            </a>
            <header class="account-products-head">
              <p class="text-eyebrow">Account management</p>
              <h1>Manage listings</h1>
              <p>{appsHostsIntro(apps.length, hosts.length)}</p>
              <div
                class="account-products-counts"
                aria-label="App and host totals"
              >
                <span>{countLabel(apps.length, "app")}</span>
                <span>{countLabel(hosts.length, "host")}</span>
              </div>
            </header>

            {discoveredAtstoreCount > 0 && (
              <p class="profile-form-status profile-form-status--success">
                Synced {countLabel(discoveredAtstoreCount, "ATStore app")}{" "}
                from your AT Protocol repository.
              </p>
            )}
            {syncUnavailable && (
              <p class="profile-form-status profile-form-status--error">
                Existing ATStore apps could not be refreshed. Previously indexed
                app profiles are still shown below.
              </p>
            )}

            {apps.length > 0 && (
              <section class="glass account-products-group" id="managed-apps">
                <div class="account-products-group-head">
                  <div>
                    <p class="text-eyebrow">App</p>
                    <h2>App profile</h2>
                    <p>
                      The public profile for the app represented by this
                      account.
                    </p>
                  </div>
                </div>
                <div class="account-products-grid account-products-grid--single">
                  {apps.map((app) => (
                    <ManagedAppCard
                      key={app.id}
                      app={app}
                      links={appLinks[app.id] ?? []}
                      ownerDid={account.user?.did ?? ""}
                    />
                  ))}
                </div>
              </section>
            )}
            {apps.length > 1 && (
              <section
                class="glass account-products-group"
                id="login-registrations"
              >
                <div class="account-products-group-head">
                  <div>
                    <p class="text-eyebrow">Developer settings</p>
                    <h2>Login with Atmosphere needs one app</h2>
                    <p>
                      This legacy account has more than one app profile, so no
                      login environment can be safely assigned to a single app.
                    </p>
                  </div>
                </div>
              </section>
            )}

            {hosts.length > 0 && (
              <section class="glass account-products-group" id="managed-hosts">
                <div class="account-products-group-head">
                  <div>
                    <p class="text-eyebrow">Account hosts</p>
                    <h2>Host profiles</h2>
                    <p>
                      The public profiles for account hosts managed by this
                      account.
                    </p>
                  </div>
                </div>
                <div class="account-products-grid account-products-grid--single">
                  {hosts.map((host) => (
                    <ManagedHostCard
                      key={host.host}
                      host={host}
                      links={hostLinks[host.host] ?? []}
                    />
                  ))}
                </div>
              </section>
            )}

            {apps.length === 1 && (
              <section
                class="glass account-products-group"
                id="login-registrations"
              >
                <div class="account-products-group-head">
                  <div>
                    <p class="text-eyebrow">Developer settings</p>
                    <h2>Login with Atmosphere</h2>
                    <p>
                      Manage client IDs and exact return URLs for this app.
                    </p>
                  </div>
                  <a
                    class="profile-form-button-secondary"
                    href="/account/developer/apps"
                  >
                    Manage developer settings
                  </a>
                </div>
                {loginApps.length > 0 && (
                  <div class="account-products-login-list">
                    {loginApps.map((app) => (
                      <a
                        key={app.clientId}
                        href={loginAppDetailPath(app.clientId)}
                      >
                        <strong>{loginEnvironmentLabel(app.clientId)}</strong>
                        <span>{loginEnvironmentStatusLabel(app.status)}</span>
                      </a>
                    ))}
                  </div>
                )}
              </section>
            )}
          </div>
        </main>
        <Footer variant="compact" />
      </div>
    </div>
  );
}

export function ManagedAppCard(
  { app, links, ownerDid }: {
    app: AppListing;
    links: DirectoryEntityAppLink[];
    ownerDid: string;
  },
) {
  const icon = appImageUrl(app.iconUrl, "icon");
  const positiveLinks = links.filter((link) =>
    link.relationship !== "host_only"
  );
  const connectedLinks = positiveLinks.filter((link) =>
    link.status === "verified"
  );
  const pendingLinks = positiveLinks.filter((link) =>
    link.status === "pending"
  );
  const editHref = app.atstoreListingUri?.startsWith(`at://${ownerDid}/`)
    ? `/apps/manage?app=${encodeURIComponent(app.id)}`
    : app.profileDid === ownerDid || app.legacyProfileDid === ownerDid
    ? "/apps/manage"
    : null;
  return (
    <article class="account-product-card account-product-card--single-profile">
      <div class="account-product-card-content">
        <div class="account-product-card-heading">
          <span class="account-product-icon" aria-hidden="true">
            {icon
              ? <img src={icon} alt="" />
              : app.name.slice(0, 1).toUpperCase()}
          </span>
          <div>
            <h3>{app.name}</h3>
            <span>{app.slug}</span>
          </div>
        </div>
        <div class="account-product-badges">
          <span>
            {app.atstoreListingUri ? "Shows on ATStore" : "App profile"}
          </span>
          {connectedLinks.length > 0 && (
            <span>{countLabel(connectedLinks.length, "connected host")}</span>
          )}
          {pendingLinks.length > 0 && (
            <span>{countLabel(pendingLinks.length, "pending host")}</span>
          )}
        </div>
        {connectedLinks.length > 0 && (
          <p class="account-product-links">
            {connectedLinks.map((link) => link.hostDisplayName).join(", ")}
          </p>
        )}
        {pendingLinks.length > 0 && (
          <p class="account-product-links">
            Pending:{" "}
            {pendingLinks.map((link) => link.hostDisplayName).join(", ")}
          </p>
        )}
      </div>
      <div class="account-product-actions">
        <a href={`/apps/${encodeURIComponent(app.slug)}`}>View profile</a>
        {editHref && (
          <a class="account-product-action--primary" href={editHref}>
            Edit listing
          </a>
        )}
        <a href={`/apps/manage/host?app=${encodeURIComponent(app.id)}`}>
          {positiveLinks.length > 0 ? "Manage hosting" : "Add a host"}
        </a>
      </div>
    </article>
  );
}

export function ManagedHostCard(
  { host, links }: { host: AccountHost; links: DirectoryEntityAppLink[] },
) {
  const positiveLinks = links.filter((link) =>
    link.relationship !== "host_only"
  );
  const connectedLinks = positiveLinks.filter((link) =>
    link.status === "verified"
  );
  const pendingLinks = positiveLinks.filter((link) =>
    link.status === "pending"
  );
  return (
    <article class="account-product-card account-product-card--single-profile">
      <div class="account-product-card-content">
        <div class="account-product-card-heading">
          <HostMark host={host} />
          <div>
            <h3>{host.displayName}</h3>
            <span>{host.host}</span>
          </div>
        </div>
        <div class="account-product-badges">
          <span>Account host</span>
          {connectedLinks.length > 0 && (
            <span>{countLabel(connectedLinks.length, "connected app")}</span>
          )}
          {pendingLinks.length > 0 && (
            <span>{countLabel(pendingLinks.length, "pending app")}</span>
          )}
        </div>
        {connectedLinks.length > 0 && (
          <p class="account-product-links">
            {connectedLinks.map((link) => link.appName).join(", ")}
          </p>
        )}
        {pendingLinks.length > 0 && (
          <p class="account-product-links">
            Pending: {pendingLinks.map((link) => link.appName).join(", ")}
          </p>
        )}
      </div>
      <div class="account-product-actions">
        <a href={`/hosts/${encodeURIComponent(host.host)}`}>View profile</a>
        <a
          class="account-product-action--primary"
          href={`/hosts/${encodeURIComponent(host.host)}/manage`}
        >
          Manage host
        </a>
        <a href={`/hosts/${encodeURIComponent(host.host)}/manage/apps`}>
          Manage apps
        </a>
      </div>
    </article>
  );
}

export function appsHostsIntro(appCount: number, hostCount: number): string {
  if (appCount > 0 && hostCount > 0) {
    return "Manage this account’s app and host profiles, their connections, and developer settings.";
  }
  if (appCount > 0) {
    return "Manage this account’s app profile, connected hosts, and developer settings.";
  }
  return "Manage the host profiles operated by this account and their app connections.";
}

export function hasManagedProfiles(
  apps: AppListing[],
  hosts: AccountHost[],
): boolean {
  return apps.length > 0 || hosts.length > 0;
}

export function appsHostsAccessRedirect(
  apps: AppListing[],
  hosts: AccountHost[],
): "/account" | null {
  return hasManagedProfiles(apps, hosts) ? null : "/account";
}

function countLabel(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

export function redirect(location: string): Response {
  return new Response(null, {
    status: 303,
    headers: { location, "cache-control": "no-store" },
  });
}

function redirectToSignin(url: URL): Response {
  const returnTo = `${url.pathname}${url.search}`;
  return redirect(`/signin?next=${encodeURIComponent(returnTo)}`);
}

function appviewUnavailable(_error: unknown): Response {
  console.error("[appview] apps and hosts unavailable");
  return new Response("Managed listings are temporarily unavailable.", {
    status: 503,
    headers: { "cache-control": "no-store" },
  });
}
