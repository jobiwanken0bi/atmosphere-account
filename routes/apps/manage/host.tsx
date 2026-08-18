import { define } from "../../../utils.ts";
import Nav from "../../../components/Nav.tsx";
import Footer from "../../../components/Footer.tsx";
import ConfirmedActionForm from "../../../islands/ConfirmedActionForm.tsx";
import { buildAccountMenuProps } from "../../../lib/account-menu-props.ts";
import {
  getAccountHost,
  getAccountHostClaim,
} from "../../../lib/account-hosts.ts";
import {
  type AppListing,
  getAppListingById,
} from "../../../lib/app-directory.ts";
import {
  defineDirectoryEntityLink,
  type DirectoryEntityAppLink,
  listDirectoryEntityLinksForApp,
  removeDirectoryEntityLink,
  userControlsAppListing,
} from "../../../lib/directory-entity-links.ts";
import { proxyAppviewPageResponse } from "../../../lib/appview-client.ts";
import { enforceDurableRateLimit } from "../../../lib/rate-limit.ts";
import {
  readFormDataRequestWithLimit,
  rejectLargeRequest,
  RequestBodyTooLargeError,
} from "../../../lib/security.ts";
import {
  loadManagedAppPortfolio,
  selectManagedApp,
} from "../../../lib/managed-products.ts";
import { getSessionForCapabilities } from "../../../lib/oauth.ts";
import {
  APP_MANAGEMENT_CAPABILITIES,
  oauthSigninUrl,
} from "../../../lib/oauth-action.ts";
import {
  createAppHostLinkIntent,
  createBoundAppHostLinkIntent,
} from "../../../lib/app-host-link-intent.ts";
import {
  appHostRelationshipLabel,
  appHostRelationshipOption,
} from "../../../lib/app-host-relationship-copy.ts";
import { appManagementHref } from "../../../lib/app-management-navigation.ts";

const MAX_RELATIONSHIP_FORM_BYTES = 16_384;

