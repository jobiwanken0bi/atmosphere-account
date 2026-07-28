import { define } from "../../../utils.ts";
import Nav from "../../../components/Nav.tsx";
import Footer from "../../../components/Footer.tsx";
import AtmosphereHandle from "../../../components/AtmosphereHandle.tsx";
import HostMark from "../../../components/hosts/HostMark.tsx";
import { buildAccountMenuProps } from "../../../lib/account-menu-props.ts";
import { proxyAppviewPageResponse } from "../../../lib/appview-client.ts";
import {
  type AccountHost,
  type AccountHostClaim,
  type AccountHostClaimAuthority,
  accountHostClaimAuthorityMatchesUser,
  claimAccountHost,
  getAccountHost,
  getAccountHostClaim,
  resolveAccountHostClaimAuthority,
} from "../../../lib/account-hosts.ts";
import {
  hostClaimProofMessage,
  verifyHostClaimDomainProof,
} from "../../../lib/host-claim-proof.ts";
import { enforceDurableRateLimit } from "../../../lib/rate-limit.ts";
import {
  type AppListing,
  getAppListingById,
} from "../../../lib/app-directory.ts";
import {
  defineDirectoryEntityLink,
  userControlsAppListing,
} from "../../../lib/directory-entity-links.ts";

type ClaimState =
  | "ready"
  | "claimed-by-you"
  | "claimed-by-other"
  | "not-authorized"
  | "not-claimable"
  | "error";

interface ClaimPageProps {
  host: AccountHost | null;
  claim: AccountHostClaim | null;
  authority: AccountHostClaimAuthority | null;
  state: ClaimState;
  activeHandle: string | null;
  error: string | null;
  account: ReturnType<typeof buildAccountMenuProps>;
  linkContext: HostClaimLinkContext | null;
}

interface HostClaimLinkContext {
  app: AppListing;
  relationship: "same_product" | "same_operator";
}

export const handler = define.handlers({
  async GET(ctx) {
    const proxied = await proxyAppviewPageResponse(ctx.url, ctx.req).catch(
      (err) => appviewUnavailable("host claim page", err),
    );
    if (proxied) return proxied;

    const limited = await enforceDurableRateLimit(ctx.req, {
      scope: "host-claim",
      capacity: 10,
      refillMs: 60_000,
    });
    if (limited) return limited;

    const hostId = decodeURIComponent(ctx.params.host).toLowerCase();
    const host = await getAccountHost(hostId).catch(() => null);
    if (!host) {
      return ctx.render(
        <HostClaimPage
          host={null}
          claim={null}
          authority={null}
          state="error"
          activeHandle={ctx.state.user?.handle ?? null}
          error="Host not found."
          account={buildAccountMenuProps(ctx.state)}
          linkContext={null}
        />,
        { status: 404 },
      );
    }
    if (!ctx.state.user) {
      return redirectToSignin(host.host, ctx.url);
    }
    const linkContext = await loadLinkContext(ctx.state.user, ctx.url);
    const page = await buildClaimPageProps(
      host,
      ctx.state.user,
      buildAccountMenuProps(ctx.state),
      linkContext,
    );
    return ctx.render(<HostClaimPage {...page} />);
  },

  async POST(ctx) {
    const proxied = await proxyAppviewPageResponse(ctx.url, ctx.req).catch(
      (err) => appviewUnavailable("host claim update", err),
    );
    if (proxied) return proxied;

    const hostId = decodeURIComponent(ctx.params.host).toLowerCase();
    const host = await getAccountHost(hostId).catch(() => null);
    if (!host) {
      return new Response("Host not found.", { status: 404 });
    }
    if (!ctx.state.user) {
      return redirectToSignin(host.host, ctx.url);
    }
    const linkContext = await loadLinkContext(ctx.state.user, ctx.url);
    const result = await claimAccountHost(host.host, ctx.state.user);
    if (result.ok) {
      if (linkContext) {
        const linked = await defineDirectoryEntityLink({
          host: result.host.host,
          app: linkContext.app,
          relationship: linkContext.relationship,
          approvedBy: "app",
          currentDid: ctx.state.user.did,
        }).catch(() => ({ ok: false as const }));
        const search = new URLSearchParams({ app: linkContext.app.id });
        search.set(linked.ok ? "saved" : "linkError", "1");
        return new Response(null, {
          status: 303,
          headers: { location: `/apps/manage/host?${search}` },
        });
      }
      return new Response(null, {
        status: 303,
        headers: {
          location: `/hosts/${encodeURIComponent(result.host.host)}?claimed=1`,
        },
      });
    }
    const page = await buildClaimPageProps(
      result.host ?? host,
      ctx.state.user,
      buildAccountMenuProps(ctx.state),
      linkContext,
      result.reason === "already_claimed"
        ? "This host has already been claimed."
        : result.reason === "not_authorized"
        ? hostClaimProofMessage()
        : "This host is not ready to be claimed yet.",
    );
    return ctx.render(<HostClaimPage {...page} />, { status: 403 });
  },
});

