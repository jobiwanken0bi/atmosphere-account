import { define } from "../../../utils.ts";
import Nav from "../../../components/Nav.tsx";
import Footer from "../../../components/Footer.tsx";
import AtmosphereHandle from "../../../components/AtmosphereHandle.tsx";
import HostMark from "../../../components/hosts/HostMark.tsx";
import OwnerManagementLink from "../../../components/OwnerManagementLink.tsx";
import CopyTextButton from "../../../islands/CopyTextButton.tsx";
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
  resolveBoundAppHostLinkIntent,
  type ResolvedAppHostLinkIntent,
} from "../../../lib/app-host-link-intent.ts";
import { oauthSigninUrl } from "../../../lib/oauth-action.ts";
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
import type { ComponentChildren } from "preact";

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
  hostAuthorized: boolean;
  transferContext: HostTransferContext | null;
  repairingClaim: boolean;
}

interface HostClaimLinkContext {
  app: AppListing;
  relationship: "same_product" | "same_operator";
  appOwnerDid: string;
  intentToken: string;
  intent: BoundAppHostLinkIntent;
}

type HostTransferContext = ResolvedHostOwnerTransferContext;

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
          hostAuthorized={false}
          transferContext={null}
          repairingClaim={false}
        />,
        { status: 404 },
      );
    }
    if (!ctx.state.user) {
      return redirectToSignin(host, ctx.url);
    }
    if (
      !await getSessionForCapabilities(ctx.state.user.did, ["host"], {
        quiet: true,
      })
    ) {
      return redirectToSignin(host, ctx.url);
    }
    const dnsToken = ctx.url.searchParams.get("dns_token")?.trim() || null;
    const transferResolution = await loadTransferContext(ctx.url, host.host);
    const transferContext = transferResolution.ok
      ? transferResolution.value
      : null;
    const transferFailureReason = transferResolution.ok ||
        transferResolution.reason === "missing"
      ? null
      : transferResolution.reason;
    const transferFailed = transferFailureReason !== null;
    const loadedLinkContext = await loadLinkContext(ctx.url, host.host);
    const linkContextExpired = loadedLinkContext instanceof Response;
    const linkContextFailed = hostClaimHasLinkFailure(
      ctx.url,
      linkContextExpired,
    );
    const linkContext = loadedLinkContext instanceof Response
      ? null
      : loadedLinkContext;
    if (transferContext && linkContext) {
      return invalidHostTransferResponse(
        "A managing-account change cannot also connect an app.",
      );
    }
    const dnsFailure = transferFailed ? null : readDnsFailureIntent(ctx.url);
    const page = await buildClaimPageProps(
      host,
      ctx.state.user,
      buildAccountMenuProps(ctx.state),
      linkContext,
      transferContext,
      {
        error: transferFailureReason
          ? hostTransferFailureMessage(transferFailureReason)
          : dnsFailure
          ? null
          : linkContextExpired
          ? "The app connection request expired. You can still claim the host, then reconnect it from app management."
          : linkContextFailed
          ? "The app connection could not be completed. You can still claim the host, then reconnect it from app management."
          : ctx.url.searchParams.get("legacy_email") === "1"
          ? "Email links are no longer used for new host claims. Existing claimed hosts are unchanged; new claims require DNS."
          : null,
        dnsToken: transferFailed ? null : dnsToken,
        dnsFailure,
        directoryListing: readDirectoryListingIntent(
          ctx.url,
          transferContext ? host.operatorListingOptIn !== false : true,
        ),
        detectedLookup: readDetectedLookupIntent(ctx.url),
      },
    );
    const response = await ctx.render(<HostClaimPage {...page} />);
    if (dnsToken || ctx.url.searchParams.has("transfer_intent")) {
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
    if (!ctx.state.user) {
      return redirectToSignin(host, ctx.url);
    }
    if (
      !await getSessionForCapabilities(ctx.state.user.did, ["host"], {
        quiet: true,
      })
    ) {
      return redirectToSignin(host, ctx.url);
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
    const dnsToken = textValue(form?.get("dns_token")) ||
      ctx.url.searchParams.get("dns_token")?.trim() || "";
    const transferResolution = await loadTransferContext(ctx.url, host.host);
    const transferContext = transferResolution.ok
      ? transferResolution.value
      : null;
    if (!transferResolution.ok && transferResolution.reason !== "missing") {
      return invalidHostTransferResponse(
        hostTransferFailureMessage(transferResolution.reason),
      );
    }
    const loadedLinkContext = await loadLinkContext(ctx.url, host.host);
    const linkContextExpired = loadedLinkContext instanceof Response;
    const linkContextFailed = hostClaimHasLinkFailure(
      ctx.url,
      linkContextExpired,
    );
    const linkContext = loadedLinkContext instanceof Response
      ? null
      : loadedLinkContext;
    if (transferContext && linkContext) {
      return invalidHostTransferResponse(
        "A managing-account change cannot also connect an app.",
      );
    }
    const submittedListingSelection = readDirectoryListingSelection(form);
    const listingSelection = transferContext
      ? undefined
      : submittedListingSelection;
    const directoryListing = transferContext
      ? host.operatorListingOptIn !== false
      : listingSelection ?? readDirectoryListingIntent(ctx.url, true);
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
          transferContext,
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
    if (action === "connect_app" && linkContextExpired) {
      return new Response(null, {
        status: 303,
        headers: {
          location: hostClaimManagementHref(host, { linkError: true }),
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
        const validRepair = isSameDidHostClaimRepair(
          existingClaim,
          verifiedOwnerDid,
          ctx.state.user.did,
          Boolean(transferContext),
        );
        if (validTransfer || validRepair) {
          // Continue below: the current owner explicitly initiated this
          // replacement, but no ownership changes until DNS succeeds.
        } else {
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
          transferContext,
        ),
        ctx.url,
      );
      location.searchParams.set("dns_token", requested.verificationToken);
      if (linkContextFailed) location.searchParams.set("linkError", "1");
      return new Response(null, {
        status: 303,
        headers: {
          location: `${location.pathname}${location.search}`,
          "cache-control": "no-store",
          "referrer-policy": "no-referrer",
        },
      });
    }
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
          ...(transferContext
            ? {
              transfer: transferContext,
            }
            : {}),
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
          { claimed: true, dnsVerified: action === "verify_dns" },
        );
      }
      return new Response(null, {
        status: 303,
        headers: {
          location: hostClaimManagementHref(result.host, {
            claimed: true,
            dnsVerified: action === "verify_dns",
            transferred: Boolean(transferContext),
            linkError: linkContextFailed,
          }),
        },
      });
    }
    const dnsFailure = isHostDnsChallengeVerificationFailureReason(
        result.reason,
      )
      ? result.reason
      : null;
    if (action === "verify_dns" && dnsFailure) {
      const location = new URL(
        claimPathForContext(
          (result.host ?? host).host,
          linkContext,
          directoryListing,
          detectedLookup,
          transferContext,
          dnsToken,
        ),
        ctx.url,
      );
      location.searchParams.set("dns_failure", dnsFailure);
      if (linkContextFailed) location.searchParams.set("linkError", "1");
      return new Response(null, {
        status: 303,
        headers: {
          location: `${location.pathname}${location.search}`,
          "cache-control": "no-store",
          "referrer-policy": "no-referrer",
        },
      });
    }
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
          ? "Verify control of this host with the required DNS record."
          : "This host is not ready to be claimed yet.",
        dnsToken: action === "verify_dns" ? dnsToken : null,
        dnsFailure,
        directoryListing,
        detectedLookup,
      },
    );
    const response = await ctx.render(<HostClaimPage {...page} />, {
      status: 403,
    });
    if (action === "verify_dns") {
      response.headers.set("cache-control", "no-store");
      response.headers.set("referrer-policy", "no-referrer");
      response.headers.set("x-robots-tag", "noindex, nofollow");
    }
    return response;
  },
});

