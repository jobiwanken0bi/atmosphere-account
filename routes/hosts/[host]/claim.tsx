import { define } from "../../../utils.ts";
import Nav from "../../../components/Nav.tsx";
import Footer from "../../../components/Footer.tsx";
import AtmosphereHandle from "../../../components/AtmosphereHandle.tsx";
import HostMark from "../../../components/hosts/HostMark.tsx";
import CopyTextButton from "../../../islands/CopyTextButton.tsx";
import { buildAccountMenuProps } from "../../../lib/account-menu-props.ts";
import { proxyAppviewPageResponse } from "../../../lib/appview-client.ts";
import {
  type AccountHost,
  type AccountHostClaim,
  type AccountHostClaimAuthority,
  type AccountHostClaimRecovery,
  claimAccountHost,
  claimAccountHostWithAtprotoIdentity,
  claimAccountHostWithContactEmailEvidence,
  claimAccountHostWithDns,
  finalizeAccountHostEmailClaimRecovery,
  getAccountHost,
  getAccountHostClaim,
  getPendingAccountHostClaimRecovery,
  recordAccountHostClaimRecoveryNotification,
  reserveAccountHostClaimRecoveryNotification,
  resolveAccountHostClaimAuthority,
  verifiedAccountHostOwnerDid,
} from "../../../lib/account-hosts.ts";
import {
  type HostClaimProofMethod,
  hostSelfServiceClaimPolicy,
  verifyAtprotoHostClaimDomainProof,
  verifyHostClaimDomainProof,
} from "../../../lib/host-claim-proof.ts";
import {
  getHostContactEmailAvailability,
  hostContactEmailVerificationFailureMessage,
  type HostContactEmailVerificationFailureReason,
  inspectHostContactEmailChallenge,
  isHostContactEmailVerificationFailureReason,
  notifyHostContactEmailOfDnsRecovery,
  prepareHostContactEmailChallenge,
  requestHostContactEmailChallenge,
} from "../../../lib/host-claim-email.ts";
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
import { IS_DEV } from "../../../lib/env.ts";
import { trustedRequestOrigin } from "../../../lib/atmosphere-origins.ts";
import { devHostClaimEmailOptions } from "../../../lib/dev-host-claim-email.ts";

export {
  rejectLegacyHostClaimAction,
  stripLegacyHostClaimToken,
} from "../../../lib/host-claim-legacy.ts";

const MAX_HOST_CLAIM_BODY_BYTES = 32_768;
const HOST_CLAIM_EMAIL_TOKEN_COOKIE = "atmo_host_claim_email_token";
const HOST_CLAIM_EMAIL_TOKEN_MAX_AGE_SECONDS = 20 * 60;
const HOST_CLAIM_EMAIL_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

type ClaimState =
  | "ready"
  | "claimed-by-you"
  | "claimed-by-other"
  | "not-authorized"
  | "verification"
  | "dns"
  | "email-token"
  | "email-sent"
  | "recovery-pending"
  | "recovery-ready"
  | "not-claimable"
  | "error";

type HostContactMethodState =
  | {
    status: "available";
    maskedEmail: string;
    deliveryConfigured: boolean;
  }
  | { status: "unavailable" }
  | { status: "lookup-error" }
  | { status: "retry" }
  | { status: "not-offered" };

interface HostEmailSentState {
  maskedEmail: string;
  expiresAt: number;
  previewUrl: string | null;
}

