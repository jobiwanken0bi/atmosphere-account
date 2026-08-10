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
  claimAccountHostWithDns,
  getAccountHost,
  getAccountHostClaim,
  resolveAccountHostClaimAuthority,
  verifiedAccountHostOwnerDid,
} from "../../../lib/account-hosts.ts";
import {
  hostSelfServiceClaimPolicy,
  verifyHostClaimDomainProof,
} from "../../../lib/host-claim-proof.ts";
import {
  hostDnsChallengeVerificationFailureMessage,
  type HostDnsChallengeVerificationFailureReason,
  type InspectedHostDnsChallengeResult,
  inspectHostDnsChallenge,
  isHostDnsChallengeVerificationFailureReason,
  requestHostDnsChallenge,
} from "../../../lib/host-claim-dns.ts";
import {
  type ResolvedHostOwnerTransferContext,
  resolveHostOwnerTransferIntent,
} from "../../../lib/host-owner-transfer-intent.ts";
import { enforceDurableRateLimit } from "../../../lib/rate-limit.ts";
import { type AppListing } from "../../../lib/app-directory.ts";
import {
  establishDirectoryEntityLinkFromIntent,
} from "../../../lib/directory-entity-links.ts";
import {
  appHostLinkIntentErrorMessage,
  type BoundAppHostLinkIntent,
  inspectExpiredBoundAppHostLinkIntent,
  resolveBoundAppHostLinkIntent,
  type ResolvedAppHostLinkIntent,
} from "../../../lib/app-host-link-intent.ts";
import {
  HOST_MANAGEMENT_CAPABILITIES,
  oauthSigninUrl,
} from "../../../lib/oauth-action.ts";
import { getSessionForCapabilities } from "../../../lib/oauth.ts";
import { oauthAddAccountHref } from "../oauth-entry.ts";
import {
  readFormDataRequestWithLimit,
  RequestBodyTooLargeError,
} from "../../../lib/security.ts";
import {
  rejectLegacyHostClaimAction,
  stripLegacyHostClaimToken,
} from "../../../lib/host-claim-legacy.ts";

export {
  rejectLegacyHostClaimAction,
  stripLegacyHostClaimToken,
} from "../../../lib/host-claim-legacy.ts";

const MAX_HOST_CLAIM_BODY_BYTES = 32_768;