async function completeAppHostLink(
  host: AccountHost,
  currentHostDid: string,
  linkContext: HostClaimLinkContext,
  options: { claimed?: boolean; dnsVerified?: boolean } = {},
): Promise<Response> {
  const linked = await establishDirectoryEntityLinkFromIntent({
    intent: linkContext.intent,
    currentHostDid,
  }).catch((error) => {
    console.error("[host-claim] app connection completion failed:", error);
    return { ok: false as const };
  });
  const location = hostClaimManagementHref(host, {
    claimed: options.claimed,
    dnsVerified: options.dnsVerified,
    linked: linked.ok,
    linkError: !linked.ok,
  });
  return new Response(null, {
    status: 303,
    headers: { location },
  });
}

export function hostClaimManagementHref(
  host: Pick<AccountHost, "host">,
  outcome: HostClaimOutcome,
): string {
  const query = hostClaimOutcomeQuery(outcome);
  return `/hosts/${encodeURIComponent(host.host)}/manage${
    query ? `?${query}` : ""
  }`;
}

export function hostClaimDetailHref(
  host: Pick<AccountHost, "host">,
  outcome: HostClaimOutcome,
): string {
  const query = hostClaimOutcomeQuery(outcome);
  return `/hosts/${encodeURIComponent(host.host)}${query ? `?${query}` : ""}`;
}

