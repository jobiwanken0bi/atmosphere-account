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
  claimAccountHost,
  claimAccountHostWithContactEmail,
  getAccountHost,
  getAccountHostClaim,
  resolveAccountHostClaimAuthority,
  verifiedAccountHostOwnerDid,
} from "../../../lib/account-hosts.ts";
import {
  hostClaimProofMessage,
  hostSelfServiceClaimPolicy,
  verifyHostClaimDomainProof,
} from "../../../lib/host-claim-proof.ts";
import {
  getHostContactEmailAvailability,
  type HostContactEmailAvailability,
  hostContactEmailVerificationFailureMessage,
  type HostContactEmailVerificationFailureReason,
  inspectHostContactEmailChallenge,
  isHostContactEmailVerificationFailureReason,
  requestHostContactEmailChallenge,
} from "../../../lib/host-claim-email.ts";
import { trustedRequestOrigin } from "../../../lib/atmosphere-origins.ts";
import { IS_DEV } from "../../../lib/env.ts";
import { enforceDurableRateLimit } from "../../../lib/rate-limit.ts";
import { type AppListing } from "../../../lib/app-directory.ts";
import {
  establishDirectoryEntityLinkFromIntent,
} from "../../../lib/directory-entity-links.ts";
import {
  appHostLinkIntentErrorMessage,
  type BoundAppHostLinkIntent,
  resolveBoundAppHostLinkIntent,
  type ResolvedAppHostLinkIntent,
} from "../../../lib/app-host-link-intent.ts";

type ClaimState =
  | "ready"
  | "claimed-by-you"
  | "claimed-by-other"
  | "not-authorized"
  | "email"
  | "email-token"
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
  contactEmail: HostContactEmailAvailability | null;
  token: string | null;
  tokenFailure: HostContactEmailVerificationFailureReason | null;
  notice: string | null;
  previewUrl: string | null;
  directoryListing: boolean;
  detectedLookup: boolean;
}

interface HostClaimLinkContext {
  app: AppListing;
  relationship: "same_product" | "same_operator";
  appOwnerDid: string;
  intentToken: string;
  intent: BoundAppHostLinkIntent;
}