type ClaimState =
  | "ready"
  | "claimed-by-you"
  | "claimed-by-other"
  | "not-authorized"
  | "verification"
  | "dns"
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
  dnsChallenge: Extract<InspectedHostDnsChallengeResult, { ok: true }> | null;
  dnsToken: string | null;
  dnsFailure: HostDnsChallengeVerificationFailureReason | null;
  directoryListing: boolean;
  detectedLookup: boolean;
  transferContext: ResolvedHostOwnerTransferContext | null;
  repairingClaim: boolean;
  linkError: boolean;
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
    const legacyEmailLink = stripLegacyHostClaimToken(ctx.url);
    if (legacyEmailLink) return legacyEmailLink;

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
          dnsChallenge={null}
          dnsToken={null}
          dnsFailure={null}
          directoryListing
          detectedLookup={false}
          transferContext={null}
          repairingClaim={false}
          linkError={false}
        />,
        { status: 404 },
      );
    }
    const transferResolution = await loadTransferContext(ctx.url, host.host);
    if (!transferResolution.ok && transferResolution.reason !== "missing") {
      return invalidHostTransferResponse(
        hostTransferFailureMessage(transferResolution.reason),
      );
    }
    const transferContext = transferResolution.ok
      ? transferResolution.value
      : null;
    if (!ctx.state.user) {
      return redirectToSignin(host, ctx.url, transferContext);
    }
    if (
      !await getSessionForCapabilities(
        ctx.state.user.did,
        HOST_MANAGEMENT_CAPABILITIES,
        {
          quiet: true,
        },
      )
    ) {
      return redirectToSignin(host, ctx.url, transferContext);
    }
    const loadedLinkContext = await loadLinkContext(ctx.url, host.host);
    if (loadedLinkContext instanceof Response) return loadedLinkContext;
    const linkError = loadedLinkContext === "expired" ||
      ctx.url.searchParams.get("linkError") === "1";
    const linkContext = loadedLinkContext === "expired"
      ? null
      : loadedLinkContext;
    if (transferContext && linkContext) {
      return invalidHostTransferResponse(
        "A managing-account change cannot also connect an app.",
      );
    }
    const dnsToken = ctx.url.searchParams.get("dns_token")?.trim() || null;
    const dnsFailure = readDnsFailureIntent(ctx.url);
    const page = await buildClaimPageProps(
      host,
      ctx.state.user,
      buildAccountMenuProps(ctx.state),
      linkContext,
      transferContext,
      {
        error: linkError
          ? "The app connection could not be completed. You can still claim or manage the host, then reconnect it from app hosting."
          : ctx.url.searchParams.get("legacy_email") === "1"
          ? "Email links are no longer used for new host claims. Existing claims are unchanged; new claims require DNS."
          : null,
        dnsToken,
        dnsFailure,
        directoryListing: readDirectoryListingIntent(ctx.url),
        detectedLookup: readDetectedLookupIntent(ctx.url),
        linkError,
      },
    );
    const response = await ctx.render(<HostClaimPage {...page} />);
    if (
      dnsToken || ctx.url.searchParams.has("transfer_intent") ||
      ctx.url.searchParams.has("link_intent") || linkError
    ) {
      response.headers.set("cache-control", "no-store");
      response.headers.set("referrer-policy", "no-referrer");
      response.headers.set("x-robots-tag", "noindex, nofollow");
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
    const transferResolution = await loadTransferContext(ctx.url, host.host);
    if (!transferResolution.ok && transferResolution.reason !== "missing") {
      return invalidHostTransferResponse(
        hostTransferFailureMessage(transferResolution.reason),
      );
    }
    const transferContext = transferResolution.ok
      ? transferResolution.value
      : null;
    if (!ctx.state.user) {
      return redirectToSignin(host, ctx.url, transferContext);
    }
    if (
      !await getSessionForCapabilities(
        ctx.state.user.did,
        HOST_MANAGEMENT_CAPABILITIES,
        {
          quiet: true,
        },
      )
    ) {
      return redirectToSignin(host, ctx.url, transferContext);
    }
    let form: FormData | null;
    try {
      form = await readFormDataRequestWithLimit(
        ctx.req,
        MAX_HOST_CLAIM_BODY_BYTES,
      );
    } catch (error) {
      return new Response(
        error instanceof RequestBodyTooLargeError
          ? "Request too large."
          : "Invalid request.",
        { status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
      );
    }
    const action = textValue(form?.get("action"));
    const legacyEmailResponse = rejectLegacyHostClaimAction(action);
    if (legacyEmailResponse) return legacyEmailResponse;
    const limited = await enforceDurableRateLimit(ctx.req, {
      scope: action === "verify_dns"
        ? "host-claim-dns-check"
        : "host-claim-update",
      capacity: action === "verify_dns" ? 30 : 8,
      refillMs: 60 * 60_000,
    });
    if (limited) return limited;
    const loadedLinkContext = await loadLinkContext(ctx.url, host.host);
    if (loadedLinkContext instanceof Response) return loadedLinkContext;
    const linkError = loadedLinkContext === "expired" ||
      ctx.url.searchParams.get("linkError") === "1";
    const linkContext = loadedLinkContext === "expired"
      ? null
      : loadedLinkContext;
    if (transferContext && linkContext) {
      return invalidHostTransferResponse(
        "A managing-account change cannot also connect an app.",
      );
    }
    const listingSelection = transferContext
      ? undefined
      : readDirectoryListingSelection(form);
    const directoryListing = transferContext
      ? host.operatorListingOptIn !== false
      : listingSelection ?? readDirectoryListingIntent(ctx.url);
    const detectedLookup = readDetectedLookupIntent(ctx.url);
    if (action === "connect_app" && (linkContext || linkError)) {
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
          transferContext,
          {
            error: "This account does not control the verified claimed host.",
            directoryListing,
            detectedLookup,
            linkError,
          },
        );
        return ctx.render(<HostClaimPage {...page} />, { status: 403 });
      }
      if (linkContext) {
        return await completeAppHostLink(
          host,
          ctx.state.user.did,
          linkContext,
        );
      }
      return new Response(null, {
        status: 303,
        headers: {
          location: `/hosts/${
            encodeURIComponent(host.host)
          }/manage?linkError=1`,
        },
      });
    }
    if (action === "request_dns") {
      const existingClaim = await getAccountHostClaim(host.host).catch(() =>
        null
      );
      if (existingClaim) {
        const verifiedOwnerDid = await verifiedAccountHostOwnerDid(
          host,
          existingClaim,
        ).catch(() => null);
        const validTransfer = transferContext &&
          transferContext.intent.previousOwnerDid ===
            existingClaim.claimantDid &&
          existingClaim.claimantDid !== ctx.state.user.did;
        const validRepair = !transferContext &&
          existingClaim.claimantDid === ctx.state.user.did &&
          verifiedOwnerDid !== ctx.state.user.did;
        if (!validTransfer && !validRepair) {
          const page = await buildClaimPageProps(
            host,
            ctx.state.user,
            buildAccountMenuProps(ctx.state),
            linkContext,
            transferContext,
            {
              error: "This host has already been claimed.",
              directoryListing,
              detectedLookup,
              linkError,
            },
          );
          return ctx.render(<HostClaimPage {...page} />, { status: 409 });
        }
      }
      const requested = await requestHostDnsChallenge(
        { host: host.host },
        ctx.state.user,
      );
      if (!requested.ok) {
        const page = await buildClaimPageProps(
          host,
          ctx.state.user,
          buildAccountMenuProps(ctx.state),
          linkContext,
          transferContext,
          {
            error: requested.reason === "rate_limited"
              ? "Too many DNS verifications were started. Try again in an hour."
              : "DNS verification is not available for this host.",
            directoryListing,
            detectedLookup,
            linkError,
          },
        );
        return ctx.render(<HostClaimPage {...page} />, { status: 409 });
      }
      const location = new URL(
        claimPathForContext(
          host.host,
          linkContext,
          directoryListing,
          detectedLookup,
          linkError,
          transferContext,
        ),
        ctx.url,
      );
      location.searchParams.set("dns_token", requested.verificationToken);
      return new Response(null, {
        status: 303,
        headers: {
          location: `${location.pathname}${location.search}`,
          "cache-control": "no-store",
          "referrer-policy": "no-referrer",
        },
      });
    }

    const dnsToken = textValue(form?.get("dns_token")) ||
      ctx.url.searchParams.get("dns_token")?.trim() || "";
    const isLocalDevClaim = action === "claim" &&
      hostSelfServiceClaimPolicy(host.host) === "local-dev";
    if (action !== "verify_dns" && !isLocalDevClaim) {
      return new Response("Invalid host claim action.", {
        status: 400,
        headers: {
          "cache-control": "no-store",
          "content-type": "text/plain; charset=utf-8",
        },
      });
    }
    const result = action === "verify_dns"
      ? await claimAccountHostWithDns(
        host.host,
        ctx.state.user,
        dnsToken,
        {
          ...(listingSelection == null
            ? {}
            : { operatorListingOptIn: listingSelection }),
          ...(transferContext ? { transfer: transferContext } : {}),
        },
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
        return await completeAppHostLink(
          result.host,
          ctx.state.user.did,
          linkContext,
        );
      }
      return new Response(null, {
        status: 303,
        headers: {
          location: hostClaimManageLocation(
            result.host.host,
            !!transferContext,
            linkError,
          ),
        },
      });
    }
    const dnsFailure = isHostDnsChallengeVerificationFailureReason(
        result.reason,
      )
      ? result.reason
      : null;
    const page = await buildClaimPageProps(
      result.host ?? host,
      ctx.state.user,
      buildAccountMenuProps(ctx.state),
      linkContext,
      transferContext,
      {
        error: dnsFailure
          ? hostDnsChallengeVerificationFailureMessage(dnsFailure)
          : result.reason === "already_claimed"
          ? "This host has already been claimed."
          : result.reason === "not_authorized"
          ? "This account is not authorized to claim or transfer this host."
          : result.reason === "dns_required"
          ? "Verify control of the host with its DNS TXT challenge."
          : "This host is not ready to be claimed yet.",
        dnsToken: action === "verify_dns" ? dnsToken : null,
        dnsFailure,
        directoryListing,
        detectedLookup,
        linkError,
      },
    );
    return await ctx.render(<HostClaimPage {...page} />, {
      status: 403,
    });
  },
});

