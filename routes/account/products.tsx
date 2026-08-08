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
  loginAppStatusLabel,
} from "../../lib/atmosphere-login.ts";
import {
  type DirectoryEntityAppLink,
  listDirectoryEntityLinksForApp,
  listDirectoryEntityLinksForHost,
} from "../../lib/directory-entity-links.ts";
import { appImageUrl } from "../../lib/media.ts";
import { loadManagedAppPortfolio } from "../../lib/managed-products.ts";
import { getValidSession, grantedScopeForSession } from "../../lib/oauth.ts";
import { hasOAuthCapabilities } from "../../lib/oauth-scopes.ts";
import { proxyAppviewPageResponse } from "../../lib/appview-client.ts";
import ContextualSignInLink from "../../islands/ContextualSignInLink.tsx";
import { oauthSigninUrl } from "../../lib/oauth-action.ts";
import OwnerManagementLink from "../../components/OwnerManagementLink.tsx";

interface ManagedProductsPageProps {
  account: ReturnType<typeof buildAccountMenuProps>;
  apps: AppListing[];
  hosts: AccountHost[];
  loginApps: LoginApp[];
  appLinks: Record<string, DirectoryEntityAppLink[]>;
  hostLinks: Record<string, DirectoryEntityAppLink[]>;
  discoveredAtstoreCount: number;
  syncUnavailable: boolean;
  appAuthorized: boolean;
  hostAuthorized: boolean;
}

export const handler = define.handlers({
  async GET(ctx) {
    const proxied = await proxyAppviewPageResponse(ctx.url, ctx.req).catch(
      (error) => appviewUnavailable(error),
    );
    if (proxied) return proxied;
    const user = ctx.state.user;
    if (!user) {
      return redirect(`/signin?next=${encodeURIComponent(ctx.url.pathname)}`);
    }
    const session = await getValidSession(user.did, { quiet: true }).catch(
      () => null,
    );
    const [portfolio, hosts, loginApps] = await Promise.all([
      loadManagedAppPortfolio({ did: user.did, pdsUrl: session?.pdsUrl }),
      listManagedAccountHosts(user.did).catch(() => []),
      listLoginAppsForOwner(user.did).catch(() => []),
    ]);
    const grantedScope = session ? grantedScopeForSession(session) : null;
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
      <ManagedProductsPage
        account={buildAccountMenuProps(ctx.state)}
        apps={portfolio.apps}
        hosts={hosts}
        loginApps={loginApps}
        appLinks={Object.fromEntries(appLinkRows)}
        hostLinks={Object.fromEntries(hostLinkRows)}
        discoveredAtstoreCount={portfolio.discoveredAtstoreCount}
        syncUnavailable={portfolio.syncUnavailable}
        appAuthorized={hasOAuthCapabilities(grantedScope, ["app"])}
        hostAuthorized={hasOAuthCapabilities(grantedScope, ["host"])}
      />,
    );
  },
});