export const handler = define.handlers({
  async GET(ctx) {
    const proxied = await proxyAppviewPageResponse(ctx.url, ctx.req).catch(
      (err) => appviewUnavailable(err),
    );
    if (proxied) return proxied;
    return await renderForOwner(ctx, {
      error: ctx.url.searchParams.get("linkError") === "1"
        ? "The host is claimed, but the app connection could not be completed. Connect it below."
        : null,
      success: ctx.url.searchParams.get("registered") === "1"
        ? "Host connected to this app."
        : ctx.url.searchParams.get("saved") === "1"
        ? "Host connection saved."
        : null,
    });
  },

  async POST(ctx) {
    const proxied = await proxyAppviewPageResponse(ctx.url, ctx.req).catch(
      (err) => appviewUnavailable(err),
    );
    if (proxied) return proxied;
    const limited = await enforceDurableRateLimit(ctx.req, {
      scope: "directory-entity-link-app",
      capacity: 20,
      refillMs: 60_000,
    });
    if (limited) return limited;
    const large = rejectLargeRequest(ctx.req, MAX_RELATIONSHIP_FORM_BYTES);
    if (large) return large;

    let form: FormData | null;
    try {
      form = await readFormDataRequestWithLimit(
        ctx.req,
        MAX_RELATIONSHIP_FORM_BYTES,
      );
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        return new Response("request body too large", { status: 413 });
      }
      form = null;
    }
    if (!form) {
      return await renderForOwner(ctx, {
        error: "Invalid form.",
        success: null,
      });
    }
    const selection = await loadOwnedApp(
      ctx,
      text(form.get("appListingId")),
    );
    if (selection instanceof Response) return selection;
    const app = selection.app;
    const action = text(form.get("action"));
    if (action === "remove") {
      const target = await getAppListingById(text(form.get("appListingId")))
        .catch(() => null);
      if (!target || target.id !== app.id) {
        return await renderForOwner(ctx, {
          error: "App listing not found.",
          success: null,
        });
      }
      const result = await removeDirectoryEntityLink({
        host: text(form.get("host")),
        app,
        currentDid: ctx.state.user!.did,
      });
      if (!result.ok) {
        return await renderForOwner(ctx, {
          error: result.error ?? "Could not remove connection.",
          success: null,
        });
      }
      return redirect(appHostManageHref(app.id, { saved: "1" }));
    }

    const relationship = text(form.get("relationship"));
    if (relationship !== "same_product" && relationship !== "same_operator") {
      return await renderForOwner(ctx, {
        error: "Choose how this host relates to the app.",
        success: null,
      });
    }
    let currentLinks: DirectoryEntityAppLink[];
    try {
      currentLinks = await listDirectoryEntityLinksForApp(app.id);
    } catch (error) {
      return appviewUnavailable(error);
    }
    const currentHosting = currentLinks.find((link) =>
      link.relationship !== "host_only"
    );
    if (currentHosting) {
      return await renderForOwner(ctx, {
        error:
          `${app.name} already uses ${currentHosting.hostDisplayName} for account hosting. Remove that connection before choosing another host.`,
        success: null,
      });
    }
    if (action === "start_detected") {
      const intent = await createAppHostLinkIntent({
        appListingId: app.id,
        relationship,
        appOwnerDid: ctx.state.user!.did,
      });
      return redirect(`/hosts/claim?link_intent=${encodeURIComponent(intent)}`);
    }

    const hostId = normalizeHost(text(form.get("host")));
    if (!hostId) {
      return await renderForOwner(ctx, {
        error: "Enter a listed host and choose a relationship.",
        success: null,
      });
    }
    const host = await getAccountHost(hostId).catch(() => null);
    if (!host) {
      return await renderForOwner(ctx, {
        error: "That host is not in the host directory yet.",
        success: null,
      });
    }
    const claim = await getAccountHostClaim(host.host).catch(() => null);
    if (!claim) {
      const intent = await createBoundAppHostLinkIntent({
        appListingId: app.id,
        relationship,
        appOwnerDid: ctx.state.user!.did,
        host: host.host,
      });
      return redirect(
        `/hosts/${encodeURIComponent(host.host)}/claim?${new URLSearchParams({
          link_intent: intent,
        })}`,
      );
    }
    const result = await defineDirectoryEntityLink({
      host: host.host,
      app,
      relationship,
      approvedBy: "app",
      currentDid: ctx.state.user!.did,
    });
    if (!result.ok || !result.link) {
      return await renderForOwner(ctx, {
        error: result.error ?? "Could not save the host connection.",
        success: null,
      });
    }
    return result.link.status === "pending"
      ? redirect(confirmHref(result.link.host, result.link.appListingId))
      : redirect(appHostManageHref(app.id, { saved: "1" }));
  },
});

async function renderForOwner(
  // deno-lint-ignore no-explicit-any
  ctx: any,
  message: { error: string | null; success: string | null },
) {
  const selection = await loadOwnedApp(
    ctx,
    ctx.url.searchParams.get("app"),
  );
  if (selection instanceof Response) return selection;
  const links = await listDirectoryEntityLinksForApp(selection.app.id).catch(
    () => [],
  );
  return ctx.render(
    <AppHostRelationshipsPage
      app={selection.app}
      apps={selection.apps}
      links={links}
      account={buildAccountMenuProps(ctx.state)}
      error={message.error}
      success={message.success}
    />,
  );
}

