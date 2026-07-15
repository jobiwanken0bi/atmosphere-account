import { define } from "../../../../utils.ts";
import Nav from "../../../../components/Nav.tsx";
import Footer from "../../../../components/Footer.tsx";
import HostMark from "../../../../components/hosts/HostMark.tsx";
import { buildAccountMenuProps } from "../../../../lib/account-menu-props.ts";
import {
  type AccountHost,
  getAccountHost,
  getAccountHostClaim,
} from "../../../../lib/account-hosts.ts";
import {
  type AppListing,
  getAppListingById,
  getAppListingByIdentifier,
  getVisibleAppListingByAccountDid,
} from "../../../../lib/app-directory.ts";
import {
  defineDirectoryEntityLink,
  type DirectoryEntityAppLink,
  isDirectoryEntityRelationship,
  listDirectoryEntityLinksForHost,
  removeDirectoryEntityLink,
} from "../../../../lib/directory-entity-links.ts";
import { appHrefForHost } from "../../../../lib/directory-identity-links.ts";
import { proxyAppviewPageResponse } from "../../../../lib/appview-client.ts";
import { enforceDurableRateLimit } from "../../../../lib/rate-limit.ts";
import { rejectLargeRequest } from "../../../../lib/security.ts";

const MAX_RELATIONSHIP_FORM_BYTES = 16_384;

export const handler = define.handlers({
  async GET(ctx) {
    const proxied = await proxyAppviewPageResponse(ctx.url, ctx.req).catch(
      (err) => appviewUnavailable(err),
    );
    if (proxied) return proxied;
    return await renderForOwner(ctx, {
      success: ctx.url.searchParams.get("saved") === "1"
        ? "App connection saved."
        : null,
      error: null,
    });
  },

  async POST(ctx) {
    const proxied = await proxyAppviewPageResponse(ctx.url, ctx.req).catch(
      (err) => appviewUnavailable(err),
    );
    if (proxied) return proxied;
    const limited = await enforceDurableRateLimit(ctx.req, {
      scope: "directory-entity-link-host",
      capacity: 20,
      refillMs: 60_000,
    });
    if (limited) return limited;
    const large = rejectLargeRequest(ctx.req, MAX_RELATIONSHIP_FORM_BYTES);
    if (large) return large;

    const host = await loadOwnedHost(ctx);
    if (host instanceof Response) return host;
    const form = await ctx.req.formData().catch(() => null);
    if (!form) {
      return await renderForOwner(ctx, {
        error: "Invalid form.",
        success: null,
      });
    }
    const action = text(form.get("action"));

    if (action === "remove") {
      const app = await getAppListingById(text(form.get("appListingId"))).catch(
        () => null,
      );
      if (!app) {
        return await renderForOwner(ctx, {
          error: "App listing not found.",
          success: null,
        });
      }
      const result = await removeDirectoryEntityLink({
        host: host.host,
        app,
        currentDid: ctx.state.user!.did,
      });
      if (!result.ok) {
        return await renderForOwner(ctx, {
          error: result.error ?? "Could not remove connection.",
          success: null,
        });
      }
      return redirect(
        `/hosts/${encodeURIComponent(host.host)}/manage/apps?saved=1`,
      );
    }

    const relationship = text(form.get("relationship"));
    const identifier = text(form.get("appIdentifier"));
    if (!isDirectoryEntityRelationship(relationship) || !identifier) {
      return await renderForOwner(ctx, {
        error: "Choose a relationship and enter the app name, handle, or URL.",
        success: null,
      });
    }
    const app = await getAppListingByIdentifier(identifier, {
      syncLegacy: false,
    }).catch(() => null);
    if (!app) {
      return await renderForOwner(ctx, {
        error: "No app listing matched that name, handle, or URL.",
        success: null,
      });
    }
    if (relationship === "host_only" && !appHrefForHost(host, app)) {
      return await renderForOwner(ctx, {
        error:
          "Host-only can only override the app currently inferred from this host's DID.",
        success: null,
      });
    }
    const result = await defineDirectoryEntityLink({
      host: host.host,
      app,
      relationship,
      approvedBy: "host",
      currentDid: ctx.state.user!.did,
    });
    if (!result.ok || !result.link) {
      return await renderForOwner(ctx, {
        error: result.error ?? "Could not save the app connection.",
        success: null,
      });
    }
    return result.link.status === "pending"
      ? redirect(confirmHref(result.link.host, result.link.appListingId))
      : redirect(`/hosts/${encodeURIComponent(host.host)}/manage/apps?saved=1`);
  },
});

