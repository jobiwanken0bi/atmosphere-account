import { define } from "../../utils.ts";
import Nav from "../../components/Nav.tsx";
import Footer from "../../components/Footer.tsx";
import { buildAccountMenuProps } from "../../lib/account-menu-props.ts";
import { getAccountHost } from "../../lib/account-hosts.ts";
import { type AppListing, getAppListingById } from "../../lib/app-directory.ts";
import {
  appIdentityDids,
  approveDirectoryEntityLink,
  type DirectoryEntityLink,
  getDirectoryEntityLink,
  userControlsAppListing,
} from "../../lib/directory-entity-links.ts";
import { proxyAppviewPageResponse } from "../../lib/appview-client.ts";
import { enforceDurableRateLimit } from "../../lib/rate-limit.ts";
import { rejectLargeRequest } from "../../lib/security.ts";

const MAX_APPROVAL_FORM_BYTES = 8_192;

export const handler = define.handlers({
  async GET(ctx) {
    const proxied = await proxyAppviewPageResponse(ctx.url, ctx.req).catch(
      (err) => appviewUnavailable(err),
    );
    if (proxied) return proxied;
    if (!ctx.state.user) return redirectToSignin(ctx.url);
    const data = await loadRelationship(ctx.url);
    if (data instanceof Response) return data;
    return ctx.render(
      <RelationshipConfirmationPage
        {...data}
        account={buildAccountMenuProps(ctx.state)}
        currentDid={ctx.state.user.did}
        error={ctx.url.searchParams.get("error")}
      />,
    );
  },

  async POST(ctx) {
    const proxied = await proxyAppviewPageResponse(ctx.url, ctx.req).catch(
      (err) => appviewUnavailable(err),
    );
    if (proxied) return proxied;
    if (!ctx.state.user) return redirectToSignin(ctx.url);
    const limited = await enforceDurableRateLimit(ctx.req, {
      scope: "directory-entity-link-approve",
      capacity: 20,
      refillMs: 60_000,
    });
    if (limited) return limited;
    const large = rejectLargeRequest(ctx.req, MAX_APPROVAL_FORM_BYTES);
    if (large) return large;
    const data = await loadRelationship(ctx.url);
    if (data instanceof Response) return data;
    const result = await approveDirectoryEntityLink(
      data.link.host,
      data.app,
      ctx.state.user.did,
    );
    const target = confirmationHref(data.link.host, data.app.id);
    return redirect(
      result.ok
        ? target
        : `${target}&error=${
          encodeURIComponent(result.error ?? "Approval failed.")
        }`,
    );
  },
});

async function loadRelationship(url: URL): Promise<
  | { link: DirectoryEntityLink; app: AppListing; hostName: string }
  | Response
> {
  const host = url.searchParams.get("host")?.trim().toLowerCase() ?? "";
  const appId = url.searchParams.get("app")?.trim() ?? "";
  if (!host || !appId) {
    return new Response("Missing relationship.", { status: 400 });
  }
  const [link, app, accountHost] = await Promise.all([
    getDirectoryEntityLink(host, appId).catch(() => null),
    getAppListingById(appId).catch(() => null),
    getAccountHost(host).catch(() => null),
  ]);
  if (!link || !app || !accountHost) {
    return new Response("Relationship not found.", { status: 404 });
  }
  return { link, app, hostName: accountHost.displayName };
}