function hostClaimOutcomeQuery(
  outcome: HostClaimOutcome,
): string {
  const query = new URLSearchParams();
  if (outcome.claimed) query.set("claimed", "1");
  if (outcome.linked) query.set("linked", "1");
  if (outcome.linkError) query.set("linkError", "1");
  if (outcome.dnsVerified) query.set("dns", "1");
  if (outcome.transferred) query.set("transferred", "1");
  return query.toString();
}

interface HostClaimOutcome {
  claimed?: boolean;
  linked?: boolean;
  linkError?: boolean;
  dnsVerified?: boolean;
  transferred?: boolean;
}

function appviewUnavailable(scope: string, _err: unknown): Response {
  console.error("[appview] host claim proxy failed (%s)", scope);
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
  transferContext: HostTransferContext | null,
  feedback: {
    error?: string | null;
    dnsToken?: string | null;
    dnsFailure?: HostDnsChallengeVerificationFailureReason | null;
    directoryListing?: boolean;
    detectedLookup?: boolean;
  } = {},
): Promise<ClaimPageProps> {
  const [claim, authority, hostSession] = await Promise.all([
    getAccountHostClaim(host.host).catch(() => null),
    resolveAccountHostClaimAuthority(host).catch(() => null),
    getSessionForCapabilities(user.did, ["host"], { quiet: true }).catch(
      () => null,
    ),
  ]);
  const verifiedClaimOwnerDid = claim
    ? await verifiedAccountHostOwnerDid(host, claim).catch(() => null)
    : null;
  let state: ClaimState = "not-claimable";
  const dnsToken = feedback.dnsToken?.trim() || null;
  let dnsFailure: HostDnsChallengeVerificationFailureReason | null =
    feedback.dnsFailure ?? null;
  let dnsChallenge:
    | Extract<InspectedHostDnsChallengeResult, { ok: true }>
    | null = null;
  if (dnsToken) {
    const inspected = await inspectHostDnsChallenge(
      { host: host.host },
      user,
      dnsToken,
    ).catch(() => ({ ok: false as const, reason: "invalid" as const }));
    if (inspected.ok) dnsChallenge = inspected;
    else dnsFailure = inspected.reason;
  }
  const isTransferTarget = Boolean(
    transferContext && claim &&
      transferContext.intent.previousOwnerDid === claim.claimantDid &&
      claim.claimantDid !== user.did,
  );
  const repairingClaim = isSameDidHostClaimRepair(
    claim,
    verifiedClaimOwnerDid,
    user.did,
    Boolean(transferContext),
  );
  if (verifiedClaimOwnerDid === user.did) {
    state = "claimed-by-you";
  } else if (isTransferTarget) {
    state = dnsChallenge ? "dns" : "verification";
  } else if (repairingClaim) {
    state = dnsChallenge ? "dns" : "verification";
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
    directoryListing: feedback.directoryListing ??
      (transferContext ? host.operatorListingOptIn !== false : true),
    detectedLookup: feedback.detectedLookup ?? false,
    hostAuthorized: Boolean(hostSession),
    transferContext,
    repairingClaim,
  };
}