function appviewUnavailable(scope: string, err: unknown): Response {
  console.error(`[appview] ${scope} proxy failed:`, err);
  return new Response("Host claiming is temporarily unavailable.", {
    status: 503,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
    },
  });
}

async function buildClaimPageProps(
  host: AccountHost,
  user: { did: string; handle: string },
  account: ReturnType<typeof buildAccountMenuProps>,
  linkContext: HostClaimLinkContext | null,
  error: string | null = null,
): Promise<ClaimPageProps> {
  const [claim, authority] = await Promise.all([
    getAccountHostClaim(host.host).catch(() => null),
    resolveAccountHostClaimAuthority(host).catch(() => null),
  ]);
  let state: ClaimState = "not-claimable";
  if (claim?.claimantDid === user.did) {
    state = "claimed-by-you";
  } else if (claim) {
    state = "claimed-by-other";
  } else if (
    authority && accountHostClaimAuthorityMatchesUser(authority, user)
  ) {
    const proof = await verifyHostClaimDomainProof(host, user);
    state = proof.ok ? "ready" : "not-claimable";
  } else if (authority) {
    state = "not-authorized";
  }
  return {
    host,
    claim,
    authority,
    state,
    activeHandle: user.handle,
    error,
    account,
    linkContext,
  };
}

function redirectToSignin(host: string, url: URL): Response {
  const next = `/hosts/${encodeURIComponent(host)}/claim${url.search}`;
  const signin = new URL("/signin", url.origin);
  signin.searchParams.set("next", next);
  return new Response(null, {
    status: 303,
    headers: { location: `${signin.pathname}${signin.search}` },
  });
}

function HostClaimPage(props: ClaimPageProps) {
  const {
    host,
    claim,
    authority,
    state,
    activeHandle,
    error,
    account,
    linkContext,
  } = props;
  return (
    <div id="page-top">
      <div class="content-layer">
        <Nav account={account} active="hosts" />
        <section class="signin-page-section host-claim-section">
          <div class="container signin-page-container">
            <a
              href={host ? `/hosts/${encodeURIComponent(host.host)}` : "/hosts"}
              class="text-link-button"
            >
              Back to host
            </a>
            <div class="glass signin-page-card host-claim-card">
              {host
                ? (
                  <>
                    <div class="host-claim-heading">
                      <HostMark host={host} />
                      <div>
                        <p class="text-eyebrow">Claim account host</p>
                        <h1 class="host-claim-title">{host.displayName}</h1>
                        <p class="profile-hero-handle">
                          {host.profileHandle
                            ? <AtmosphereHandle handle={host.profileHandle} />
                            : host.host}
                        </p>
                      </div>
                    </div>
                    <p class="text-body host-claim-copy">
                      {linkContext
                        ? `Claiming this host proves control and connects it to ${linkContext.app.name} in the same flow.`
                        : "Claiming a host proves control of the ATProto account tied to this listing. Once claimed, that account can manage the host details here."}
                    </p>
                    <ClaimBody
                      host={host}
                      claim={claim}
                      authority={authority}
                      state={state}
                      activeHandle={activeHandle}
                      error={error}
                      linkContext={linkContext}
                    />
                  </>
                )
                : (
                  <>
                    <p class="text-eyebrow">Claim account host</p>
                    <h1 class="host-claim-title">Host not found</h1>
                    <p class="text-body host-claim-copy">
                      This host is not listed yet.
                    </p>
                  </>
                )}
            </div>
          </div>
        </section>
        <Footer variant="compact" />
      </div>
    </div>
  );
}