function ManagedProductsPage(props: ManagedProductsPageProps) {
  const {
    account,
    apps,
    hosts,
    loginApps,
    appLinks,
    hostLinks,
    discoveredAtstoreCount,
    syncUnavailable,
    appAuthorized,
    hostAuthorized,
  } = props;
  return (
    <div id="page-top">
      <div class="content-layer">
        <Nav account={account} />
        <section class="account-products-section">
          <div class="container account-products-container">
            <a href="/account" class="text-link-button">
              ← Back to account home
            </a>
            <header class="account-products-head">
              <p class="text-eyebrow">Owner workspace</p>
              <h1>Managed products</h1>
              <p>
                Apps, account hosts, and universal login registrations stay
                separate publicly, while this workspace keeps everything you
                operate together.
              </p>
              <div class="account-products-counts" aria-label="Managed totals">
                <span>{countLabel(apps.length, "app")}</span>
                <span>{countLabel(hosts.length, "host")}</span>
                <span>
                  {countLabel(loginApps.length, "login registration")}
                </span>
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
                products are still shown below.
              </p>
            )}

            <section class="glass account-products-group" id="managed-apps">
              <div class="account-products-group-head">
                <div>
                  <p class="text-eyebrow">Apps</p>
                  <h2>App profiles</h2>
                  <p>
                    Public software listings, including apps discovered from
                    ATStore records owned by this account.
                  </p>
                </div>
                {appAuthorized
                  ? (
                    <a
                      class="profile-form-button-secondary"
                      href="/apps/manage?new=1"
                    >
                      Register another app
                    </a>
                  )
                  : (
                    <ContextualSignInLink
                      href={oauthSigninUrl({
                        next: "/apps/manage?new=1",
                        action: "app",
                        capabilities: ["app"],
                        name: "your app",
                      })}
                      returnTo="/apps/manage?new=1"
                      action="app"
                      capabilities={["app"]}
                      targetName="your app"
                      label="Register another app"
                      className="profile-form-button-secondary"
                      rememberedAccounts={account.rememberedAccounts}
                      initialHandle={account.user?.handle}
                    />
                  )}
              </div>
              {apps.length === 0
                ? (
                  <EmptyProductState copy="No app profiles are managed by this account yet." />
                )
                : (
                  <div class="account-products-grid">
                    {apps.map((app) => (
                      <ManagedAppCard
                        key={app.id}
                        app={app}
                        links={appLinks[app.id] ?? []}
                        ownerDid={account.user?.did ?? ""}
                        authorized={appAuthorized}
                        rememberedAccounts={account.rememberedAccounts}
                        initialHandle={account.user?.handle}
                      />
                    ))}
                  </div>
                )}
            </section>

            <section class="glass account-products-group" id="managed-hosts">
              <div class="account-products-group-head">
                <div>
                  <p class="text-eyebrow">Account hosts</p>
                  <h2>Host profiles</h2>
                  <p>
                    Operational account services. One host may serve several
                    apps, including apps run by another account.
                  </p>
                </div>
                <div class="account-products-group-actions">
                  <a
                    class="profile-form-button-secondary"
                    href="/hosts/claim"
                  >
                    Claim detected PDS
                  </a>
                </div>
              </div>
              {hosts.length === 0
                ? (
                  <EmptyProductState copy="No account hosts are managed by this account yet." />
                )
                : (
                  <div class="account-products-grid">
                    {hosts.map((host) => (
                      <ManagedHostCard
                        key={host.host}
                        host={host}
                        links={hostLinks[host.host] ?? []}
                        authorized={hostAuthorized}
                        rememberedAccounts={account.rememberedAccounts}
                        initialHandle={account.user?.handle}
                      />
                    ))}
                  </div>
                )}
            </section>

            <section
              class="glass account-products-group"
              id="login-registrations"
            >
              <div class="account-products-group-head">
                <div>
                  <p class="text-eyebrow">Universal login</p>
                  <h2>Continue with Atmosphere</h2>
                  <p>
                    Login client IDs and return URLs are operational settings,
                    not another public app profile.
                  </p>
                </div>
                <a
                  class="profile-form-button-secondary"
                  href="/account/developer/apps"
                >
                  Manage login registrations
                </a>
              </div>
              {loginApps.length > 0 && (
                <div class="account-products-login-list">
                  {loginApps.map((app) => (
                    <a
                      key={app.clientId}
                      href={loginAppDetailPath(app.clientId)}
                    >
                      <strong>{app.appName}</strong>
                      <span>{loginAppStatusLabel(app.status)}</span>
                    </a>
                  ))}
                </div>
              )}
            </section>
          </div>
        </section>
        <Footer variant="compact" />
      </div>
    </div>
  );
}