export function hostClaimManageLocation(
  host: string,
  transferred: boolean,
  linkError: boolean,
): string {
  const search = new URLSearchParams({
    [transferred ? "transferred" : "claimed"]: "1",
    dns: "1",
  });
  if (linkError) search.set("linkError", "1");
  return `/hosts/${encodeURIComponent(host)}/manage?${search}`;
}

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
    headers: { location },
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
  transferContext: ResolvedHostOwnerTransferContext | null,
  feedback: {
    error?: string | null;
    dnsToken?: string | null;
    dnsFailure?: HostDnsChallengeVerificationFailureReason | null;
    directoryListing?: boolean;
    detectedLookup?: boolean;
    linkError?: boolean;
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
  const dnsToken = feedback.dnsToken?.trim() || null;
  let dnsFailure = feedback.dnsFailure ?? null;
  let dnsChallenge:
    | Extract<InspectedHostDnsChallengeResult, { ok: true }>
    | null = null;
  if (dnsToken && !dnsFailure) {
    const inspected = await inspectHostDnsChallenge(
      { host: host.host },
      user,
      dnsToken,
    ).catch(() => ({ ok: false as const, reason: "invalid" as const }));
    if (inspected.ok) dnsChallenge = inspected;
    else dnsFailure = inspected.reason;
  }
  const repairingClaim = !transferContext && !!claim &&
    claim.claimantDid === user.did && verifiedClaimOwnerDid !== user.did;
  const validTransfer = !!transferContext && !!claim &&
    claim.claimantDid === transferContext.intent.previousOwnerDid &&
    claim.claimantDid !== user.did;
  if (validTransfer || repairingClaim) {
    state = dnsChallenge ? "dns" : "verification";
  } else if (verifiedClaimOwnerDid === user.did) {
    state = "claimed-by-you";
  } else if (verifiedClaimOwnerDid) {
    state = "claimed-by-other";
  } else if (claim) {
    state = "not-authorized";
  } else if (hostSelfServiceClaimPolicy(host.host) === "local-dev") {
    const proof = verifyHostClaimDomainProof(host, user);
    state = proof.ok ? "ready" : "not-claimable";
  } else {
    state = dnsChallenge ? "dns" : "verification";
  }
  return {
    host,
    claim,
    authority,
    state,
    activeHandle: user.handle,
    error: feedback.error ??
      (dnsFailure
        ? hostDnsChallengeVerificationFailureMessage(dnsFailure)
        : null),
    account,
    linkContext,
    dnsChallenge,
    dnsToken,
    dnsFailure,
    directoryListing: feedback.directoryListing ?? true,
    detectedLookup: feedback.detectedLookup ?? false,
    transferContext,
    repairingClaim,
    linkError: feedback.linkError ?? false,
  };
}