function ClaimBody(
  { host, claim, authority, state, activeHandle, error, linkContext }: {
    host: AccountHost;
    claim: AccountHostClaim | null;
    authority: AccountHostClaimAuthority | null;
    state: ClaimState;
    activeHandle: string | null;
    error: string | null;
    linkContext: HostClaimLinkContext | null;
  },
) {
  if (state === "claimed-by-you") {
    return (
      <div class="host-claim-panel host-claim-panel-ok">
        <p class="host-claim-panel-title">
          Claimed by <AtmosphereHandle handle={claim?.claimantHandle} />
        </p>
        <p class="text-body">
          This account is already managing {host.displayName}.
        </p>
        {linkContext && (
          <form method="POST">
            <button type="submit" class="directory-register-button">
              Connect to {linkContext.app.name}
            </button>
          </form>
        )}
      </div>
    );
  }
  if (state === "claimed-by-other") {
    return (
      <div class="host-claim-panel">
        <p class="host-claim-panel-title">Already claimed</p>
        <p class="text-body">
          This host is managed by{" "}
          <AtmosphereHandle handle={claim?.claimantHandle} />.
        </p>
      </div>
    );
  }
  if (state === "ready") {
    return (
      <form method="POST" class="host-claim-form">
        {error && (
          <p class="profile-form-status profile-form-status--error">{error}</p>
        )}
        <div class="host-claim-panel host-claim-panel-ok">
          <p class="host-claim-panel-title">
            Signed in as <AtmosphereHandle handle={activeHandle} />
          </p>
          <p class="text-body">
            This matches the host account{" "}
            <AtmosphereHandle handle={authority?.handle} />. You can claim the
            listing now.
          </p>
        </div>
        <button type="submit" class="directory-register-button">
          <span class="directory-register-button-icon" aria-hidden="true">
            +
          </span>
          <span>
            {linkContext ? "Claim and connect host" : "Claim this host"}
          </span>
        </button>
      </form>
    );
  }
  if (state === "not-authorized") {
    return (
      <div class="host-claim-panel">
        {error && (
          <p class="profile-form-status profile-form-status--error">{error}</p>
        )}
        <p class="host-claim-panel-title">
          Sign in as <AtmosphereHandle handle={authority?.handle} />
        </p>
        <p class="text-body">
          You are currently signed in as{" "}
          <AtmosphereHandle handle={activeHandle} />. This host can only be
          claimed by its linked ATProto account.
        </p>
        <a
          class="directory-register-button host-claim-secondary-action"
          href={`/oauth/add-account?next=${
            encodeURIComponent(claimPathForContext(host.host, linkContext))
          }`}
        >
          <span class="directory-register-button-icon" aria-hidden="true">
            +
          </span>
          <span>Use another account</span>
        </a>
      </div>
    );
  }
  return (
    <div class="host-claim-panel">
      {error && (
        <p class="profile-form-status profile-form-status--error">{error}</p>
      )}
      <p class="host-claim-panel-title">Manual review needed</p>
      <p class="text-body">
        This host needs proof from the host domain before it can be claimed.
        Sign in with the account whose handle matches the host domain, or add
        the Atmosphere host proof file to the host website.
      </p>
      <a
        class="directory-register-button host-claim-secondary-action"
        href="/hosts/register"
      >
        <span class="directory-register-button-icon" aria-hidden="true">+</span>
        <span>Register host</span>
      </a>
    </div>
  );
}

function claimPathForContext(
  host: string,
  linkContext: HostClaimLinkContext | null,
): string {
  const path = `/hosts/${encodeURIComponent(host)}/claim`;
  if (!linkContext) return path;
  const search = new URLSearchParams({
    app: linkContext.app.id,
    relationship: linkContext.relationship,
  });
  return `${path}?${search}`;
}

async function loadLinkContext(
  user: { did: string },
  url: URL,
): Promise<HostClaimLinkContext | null> {
  const id = url.searchParams.get("app")?.trim();
  if (!id) return null;
  const app = await getAppListingById(id).catch(() => null);
  if (!app || !userControlsAppListing(app, user.did)) return null;
  return {
    app,
    relationship: url.searchParams.get("relationship") === "same_operator"
      ? "same_operator"
      : "same_product",
  };
}