export const handler = define.handlers({
  async GET(ctx) {
    const capturedToken = captureHostClaimToken(ctx.url, ctx.params.host);
    if (capturedToken) return capturedToken;

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
          contactEmail={null}
          token={null}
          tokenFailure={null}
          notice={null}
          previewUrl={null}
          directoryListing
          detectedLookup={false}
        />,
        { status: 404 },
      );
    }
    if (!ctx.state.user) {
      return redirectToSignin(host.host, ctx.url);
    }
    const linkContext = await loadLinkContext(ctx.url, host.host);
    if (linkContext instanceof Response) return linkContext;
    const page = await buildClaimPageProps(
      host,
      ctx.state.user,
      buildAccountMenuProps(ctx.state),
      linkContext,
      {
        error: ctx.url.searchParams.get("linkError") === "1"
          ? "The host is claimed, but its app connection could not be completed. Try connecting it again below."
          : null,
        token: readHostClaimToken(ctx.req),
        directoryListing: readDirectoryListingIntent(ctx.url),
        detectedLookup: readDetectedLookupIntent(ctx.url),
      },
    );
    const response = await ctx.render(<HostClaimPage {...page} />);
    if (page.tokenFailure && page.tokenFailure !== "account_mismatch") {
      response.headers.append(
        "set-cookie",
        clearHostClaimTokenCookie(host.host),
      );
    }
    return response;
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
    const limited = await enforceDurableRateLimit(ctx.req, {
      scope: "host-claim-update",
      capacity: 8,
      refillMs: 60 * 60_000,
    });
    if (limited) return limited;
    const linkContext = await loadLinkContext(ctx.url, host.host);
    if (linkContext instanceof Response) return linkContext;
    const form = await ctx.req.formData().catch(() => null);
    const action = textValue(form?.get("action"));
    const listingSelection = readDirectoryListingSelection(form);
    const directoryListing = listingSelection ??
      readDirectoryListingIntent(ctx.url);
    const detectedLookup = readDetectedLookupIntent(ctx.url);
    if (action === "connect_app" && linkContext) {
      const existingClaim = await getAccountHostClaim(host.host).catch(() =>
        null
      );
      const verifiedOwnerDid = existingClaim
        ? await verifiedAccountHostOwnerDid(host, existingClaim).catch(() =>
          null
        )
        : null;
      if (verifiedOwnerDid !== ctx.state.user.did) {
        const page = await buildClaimPageProps(
          host,
          ctx.state.user,
          buildAccountMenuProps(ctx.state),
          linkContext,
          {
            error: "This account does not control the verified claimed host.",
            directoryListing,
            detectedLookup,
          },
        );
        return ctx.render(<HostClaimPage {...page} />, { status: 403 });
      }
      return await completeAppHostLink(
        host,
        ctx.state.user.did,
        linkContext,
      );
    }
    if (action === "request_email") {
      const existingClaim = await getAccountHostClaim(host.host).catch(() =>
        null
      );
      if (existingClaim) {
        const page = await buildClaimPageProps(
          host,
          ctx.state.user,
          buildAccountMenuProps(ctx.state),
          linkContext,
          {
            error: "This host has already been claimed.",
            directoryListing,
            detectedLookup,
          },
        );
        return ctx.render(<HostClaimPage {...page} />, { status: 409 });
      }
      const availability = await getHostContactEmailAvailability({
        host: host.host,
        displayName: host.displayName,
        serviceEndpoint: host.serviceEndpoint,
      });
      if (!availability.available) {
        const page = await buildClaimPageProps(
          host,
          ctx.state.user,
          buildAccountMenuProps(ctx.state),
          linkContext,
          {
            error: "This PDS no longer announces a contact email.",
            directoryListing,
            detectedLookup,
          },
        );
        return ctx.render(<HostClaimPage {...page} />, { status: 409 });
      }
      const requested = await requestHostContactEmailChallenge(
        {
          host: host.host,
          displayName: host.displayName,
          serviceEndpoint: host.serviceEndpoint,
        },
        ctx.state.user,
        trustedRequestOrigin(ctx.url, ctx.req.headers),
        claimPathForContext(
          host.host,
          linkContext,
          directoryListing,
          detectedLookup,
        ),
      );
      const feedback = emailRequestFeedback(requested);
      const page = await buildClaimPageProps(
        host,
        ctx.state.user,
        buildAccountMenuProps(ctx.state),
        linkContext,
        { ...feedback, directoryListing, detectedLookup },
      );
      return ctx.render(<HostClaimPage {...page} />, {
        status: requested.ok ? 200 : 409,
      });
    }

    const verificationToken = action === "verify_email"
      ? textValue(form?.get("token")) || readHostClaimToken(ctx.req)
      : "";
    const result = action === "verify_email"
      ? await claimAccountHostWithContactEmail(
        host.host,
        ctx.state.user,
        verificationToken,
        listingSelection == null
          ? {}
          : { operatorListingOptIn: listingSelection },
      )
      : action === "claim" &&
          hostSelfServiceClaimPolicy(host.host) === "local-dev"
      ? await claimAccountHost(
        host.host,
        ctx.state.user,
        listingSelection == null
          ? {}
          : { operatorListingOptIn: listingSelection },
      )
      : {
        ok: false as const,
        reason: "contact_email_required" as const,
        host,
      };
    if (result.ok) {
      if (linkContext) {
        return await completeAppHostLink(
          result.host,
          ctx.state.user.did,
          linkContext,
        );
      }
      return new Response(null, {
        status: 303,
        headers: {
          location: `/hosts/${
            encodeURIComponent(result.host.host)
          }/manage?claimed=1`,
          "set-cookie": clearHostClaimTokenCookie(host.host),
        },
      });
    }
    const emailFailure = isHostContactEmailVerificationFailureReason(
        result.reason,
      )
      ? result.reason
      : null;
    const page = await buildClaimPageProps(
      result.host ?? host,
      ctx.state.user,
      buildAccountMenuProps(ctx.state),
      linkContext,
      {
        error: emailFailure
          ? hostContactEmailVerificationFailureMessage(emailFailure)
          : result.reason === "already_claimed"
          ? "This host has already been claimed."
          : result.reason === "not_authorized"
          ? hostClaimProofMessage()
          : result.reason === "contact_email_required"
          ? hostClaimProofMessage()
          : "This host is not ready to be claimed yet.",
        token: action === "verify_email" ? verificationToken : null,
        tokenFailure: emailFailure,
        directoryListing,
        detectedLookup,
      },
    );
    const response = await ctx.render(<HostClaimPage {...page} />, {
      status: 403,
    });
    if (
      action === "verify_email" && emailFailure !== "account_mismatch"
    ) {
      response.headers.append(
        "set-cookie",
        clearHostClaimTokenCookie(host.host),
      );
    }
    return response;
  },
});