function RelationshipConfirmationPage(props: {
  link: DirectoryEntityLink;
  app: AppListing;
  hostName: string;
  account: ReturnType<typeof buildAccountMenuProps>;
  currentDid: string;
  error: string | null;
}) {
  const { link, app, hostName, account, currentDid, error } = props;
  const next = confirmationHref(link.host, app.id);
  const appDids = appIdentityDids(app);
  const hostMissing = !link.hostApprovedAt;
  const appMissing = link.relationship !== "host_only" && !link.appApprovedAt;
  const canApprove = (hostMissing && currentDid === link.hostOwnerDid) ||
    (appMissing && userControlsAppListing(app, currentDid));
  const requiredDids = new Set<string>();
  if (hostMissing) requiredDids.add(link.hostOwnerDid);
  if (appMissing) appDids.forEach((did) => requiredDids.add(did));
  requiredDids.delete(currentDid);
  const switchable = account.rememberedAccounts.filter((remembered) =>
    requiredDids.has(remembered.did)
  );
  const complete = link.status === "verified";

  return (
    <div id="page-top">
      <div class="content-layer">
        <Nav account={account} />
        <section class="signin-page-section">
          <div class="container signin-page-container relationship-confirm-container">
            <div class="glass signin-page-card relationship-confirm-card">
              <p class="text-eyebrow">Verified directory connection</p>
              <h1>{hostName} + {app.name}</h1>
              <p class="text-body">
                {relationshipDescription(link.relationship, hostName, app.name)}
              </p>
              {error && (
                <p class="profile-form-status profile-form-status--error">
                  {error}
                </p>
              )}

              <div class="relationship-proof-grid">
                <ProofState
                  label="Host owner"
                  detail={hostName}
                  approved={Boolean(link.hostApprovedAt)}
                />
                {link.relationship !== "host_only" && (
                  <ProofState
                    label="App owner"
                    detail={app.name}
                    approved={Boolean(link.appApprovedAt)}
                  />
                )}
              </div>

              {complete
                ? (
                  <div class="relationship-complete">
                    <p class="profile-form-status profile-form-status--success">
                      Both owners are verified. This connection now overrides
                      the automatic DID match.
                    </p>
                    <div class="relationship-confirm-actions">
                      <a
                        class="directory-register-button"
                        href={`/hosts/${encodeURIComponent(link.host)}`}
                      >
                        View host
                      </a>
                      <a
                        class="profile-form-button-secondary"
                        href={`/apps/${encodeURIComponent(app.slug)}`}
                      >
                        View app
                      </a>
                    </div>
                  </div>
                )
                : (
                  <div class="relationship-confirm-next">
                    {canApprove && (
                      <form method="POST">
                        <button class="directory-register-button" type="submit">
                          Approve as this account
                        </button>
                      </form>
                    )}
                    {switchable.map((remembered) => (
                      <form
                        method="POST"
                        action="/oauth/switch"
                        class="relationship-switch-form"
                      >
                        <input
                          type="hidden"
                          name="did"
                          value={remembered.did}
                        />
                        <input type="hidden" name="next" value={next} />
                        <button
                          class="profile-form-button-secondary"
                          type="submit"
                        >
                          Continue as @{remembered.handle}
                        </button>
                      </form>
                    ))}
                    {!canApprove && switchable.length === 0 && (
                      <p class="text-body">
                        Sign in with the other controlling account to finish the
                        connection. Atmosphere never accepts an unverified DID
                        from the request.
                      </p>
                    )}
                    <a
                      class="text-link-button relationship-add-account"
                      href={`/oauth/add-account?next=${
                        encodeURIComponent(next)
                      }`}
                    >
                      + Add the other account
                    </a>
                  </div>
                )}
            </div>
          </div>
        </section>
        <Footer variant="compact" />
      </div>
    </div>
  );
}

function ProofState(
  props: { label: string; detail: string; approved: boolean },
) {
  return (
    <div
      class={`relationship-proof ${
        props.approved ? "is-approved" : "is-pending"
      }`}
    >
      <span aria-hidden="true">{props.approved ? "✓" : "…"}</span>
      <div>
        <strong>{props.label}</strong>
        <p>{props.detail} · {props.approved ? "Approved" : "Pending"}</p>
      </div>
    </div>
  );
}

function relationshipDescription(
  relationship: DirectoryEntityLink["relationship"],
  host: string,
  app: string,
): string {
  if (relationship === "same_product") {
    return `${host} is the account host for the ${app} product.`;
  }
  if (relationship === "same_operator") {
    return `${host} and ${app} are separate services operated by the same organization.`;
  }
  return `${host} is a host-only listing; the inferred app link will be suppressed.`;
}

function confirmationHref(host: string, app: string): string {
  return `/relationships/confirm?${new URLSearchParams({ host, app })}`;
}

function redirectToSignin(url: URL): Response {
  const next = `${url.pathname}${url.search}`;
  return redirect(`/signin?next=${encodeURIComponent(next)}`);
}

function redirect(location: string): Response {
  return new Response(null, { status: 303, headers: { location } });
}

function appviewUnavailable(err: unknown): Response {
  console.error("[appview] relationship confirmation proxy failed:", err);
  return new Response("Relationship approval is temporarily unavailable.", {
    status: 503,
  });
}