async function loadOwnedApp(
  // deno-lint-ignore no-explicit-any
  ctx: any,
  identifier?: string | null,
): Promise<{ app: AppListing; apps: AppListing[] } | Response> {
  const user = ctx.state.user;
  const next = `${ctx.url.pathname}${ctx.url.search}`;
  if (!user) {
    return redirect(oauthSigninUrl({
      next,
      action: "app",
      capabilities: APP_MANAGEMENT_CAPABILITIES,
      name: "your app",
    }));
  }
  const session = await getSessionForCapabilities(
    user.did,
    APP_MANAGEMENT_CAPABILITIES,
    {
      quiet: true,
    },
  );
  if (!session) {
    return redirect(oauthSigninUrl({
      next,
      action: "app",
      capabilities: APP_MANAGEMENT_CAPABILITIES,
      name: "your app",
    }));
  }
  const portfolio = await loadManagedAppPortfolio({
    did: user.did,
    pdsUrl: session?.pdsUrl,
  }).catch(() => ({
    apps: [],
    discoveredAtstoreCount: 0,
    syncUnavailable: true,
  }));
  if (portfolio.apps.length === 0) {
    return new Response("Publish the app listing before connecting a host.", {
      status: 404,
    });
  }
  const app = selectManagedApp(portfolio.apps, identifier);
  if (!app) return new Response("App listing not found.", { status: 404 });
  if (!userControlsAppListing(app, user.did)) {
    return new Response("This account cannot manage that app listing.", {
      status: 403,
    });
  }
  return { app, apps: portfolio.apps };
}

