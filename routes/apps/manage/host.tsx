import { define } from "../../../utils.ts";
import Nav from "../../../components/Nav.tsx";
import Footer from "../../../components/Footer.tsx";
import { buildAccountMenuProps } from "../../../lib/account-menu-props.ts";
import { getEffectiveAccountType } from "../../../lib/account-types.ts";
import { getAccountHost } from "../../../lib/account-hosts.ts";
import {
  type AppListing,
  getAppListingById,
  getAppListingByIdentifier,
  getVisibleAppListingByAccountDid,
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
import { rejectLargeRequest } from "../../../lib/security.ts";

const MAX_RELATIONSHIP_FORM_BYTES = 16_384;

export const handler = define.handlers({
  async GET(ctx) {
    const proxied = await proxyAppviewPageResponse(ctx.url, ctx.req).catch(
      (err) => appviewUnavailable(err),
    );
    if (proxied) return proxied;
    return await renderForOwner(ctx, {
      error: null,
      success: ctx.url.searchParams.get("saved") === "1"
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

    const app = await loadOwnedApp(ctx);
    if (app instanceof Response) return app;
    const form = await ctx.req.formData().catch(() => null);
    if (!form) {
      return await renderForOwner(ctx, {
        error: "Invalid form.",
        success: null,
      });
    }
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
      return redirect("/apps/manage/host?saved=1");
    }

    const hostId = normalizeHost(text(form.get("host")));
    const relationship = text(form.get("relationship"));
    if (
      !hostId ||
      (relationship !== "same_product" && relationship !== "same_operator")
    ) {
      return await renderForOwner(ctx, {
        error: "Enter a listed host and choose a relationship.",
        success: null,
      });
    }
    const host = await getAccountHost(hostId).catch(() => null);
    if (!host) {
      return await renderForOwner(ctx, {
        error: "That host is not in the Atmosphere host directory yet.",
        success: null,
      });
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
      : redirect("/apps/manage/host?saved=1");
  },
});

async function renderForOwner(
  // deno-lint-ignore no-explicit-any
  ctx: any,
  message: { error: string | null; success: string | null },
) {
  const app = await loadOwnedApp(ctx);
  if (app instanceof Response) return app;
  const links = await listDirectoryEntityLinksForApp(app.id).catch(() => []);
  return ctx.render(
    <AppHostRelationshipsPage
      app={app}
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
): Promise<AppListing | Response> {
  const user = ctx.state.user;
  if (!user) return redirect(`/apps/create?intent=project`);
  const accountType = await getEffectiveAccountType(user.did).catch(() => null);
  if (accountType !== "project") return redirect("/account?upgrade=app");
  const app =
    await getVisibleAppListingByAccountDid(user.did, { syncLegacy: false })
      .catch(() => null) ??
      await getAppListingByIdentifier(user.handle, { syncLegacy: false }).catch(
        () => null,
      );
  if (!app) {
    return new Response("Publish the app listing before connecting a host.", {
      status: 404,
    });
  }
  if (!userControlsAppListing(app, user.did)) {
    return new Response("This account cannot manage that app listing.", {
      status: 403,
    });
  }
  return app;
}

function AppHostRelationshipsPage(props: {
  app: AppListing;
  links: DirectoryEntityAppLink[];
  account: ReturnType<typeof buildAccountMenuProps>;
  error: string | null;
  success: string | null;
}) {
  const { app, links, account, error, success } = props;
  return (
    <div id="page-top">
      <div class="content-layer">
        <Nav account={account} active="apps" />
        <section class="signin-page-section host-manage-section">
          <div class="container signin-page-container relationship-manage-container">
            <a href="/apps/manage" class="text-link-button">
              ← Back to app management
            </a>
            <div class="glass signin-page-card host-manage-card">
              <p class="text-eyebrow">Host identity</p>
              <h1 class="host-claim-title">{app.name}</h1>
              <p class="text-body host-claim-copy">
                Connect this app to a host run as part of the product or by the
                same organization. Explicit, verified connections override
                Atmosphere's DID-based fallback.
              </p>
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

              {links.length > 0 && (
                <section
                  class="relationship-list"
                  aria-label="Current host connections"
                >
                  <h2>Current connections</h2>
                  {links.map((link) => (
                    <article
                      class="relationship-row"
                      key={`${link.host}:${link.appListingId}`}
                    >
                      <div>
                        <strong>{link.hostDisplayName}</strong>
                        <p>
                          {link.relationship === "same_product"
                            ? "Same product"
                            : "Same organization, separate product"}
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
                        <form method="POST">
                          <input type="hidden" name="action" value="remove" />
                          <input type="hidden" name="host" value={link.host} />
                          <input
                            type="hidden"
                            name="appListingId"
                            value={app.id}
                          />
                          <button
                            class="profile-form-button-secondary"
                            type="submit"
                          >
                            Remove
                          </button>
                        </form>
                      </div>
                    </article>
                  ))}
                </section>
              )}

              <section class="relationship-create">
                <h2>Define a connection</h2>
                <form method="POST" class="host-manage-form">
                  <input type="hidden" name="action" value="define" />
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
                        Same product — this host is part of the app
                      </option>
                      <option value="same_operator">
                        Same operator — we also run this host
                      </option>
                    </select>
                  </label>
                  <p class="profile-form-hint">
                    If the host is claimed by another DID, switch to that
                    account on the next screen to complete approval.
                  </p>
                  <button class="directory-register-button" type="submit">
                    Save connection
                  </button>
                </form>
              </section>
            </div>
          </div>
        </section>
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