async function completeAppHostLink(
  host: AccountHost,
  currentHostDid: string,
  linkContext: HostClaimLinkContext,
): Promise<Response> {
  const linked = await establishDirectoryEntityLinkFromIntent({
    intent: linkContext.intent,
    currentHostDid,
  }).catch((error) => {
    console.error("[host-claim] app connection completion failed:", error);
    return { ok: false as const };
  });
  const location = linked.ok
    ? `/hosts/${encodeURIComponent(host.host)}/manage?linked=1`
    : `/hosts/${encodeURIComponent(host.host)}/manage?linkError=1`;
  return new Response(null, {
    status: 303,
    headers: {
      location,
      "set-cookie": clearHostClaimTokenCookie(host.host),
    },
  });
}

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
  feedback: {
    error?: string | null;
    notice?: string | null;
    previewUrl?: string | null;
    token?: string | null;
    tokenFailure?: HostContactEmailVerificationFailureReason | null;
    directoryListing?: boolean;
    detectedLookup?: boolean;
  } = {},
): Promise<ClaimPageProps> {
  const [claim, authority] = await Promise.all([
    getAccountHostClaim(host.host).catch(() => null),
    resolveAccountHostClaimAuthority(host).catch(() => null),
  ]);
  const verifiedClaimOwnerDid = claim
    ? await verifiedAccountHostOwnerDid(host, claim).catch(() => null)
    : null;
  let state: ClaimState = "not-claimable";
  let contactEmail: HostContactEmailAvailability | null = null;
  const token = feedback.token?.trim() || null;
  let tokenFailure: HostContactEmailVerificationFailureReason | null =
    feedback.tokenFailure ?? null;
  let tokenIsReady = false;
  if (token && !tokenFailure) {
    const inspected = await inspectHostContactEmailChallenge(
      {
        host: host.host,
        displayName: host.displayName,
        serviceEndpoint: host.serviceEndpoint,
      },
      user,
      token,
    ).catch(() => ({ ok: false as const, reason: "invalid" as const }));
    if (inspected.ok) tokenIsReady = true;
    else tokenFailure = inspected.reason;
  }
  if (verifiedClaimOwnerDid === user.did) {
    state = "claimed-by-you";
  } else if (verifiedClaimOwnerDid) {
    state = "claimed-by-other";
  } else if (claim) {
    state = "not-authorized";
  } else if (hostSelfServiceClaimPolicy(host.host) === "local-dev") {
    const proof = verifyHostClaimDomainProof(host, user);
    state = proof.ok ? "ready" : "not-claimable";
  } else {
    contactEmail = await getHostContactEmailAvailability({
      host: host.host,
      displayName: host.displayName,
      serviceEndpoint: host.serviceEndpoint,
    }).catch(() => null);
    state = tokenIsReady
      ? "email-token"
      : contactEmail?.available
      ? "email"
      : "not-claimable";
  }
  return {
    host,
    claim,
    authority,
    state,
    activeHandle: user.handle,
    error: feedback.error ??
      (tokenFailure
        ? hostContactEmailVerificationFailureMessage(tokenFailure)
        : null),
    account,
    linkContext,
    contactEmail,
    token,
    tokenFailure,
    notice: feedback.notice ?? null,
    previewUrl: feedback.previewUrl ?? null,
    directoryListing: feedback.directoryListing ?? true,
    detectedLookup: feedback.detectedLookup ?? false,
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
    contactEmail,
    token,
    tokenFailure,
    notice,
    previewUrl,
    directoryListing,
    detectedLookup,
  } = props;
  return (
    <div id="page-top">
      <div class="content-layer">
        <Nav account={account} active="hosts" />
        <section class="signin-page-section host-claim-section">
          <div class="container signin-page-container">
            <a
              href={detectedLookup
                ? detectedClaimHref(linkContext)
                : host
                ? `/hosts/${encodeURIComponent(host.host)}`
                : "/hosts"}
              class="text-link-button"
            >
              {detectedLookup && linkContext
                ? "Back to app hosting"
                : detectedLookup
                ? "Back to PDS lookup"
                : "Back to host"}
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
                        : "Claiming verifies that you operate this PDS. Once claimed, your signed-in Atmosphere account can manage the host details here."}
                    </p>
                    <DetectedHostSummary host={host} />
                    <ClaimBody
                      host={host}
                      claim={claim}
                      authority={authority}
                      state={state}
                      activeHandle={activeHandle}
                      error={error}
                      linkContext={linkContext}
                      contactEmail={contactEmail}
                      token={token}
                      tokenFailure={tokenFailure}
                      notice={notice}
                      previewUrl={previewUrl}
                      directoryListing={directoryListing}
                      detectedLookup={detectedLookup}
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
  {
    host,
    claim,
    authority,
    state,
    activeHandle,
    error,
    linkContext,
    contactEmail,
    token,
    tokenFailure,
    notice,
    previewUrl,
    directoryListing,
    detectedLookup,
  }: {
    host: AccountHost;
    claim: AccountHostClaim | null;
    authority: AccountHostClaimAuthority | null;
    state: ClaimState;
    activeHandle: string | null;
    error: string | null;
    linkContext: HostClaimLinkContext | null;
    contactEmail: HostContactEmailAvailability | null;
    token: string | null;
    tokenFailure: HostContactEmailVerificationFailureReason | null;
    notice: string | null;
    previewUrl: string | null;
    directoryListing: boolean;
    detectedLookup: boolean;
  },
) {
  if (state === "claimed-by-you") {
    return (
      <div class="host-claim-panel host-claim-panel-ok">
        {error && (
          <p class="profile-form-status profile-form-status--error">{error}</p>
        )}
        <p class="host-claim-panel-title">
          Claimed by <AtmosphereHandle handle={claim?.claimantHandle} />
        </p>
        <p class="text-body">
          This account is already managing {host.displayName}.
        </p>
        <p class="text-body">
          Directory visibility is currently{" "}
          <strong>
            {host.operatorListingOptIn === false ? "off" : "on"}
          </strong>.
        </p>
        <a
          class="text-link-button"
          href={`/hosts/${encodeURIComponent(host.host)}/manage`}
        >
          Manage public listing
        </a>
        {linkContext && (
          <form method="POST">
            <input type="hidden" name="action" value="connect_app" />
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
        {error && (
          <p class="profile-form-status profile-form-status--error">{error}</p>
        )}
        <p class="host-claim-panel-title">Already claimed</p>
        <p class="text-body">
          This host is managed by{" "}
          <AtmosphereHandle handle={claim?.claimantHandle} />.
        </p>
        {linkContext && (
          <a
            class="directory-register-button host-claim-secondary-action"
            href={switchAccountHref(
              host.host,
              linkContext,
              directoryListing,
              detectedLookup,
            )}
          >
            <span>Use the verified host operator account</span>
          </a>
        )}
      </div>
    );
  }
  if (state === "ready") {
    return (
      <form method="POST" class="host-claim-form">
        <input type="hidden" name="action" value="claim" />
        {error && (
          <p class="profile-form-status profile-form-status--error">{error}</p>
        )}
        <div class="host-claim-panel host-claim-panel-ok">
          <p class="host-claim-panel-title">
            Signed in as <AtmosphereHandle handle={activeHandle} />
          </p>
          <p class="text-body">
            This local development fixture can be claimed without sending an
            email.
          </p>
        </div>
        <DirectoryListingChoice checked={directoryListing} />
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
  if (state === "email-token" && token) {
    return (
      <form method="POST" class="host-claim-form">
        <input type="hidden" name="action" value="verify_email" />
        {error && (
          <p class="profile-form-status profile-form-status--error">{error}</p>
        )}
        <div class="host-claim-panel host-claim-panel-ok">
          <p class="host-claim-panel-title">Finish email verification</p>
          <p class="text-body">
            This link was sent to the contact address announced by the PDS.
            Confirm that <AtmosphereHandle handle={activeHandle} />{" "}
            should manage {host.displayName}.
          </p>
        </div>
        <DirectoryListingChoice checked={directoryListing} />
        <button type="submit" class="directory-register-button">
          <span>Verify and claim host</span>
        </button>
      </form>
    );
  }
  if (state === "email") {
    return (
      <form method="POST" class="host-claim-form">
        <input type="hidden" name="action" value="request_email" />
        {error && (
          <p class="profile-form-status profile-form-status--error">{error}</p>
        )}
        {notice && (
          <p class="profile-form-status profile-form-status--ok">
            {notice}
          </p>
        )}
        {tokenFailure === "account_mismatch" && token && (
          <a
            class="directory-register-button host-claim-secondary-action"
            href={`/oauth/add-account?next=${
              encodeURIComponent(
                claimPathForContext(
                  host.host,
                  linkContext,
                  directoryListing,
                  detectedLookup,
                ),
              )
            }`}
          >
            <span class="directory-register-button-icon" aria-hidden="true">
              +
            </span>
            <span>Switch or add account</span>
          </a>
        )}
        <div class="host-claim-panel host-claim-panel-ok">
          <p class="host-claim-panel-title">Verify through the PDS</p>
          <p class="text-body">
            {host.displayName} announces {contactEmail?.maskedEmail}{" "}
            as its PDS contact. Atmosphere will send a one-time link bound to
            <AtmosphereHandle handle={activeHandle} />.
          </p>
        </div>
        {linkContext && tokenFailure !== "account_mismatch" && (
          <a
            class="text-link-button"
            href={switchAccountHref(
              host.host,
              linkContext,
              directoryListing,
              detectedLookup,
            )}
          >
            Use the host operator account instead
          </a>
        )}
        <DirectoryListingChoice checked={directoryListing} />
        {previewUrl && (
          <a class="text-link-button" href={previewUrl}>
            Open local email preview
          </a>
        )}
        {contactEmail?.deliveryConfigured
          ? (
            <button type="submit" class="directory-register-button">
              <span>Send verification email</span>
            </button>
          )
          : (
            <p class="text-body">
              Email delivery is temporarily unavailable. Try again later.
            </p>
          )}
      </form>
    );
  }
  if (state === "not-authorized") {
    if (!authority?.did) {
      return (
        <div class="host-claim-panel">
          {error && (
            <p class="profile-form-status profile-form-status--error">
              {error}
            </p>
          )}
          <p class="host-claim-panel-title">
            Operator verification unavailable
          </p>
          <p class="text-body">
            Atmosphere could not live-verify the account currently recorded as
            this host’s operator. Nothing has been changed; try again later.
          </p>
        </div>
      );
    }
    return (
      <div class="host-claim-panel">
        {error && (
          <p class="profile-form-status profile-form-status--error">{error}</p>
        )}
        <p class="host-claim-panel-title">
          Operator account required
        </p>
        <p class="text-body">
          You are currently signed in as{" "}
          <AtmosphereHandle handle={activeHandle} />. This host is pinned to
          {" "}
          <AtmosphereHandle handle={authority.handle} />. If that is already
          this account, its stored ownership record needs repair before changes
          can be made.
        </p>
        <a
          class="directory-register-button host-claim-secondary-action"
          href={`/oauth/add-account?next=${
            encodeURIComponent(
              claimPathForContext(
                host.host,
                linkContext,
                directoryListing,
                detectedLookup,
              ),
            )
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
      <p class="host-claim-panel-title">More verification needed</p>
      <p class="text-body">
        This PDS does not expose a usable contact email. Configure{" "}
        <code>contact.email</code> in its live{" "}
        <code>com.atproto.server.describeServer</code>{" "}
        response, then retry. Atmosphere will send that address a one-time link
        to verify the management account.
      </p>
      {linkContext && (
        <a
          class="directory-register-button host-claim-secondary-action"
          href={switchAccountHref(
            host.host,
            linkContext,
            directoryListing,
            detectedLookup,
          )}
        >
          <span>Use the host operator account</span>
        </a>
      )}
    </div>
  );
}

function textValue(value: FormDataEntryValue | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function emailRequestFeedback(
  result: Awaited<ReturnType<typeof requestHostContactEmailChallenge>>,
): {
  error?: string;
  notice?: string;
  previewUrl?: string;
} {
  if (result.ok) {
    return {
      notice:
        `Verification email sent to ${result.maskedEmail}. The link expires in 20 minutes.`,
      previewUrl: result.previewUrl,
    };
  }
  if (result.reason === "rate_limited") {
    return {
      error:
        "Too many verification emails were requested. Try again in an hour.",
    };
  }
  if (result.reason === "contact_unavailable") {
    return { error: "This PDS no longer announces a valid contact email." };
  }
  if (result.reason === "delivery_unavailable") {
    return { error: "Email delivery is not configured yet." };
  }
  return {
    error: "The verification email could not be sent. Try again shortly.",
  };
}

function claimPathForContext(
  host: string,
  linkContext: HostClaimLinkContext | null,
  directoryListing = true,
  detectedLookup = false,
): string {
  const path = `/hosts/${encodeURIComponent(host)}/claim`;
  const search = new URLSearchParams({
    publish: directoryListing ? "1" : "0",
  });
  if (linkContext) {
    search.set("link_intent", linkContext.intentToken);
  }
  if (detectedLookup) search.set("from", "detected");
  return `${path}?${search}`;
}

function switchAccountHref(
  host: string,
  linkContext: HostClaimLinkContext | null,
  directoryListing: boolean,
  detectedLookup: boolean,
): string {
  return `/oauth/add-account?next=${
    encodeURIComponent(
      claimPathForContext(
        host,
        linkContext,
        directoryListing,
        detectedLookup,
      ),
    )
  }`;
}

const HOST_CLAIM_TOKEN_COOKIE = "atmo_host_claim_token";
const HOST_CLAIM_TOKEN_MAX_AGE_SECONDS = 20 * 60;

function captureHostClaimToken(
  url: URL,
  routeHost: string,
): Response | null {
  if (!url.searchParams.has("token")) return null;
  const rawToken = url.searchParams.get("token")?.trim() ?? "";
  const token = /^[A-Za-z0-9_-]{43}$/.test(rawToken) ? rawToken : "invalid";
  const host = normalizeClaimCookieHost(routeHost);
  const clean = new URL(url);
  clean.searchParams.delete("token");
  const headers = new Headers({
    location: `${clean.pathname}${clean.search}`,
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    "x-robots-tag": "noindex, nofollow",
  });
  if (host) {
    headers.append("set-cookie", buildHostClaimTokenCookie(host, token));
  }
  return new Response(null, { status: 303, headers });
}

function readHostClaimToken(req: Request): string {
  const cookie = req.headers.get("cookie");
  if (!cookie) return "";
  for (const part of cookie.split(";").map((value) => value.trim())) {
    if (!part.startsWith(`${HOST_CLAIM_TOKEN_COOKIE}=`)) continue;
    try {
      const value = decodeURIComponent(
        part.slice(HOST_CLAIM_TOKEN_COOKIE.length + 1),
      );
      return value.length <= 256 ? value : "";
    } catch {
      return "";
    }
  }
  return "";
}

function buildHostClaimTokenCookie(host: string, token: string): string {
  const flags = [
    `Path=/hosts/${encodeURIComponent(host)}/claim`,
    `Max-Age=${HOST_CLAIM_TOKEN_MAX_AGE_SECONDS}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (!IS_DEV) flags.push("Secure");
  return `${HOST_CLAIM_TOKEN_COOKIE}=${encodeURIComponent(token)}; ${
    flags.join("; ")
  }`;
}

function clearHostClaimTokenCookie(host: string): string {
  const flags = [
    `Path=/hosts/${encodeURIComponent(host)}/claim`,
    "Max-Age=0",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (!IS_DEV) flags.push("Secure");
  return `${HOST_CLAIM_TOKEN_COOKIE}=; ${flags.join("; ")}`;
}

function normalizeClaimCookieHost(value: string): string | null {
  try {
    const host = decodeURIComponent(value).trim().toLowerCase();
    return /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/.test(host) ? host : null;
  } catch {
    return null;
  }
}

function readDirectoryListingIntent(url: URL): boolean {
  return url.searchParams.get("publish") !== "0";
}

function readDetectedLookupIntent(url: URL): boolean {
  return url.searchParams.get("from") === "detected";
}

function readDirectoryListingSelection(
  form: FormData | null,
): boolean | undefined {
  if (!form?.has("directory_listing_setting")) return undefined;
  return form.get("directory_listing") === "1";
}

function DirectoryListingChoice({ checked }: { checked: boolean }) {
  return (
    <label class="profile-form-toggle host-claim-listing-choice">
      <input type="hidden" name="directory_listing_setting" value="1" />
      <input
        type="checkbox"
        name="directory_listing"
        value="1"
        checked={checked}
      />
      <span class="profile-form-toggle-body">
        <span class="profile-form-toggle-label">
          List this PDS in the public Hosts directory
        </span>
        <span class="profile-form-toggle-hint">
          This explicit choice overrides automatic personal-PDS filtering after
          ownership is verified. You can turn it off later.
        </span>
      </span>
    </label>
  );
}

function DetectedHostSummary({ host }: { host: AccountHost }) {
  return (
    <section class="host-claim-detected-summary" aria-label="Detected PDS data">
      <p class="host-claim-panel-title">Detected from relay activity</p>
      <dl>
        <div>
          <dt>PDS domain</dt>
          <dd>{host.host}</dd>
        </div>
        {host.serviceEndpoint && (
          <div>
            <dt>Service endpoint</dt>
            <dd>{host.serviceEndpoint}</dd>
          </div>
        )}
        <div>
          <dt>Observed accounts</dt>
          <dd>{host.observedAccountCount.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Automatic classification</dt>
          <dd>
            {host.publicIntentStatus === "detected"
              ? "Public host signals detected"
              : "No public-host signal detected"}
          </dd>
        </div>
      </dl>
    </section>
  );
}

async function loadLinkContext(
  url: URL,
  expectedHost: string,
): Promise<HostClaimLinkContext | null | Response> {
  const token = url.searchParams.get("link_intent")?.trim();
  if (!token) return null;
  const resolved = await resolveBoundAppHostLinkIntent(token, expectedHost);
  if (!resolved.ok) {
    return new Response(appHostLinkIntentErrorMessage(resolved.reason), {
      status: 400,
      headers: { "cache-control": "no-store" },
    });
  }
  return linkContextFromResolvedIntent(resolved.value);
}

function linkContextFromResolvedIntent(
  value: ResolvedAppHostLinkIntent<BoundAppHostLinkIntent>,
): HostClaimLinkContext {
  return {
    app: value.app,
    relationship: value.intent.relationship,
    appOwnerDid: value.intent.appOwnerDid,
    intentToken: value.token,
    intent: value.intent,
  };
}

function detectedClaimHref(linkContext: HostClaimLinkContext | null): string {
  return linkContext
    ? `/apps/manage/host?app=${encodeURIComponent(linkContext.app.id)}`
    : "/hosts/claim";
}