async function renderForOwner(
  // deno-lint-ignore no-explicit-any
  ctx: any,
  message: { error: string | null; success: string | null },
) {
  const host = await loadOwnedHost(ctx);
  if (host instanceof Response) return host;
  const [links, inferredApp] = await Promise.all([
    listDirectoryEntityLinksForHost(host.host).catch(() => []),
    host.profileDid
      ? getVisibleAppListingByAccountDid(host.profileDid, { syncLegacy: false })
        .catch(() => null)
      : Promise.resolve(null),
  ]);
  return ctx.render(
    <HostAppRelationshipsPage
      host={host}
      links={links}
      inferredApp={inferredApp}
      account={buildAccountMenuProps(ctx.state)}
      error={message.error}
      success={message.success}
    />,
  );
}

async function loadOwnedHost(ctx: {
  params: Record<string, string>;
  url: URL;
  state: { user: { did: string; handle: string } | null };
}): Promise<AccountHost | Response> {
  const hostId = decodeURIComponent(ctx.params.host).trim().toLowerCase();
  const host = await getAccountHost(hostId).catch(() => null);
  if (!host) return new Response("Host not found.", { status: 404 });
  if (!ctx.state.user) {
    return redirect(`/signin?next=${encodeURIComponent(ctx.url.pathname)}`);
  }
  const claim = await getAccountHostClaim(host.host).catch(() => null);
  if (!claim || claim.claimantDid !== ctx.state.user.did) {
    return new Response(
      "Only the verified host owner can manage app connections.",
      { status: 403 },
    );
  }
  return host;
}

function HostAppRelationshipsPage(props: {
  host: AccountHost;
  links: DirectoryEntityAppLink[];
  inferredApp: AppListing | null;
  account: ReturnType<typeof buildAccountMenuProps>;
  error: string | null;
  success: string | null;
}) {
  const { host, links, inferredApp, account, error, success } = props;
  return (
    <div id="page-top">
      <div class="content-layer">
        <Nav account={account} active="hosts" />
        <section class="signin-page-section host-manage-section">
          <div class="container signin-page-container relationship-manage-container">
            <a
              href={`/hosts/${encodeURIComponent(host.host)}/manage`}
              class="text-link-button"
            >
              ← Back to host management
            </a>
            <div class="glass signin-page-card host-manage-card">
              <div class="host-claim-heading">
                <HostMark host={host} />
                <div>
                  <p class="text-eyebrow">Apps and host identity</p>
                  <h1 class="host-claim-title">{host.displayName}</h1>
                  <p class="text-body">{host.host}</p>
                </div>
              </div>
              <p class="text-body host-claim-copy">
                Explicit connections take precedence over Atmosphere's DID-based
                fallback. If the app uses a different owner account, both
                accounts must approve it.
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
                  aria-label="Current app connections"
                >
                  <h2>Current connections</h2>
                  {links.map((link) => (
                    <article
                      class="relationship-row"
                      key={`${link.host}:${link.appListingId}`}
                    >
                      <div>
                        <strong>{link.appName}</strong>
                        <p>{relationshipLabel(link.relationship)}</p>
                        <span
                          class={`relationship-status relationship-status--${link.status}`}
                        >
                          {link.status === "verified"
                            ? "Verified"
                            : "Waiting for other account"}
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
                          <input
                            type="hidden"
                            name="appListingId"
                            value={link.appListingId}
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
                    <span class="profile-form-label">App</span>
                    <input
                      class="profile-form-input"
                      name="appIdentifier"
                      value={inferredApp?.slug ?? ""}
                      placeholder="App name, handle, or URL"
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
                        Same operator — we run this separate app
                      </option>
                      <option value="host_only">
                        Host only — suppress the inferred App badge
                      </option>
                    </select>
                  </label>
                  <p class="profile-form-hint">
                    Same product and same operator require the app account's
                    approval when its DID differs from the host owner.
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

function relationshipLabel(
  value: DirectoryEntityAppLink["relationship"],
): string {
  if (value === "same_product") return "Same product";
  if (value === "same_operator") return "Same organization, separate app";
  return "Host-only override";
}

function confirmHref(host: string, appListingId: string): string {
  return `/relationships/confirm?${new URLSearchParams({
    host,
    app: appListingId,
  })}`;
}

function text(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim() : "";
}

function redirect(location: string): Response {
  return new Response(null, { status: 303, headers: { location } });
}

function appviewUnavailable(err: unknown): Response {
  console.error("[appview] host app relationship proxy failed:", err);
  return new Response("App connections are temporarily unavailable.", {
    status: 503,
  });
}