function redirectToSignin(host: AccountHost, url: URL): Response {
  const next = `/hosts/${encodeURIComponent(host.host)}/claim${url.search}`;
  return new Response(null, {
    status: 303,
    headers: {
      location: hostClaimAuthorizationHrefForNext(
        host,
        next,
        url.searchParams.has("transfer_intent")
          ? "host_transfer"
          : "host_claim",
      ),
    },
  });
}

export function hostClaimAuthorizationHref(
  host: Pick<AccountHost, "host" | "displayName">,
  url: URL,
): string {
  return hostClaimAuthorizationHrefForNext(
    host,
    `/hosts/${encodeURIComponent(host.host)}/claim${url.search}`,
  );
}

function hostClaimAuthorizationHrefForNext(
  host: Pick<AccountHost, "displayName">,
  next: string,
  action: "host_claim" | "host_transfer" = "host_claim",
): string {
  return oauthSigninUrl({
    next,
    action,
    capabilities: ["host"],
    name: host.displayName,
  });
}

function hostClaimIntroCopy(
  {
    host,
    state,
    activeHandle,
    linkContext,
    transferContext,
    repairingClaim,
  }: {
    host: Pick<AccountHost, "displayName">;
    state: ClaimState;
    activeHandle: string | null;
    linkContext: HostClaimLinkContext | null;
    transferContext: HostTransferContext | null;
    repairingClaim: boolean;
  },
): string {
  const account = activeHandle ? `@${activeHandle}` : "this account";
  if (transferContext && state === "claimed-by-you") {
    return `${account} already manages ${host.displayName}. Choose another account to continue.`;
  }
  if (transferContext) {
    return `The current manager stays in control until ${account} verifies the host domain with DNS.`;
  }
  if (repairingClaim) {
    return `Reverify the host domain with DNS to restore management for ${account}.`;
  }
  if (linkContext && state === "claimed-by-you") {
    return `Connect this managed host to ${linkContext.app.name}.`;
  }
  if (linkContext) {
    return `Verify control of this host to claim it and connect it to ${linkContext.app.name}.`;
  }
  if (state === "claimed-by-you") {
    return `${account} already manages this host.`;
  }
  if (state === "claimed-by-other") {
    return "This host already has a managing account.";
  }
  return `${account} will manage this host’s public profile and images after DNS verification.`;
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
    hostAuthorized,
    transferContext,
    repairingClaim,
  } = props;
  const backHref = transferContext && host
    ? `/hosts/${encodeURIComponent(host.host)}/manage`
    : detectedLookup
    ? detectedClaimHref(linkContext)
    : host
    ? `/hosts/${encodeURIComponent(host.host)}`
    : "/hosts";
  const backLabel = transferContext
    ? "Back to host management"
    : detectedLookup && linkContext
    ? "Back to app hosting"
    : detectedLookup
    ? "Back to PDS lookup"
    : "Back to host";
  return (
    <div id="page-top">
      <div class="content-layer">
        <Nav account={account} active="hosts" />
        <section class="signin-page-section host-claim-section">
          <div class="container signin-page-container">
            <a
              href={backHref}
              class="text-link-button"
            >
              {backLabel}
            </a>
            <div class="glass signin-page-card host-claim-card">
              {host
                ? (
                  <>
                    <div class="host-claim-heading">
                      <HostMark host={host} />
                      <div>
                        <p class="text-eyebrow">
                          {transferContext
                            ? "Change managing account"
                            : "Claim this host"}
                        </p>
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
                        host,
                        state,
                        activeHandle,
                        linkContext,
                        transferContext,
                        repairingClaim,
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
                      hostAuthorized={hostAuthorized}
                      account={account}
                      transferContext={transferContext}
                      repairingClaim={repairingClaim}
                    />
                    {detectedLookup && <DetectedHostSummary host={host} />}
                  </>
                )
                : (
                  <>
                    <p class="text-eyebrow">Claim this host</p>
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
    dnsChallenge,
    dnsToken,
    dnsFailure,
    directoryListing,
    detectedLookup,
    hostAuthorized,
    account,
    transferContext,
    repairingClaim,
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
    hostAuthorized: boolean;
    account: ReturnType<typeof buildAccountMenuProps>;
    transferContext: HostTransferContext | null;
    repairingClaim: boolean;
  },
) {
  const accountMismatchDnsToken = dnsFailure === "account_mismatch"
    ? dnsToken
    : null;
  if (state === "claimed-by-you") {
    if (transferContext) {
      return (
        <div class="host-claim-panel host-claim-panel-ok">
          {error && (
            <p
              class="profile-form-status profile-form-status--error"
              role="alert"
            >
              {error}
            </p>
          )}
          <h2 class="host-claim-panel-title">This is already the manager</h2>
          <p class="text-body">
            <AtmosphereHandle handle={claim?.claimantHandle} /> already manages
            {" "}
            {host.displayName}. Choose another account to continue, or return to
            host management.
          </p>
          <div class="host-claim-verification-actions">
            <a
              class="account-dashboard-button account-dashboard-button--secondary"
              href={hostClaimSwitchAccountHref(
                host,
                linkContext,
                directoryListing,
                detectedLookup,
                transferContext,
                accountMismatchDnsToken,
              )}
            >
              Choose another account
            </a>
          </div>
        </div>
      );
    }
    return (
      <div class="host-claim-panel host-claim-panel-ok">
        {error && (
          <p
            class="profile-form-status profile-form-status--error"
            role="alert"
          >
            {error}
          </p>
        )}
        <h2 class="host-claim-panel-title">
          Claimed by <AtmosphereHandle handle={claim?.claimantHandle} />
        </h2>
        <p class="text-body">
          This account is already managing {host.displayName}.
        </p>
        <p class="text-body">
          Directory visibility is currently{" "}
          <strong>
            {host.operatorListingOptIn === false ? "off" : "on"}
          </strong>.
        </p>
        <ClaimedHostManagementLink
          host={host}
          authorized={hostAuthorized}
          account={account}
        />
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
          <p
            class="profile-form-status profile-form-status--error"
            role="alert"
          >
            {error}
          </p>
        )}
        <h2 class="host-claim-panel-title">Already claimed</h2>
        <p class="text-body">
          This host is managed by{" "}
          <AtmosphereHandle handle={claim?.claimantHandle} />.
        </p>
        <a
          class="account-dashboard-button account-dashboard-button--secondary host-claim-secondary-action"
          href={hostClaimSwitchAccountHref(
            host,
            linkContext,
            directoryListing,
            detectedLookup,
            transferContext,
            accountMismatchDnsToken,
          )}
        >
          <span>Choose the managing account</span>
        </a>
      </div>
    );
  }
  if (state === "ready") {
    return (
      <form method="POST" class="host-claim-form">
        <input type="hidden" name="action" value="claim" />
        {error && (
          <p
            class="profile-form-status profile-form-status--error"
            role="alert"
          >
            {error}
          </p>
        )}
        <div class="host-claim-panel">
          <h2 class="host-claim-panel-title">
            Signed in as <AtmosphereHandle handle={activeHandle} />
          </h2>
          <p class="text-body">
            This local development fixture can be claimed without DNS
            verification.
          </p>
        </div>
        <DirectoryListingChoice checked={directoryListing} />
        <button
          type="submit"
          class="account-dashboard-button account-dashboard-button--primary host-claim-primary-action"
        >
          <span>
            {linkContext ? "Claim and connect host" : "Claim this host"}
          </span>
        </button>
      </form>
    );
  }
  if (state === "dns" && dnsChallenge) {
    return (
      <form method="POST" class="host-claim-form">
        <input
          type="hidden"
          name="dns_token"
          value={dnsChallenge.verificationToken}
        />
        {error && (
          <p
            class="profile-form-status profile-form-status--error"
            role="alert"
          >
            {error}
          </p>
        )}
        <div class="host-claim-panel host-dns-instructions">
          <h2 class="host-claim-panel-title">Add this DNS record</h2>
          <p class="text-body">
            At your DNS provider, add this temporary TXT record for{" "}
            {host.host}. Use the full name shown below. If your provider
            automatically adds {host.host}, enter only{" "}
            <code>_atmosphere-account</code>.
          </p>
          <dl class="host-dns-record">
            <div>
              <dt>Type</dt>
              <dd>
                <code>TXT</code>
              </dd>
            </div>
            <div>
              <dt>Name</dt>
              <dd>
                <code>{dnsChallenge.recordName}</code>
                <CopyTextButton
                  text={dnsChallenge.recordName}
                  label="Copy name"
                  copiedLabel="Name copied"
                  failedLabel="Couldn’t copy name"
                  className="profile-form-button-secondary host-dns-copy"
                />
              </dd>
            </div>
            <div>
              <dt>Value</dt>
              <dd>
                <code>{dnsChallenge.recordValue}</code>
                <CopyTextButton
                  text={dnsChallenge.recordValue}
                  label="Copy value"
                  copiedLabel="Value copied"
                  failedLabel="Couldn’t copy value"
                  className="profile-form-button-secondary host-dns-copy"
                />
              </dd>
            </div>
            <div>
              <dt>TTL</dt>
              <dd>
                <span>Automatic, or the shortest available</span>
              </dd>
            </div>
          </dl>
          <p class="profile-form-hint">
            DNS changes often appear within a few minutes, but can take longer.
            This record expires in 24 hours and can be removed after
            verification.
          </p>
        </div>
        {!transferContext && (
          <DirectoryListingChoice checked={directoryListing} />
        )}
        <div class="host-claim-verification-actions">
          <button
            type="submit"
            name="action"
            value="verify_dns"
            class="account-dashboard-button account-dashboard-button--primary host-claim-primary-action"
          >
            <span>Check DNS record</span>
          </button>
        </div>
      </form>
    );
  }
  if (state === "verification") {
    return (
      <div class="host-claim-form">
        {error && (
          <p
            class="profile-form-status profile-form-status--error"
            role="alert"
          >
            {error}
          </p>
        )}
        <div class="host-claim-panel">
          <h2 class="host-claim-panel-title">
            {transferContext
              ? "Choose the new manager"
              : repairingClaim
              ? "Reverify host ownership"
              : "Verify host ownership"}
          </h2>
          {transferContext
            ? (
              <div class="host-transfer-summary">
                <dl>
                  <dt>Current manager</dt>
                  <dd>
                    <AtmosphereHandle handle={claim?.claimantHandle} />
                  </dd>
                </dl>
                <span aria-hidden="true" class="host-transfer-arrow">→</span>
                <dl>
                  <dt>New manager</dt>
                  <dd>
                    <AtmosphereHandle handle={activeHandle} />
                  </dd>
                </dl>
              </div>
            )
            : (
              <p class="host-claim-account-row">
                <span>Managing account</span>
                <strong>
                  <AtmosphereHandle handle={activeHandle} />
                </strong>
              </p>
            )}
          <p class="text-body">
            {transferContext
              ? `The current manager stays in control until this account proves control of ${host.displayName} with DNS.`
              : repairingClaim
              ? `Add a temporary DNS record to restore verified management for ${host.displayName}. Nothing changes until verification succeeds.`
              : (
                <>
                  Add a temporary DNS record to prove that you operate{" "}
                  {host.displayName}. The host is not claimed until verification
                  succeeds.
                </>
              )}
          </p>
          <DnsOnlyHostClaimMethod repairingClaim={repairingClaim} />
        </div>
        <div class="host-claim-support-actions">
          <a
            class="text-link-button"
            href={hostClaimSwitchAccountHref(
              host,
              linkContext,
              directoryListing,
              detectedLookup,
              transferContext,
              accountMismatchDnsToken,
            )}
          >
            {dnsFailure === "account_mismatch"
              ? "Return to the account that started this verification"
              : "Choose another account"}
          </a>
        </div>
      </div>
    );
  }
  if (state === "not-authorized") {
    if (!authority?.did) {
      return (
        <div class="host-claim-panel">
          {error && (
            <p
              class="profile-form-status profile-form-status--error"
              role="alert"
            >
              {error}
            </p>
          )}
          <h2 class="host-claim-panel-title">
            Operator verification unavailable
          </h2>
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
          <p
            class="profile-form-status profile-form-status--error"
            role="alert"
          >
            {error}
          </p>
        )}
        <h2 class="host-claim-panel-title">
          Operator account required
        </h2>
        <p class="text-body">
          You are currently signed in as{" "}
          <AtmosphereHandle handle={activeHandle} />. This host is pinned to
          {" "}
          <AtmosphereHandle handle={authority.handle} />. If that is already
          this account, its stored ownership record needs repair before changes
          can be made.
        </p>
        <a
          class="account-dashboard-button account-dashboard-button--secondary host-claim-secondary-action"
          href={hostClaimSwitchAccountHref(
            host,
            linkContext,
            directoryListing,
            detectedLookup,
            transferContext,
            accountMismatchDnsToken,
          )}
        >
          <span>Choose another account</span>
        </a>
      </div>
    );
  }
  return (
    <div class="host-claim-panel">
      {error && (
        <p class="profile-form-status profile-form-status--error" role="alert">
          {error}
        </p>
      )}
      <h2 class="host-claim-panel-title">DNS verification required</h2>
      <p class="text-body">
        Verify the host with the required temporary DNS record. Social handles
        and repository records do not prove control of its domain.
      </p>
      {linkContext && (
        <a
          class="account-dashboard-button account-dashboard-button--secondary host-claim-secondary-action"
          href={hostClaimSwitchAccountHref(
            host,
            linkContext,
            directoryListing,
            detectedLookup,
          )}
        >
          <span>Choose the managing account</span>
        </a>
      )}
    </div>
  );
}