interface HostClaimRecoveryView {
  requesterDid: string;
  requesterHandle: string;
  currentOwnerHandle: string;
  eligibleAt: number;
  viewerIsRequester: boolean;
}

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
  contactMethod: HostContactMethodState;
  emailToken: string | null;
  emailTokenFailure: HostContactEmailVerificationFailureReason | null;
  emailSent: HostEmailSentState | null;
  recovery: HostClaimRecoveryView | null;
  directoryListing: boolean;
  detectedLookup: boolean;
  transferContext: ResolvedHostOwnerTransferContext | null;
  repairingClaim: boolean;
  linkError: boolean;
  claimProofMethod: HostClaimProofMethod | null;
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
    const capturedEmailToken = captureHostClaimEmailToken(
      ctx.url,
      ctx.params.host,
    );
    if (capturedEmailToken) return capturedEmailToken;

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
          contactMethod={{ status: "not-offered" }}
          emailToken={null}
          emailTokenFailure={null}
          emailSent={null}
          recovery={null}
          directoryListing
          detectedLookup={false}
          transferContext={null}
          repairingClaim={false}
          linkError={false}
          claimProofMethod={null}
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
          ? "This retired email link is no longer valid. Choose a new verification method."
          : null,
        dnsToken,
        dnsFailure,
        emailToken: readHostClaimEmailToken(ctx.req),
        directoryListing: readDirectoryListingIntent(ctx.url),
        detectedLookup: readDetectedLookupIntent(ctx.url),
        linkError,
      },
    );
    const response = await ctx.render(<HostClaimPage {...page} />);
    if (
      (page.emailTokenFailure &&
        page.emailTokenFailure !== "account_mismatch") ||
      (page.emailToken &&
        (page.state === "claimed-by-you" ||
          page.state === "claimed-by-other" ||
          page.state === "not-authorized"))
    ) {
      response.headers.append(
        "set-cookie",
        clearHostClaimEmailTokenCookie(host.host),
      );
    }
    if (
      dnsToken || ctx.url.searchParams.has("transfer_intent") ||
      ctx.url.searchParams.has("link_intent") || linkError ||
      ctx.url.searchParams.has("legacy_email") || page.emailToken ||
      page.emailTokenFailure
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
        : action === "finalize_recovery"
        ? "host-claim-dns-finalize"
        : action === "request_contact_email"
        ? "host-claim-email-send"
        : action === "confirm_contact_email"
        ? "host-claim-email-confirm"
        : "host-claim-update",
      capacity: action === "verify_dns" || action === "finalize_recovery" ||
          action === "confirm_contact_email"
        ? 30
        : 8,
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
    if (action === "request_contact_email") {
      const existingClaim = await getAccountHostClaim(host.host).catch(() =>
        null
      );
      if (existingClaim || transferContext) {
        const page = await buildClaimPageProps(
          host,
          ctx.state.user,
          buildAccountMenuProps(ctx.state),
          linkContext,
          transferContext,
          {
            error: existingClaim
              ? "This host has already been claimed. Use DNS to recover or change its managing account."
              : "Email verification is available only for a host’s first claim.",
            directoryListing,
            detectedLookup,
            linkError,
          },
        );
        return ctx.render(<HostClaimPage {...page} />, { status: 409 });
      }
      const requested = await requestHostContactEmailChallenge(
        hostContactClaimTarget(host),
        ctx.state.user,
        trustedRequestOrigin(ctx.url, ctx.req.headers),
        claimPathForContext(
          host.host,
          linkContext,
          directoryListing,
          detectedLookup,
          linkError,
          transferContext,
        ),
        devHostClaimEmailOptions(host.host),
      );
      const page = await buildClaimPageProps(
        host,
        ctx.state.user,
        buildAccountMenuProps(ctx.state),
        linkContext,
        transferContext,
        {
          ...(requested.ok
            ? {
              emailSent: {
                maskedEmail: requested.maskedEmail,
                expiresAt: requested.expiresAt,
                previewUrl: requested.previewUrl ?? null,
              },
            }
            : {
              error: emailRequestFailureMessage(requested.reason),
              contactMethod: contactMethodForEmailRequestFailure(
                requested.reason,
              ),
            }),
          directoryListing,
          detectedLookup,
          linkError,
        },
      );
      const response = await ctx.render(<HostClaimPage {...page} />, {
        status: requested.ok
          ? 200
          : requested.reason === "lookup_error"
          ? 503
          : requested.reason === "rate_limited"
          ? 429
          : 409,
      });
      return hardenHostClaimProofResponse(response);
    }
    if (action === "confirm_contact_email") {
      if (transferContext) {
        return new Response(
          "Email verification cannot change a host’s managing account.",
          { status: 400, headers: { "cache-control": "no-store" } },
        );
      }
      const emailToken = readHostClaimEmailToken(ctx.req);
      const proof = await prepareHostContactEmailChallenge(
        hostContactClaimTarget(host),
        ctx.state.user,
        emailToken,
        devHostClaimEmailOptions(host.host),
      );
      const result = proof.ok
        ? await claimAccountHostWithContactEmailEvidence(
          host.host,
          ctx.state.user,
          proof,
          listingSelection == null
            ? {}
            : { operatorListingOptIn: listingSelection },
        )
        : {
          ok: false as const,
          reason: proof.reason,
          host,
        };
      if (result.ok) {
        if (linkContext) {
          const linked = await completeAppHostLink(
            result.host,
            ctx.state.user.did,
            linkContext,
            "email",
          );
          linked.headers.append(
            "set-cookie",
            clearHostClaimEmailTokenCookie(host.host),
          );
          return hardenHostClaimProofResponse(linked);
        }
        return hardenHostClaimProofResponse(
          new Response(null, {
            status: 303,
            headers: {
              location: hostClaimManageLocation(
                result.host.host,
                false,
                linkError,
                false,
              ),
              "set-cookie": clearHostClaimEmailTokenCookie(host.host),
              "cache-control": "no-store",
            },
          }),
        );
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
        transferContext,
        {
          error: emailFailure
            ? hostContactEmailVerificationFailureMessage(emailFailure)
            : result.reason === "already_claimed"
            ? "This host has already been claimed."
            : "This email verification could not complete the host claim.",
          emailToken: emailToken || null,
          emailTokenFailure: emailFailure,
          directoryListing,
          detectedLookup,
          linkError,
        },
      );
      const response = await ctx.render(<HostClaimPage {...page} />, {
        status: 409,
      });
      if (emailFailure !== "account_mismatch") {
        response.headers.append(
          "set-cookie",
          clearHostClaimEmailTokenCookie(host.host),
        );
      }
      return hardenHostClaimProofResponse(response);
    }
    if (action === "finalize_recovery") {
      const finalDnsToken = textValue(form?.get("dns_token"));
      const finalized = await finalizeAccountHostEmailClaimRecovery(
        host.host,
        ctx.state.user,
        finalDnsToken,
      );
      if (finalized.ok) {
        return hardenHostClaimProofResponse(
          new Response(null, {
            status: 303,
            headers: {
              location: hostClaimManageLocation(
                finalized.host.host,
                true,
                linkError,
                true,
              ),
              "cache-control": "no-store",
            },
          }),
        );
      }
      const dnsFailure = isHostDnsChallengeVerificationFailureReason(
          finalized.reason,
        )
        ? finalized.reason
        : null;
      const reusableDnsToken = dnsFailure === "record_not_found" ||
          dnsFailure === "dns_unavailable" ||
          dnsFailure === "account_mismatch"
        ? finalDnsToken
        : null;
      const page = await buildClaimPageProps(
        host,
        ctx.state.user,
        buildAccountMenuProps(ctx.state),
        linkContext,
        transferContext,
        {
          error: hostClaimRecoveryFailureMessage(
            finalized.reason,
            finalized.recovery,
          ),
          dnsToken: reusableDnsToken,
          dnsFailure,
          directoryListing,
          detectedLookup,
          linkError,
        },
      );
      const response = await ctx.render(<HostClaimPage {...page} />, {
        status: dnsFailure === "dns_unavailable" ? 503 : 409,
      });
      return hardenHostClaimProofResponse(response);
    }
    if (action === "request_dns") {
      const existingClaim = await getAccountHostClaim(host.host).catch(() =>
        null
      );
      let continuationDirectoryListing = directoryListing;
      if (existingClaim) {
        continuationDirectoryListing = host.operatorListingOptIn !== false;
        const [verifiedOwnerDid, pendingRecovery] = await Promise.all([
          verifiedAccountHostOwnerDid(host, existingClaim).catch(() => null),
          existingClaim.method === "pds_contact_email"
            ? getPendingAccountHostClaimRecovery(host.host).catch(() => null)
            : Promise.resolve(null),
        ]);
        if (
          !hostClaimDnsRequestAllowed({
            claim: existingClaim,
            verifiedOwnerDid,
            currentDid: ctx.state.user.did,
            transferPreviousOwnerDid:
              transferContext?.intent.previousOwnerDid ?? null,
            pendingRecoveryRequesterDid: pendingRecovery?.requesterDid ?? null,
            pendingRecoveryEligibleAt: pendingRecovery?.eligibleAt ?? null,
            now: Date.now(),
          })
        ) {
          const page = await buildClaimPageProps(
            host,
            ctx.state.user,
            buildAccountMenuProps(ctx.state),
            linkContext,
            transferContext,
            {
              error: pendingRecovery?.status === "pending"
                ? "A DNS recovery is already in progress. The current manager remains in control during the review period."
                : "This host has already been claimed.",
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
          continuationDirectoryListing,
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
    const isAtprotoIdentityClaim = action === "claim_identity" &&
      !transferContext;
    if (
      action !== "verify_dns" && !isLocalDevClaim &&
      !isAtprotoIdentityClaim
    ) {
      return new Response("Invalid host claim action.", {
        status: 400,
        headers: {
          "cache-control": "no-store",
          "content-type": "text/plain; charset=utf-8",
        },
      });
    }
    const strengtheningEmailClaim = action === "verify_dns" &&
      !transferContext &&
      (await getAccountHostClaim(host.host).catch(() => null))?.method ===
        "pds_contact_email";
    const pendingRecovery = action === "verify_dns" && strengtheningEmailClaim
      ? await getPendingAccountHostClaimRecovery(host.host).catch(() => null)
      : null;
    const startingEmailRecovery = pendingRecovery?.requesterDid ===
        ctx.state.user.did && pendingRecovery.status === "pending";
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
      : isAtprotoIdentityClaim
      ? await claimAccountHostWithAtprotoIdentity(
        host.host,
        ctx.state.user,
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
        return await completeAppHostLink(
          result.host,
          ctx.state.user.did,
          linkContext,
          action === "verify_dns" ? "dns" : "identity",
        );
      }
      return new Response(null, {
        status: 303,
        headers: {
          location: hostClaimManageLocation(
            result.host.host,
            !!transferContext,
            linkError,
            action === "verify_dns",
            strengtheningEmailClaim && !startingEmailRecovery,
          ),
        },
      });
    }
    if (result.reason === "recovery_pending") {
      const notificationAttemptedAt = Date.now();
      const notificationReservation = result.recovery?.notificationStatus ===
          "pending"
        ? await reserveAccountHostClaimRecoveryNotification(
          host.host,
          result.recovery.requesterDid,
          { now: notificationAttemptedAt },
        ).catch(() => null)
        : null;
      if (notificationReservation) {
        const notificationRecovery = notificationReservation.recovery;
        const notification = notificationReservation.expectedEmailFingerprint
          ? await notifyHostContactEmailOfDnsRecovery(
            hostContactClaimTarget(host),
            {
              currentClaimantHandle: notificationRecovery.currentOwnerHandle,
              requestingHandle: notificationRecovery.requesterHandle,
              requestingDid: notificationRecovery.requesterDid,
              eligibleAt: notificationRecovery.eligibleAt,
            },
            notificationReservation.expectedEmailFingerprint,
            devHostClaimEmailOptions(host.host),
          ).catch(() => ({
            ok: false as const,
            reason: "delivery_failed" as const,
          }))
          : { ok: false as const, reason: "contact_changed" as const };
        await recordAccountHostClaimRecoveryNotification(
          host.host,
          notificationRecovery.requesterDid,
          notification.ok
            ? {
              status: "sent",
              deliveryId: notification.deliveryId,
              emailFingerprint: notification.emailFingerprint,
              attemptedAt: notificationAttemptedAt,
            }
            : {
              status: notification.reason === "contact_unavailable" ||
                  notification.reason === "contact_changed"
                ? "unavailable"
                : "failed",
              attemptedAt: notificationAttemptedAt,
            },
        ).catch(() => null);
      }
      return new Response(null, {
        status: 303,
        headers: {
          location: claimPathForContext(
            host.host,
            linkContext,
            directoryListing,
            detectedLookup,
            linkError,
          ),
          "cache-control": "no-store",
          "referrer-policy": "no-referrer",
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
  usedDns = true,
  strengthened = false,
): string {
  const search = new URLSearchParams({
    [transferred ? "transferred" : strengthened ? "strengthened" : "claimed"]:
      "1",
  });
  if (usedDns) search.set("dns", "1");
  if (linkError) search.set("linkError", "1");
  return `/hosts/${encodeURIComponent(host)}/manage?${search}`;
}

export function hostClaimDnsRequestAllowed(
  input: {
    claim: AccountHostClaim;
    verifiedOwnerDid: string | null;
    currentDid: string;
    transferPreviousOwnerDid: string | null;
    pendingRecoveryRequesterDid?: string | null;
    pendingRecoveryEligibleAt?: number | null;
    now?: number;
  },
): boolean {
  if (input.transferPreviousOwnerDid) {
    return input.claim.claimantDid === input.transferPreviousOwnerDid &&
      input.claim.claimantDid !== input.currentDid;
  }
  if (input.claim.method === "pds_contact_email") {
    // A different account may begin DNS recovery. The current email-derived
    // owner may also upgrade to DNS, superseding any pending recovery.
    if (input.claim.claimantDid === input.currentDid) return true;
    if (!input.pendingRecoveryRequesterDid) return true;
    return input.pendingRecoveryRequesterDid === input.currentDid &&
      (input.pendingRecoveryEligibleAt ?? Number.POSITIVE_INFINITY) <=
        (input.now ?? Date.now());
  }
  return input.claim.claimantDid === input.currentDid &&
    input.verifiedOwnerDid !== input.currentDid;
}

async function completeAppHostLink(
  host: AccountHost,
  currentHostDid: string,
  linkContext: HostClaimLinkContext,
  claimMethod: "dns" | "email" | "identity" | null = null,
): Promise<Response> {
  const linked = await establishDirectoryEntityLinkFromIntent({
    intent: linkContext.intent,
    currentHostDid,
  }).catch((error) => {
    console.error("[host-claim] app connection completion failed:", error);
    return { ok: false as const };
  });
  const search = new URLSearchParams({
    [linked.ok ? "linked" : "linkError"]: "1",
  });
  if (claimMethod) {
    search.set("claimed", "1");
    if (claimMethod === "dns") search.set("dns", "1");
  }
  const location = `/hosts/${encodeURIComponent(host.host)}/manage?${search}`;
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

function hardenHostClaimProofResponse(response: Response): Response {
  response.headers.set("cache-control", "no-store");
  response.headers.set("referrer-policy", "no-referrer");
  response.headers.set("x-robots-tag", "noindex, nofollow");
  return response;
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
    emailToken?: string | null;
    emailTokenFailure?: HostContactEmailVerificationFailureReason | null;
    emailSent?: HostEmailSentState | null;
    contactMethod?: HostContactMethodState;
    directoryListing?: boolean;
    detectedLookup?: boolean;
    linkError?: boolean;
  } = {},
): Promise<ClaimPageProps> {
  const [claim, authority, pendingRecovery] = await Promise.all([
    getAccountHostClaim(host.host).catch(() => null),
    resolveAccountHostClaimAuthority(host).catch(() => null),
    getPendingAccountHostClaimRecovery(host.host).catch(() => null),
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
  let claimProofMethod: HostClaimProofMethod | null = null;
  const emailToken = feedback.emailToken?.trim() || null;
  let emailTokenFailure = feedback.emailTokenFailure ?? null;
  let emailTokenIsReady = false;
  let contactMethod: HostContactMethodState = feedback.contactMethod ?? {
    status: "not-offered",
  };
  if (
    dnsToken &&
    (!dnsFailure || dnsFailure === "record_not_found" ||
      dnsFailure === "dns_unavailable")
  ) {
    const inspected = await inspectHostDnsChallenge(
      { host: host.host },
      user,
      dnsToken,
    ).catch(() => ({ ok: false as const, reason: "invalid" as const }));
    if (inspected.ok) dnsChallenge = inspected;
    else dnsFailure = inspected.reason;
  }
  if (emailToken && !emailTokenFailure && !claim && !transferContext) {
    const inspected = await inspectHostContactEmailChallenge(
      hostContactClaimTarget(host),
      user,
      emailToken,
      devHostClaimEmailOptions(host.host),
    ).catch(() => ({ ok: false as const, reason: "invalid" as const }));
    if (inspected.ok) emailTokenIsReady = true;
    else {
      emailTokenFailure = inspected.reason;
      if (inspected.reason !== "account_mismatch") {
        contactMethod = { status: "retry" };
      }
    }
  }
  const repairingClaim = !transferContext && !!claim &&
    claim.claimantDid === user.did && verifiedClaimOwnerDid !== user.did;
  const validTransfer = !!transferContext && !!claim &&
    claim.claimantDid === transferContext.intent.previousOwnerDid &&
    claim.claimantDid !== user.did;
  const emailRecoveryCandidate = !transferContext && !!claim &&
    claim.method === "pds_contact_email" && claim.claimantDid !== user.did;
  const emailOwnerDnsUpgrade = !transferContext && !!claim &&
    claim.method === "pds_contact_email" && claim.claimantDid === user.did;
  const activeRecovery = pendingRecovery?.status === "pending"
    ? pendingRecovery
    : null;
  const recoveryView: HostClaimRecoveryView | null = activeRecovery
    ? {
      requesterDid: activeRecovery.requesterDid,
      requesterHandle: activeRecovery.requesterHandle,
      currentOwnerHandle: activeRecovery.currentOwnerHandle,
      eligibleAt: activeRecovery.eligibleAt,
      viewerIsRequester: activeRecovery.requesterDid === user.did,
    }
    : null;
  if (
    recoveryView?.requesterDid === user.did &&
    recoveryView.eligibleAt <= Date.now()
  ) {
    state = "recovery-ready";
  } else if (recoveryView?.requesterDid === user.did) {
    state = "recovery-pending";
  } else if (recoveryView && claim?.claimantDid !== user.did) {
    // Do not offer another claimant a DNS challenge while one recovery owns
    // the pending slot. The email-derived current owner is still allowed to
    // supersede it with fresh DNS below.
    state = "recovery-pending";
  } else if (validTransfer || repairingClaim || emailRecoveryCandidate) {
    state = dnsChallenge ? "dns" : "verification";
  } else if (emailOwnerDnsUpgrade && dnsChallenge) {
    state = "dns";
  } else if (verifiedClaimOwnerDid === user.did) {
    state = "claimed-by-you";
  } else if (verifiedClaimOwnerDid) {
    state = "claimed-by-other";
  } else if (claim) {
    state = "not-authorized";
  } else if (hostSelfServiceClaimPolicy(host.host) === "local-dev") {
    const proof = verifyHostClaimDomainProof(host, user);
    if (proof.ok) {
      state = "ready";
      claimProofMethod = proof.method;
    } else {
      state = "not-claimable";
    }
  } else {
    const identityProof = await verifyAtprotoHostClaimDomainProof(host, user);
    if (identityProof.ok) {
      state = "ready";
      claimProofMethod = identityProof.method;
    } else if (emailTokenIsReady) {
      state = "email-token";
    } else if (feedback.emailSent) {
      state = "email-sent";
    } else {
      state = dnsChallenge ? "dns" : "verification";
    }
  }
  if (
    !feedback.contactMethod && !emailTokenFailure && !claim &&
    !transferContext && state === "verification"
  ) {
    try {
      const availability = await getHostContactEmailAvailability(
        hostContactClaimTarget(host),
        devHostClaimEmailOptions(host.host),
      );
      contactMethod = availability.status === "available"
        ? {
          status: "available",
          maskedEmail: availability.maskedEmail,
          deliveryConfigured: availability.deliveryConfigured,
        }
        : availability.status === "lookup_error"
        ? { status: "lookup-error" }
        : { status: "unavailable" };
    } catch {
      contactMethod = { status: "lookup-error" };
    }
  }
  return {
    host,
    claim,
    authority,
    state,
    activeHandle: user.handle,
    error: feedback.error ??
      (emailTokenFailure
        ? hostContactEmailVerificationFailureMessage(emailTokenFailure)
        : dnsFailure
        ? hostDnsChallengeVerificationFailureMessage(dnsFailure)
        : null),
    account,
    linkContext,
    dnsChallenge,
    dnsToken,
    dnsFailure,
    contactMethod,
    emailToken,
    emailTokenFailure,
    emailSent: feedback.emailSent ?? null,
    recovery: recoveryView,
    directoryListing: feedback.directoryListing ?? true,
    detectedLookup: feedback.detectedLookup ?? false,
    transferContext,
    repairingClaim,
    linkError: feedback.linkError ?? false,
    claimProofMethod,
  };
}

function hostContactClaimTarget(
  host: Pick<AccountHost, "host" | "displayName" | "serviceEndpoint">,
) {
  return {
    host: host.host,
    displayName: host.displayName,
    serviceEndpoint: host.serviceEndpoint,
  };
}

function emailRequestFailureMessage(
  reason:
    | "contact_unavailable"
    | "lookup_error"
    | "delivery_unavailable"
    | "rate_limited"
    | "delivery_failed",
): string {
  switch (reason) {
    case "lookup_error":
      return "We couldn’t check the PDS contact email. Try again, or use DNS.";
    case "contact_unavailable":
      return "This PDS no longer publishes the same contact email. Try again, or use DNS.";
    case "delivery_unavailable":
      return "Email verification is temporarily unavailable. Use DNS, or try again later.";
    case "rate_limited":
      return "Wait a minute, then try again. Repeated requests may be limited for up to an hour, or use DNS.";
    case "delivery_failed":
      return "The verification email could not be sent. Try again, or use DNS.";
  }
}

function contactMethodForEmailRequestFailure(
  reason:
    | "contact_unavailable"
    | "lookup_error"
    | "delivery_unavailable"
    | "rate_limited"
    | "delivery_failed",
): HostContactMethodState {
  return reason === "contact_unavailable"
    ? { status: "unavailable" }
    : reason === "lookup_error"
    ? { status: "lookup-error" }
    : { status: "retry" };
}

function hostClaimRecoveryFailureMessage(
  reason:
    | "not_found"
    | "not_requester"
    | "not_ready"
    | "expired"
    | "owner_changed"
    | "fresh_dns_required"
    | HostDnsChallengeVerificationFailureReason,
  recovery?: AccountHostClaimRecovery,
): string {
  if (
    isHostDnsChallengeVerificationFailureReason(reason) &&
    reason !== "expired"
  ) {
    return hostDnsChallengeVerificationFailureMessage(reason);
  }
  switch (reason) {
    case "not_found":
      return "This DNS recovery request no longer exists. Start a new verification.";
    case "not_requester":
      return "Switch to the account that started this DNS recovery.";
    case "not_ready":
      return "The 48-hour review period has not ended yet.";
    case "expired":
      return recovery?.status === "pending" && recovery.expiresAt > Date.now()
        ? hostDnsChallengeVerificationFailureMessage("expired")
        : "This DNS recovery request expired. Start a new verification.";
    case "owner_changed":
      return "The managing account changed after recovery began. Start a new verification if needed.";
    case "fresh_dns_required":
      return "Generate a fresh DNS record now that the review period has ended.";
  }
}

function formatClaimTime(value: number): string {
  return new Intl.DateTimeFormat("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(value));
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
    contactMethod,
    emailToken,
    emailTokenFailure,
    emailSent,
    recovery,
    directoryListing,
    detectedLookup,
    transferContext,
    repairingClaim,
    linkError,
    claimProofMethod,
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
                        claimProofMethod,
                        host: host.host,
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
                      contactMethod={contactMethod}
                      emailToken={emailToken}
                      emailTokenFailure={emailTokenFailure}
                      emailSent={emailSent}
                      recovery={recovery}
                      directoryListing={directoryListing}
                      detectedLookup={detectedLookup}
                      transferContext={transferContext}
                      repairingClaim={repairingClaim}
                      linkError={linkError}
                      claimProofMethod={claimProofMethod}
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
    contactMethod,
    emailToken,
    emailTokenFailure,
    emailSent,
    recovery,
    directoryListing,
    detectedLookup,
    transferContext,
    repairingClaim,
    linkError,
    claimProofMethod,
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
    contactMethod: HostContactMethodState;
    emailToken: string | null;
    emailTokenFailure: HostContactEmailVerificationFailureReason | null;
    emailSent: HostEmailSentState | null;
    recovery: HostClaimRecoveryView | null;
    directoryListing: boolean;
    detectedLookup: boolean;
    transferContext: ResolvedHostOwnerTransferContext | null;
    repairingClaim: boolean;
    linkError: boolean;
    claimProofMethod: HostClaimProofMethod | null;
  },
) {
  const recoveringEmailClaim = state === "verification" &&
    claim?.method === "pds_contact_email" && !transferContext &&
    !repairingClaim;
  if (
    (state === "recovery-pending" || state === "recovery-ready") && recovery
  ) {
    const ready = state === "recovery-ready";
    const freshDnsReady = ready && !!dnsToken && !!dnsChallenge;
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
        <div
          class={`host-claim-panel${ready ? " host-claim-panel-ok" : ""}`}
        >
          <p class="host-claim-panel-title">
            {ready ? "Recovery ready to finish" : "DNS recovery pending"}
          </p>
          {recovery.viewerIsRequester
            ? (
              <p class="text-body">
                DNS control has been verified for{" "}
                <AtmosphereHandle handle={recovery.requesterHandle} />. The
                current email-verified manager is{" "}
                <AtmosphereHandle handle={recovery.currentOwnerHandle} />.
              </p>
            )
            : (
              <p class="text-body">
                Another account has already verified DNS control. No additional
                recovery can begin while its review period is active.
              </p>
            )}
          <p class="text-body">
            {ready
              ? "The 48-hour review period has ended. Generate and verify a fresh DNS record to change the managing account."
              : recovery.viewerIsRequester
              ? `The current manager remains in control until ${
                formatClaimTime(recovery.eligibleAt)
              }. Return after that time to generate and verify a fresh DNS record.`
              : "The current manager remains in control during the review period."}
          </p>
        </div>
        {freshDnsReady && dnsChallenge
          ? (
            <form method="POST" data-submit-once="true">
              <input type="hidden" name="action" value="finalize_recovery" />
              <input type="hidden" name="dns_token" value={dnsToken} />
              <DnsRecordPanel
                challenge={dnsChallenge}
                description="Add this fresh TXT record, then verify it to finish changing the managing account."
              />
              <button
                type="submit"
                class="directory-register-button"
                data-pending-label="Verifying DNS…"
              >
                <span data-submit-once-label>
                  Verify DNS and finish recovery
                </span>
              </button>
            </form>
          )
          : ready
          ? (
            <form method="POST" data-submit-once="true">
              <button
                type="submit"
                name="action"
                value="request_dns"
                class="directory-register-button"
                data-pending-label="Preparing DNS record…"
              >
                <span data-submit-once-label>Generate fresh DNS record</span>
              </button>
            </form>
          )
          : null}
        <a
          class="text-link-button"
          href={switchAccountHref(
            host,
            linkContext,
            directoryListing,
            detectedLookup,
            linkError,
            null,
            dnsToken,
          )}
        >
          Choose another account
        </a>
      </div>
    );
  }
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
        {claim?.method === "pds_contact_email" && (
          <form method="POST" data-submit-once="true">
            <p class="text-body">
              {recovery
                ? "Another account has verified DNS control. Complete a fresh DNS verification for this account to supersede the pending recovery."
                : "This claim currently uses the contact email published by the PDS. Verify DNS to strengthen its ownership proof."}
            </p>
            <button
              type="submit"
              name="action"
              value="request_dns"
              class="directory-register-button"
              data-pending-label="Preparing DNS record…"
            >
              <span data-submit-once-label>Strengthen ownership with DNS</span>
            </button>
          </form>
        )}
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
        <input
          type="hidden"
          name="action"
          value={claimProofMethod === "atproto_handle"
            ? "claim_identity"
            : "claim"}
        />
        {error && (
          <p class="profile-form-status profile-form-status--error">{error}</p>
        )}
        <div class="host-claim-panel host-claim-panel-ok">
          <p class="host-claim-panel-title">
            Signed in as <AtmosphereHandle handle={activeHandle} />
          </p>
          {claimProofMethod === "atproto_handle"
            ? (
              <p class="text-body">
                Your verified handle exactly matches{" "}
                <strong>{host.host}</strong>, so no additional verification is
                needed.
              </p>
            )
            : (
              <p class="text-body">
                This explicit local <code>.test</code>{" "}
                fixture can be claimed without a public DNS lookup.
              </p>
            )}
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
  if (state === "email-token" && emailToken) {
    return (
      <form method="POST" class="host-claim-form" data-submit-once="true">
        <input type="hidden" name="action" value="confirm_contact_email" />
        {error && (
          <p
            class="profile-form-status profile-form-status--error"
            role="alert"
          >
            {error}
          </p>
        )}
        <div class="host-claim-panel host-claim-panel-ok">
          <p class="host-claim-panel-title">Confirm host claim</p>
          <p class="text-body">
            This verification link was sent to the contact address published by
            {" "}
            {host.host}. Confirm that <AtmosphereHandle handle={activeHandle} />
            {" "}
            should manage {host.displayName}.
          </p>
        </div>
        <DirectoryListingChoice checked={directoryListing} />
        <button
          type="submit"
          class="directory-register-button"
          data-pending-label="Verifying email…"
        >
          <span data-submit-once-label>
            {linkContext
              ? "Verify, claim, and connect host"
              : "Verify and claim host"}
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
          )}
        >
          {emailTokenFailure === "account_mismatch"
            ? "Return to the account that requested this email"
            : "Choose another account"}
        </a>
      </form>
    );
  }
  if (state === "email-sent" && emailSent) {
    return (
      <form method="POST" class="host-claim-form" data-submit-once="true">
        {error && (
          <p
            class="profile-form-status profile-form-status--error"
            role="alert"
          >
            {error}
          </p>
        )}
        <div class="host-claim-panel host-claim-panel-ok" role="status">
          <p class="host-claim-panel-title">
            Check {emailSent.maskedEmail}
          </p>
          <p class="text-body">
            Open the verification link in the email to continue. It expires at
            {" "}
            <strong>{formatClaimTime(emailSent.expiresAt)}</strong>.
          </p>
        </div>
        <DirectoryListingChoice checked={directoryListing} />
        <div class="host-claim-inline-actions">
          <button
            type="submit"
            name="action"
            value="request_dns"
            class="text-link-button"
            data-pending-label="Preparing DNS record…"
          >
            <span data-submit-once-label>Use DNS instead</span>
          </button>
        </div>
        <p id="host-email-resend-help" class="host-claim-expiry">
          The verification link is bound to this signed-in account. If it
          doesn’t arrive, wait one minute before requesting another.
        </p>
        <a
          class="text-link-button"
          href={claimPathForContext(
            host.host,
            linkContext,
            directoryListing,
            detectedLookup,
            linkError,
          )}
        >
          Back to verification choices
        </a>
        {emailSent.previewUrl && (
          <a class="text-link-button" href={emailSent.previewUrl}>
            Open local email preview
          </a>
        )}
        <a
          class="text-link-button"
          href={switchAccountHref(
            host,
            linkContext,
            directoryListing,
            detectedLookup,
            linkError,
          )}
        >
          Choose another account
        </a>
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
        <DnsRecordPanel
          challenge={dnsChallenge}
          description="Add the exact record below with your DNS provider, then verify it once DNS updates."
        />
        {!transferContext && !claim && (
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
        {error && (
          <p
            class="profile-form-status profile-form-status--error"
            role="alert"
          >
            {error}
          </p>
        )}
        <fieldset class="host-claim-methods">
          <legend>
            {transferContext
              ? "Change the managing account"
              : repairingClaim
              ? "Restore verified management"
              : recoveringEmailClaim
              ? "Recover the managing account"
              : "Verify host ownership"}
          </legend>
          <p class="text-body">
            {transferContext
              ? `The existing manager remains in control until this account proves control of ${host.host} with DNS.`
              : repairingClaim
              ? `Use DNS to restore verified management of ${host.host}.`
              : recoveringEmailClaim
              ? `Use DNS to prove current control of ${host.host}. The existing manager remains in control during a 48-hour review period.`
              : `Choose how to verify that you operate ${host.host}.`}
          </p>
          <p class="text-body">
            Managing account:{" "}
            <strong>
              <AtmosphereHandle handle={activeHandle} />
            </strong>
          </p>
          <div class="host-claim-method-grid">
            <section class="host-claim-method host-claim-method--recommended">
              <div class="host-claim-method-heading">
                <h2 class="host-claim-method-title">DNS record</h2>
                <span class="host-claim-method-badge">Recommended</span>
              </div>
              <p class="text-body">
                Add a temporary TXT record. DNS is always available and is
                required for managing-account changes and recovery.
              </p>
              <button
                type="submit"
                name="action"
                value="request_dns"
                class="directory-register-button"
                data-pending-label="Preparing DNS record…"
              >
                <span data-submit-once-label>Show DNS record</span>
              </button>
            </section>
            {!transferContext && !repairingClaim && !claim &&
              contactMethod.status !== "not-offered" && (
              <ContactEmailMethodCard
                contactMethod={contactMethod}
                retryHref={claimPathForContext(
                  host.host,
                  linkContext,
                  directoryListing,
                  detectedLookup,
                  linkError,
                )}
              />
            )}
          </div>
        </fieldset>
        {!transferContext && !claim && (
          <DirectoryListingChoice checked={directoryListing} />
        )}
        <a
          class="text-link-button"
          href={switchAccountHref(
            host,
            linkContext,
            directoryListing,
            detectedLookup,
            linkError,
            transferContext,
            dnsFailure === "account_mismatch" ? dnsToken : null,
          )}
        >
          {emailTokenFailure === "account_mismatch"
            ? "Return to the account that requested this email"
            : "Choose another account"}
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
        Verify the host with a temporary DNS TXT record. This host cannot use
        automatic identity or its PDS-published contact email for this claim.
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

function DnsRecordPanel(
  {
    challenge,
    description,
  }: {
    challenge: Extract<InspectedHostDnsChallengeResult, { ok: true }>;
    description: string;
  },
) {
  return (
    <div class="host-claim-panel host-claim-panel-ok">
      <p class="host-claim-panel-title">Add this DNS TXT record</p>
      <p class="text-body">{description}</p>
      <dl class="host-claim-detected-summary">
        <div>
          <dt>Type</dt>
          <dd>
            <code>TXT</code>
          </dd>
        </div>
        <div>
          <dt>Name</dt>
          <dd class="host-claim-dns-field">
            <code>{challenge.recordName}</code>
            <CopyTextButton
              text={challenge.recordName}
              ariaLabel="Copy DNS record name"
              copiedAriaLabel="DNS record name copied"
              className="host-claim-copy-button"
            />
          </dd>
        </div>
        <div>
          <dt>Value</dt>
          <dd class="host-claim-dns-field">
            <code>{challenge.recordValue}</code>
            <CopyTextButton
              text={challenge.recordValue}
              ariaLabel="Copy DNS record value"
              copiedAriaLabel="DNS record value copied"
              className="host-claim-copy-button"
            />
          </dd>
        </div>
      </dl>
    </div>
  );
}

export function hostClaimIntroCopy(
  input: {
    state: ClaimState;
    linkAppName?: string | null;
    transferring?: boolean;
    claimProofMethod?: HostClaimProofMethod | null;
    host?: string;
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
  if (input.state === "recovery-pending") {
    return "DNS control is verified. The current manager remains in control during a 48-hour review period.";
  }
  if (input.state === "recovery-ready") {
    return "The DNS recovery review period has ended. Complete a fresh DNS check to finish changing the managing account.";
  }
  if (input.transferring) {
    return "The new managing account must prove control of this host with DNS before anything changes.";
  }
  if (input.state === "ready") {
    if (input.claimProofMethod === "atproto_handle") {
      const domain = input.host ?? "this host domain";
      return input.linkAppName
        ? `Your verified handle exactly matches ${domain}. Claim it to connect it to ${input.linkAppName}.`
        : `Your verified handle exactly matches ${domain}, so no additional verification is needed.`;
    }
    return input.linkAppName
      ? `This local .test fixture uses the development claim path and then connects it to ${input.linkAppName}.`
      : "This local .test fixture uses the development claim path. Once claimed, this Atmosphere account can manage its public profile and images.";
  }
  if (input.state === "email-token") {
    return "The contact email link is valid. Confirm the managing account to complete the claim.";
  }
  if (input.state === "email-sent") {
    return "A verification link was sent to the contact email published by this PDS.";
  }
  if (input.linkAppName) {
    return `Verify control of this host, then connect it to ${input.linkAppName}.`;
  }
  return "Verify that you operate this host. Once claimed, this Atmosphere account can manage its public profile and images.";
}

function ContactEmailMethodCard(
  {
    contactMethod,
    retryHref,
  }: {
    contactMethod: HostContactMethodState;
    retryHref: string;
  },
) {
  if (contactMethod.status === "available") {
    const enabled = contactMethod.deliveryConfigured;
    return (
      <section
        class={`host-claim-method${
          enabled ? "" : " host-claim-method--unavailable"
        }`}
        aria-labelledby="host-contact-email-method"
      >
        <div class="host-claim-method-heading">
          <h2
            id="host-contact-email-method"
            class="host-claim-method-title"
          >
            Contact email
          </h2>
          {!enabled && <span class="host-claim-method-badge">Unavailable</span>}
        </div>
        <p class="text-body">
          Send a verification link to{" "}
          {contactMethod.maskedEmail}, as published by this PDS.
        </p>
        {enabled
          ? (
            <button
              type="submit"
              name="action"
              value="request_contact_email"
              class="directory-register-button"
              data-pending-label="Sending email…"
            >
              <span data-submit-once-label>Send verification email</span>
            </button>
          )
          : (
            <p class="host-claim-method-unavailable-copy" role="status">
              Email verification is temporarily unavailable. Use DNS, or try
              again later.
            </p>
          )}
      </section>
    );
  }
  if (contactMethod.status === "lookup-error") {
    return (
      <section
        class="host-claim-method host-claim-method--unavailable"
        aria-labelledby="host-contact-email-method"
      >
        <div class="host-claim-method-heading">
          <h2
            id="host-contact-email-method"
            class="host-claim-method-title"
          >
            Contact email
          </h2>
          <span class="host-claim-method-badge">Check failed</span>
        </div>
        <p class="host-claim-method-unavailable-copy" role="status">
          We couldn’t check the PDS contact email. Try again, or use DNS.
        </p>
        <a class="text-link-button" href={retryHref}>
          Check again
        </a>
      </section>
    );
  }
  if (contactMethod.status === "retry") {
    return (
      <section
        class="host-claim-method host-claim-method--unavailable"
        aria-labelledby="host-contact-email-method"
      >
        <div class="host-claim-method-heading">
          <h2 id="host-contact-email-method" class="host-claim-method-title">
            Contact email
          </h2>
          <span class="host-claim-method-badge">Try later</span>
        </div>
        <p class="host-claim-method-unavailable-copy" role="status">
          Email verification isn’t available for this attempt. Use DNS, or try
          again later.
        </p>
        <a class="text-link-button" href={retryHref}>
          Check again
        </a>
      </section>
    );
  }
  return (
    <section
      class="host-claim-method host-claim-method--unavailable"
      aria-labelledby="host-contact-email-method"
    >
      <div class="host-claim-method-heading">
        <h2 id="host-contact-email-method" class="host-claim-method-title">
          Contact email
        </h2>
        <span class="host-claim-method-badge">Unavailable</span>
      </div>
      <p class="host-claim-method-unavailable-copy" role="status">
        This PDS doesn’t publish a contact email. Add one in the PDS settings,
        then check again. DNS remains available.
      </p>
      <a class="text-link-button" href={retryHref}>
        Check again
      </a>
    </section>
  );
}

function textValue(value: FormDataEntryValue | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Email links may be opened by scanners, another browser, or a signed-out
 * session. Capture the opaque proof once, remove it from browser-visible URLs,
 * and require a later account-bound POST before ownership changes.
 */
export function captureHostClaimEmailToken(
  url: URL,
  routeHost: string,
): Response | null {
  if (!url.searchParams.has("email_token")) return null;
  const rawToken = url.searchParams.get("email_token")?.trim() ?? "";
  const token = HOST_CLAIM_EMAIL_TOKEN_PATTERN.test(rawToken)
    ? rawToken
    : "invalid";
  const host = normalizeClaimCookieHost(routeHost);
  const clean = new URL(url);
  clean.searchParams.delete("email_token");
  const headers = new Headers({
    location: `${clean.pathname}${clean.search}`,
    "cache-control": "no-store",
    "referrer-policy": "no-referrer",
    "x-robots-tag": "noindex, nofollow",
  });
  if (host) {
    headers.append(
      "set-cookie",
      buildHostClaimEmailTokenCookie(host, token),
    );
  }
  return new Response(null, { status: 303, headers });
}

function readHostClaimEmailToken(req: Request): string {
  const cookie = req.headers.get("cookie");
  if (!cookie) return "";
  for (const part of cookie.split(";").map((value) => value.trim())) {
    if (!part.startsWith(`${HOST_CLAIM_EMAIL_TOKEN_COOKIE}=`)) continue;
    try {
      const value = decodeURIComponent(
        part.slice(HOST_CLAIM_EMAIL_TOKEN_COOKIE.length + 1),
      );
      return value.length <= 256 ? value : "";
    } catch {
      return "";
    }
  }
  return "";
}

function buildHostClaimEmailTokenCookie(host: string, token: string): string {
  const flags = [
    `Path=/hosts/${encodeURIComponent(host)}/claim`,
    `Max-Age=${HOST_CLAIM_EMAIL_TOKEN_MAX_AGE_SECONDS}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (!IS_DEV) flags.push("Secure");
  return `${HOST_CLAIM_EMAIL_TOKEN_COOKIE}=${encodeURIComponent(token)}; ${
    flags.join("; ")
  }`;
}

function clearHostClaimEmailTokenCookie(host: string): string {
  const flags = [
    `Path=/hosts/${encodeURIComponent(host)}/claim`,
    "Max-Age=0",
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (!IS_DEV) flags.push("Secure");
  return `${HOST_CLAIM_EMAIL_TOKEN_COOKIE}=; ${flags.join("; ")}`;
}

function normalizeClaimCookieHost(value: string): string | null {
  try {
    const host = decodeURIComponent(value).trim().toLowerCase();
    return /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/.test(host) ? host : null;
  } catch {
    return null;
  }
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
