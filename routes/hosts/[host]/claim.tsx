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
  claimAccountHostWithContactEmail,
  getAccountHost,
  getAccountHostClaim,
  resolveAccountHostClaimAuthority,
} from "../../../lib/account-hosts.ts";
import {
  hasPreboundHostAuthority,
  hostClaimProofMessage,
  verifyHostClaimDomainProof,
} from "../../../lib/host-claim-proof.ts";
import {
  getHostContactEmailAvailability,
  type HostContactEmailAvailability,
  inspectHostContactEmailChallenge,
  requestHostContactEmailChallenge,
} from "../../../lib/host-claim-email.ts";
import { trustedRequestOrigin } from "../../../lib/atmosphere-origins.ts";
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
  notice: string | null;
  previewUrl: string | null;
  directoryListing: boolean;
  detectedLookup: boolean;
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
          contactEmail={null}
          token={null}
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
    const linkContext = await loadLinkContext(ctx.state.user, ctx.url);
    const page = await buildClaimPageProps(
      host,
      ctx.state.user,
      buildAccountMenuProps(ctx.state),
      linkContext,
      {
        token: ctx.url.searchParams.get("token"),
        directoryListing: readDirectoryListingIntent(ctx.url),
        detectedLookup: readDetectedLookupIntent(ctx.url),
      },
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
    const limited = await enforceDurableRateLimit(ctx.req, {
      scope: "host-claim-update",
      capacity: 8,
      refillMs: 60 * 60_000,
    });
    if (limited) return limited;
    const linkContext = await loadLinkContext(ctx.state.user, ctx.url);
    const form = await ctx.req.formData().catch(() => null);
    const action = textValue(form?.get("action"));
    const listingSelection = readDirectoryListingSelection(form);
    const directoryListing = listingSelection ??
      readDirectoryListingIntent(ctx.url);
    const detectedLookup = readDetectedLookupIntent(ctx.url);
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
      const authority = await resolveAccountHostClaimAuthority(host).catch(() =>
        null
      );
      if (
        hasPreboundHostAuthority(host) && authority &&
        !accountHostClaimAuthorityMatchesUser(authority, ctx.state.user)
      ) {
        const page = await buildClaimPageProps(
          host,
          ctx.state.user,
          buildAccountMenuProps(ctx.state),
          linkContext,
          {
            error: `This curated host is already tied to @${authority.handle}.`,
            directoryListing,
            detectedLookup,
          },
        );
        return ctx.render(<HostClaimPage {...page} />, { status: 403 });
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

    const result = action === "verify_email"
      ? await claimAccountHostWithContactEmail(
        host.host,
        ctx.state.user,
        textValue(form?.get("token")),
        listingSelection == null
          ? {}
          : { operatorListingOptIn: listingSelection },
      )
      : await claimAccountHost(
        host.host,
        ctx.state.user,
        listingSelection == null
          ? {}
          : { operatorListingOptIn: listingSelection },
      );
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
          location: result.host.operatorListingOptIn === false
            ? `/hosts/${encodeURIComponent(result.host.host)}/manage?claimed=1`
            : `/hosts/${encodeURIComponent(result.host.host)}?claimed=1`,
        },
      });
    }
    const page = await buildClaimPageProps(
      result.host ?? host,
      ctx.state.user,
      buildAccountMenuProps(ctx.state),
      linkContext,
      {
        error: result.reason === "already_claimed"
          ? "This host has already been claimed."
          : result.reason === "not_authorized"
          ? action === "verify_email"
            ? "That verification link is invalid, expired, already used, or the PDS contact address changed. Request a new email and try again."
            : hostClaimProofMessage()
          : "This host is not ready to be claimed yet.",
        token: action === "verify_email" ? textValue(form?.get("token")) : null,
        directoryListing,
        detectedLookup,
      },
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
  feedback: {
    error?: string | null;
    notice?: string | null;
    previewUrl?: string | null;
    token?: string | null;
    directoryListing?: boolean;
    detectedLookup?: boolean;
  } = {},
): Promise<ClaimPageProps> {
  const [claim, authority] = await Promise.all([
    getAccountHostClaim(host.host).catch(() => null),
    resolveAccountHostClaimAuthority(host).catch(() => null),
  ]);
  let state: ClaimState = "not-claimable";
  let contactEmail: HostContactEmailAvailability | null = null;
  const token = feedback.token?.trim() || null;
  if (claim?.claimantDid === user.did) {
    state = "claimed-by-you";
  } else if (claim) {
    state = "claimed-by-other";
  } else {
    const proof = await verifyHostClaimDomainProof(host, user);
    const authorityMatches = authority &&
      accountHostClaimAuthorityMatchesUser(authority, user);
    if (proof.ok && (proof.method !== "prebound" || authorityMatches)) {
      state = "ready";
    } else if (hasPreboundHostAuthority(host) && authority) {
      state = "not-authorized";
    } else {
      contactEmail = await getHostContactEmailAvailability({
        host: host.host,
        displayName: host.displayName,
        serviceEndpoint: host.serviceEndpoint,
      }).catch(() => null);
      state = contactEmail?.available ? "email" : "not-claimable";
      if (token) {
        const inspected = await inspectHostContactEmailChallenge(
          {
            host: host.host,
            displayName: host.displayName,
            serviceEndpoint: host.serviceEndpoint,
          },
          user,
          token,
        ).catch(() => ({ ok: false as const, reason: "invalid" as const }));
        if (inspected.ok) state = "email-token";
      }
    }
  }
  return {
    host,
    claim,
    authority,
    state,
    activeHandle: user.handle,
    error: feedback.error ?? null,
    account,
    linkContext,
    contactEmail,
    token,
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
                ? "/hosts/claim"
                : host
                ? `/hosts/${encodeURIComponent(host.host)}`
                : "/hosts"}
              class="text-link-button"
            >
              {detectedLookup ? "Back to PDS lookup" : "Back to host"}
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
    notice: string | null;
    previewUrl: string | null;
    directoryListing: boolean;
    detectedLookup: boolean;
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
        <input type="hidden" name="action" value="claim" />
        {error && (
          <p class="profile-form-status profile-form-status--error">{error}</p>
        )}
        <div class="host-claim-panel host-claim-panel-ok">
          <p class="host-claim-panel-title">
            Signed in as <AtmosphereHandle handle={activeHandle} />
          </p>
          <p class="text-body">
            {authority?.handle
              ? (
                <>
                  This matches the host account{" "}
                  <AtmosphereHandle handle={authority.handle} />. You can claim
                  the listing now.
                </>
              )
              : (
                <>
                  Atmosphere verified an operator proof tied to this PDS. You
                  can claim the listing now.
                </>
              )}
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
        <input type="hidden" name="token" value={token} />
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
        <div class="host-claim-panel host-claim-panel-ok">
          <p class="host-claim-panel-title">Verify through the PDS</p>
          <p class="text-body">
            {host.displayName} announces {contactEmail?.maskedEmail}{" "}
            as its PDS contact. Atmosphere will send a one-time link bound to
            <AtmosphereHandle handle={activeHandle} />.
          </p>
        </div>
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
        This PDS does not expose a usable contact email, and the signed-in
        account has not provided another accepted operator proof. Atmosphere
        cannot safely infer its operator account yet. A standardized PDS
        operator declaration could make this self-service in the future.
      </p>
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
    search.set("app", linkContext.app.id);
    search.set("relationship", linkContext.relationship);
  }
  if (detectedLookup) search.set("from", "detected");
  return `${path}?${search}`;
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