export function DnsOnlyHostClaimMethod(
  {
    repairingClaim = false,
  }: { repairingClaim?: boolean; children?: ComponentChildren },
) {
  return (
    <form
      method="POST"
      class="host-claim-method"
      aria-labelledby="host-dns-method-title"
    >
      <div class="host-claim-method-copy">
        <h2 id="host-dns-method-title">
          {repairingClaim ? "Reverify with DNS" : "Verify with DNS"}
        </h2>
        <p class="text-body">
          Add a temporary TXT record in your DNS settings to prove that you
          control this domain.
        </p>
      </div>
      <input type="hidden" name="action" value="request_dns" />
      <button
        type="submit"
        class="account-dashboard-button account-dashboard-button--primary host-claim-primary-action"
      >
        Show DNS record
      </button>
    </form>
  );
}

export function ClaimedHostManagementLink(
  {
    host,
    authorized,
    account,
  }: {
    host: Pick<AccountHost, "host" | "displayName">;
    authorized: boolean;
    account: ReturnType<typeof buildAccountMenuProps>;
  },
) {
  return (
    <OwnerManagementLink
      authorized={authorized}
      kind="host"
      destinationHref={`/hosts/${encodeURIComponent(host.host)}/manage`}
      targetName={host.displayName}
      label="Manage host"
      className="account-dashboard-button account-dashboard-button--primary host-claim-primary-action"
      rememberedAccounts={account.rememberedAccounts}
      initialHandle={account.user?.handle}
    />
  );
}