export function ManagedAppCard(
  { app, links, ownerDid, authorized, rememberedAccounts, initialHandle }: {
    app: AppListing;
    links: DirectoryEntityAppLink[];
    ownerDid: string;
    authorized: boolean;
    rememberedAccounts: Array<{ did: string; handle: string }>;
    initialHandle?: string;
  },
) {
  const icon = appImageUrl(app.iconUrl, "icon");
  const positiveLinks = links.filter((link) =>
    link.relationship !== "host_only"
  );
  const editHref = app.atstoreListingUri?.startsWith(`at://${ownerDid}/`)
    ? `/apps/manage?app=${encodeURIComponent(app.id)}`
    : app.profileDid === ownerDid || app.legacyProfileDid === ownerDid
    ? "/apps/manage"
    : null;
  return (
    <article class="account-product-card">
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
        <span>{app.atstoreListingUri ? "ATStore app" : "App profile"}</span>
        {positiveLinks.length > 0 && (
          <span>{countLabel(positiveLinks.length, "connected host")}</span>
        )}
      </div>
      {positiveLinks.length > 0 && (
        <p class="account-product-links">
          {positiveLinks.map((link) => link.hostDisplayName).join(", ")}
        </p>
      )}
      <div class="account-product-actions">
        <a href={`/apps/${encodeURIComponent(app.slug)}`}>View profile</a>
        {editHref && (
          <OwnerManagementLink
            authorized={authorized}
            kind="app"
            destinationHref={editHref}
            targetName={app.name}
            label="Edit listing"
            rememberedAccounts={rememberedAccounts}
            initialHandle={initialHandle}
          />
        )}
        <OwnerManagementLink
          authorized={authorized}
          kind="app"
          destinationHref={`/apps/manage/host?app=${
            encodeURIComponent(app.id)
          }`}
          targetName={app.name}
          label={positiveLinks.length > 0 ? "Manage hosting" : "Add a host"}
          rememberedAccounts={rememberedAccounts}
          initialHandle={initialHandle}
        />
      </div>
    </article>
  );
}

export function ManagedHostCard(
  { host, links, authorized, rememberedAccounts, initialHandle }: {
    host: AccountHost;
    links: DirectoryEntityAppLink[];
    authorized: boolean;
    rememberedAccounts: Array<{ did: string; handle: string }>;
    initialHandle?: string;
  },
) {
  const positiveLinks = links.filter((link) =>
    link.relationship !== "host_only"
  );
  return (
    <article class="account-product-card">
      <div class="account-product-card-heading">
        <HostMark host={host} />
        <div>
          <h3>{host.displayName}</h3>
          <span>{host.host}</span>
        </div>
      </div>
      <div class="account-product-badges">
        <span>Account host</span>
        {positiveLinks.length > 0 && (
          <span>{countLabel(positiveLinks.length, "connected app")}</span>
        )}
      </div>
      {positiveLinks.length > 0 && (
        <p class="account-product-links">
          {positiveLinks.map((link) => link.appName).join(", ")}
        </p>
      )}
      <div class="account-product-actions">
        <a href={`/hosts/${encodeURIComponent(host.host)}`}>View profile</a>
        <OwnerManagementLink
          authorized={authorized}
          kind="host"
          destinationHref={`/hosts/${encodeURIComponent(host.host)}/manage`}
          targetName={host.displayName}
          label="Manage host"
          rememberedAccounts={rememberedAccounts}
          initialHandle={initialHandle}
        />
        <OwnerManagementLink
          authorized={authorized}
          kind="host"
          destinationHref={`/hosts/${
            encodeURIComponent(host.host)
          }/manage/apps`}
          targetName={host.displayName}
          label="Manage apps"
          rememberedAccounts={rememberedAccounts}
          initialHandle={initialHandle}
        />
      </div>
    </article>
  );
}

function EmptyProductState({ copy }: { copy: string }) {
  return <p class="account-products-empty">{copy}</p>;
}

function countLabel(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function redirect(location: string): Response {
  return new Response(null, { status: 303, headers: { location } });
}

function appviewUnavailable(error: unknown): Response {
  console.error("[appview] managed products unavailable:", error);
  return new Response("Managed products are temporarily unavailable.", {
    status: 503,
  });
}