function redirectToSignin(
  host: AccountHost,
  url: URL,
  transferContext: ResolvedHostOwnerTransferContext | null,
): Response {
  return new Response(null, {
    status: 303,
    headers: {
      location: hostClaimAuthorizationHref(
        host,
        url,
        transferContext ? "host_transfer" : "host_claim",
      ),
    },
  });
}

export function hostClaimAuthorizationHref(
  host: Pick<AccountHost, "host" | "displayName">,
  url: URL,
  action: "host_claim" | "host_transfer" = "host_claim",
): string {
  return oauthSigninUrl({
    next: `/hosts/${encodeURIComponent(host.host)}/claim${url.search}`,
    action,
    capabilities: HOST_MANAGEMENT_CAPABILITIES,
    name: host.displayName,
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
    dnsChallenge,
    dnsToken,
    dnsFailure,
    directoryListing,
    detectedLookup,
    transferContext,
    repairingClaim,
    linkError,
  } = props;
  return (
    <div id="page-top">
      <div class="content-layer">
        <Nav account={account} active="hosts" />
        <main
          id="main-content"
          class="signin-page-section host-claim-section"
        >
          <div class="container signin-page-container">
            <a
              href={detectedLookup
                ? detectedClaimHref(linkContext)
                : host
                ? `/hosts/${encodeURIComponent(host.host)}`
                : "/hosts"}
              class="text-link-button"
            >
              ← {detectedLookup && linkContext
                ? "Back to app hosting"
                : detectedLookup
                ? "Back to PDS lookup"
                : host
                ? "Back to host"
                : "Back to hosts"}
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
                      {hostClaimIntroCopy({
                        state,
                        linkAppName: linkContext?.app.name ?? null,
                        transferring: !!transferContext,
                      })}
                    </p>
                    <ClaimBody
                      host={host}
                      claim={claim}
                      authority={authority}
                      state={state}
                      activeHandle={activeHandle}
                      error={error}
                      linkContext={linkContext}
                      dnsChallenge={dnsChallenge}
                      dnsToken={dnsToken}
                      dnsFailure={dnsFailure}
                      directoryListing={directoryListing}
                      detectedLookup={detectedLookup}
                      transferContext={transferContext}
                      repairingClaim={repairingClaim}
                      linkError={linkError}
                    />
                    <DetectedHostSummary host={host} />
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
        </main>
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
    dnsChallenge,
    dnsToken,
    dnsFailure,
    directoryListing,
    detectedLookup,
    transferContext,
    repairingClaim,
    linkError,
  }: {
    host: AccountHost;
    claim: AccountHostClaim | null;
    authority: AccountHostClaimAuthority | null;
    state: ClaimState;
    activeHandle: string | null;
    error: string | null;
    linkContext: HostClaimLinkContext | null;
    dnsChallenge: Extract<InspectedHostDnsChallengeResult, { ok: true }> | null;
    dnsToken: string | null;
    dnsFailure: HostDnsChallengeVerificationFailureReason | null;
    directoryListing: boolean;
    detectedLookup: boolean;
    transferContext: ResolvedHostOwnerTransferContext | null;
    repairingClaim: boolean;
    linkError: boolean;
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
          Manage host
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
              host,
              linkContext,
              directoryListing,
              detectedLookup,
              linkError,
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
      <form
        method="POST"
        class="host-claim-form"
        data-submit-once="true"
      >
        <input type="hidden" name="action" value="claim" />
        {error && (
          <p class="profile-form-status profile-form-status--error">{error}</p>
        )}
        <div class="host-claim-panel host-claim-panel-ok">
          <p class="host-claim-panel-title">
            Signed in as <AtmosphereHandle handle={activeHandle} />
          </p>
          <p class="text-body">
            This explicit local <code>.test</code>{" "}
            fixture can be claimed without a public DNS lookup.
          </p>
        </div>
        <DirectoryListingChoice checked={directoryListing} />
        <button
          type="submit"
          class="directory-register-button"
          data-pending-label={linkContext
            ? "Claiming and connecting…"
            : "Claiming host…"}
        >
          <span class="directory-register-button-icon" aria-hidden="true">
            +
          </span>
          <span data-submit-once-label>
            {linkContext ? "Claim and connect host" : "Claim this host"}
          </span>
        </button>
      </form>
    );
  }
  if (state === "dns" && dnsToken && dnsChallenge) {
    return (
      <form method="POST" class="host-claim-form" data-submit-once="true">
        <input type="hidden" name="action" value="verify_dns" />
        <input type="hidden" name="dns_token" value={dnsToken} />
        {error && (
          <p
            class="profile-form-status profile-form-status--error"
            role="alert"
          >
            {error}
          </p>
        )}
        <div class="host-claim-panel host-claim-panel-ok">
          <p class="host-claim-panel-title">Add this DNS TXT record</p>
          <p class="text-body">
            Add the exact record below with your DNS provider. Keep this page
            open while DNS updates, then verify it.
          </p>
          <dl class="host-claim-detected-summary">
            <div>
              <dt>Name</dt>
              <dd>
                <code>{dnsChallenge.recordName}</code>
              </dd>
            </div>
            <div>
              <dt>Type</dt>
              <dd>
                <code>TXT</code>
              </dd>
            </div>
            <div>
              <dt>Value</dt>
              <dd>
                <code>{dnsChallenge.recordValue}</code>
              </dd>
            </div>
          </dl>
        </div>
        {!transferContext && (
          <DirectoryListingChoice checked={directoryListing} />
        )}
        <button
          type="submit"
          class="directory-register-button"
          data-pending-label="Verifying DNS…"
        >
          <span data-submit-once-label>
            {transferContext
              ? "Verify DNS and change manager"
              : repairingClaim
              ? "Verify DNS and restore management"
              : "Verify DNS and claim host"}
          </span>
        </button>
        <a
          class="text-link-button"
          href={switchAccountHref(
            host,
            linkContext,
            directoryListing,
            detectedLookup,
            linkError,
            transferContext,
            dnsToken,
          )}
        >
          {dnsFailure === "account_mismatch"
            ? "Return to the account that started verification"
            : "Choose another account"}
        </a>
      </form>
    );
  }
  if (state === "verification") {
    return (
      <form method="POST" class="host-claim-form" data-submit-once="true">
        <input type="hidden" name="action" value="request_dns" />
        {error && (
          <p
            class="profile-form-status profile-form-status--error"
            role="alert"
          >
            {error}
          </p>
        )}
        <div class="host-claim-panel host-claim-panel-ok">
          <p class="host-claim-panel-title">
            {transferContext
              ? "Change the managing account"
              : repairingClaim
              ? "Restore verified management"
              : "Verify host ownership"}
          </p>
          <p class="text-body">
            {transferContext
              ? `The existing manager remains in control until the new account proves control of ${host.host} with DNS.`
              : `Add a temporary DNS record to prove that you control ${host.host}. Permission alone does not claim the host.`}
          </p>
          <p class="text-body">
            Managing account:{" "}
            <strong>
              <AtmosphereHandle handle={activeHandle} />
            </strong>
          </p>
        </div>
        {!transferContext && (
          <DirectoryListingChoice checked={directoryListing} />
        )}
        <button
          type="submit"
          class="directory-register-button"
          data-pending-label="Preparing DNS record…"
        >
          <span data-submit-once-label>Show DNS record</span>
        </button>
        <a
          class="text-link-button"
          href={switchAccountHref(
            host,
            linkContext,
            directoryListing,
            detectedLookup,
            linkError,
            transferContext,
          )}
        >
          Choose another account
        </a>
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
            This site could not verify the account currently recorded as this
            host’s operator. Nothing has been changed; try again later.
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
          href={switchAccountHref(
            host,
            linkContext,
            directoryListing,
            detectedLookup,
            linkError,
          )}
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
      <p class="host-claim-panel-title">DNS verification required</p>
      <p class="text-body">
        Verify the host with a temporary DNS TXT record. Social handles, email
        addresses, and repository records do not prove control of its domain.
      </p>
      {linkContext && (
        <a
          class="directory-register-button host-claim-secondary-action"
          href={switchAccountHref(
            host,
            linkContext,
            directoryListing,
            detectedLookup,
            linkError,
          )}
        >
          <span>Use the host operator account</span>
        </a>
      )}
    </div>
  );
}

export function hostClaimIntroCopy(
  input: {
    state: ClaimState;
    linkAppName?: string | null;
    transferring?: boolean;
  },
): string {
  if (input.state === "claimed-by-you") {
    return input.linkAppName
      ? `This account already manages this host. You can connect it to ${input.linkAppName} below.`
      : "This account already manages this host. Open management to update its public profile and settings.";
  }
  if (input.state === "claimed-by-other") {
    return "This host already has a verified managing account.";
  }
  if (input.state === "not-authorized") {
    return "This host has an existing claim that this account cannot use.";
  }
  if (input.transferring) {
    return "The new managing account must prove control of this host with DNS before anything changes.";
  }
  if (input.state === "ready") {
    return input.linkAppName
      ? `This local .test fixture uses the development claim path and then connects it to ${input.linkAppName}.`
      : "This local .test fixture uses the development claim path. Once claimed, this Atmosphere account can manage its public profile and images.";
  }
  if (input.linkAppName) {
    return `DNS verification proves control of this host and then connects it to ${input.linkAppName}.`;
  }
  return "A temporary DNS record proves that you operate this host. Once claimed, this Atmosphere account can manage its public profile and images.";
}

function textValue(value: FormDataEntryValue | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function claimPathForContext(
  host: string,
  linkContext: HostClaimLinkContext | null,
  directoryListing = true,
  detectedLookup = false,
  linkError = false,
  transferContext: ResolvedHostOwnerTransferContext | null = null,
  dnsToken: string | null = null,
): string {
  const path = `/hosts/${encodeURIComponent(host)}/claim`;
  const search = new URLSearchParams({
    publish: directoryListing ? "1" : "0",
  });
  if (linkContext) {
    search.set("link_intent", linkContext.intentToken);
  }
  if (transferContext) search.set("transfer_intent", transferContext.token);
  if (dnsToken) search.set("dns_token", dnsToken);
  if (detectedLookup) search.set("from", "detected");
  if (linkError) search.set("linkError", "1");
  return `${path}?${search}`;
}

export function hostClaimExpiredLinkContinuationPathForTest(
  host: string,
): string {
  return claimPathForContext(host, null, true, false, true);
}

function switchAccountHref(
  host: Pick<AccountHost, "host" | "displayName">,
  linkContext: HostClaimLinkContext | null,
  directoryListing: boolean,
  detectedLookup: boolean,
  linkError: boolean,
  transferContext: ResolvedHostOwnerTransferContext | null = null,
  dnsToken: string | null = null,
): string {
  const next = claimPathForContext(
    host.host,
    linkContext,
    directoryListing,
    detectedLookup,
    linkError,
    transferContext,
    dnsToken,
  );
  return oauthAddAccountHref(oauthSigninUrl({
    next,
    action: transferContext ? "host_transfer" : "host_claim",
    capabilities: HOST_MANAGEMENT_CAPABILITIES,
    name: host.displayName,
  }));
}

async function loadTransferContext(
  url: URL,
  expectedHost: string,
): Promise<Awaited<ReturnType<typeof resolveHostOwnerTransferIntent>>> {
  return await resolveHostOwnerTransferIntent(
    url.searchParams.get("transfer_intent")?.trim() || null,
    expectedHost,
  );
}

function hostTransferFailureMessage(
  reason: "invalid" | "expired" | "host_mismatch" | "owner_changed",
): string {
  return reason === "expired"
    ? "This managing-account change has expired. Ask the current manager to start it again."
    : reason === "owner_changed"
    ? "The managing account changed after this request began. Nothing else was changed."
    : "This managing-account change is invalid. Nothing was changed.";
}

function invalidHostTransferResponse(message: string): Response {
  return new Response(message, {
    status: 400,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
      "referrer-policy": "no-referrer",
      "x-robots-tag": "noindex, nofollow",
    },
  });
}

function readDnsFailureIntent(
  url: URL,
): HostDnsChallengeVerificationFailureReason | null {
  const value = url.searchParams.get("dns_failure");
  return isHostDnsChallengeVerificationFailureReason(value) ? value : null;
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
): Promise<HostClaimLinkContext | "expired" | null | Response> {
  const token = url.searchParams.get("link_intent")?.trim();
  if (!token) return null;
  const resolved = await resolveBoundAppHostLinkIntent(token, expectedHost);
  if (!resolved.ok) {
    if (resolved.reason === "expired") {
      const inspected = await inspectExpiredBoundAppHostLinkIntent(
        token,
        expectedHost,
      );
      if (inspected.ok) return "expired";
      return new Response(appHostLinkIntentErrorMessage(inspected.reason), {
        status: 400,
        headers: { "cache-control": "no-store" },
      });
    }
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