function textValue(value: FormDataEntryValue | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function claimPathForContext(
  host: string,
  linkContext: HostClaimLinkContext | null,
  directoryListing = true,
  detectedLookup = false,
  transferContext: HostTransferContext | null = null,
  dnsToken: string | null = null,
): string {
  const path = `/hosts/${encodeURIComponent(host)}/claim`;
  const search = new URLSearchParams({
    publish: directoryListing ? "1" : "0",
  });
  if (linkContext) {
    search.set("link_intent", linkContext.intentToken);
  }
  if (transferContext) {
    search.set("transfer_intent", transferContext.token);
  }
  if (dnsToken) search.set("dns_token", dnsToken);
  if (detectedLookup) search.set("from", "detected");
  return `${path}?${search}`;
}

export function hostClaimAddAccountHref(
  host: Pick<AccountHost, "host" | "displayName">,
  next: string,
  action: "host_claim" | "host_transfer" = "host_claim",
): string {
  return oauthAddAccountHref(
    hostClaimAuthorizationHrefForNext(host, next, action),
  );
}

export function hostClaimSwitchAccountHref(
  host: Pick<AccountHost, "host" | "displayName">,
  linkContext: HostClaimLinkContext | null,
  directoryListing: boolean,
  detectedLookup: boolean,
  transferContext: HostTransferContext | null = null,
  dnsToken: string | null = null,
): string {
  return hostClaimAddAccountHref(
    host,
    claimPathForContext(
      host.host,
      linkContext,
      directoryListing,
      detectedLookup,
      transferContext,
      dnsToken,
    ),
    transferContext ? "host_transfer" : "host_claim",
  );
}

async function loadTransferContext(
  url: URL,
  expectedHost: string,
): Promise<
  | { ok: true; value: HostTransferContext }
  | {
    ok: false;
    reason:
      | "missing"
      | "invalid"
      | "expired"
      | "host_mismatch"
      | "owner_changed";
  }
> {
  const token = url.searchParams.get("transfer_intent")?.trim() || null;
  return await resolveHostOwnerTransferIntent(token, expectedHost);
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

export function isSameDidHostClaimRepair(
  claim: Pick<AccountHostClaim, "claimantDid"> | null,
  verifiedOwnerDid: string | null,
  currentDid: string,
  hasTransferContext = false,
): boolean {
  return !hasTransferContext && !!claim &&
    claim.claimantDid === currentDid && verifiedOwnerDid !== currentDid;
}

export function hostClaimHasLinkFailure(
  url: URL,
  failedNow = false,
): boolean {
  return failedNow || url.searchParams.get("linkError") === "1";
}

function readDirectoryListingIntent(url: URL, fallback = true): boolean {
  const value = url.searchParams.get("publish");
  return value === "1" ? true : value === "0" ? false : fallback;
}

function readDetectedLookupIntent(url: URL): boolean {
  return url.searchParams.get("from") === "detected";
}

function readDnsFailureIntent(
  url: URL,
): HostDnsChallengeVerificationFailureReason | null {
  const value = url.searchParams.get("dns_failure");
  return isHostDnsChallengeVerificationFailureReason(value) ? value : null;
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
          Show this host in the public Hosts directory
        </span>
        <span class="profile-form-toggle-hint">
          Turn this off to keep its page and directory card hidden. You can
          change this later.
        </span>
      </span>
    </label>
  );
}

function DetectedHostSummary({ host }: { host: AccountHost }) {
  return (
    <details class="host-claim-detected-summary">
      <summary>
        <span>Detected host details</span>
        <span>{host.observedAccountCount.toLocaleString()} accounts seen</span>
      </summary>
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
      </dl>
    </details>
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