export function AppHostRelationshipsPage(props: {
  app: AppListing;
  apps: AppListing[];
  links: DirectoryEntityAppLink[];
  account: ReturnType<typeof buildAccountMenuProps>;
  error: string | null;
  success: string | null;
}) {
  const { app, apps, links, account, error, success } = props;
  const accountHostingLinks = links.filter((link) =>
    link.relationship !== "host_only"
  );
  const backHref = appManagementHref(app, account.user?.did ?? "");
  return (
    <div id="page-top">
      <div class="content-layer">
        <Nav account={account} active="apps" />
        <main
          id="main-content"
          class="signin-page-section host-manage-section"
        >
          <div class="container signin-page-container relationship-manage-container">
            <a href={backHref} class="text-link-button">
              ← Back to app management
            </a>
            <div class="glass signin-page-card host-manage-card">
              <p class="text-eyebrow">Host identity</p>
              <h1 class="host-claim-title">{app.name}</h1>
              <p class="text-body host-claim-copy">
                The app and host keep separate public profiles. Verified
                connections show whether the host provides account services for
                the app or the two share an operator.
              </p>
              {apps.length > 1 && (
                <form method="GET" class="managed-app-switcher">
                  <label class="profile-form-field">
                    <span class="profile-form-label">Managing app</span>
                    <select class="profile-form-input" name="app">
                      {apps.map((candidate) => (
                        <option
                          value={candidate.id}
                          selected={candidate.id === app.id}
                        >
                          {candidate.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button class="profile-form-button-secondary" type="submit">
                    Switch app
                  </button>
                </form>
              )}
              {error && (
                <p class="profile-form-status profile-form-status--error">
                  {error}
                </p>
              )}
              {success && (
                <p class="profile-form-status profile-form-status--success">
                  {success}
                </p>
              )}

              {accountHostingLinks.length > 0 && (
                <section
                  class="relationship-list"
                  aria-label="Current host connections"
                >
                  <h2>Current connections</h2>
                  {accountHostingLinks.map((link) => (
                    <article
                      class="relationship-row"
                      key={`${link.host}:${link.appListingId}`}
                    >
                      <div>
                        <strong>{link.hostDisplayName}</strong>
                        <p>
                          {appHostRelationshipLabel(link.relationship)}
                        </p>
                        <span
                          class={`relationship-status relationship-status--${link.status}`}
                        >
                          {link.status === "verified"
                            ? "Verified"
                            : "Waiting for host approval"}
                        </span>
                      </div>
                      <div class="relationship-row-actions">
                        {link.status === "pending" && (
                          <a
                            class="text-link-button"
                            href={confirmHref(link.host, link.appListingId)}
                          >
                            Continue approval
                          </a>
                        )}
                        <ConfirmedActionForm
                          action={appHostManageHref(app.id)}
                          fields={{
                            action: "remove",
                            appListingId: app.id,
                            host: link.host,
                          }}
                          label="Remove"
                          confirmation={`Remove the connection between ${app.name} and ${link.hostDisplayName}? You can connect them again later.`}
                          buttonClass="account-dashboard-mini-button account-dashboard-mini-button--danger"
                          ariaLabel={`Remove ${link.hostDisplayName} from ${app.name}`}
                        />
                      </div>
                    </article>
                  ))}
                </section>
              )}

              {accountHostingLinks.length === 0 && (
                <section class="relationship-create">
                  <div class="relationship-create-heading">
                    <div>
                      <h2>Connect account hosting</h2>
                      <p>
                        Start with a detected PDS or connect an existing claimed
                        host below.
                      </p>
                    </div>
                  </div>
                  <form
                    method="POST"
                    class="host-manage-form"
                    data-submit-once="true"
                  >
                    <input
                      type="hidden"
                      name="appListingId"
                      value={app.id}
                    />
                    <label class="profile-form-field">
                      <span class="profile-form-label">Relationship</span>
                      <select class="profile-form-input" name="relationship">
                        <option value="same_product">
                          {appHostRelationshipOption("same_product")}
                        </option>
                        <option value="same_operator">
                          {appHostRelationshipOption("same_operator")}
                        </option>
                      </select>
                    </label>
                    <div class="owner-app-relationship-actions">
                      <button
                        class="directory-register-button"
                        type="submit"
                        name="action"
                        value="start_detected"
                        data-pending-label="Finding PDS…"
                      >
                        <span data-submit-once-label>Find a detected PDS</span>
                      </button>
                    </div>
                  </form>
                  <form
                    method="POST"
                    class="host-manage-form"
                    data-submit-once="true"
                  >
                    <input type="hidden" name="action" value="define" />
                    <input
                      type="hidden"
                      name="appListingId"
                      value={app.id}
                    />
                    <label class="profile-form-field">
                      <span class="profile-form-label">Host domain</span>
                      <input
                        class="profile-form-input"
                        name="host"
                        value={app.accountHost ?? ""}
                        placeholder="eurosky.social"
                        autoComplete="off"
                        required
                      />
                    </label>
                    <label class="profile-form-field">
                      <span class="profile-form-label">Relationship</span>
                      <select class="profile-form-input" name="relationship">
                        <option value="same_product">
                          {appHostRelationshipOption("same_product")}
                        </option>
                        <option value="same_operator">
                          {appHostRelationshipOption("same_operator")}
                        </option>
                      </select>
                    </label>
                    <p class="profile-form-hint">
                      If the host is claimed by another DID, switch to that
                      account on the next screen to complete approval.
                    </p>
                    <button
                      class="directory-register-button"
                      type="submit"
                      data-pending-label="Saving connection…"
                    >
                      <span data-submit-once-label>Save connection</span>
                    </button>
                  </form>
                </section>
              )}
            </div>
          </div>
        </main>
        <Footer variant="compact" />
      </div>
    </div>
  );
}

function confirmHref(host: string, appListingId: string): string {
  return `/relationships/confirm?${new URLSearchParams({
    host,
    app: appListingId,
  })}`;
}

function appHostManageHref(
  appListingId: string,
  params: Record<string, string> = {},
): string {
  const search = new URLSearchParams({ app: appListingId, ...params });
  return `/apps/manage/host?${search}`;
}

function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/^https?:\/\//, "").replace(
    /\/$/,
    "",
  );
}

function text(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : "";
}

function redirect(location: string): Response {
  return new Response(null, { status: 303, headers: { location } });
}

function appviewUnavailable(err: unknown): Response {
  console.error("[appview] app host relationship proxy failed:", err);
  return new Response("Host connections are temporarily unavailable.", {
    status: 503,
  });
}
