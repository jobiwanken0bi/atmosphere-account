import { define } from "../../utils.ts";
import Nav from "../../components/Nav.tsx";
import Footer from "../../components/Footer.tsx";
import { buildAccountMenuProps } from "../../lib/account-menu-props.ts";
import {
  accountHostKeyForEndpoint,
  getAccountHost,
} from "../../lib/account-hosts.ts";
import { proxyAppviewPageResponse } from "../../lib/appview-client.ts";
import { enforceDurableRateLimit } from "../../lib/rate-limit.ts";
import {
  appHostLinkIntentErrorMessage,
  type AppHostLinkSelectorIntent,
  bindAppHostLinkIntent,
  resolveAppHostLinkSelectorIntent,
  type ResolvedAppHostLinkIntent,
} from "../../lib/app-host-link-intent.ts";
import { oauthSigninUrl } from "../../lib/oauth-action.ts";
import { getSessionForCapabilities } from "../../lib/oauth.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const proxied = await proxyAppviewPageResponse(ctx.url, ctx.req).catch(
      (err) => appviewUnavailable(err),
    );
    if (proxied) return proxied;

    const rawLinkIntent = ctx.url.searchParams.get("link_intent");
    if (!ctx.state.user) {
      if (rawLinkIntent?.trim()) {
        return new Response(
          "Return to the app owner account and start the host connection again.",
          { status: 400, headers: { "cache-control": "no-store" } },
        );
      }
      return redirectToSignin(ctx.url);
    }
    const selectorSession = await getSessionForCapabilities(
      ctx.state.user.did,
      rawLinkIntent?.trim() ? ["identity"] : ["host"],
      { quiet: true },
    );
    if (!selectorSession) {
      if (rawLinkIntent?.trim()) {
        return new Response(
          "Return to the app owner account and start the host connection again.",
          { status: 400, headers: { "cache-control": "no-store" } },
        );
      }
      return redirectToSignin(ctx.url);
    }

    const linkContext = await loadOptionalLinkIntent(
      rawLinkIntent,
      ctx.state.user.did,
    );
    if (linkContext instanceof Response) return linkContext;

    const limited = await enforceDurableRateLimit(ctx.req, {
      scope: "detected-host-claim-search",
      capacity: 20,
      refillMs: 60_000,
    });
    if (limited) return limited;

    const input = ctx.url.searchParams.get("domain")?.trim() ?? "";
    let error: string | null = null;
    if (input) {
      const hostId = normalizeDetectedPdsDomain(input);
      if (!hostId) {
        error = "Enter a valid PDS domain, such as pds.example.com.";
      } else {
        const host = await getAccountHost(hostId).catch(() => null);
        if (host) {
          const search = new URLSearchParams({
            publish: "1",
            from: "detected",
          });
          if (linkContext) {
            const bound = await bindAppHostLinkIntent(
              linkContext.token,
              host.host,
              ctx.state.user.did,
            );
            if (!bound.ok) {
              return new Response(
                appHostLinkIntentErrorMessage(bound.reason),
                { status: 400, headers: { "cache-control": "no-store" } },
              );
            }
            search.set("link_intent", bound.value.token);
          }
          return new Response(null, {
            status: 303,
            headers: {
              location: `/hosts/${
                encodeURIComponent(host.host)
              }/claim?${search}`,
            },
          });
        }
        error =
          "We haven’t detected that PDS in relay inventory yet. Check the exact PDS domain and make sure it has an active account visible to the relay before trying again.";
      }
    }

    return ctx.render(
      <DetectedHostClaimPage
        account={buildAccountMenuProps(ctx.state)}
        input={input}
        error={error}
        linkContext={linkContext}
      />,
      { status: error ? 404 : 200 },
    );
  },
});

export function normalizeDetectedPdsDomain(value: string): string | null {
  const raw = value.trim().toLowerCase();
  if (!raw || raw.length > 500) return null;
  try {
    const url = new URL(raw.includes("://") ? raw : `https://${raw}`);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password || !url.hostname) return null;
    return accountHostKeyForEndpoint(url.origin) || null;
  } catch {
    return null;
  }
}

function DetectedHostClaimPage(
  { account, input, error, linkContext }: {
    account: ReturnType<typeof buildAccountMenuProps>;
    input: string;
    error: string | null;
    linkContext: ResolvedAppHostLinkIntent<AppHostLinkSelectorIntent> | null;
  },
) {
  const hintId = "detected-host-domain-hint";
  const errorId = "detected-host-domain-error";
  return (
    <div id="page-top">
      <div class="content-layer">
        <Nav account={account} active="hosts" />
        <section class="signin-page-section host-claim-section">
          <div class="container signin-page-container">
            <a
              href={linkContext
                ? `/apps/manage/host?app=${
                  encodeURIComponent(linkContext.app.id)
                }`
                : "/hosts"}
              class="text-link-button"
            >
              {linkContext ? "Back to app hosting" : "Back to hosts"}
            </a>
            <div class="glass signin-page-card host-claim-card">
              <p class="text-eyebrow">
                {linkContext
                  ? "Connect account hosting"
                  : "Claim a detected PDS"}
              </p>
              <h1 class="host-claim-title">
                {linkContext
                  ? `Connect a PDS to ${linkContext.app.name}`
                  : "List your PDS publicly"}
              </h1>
              <p class="text-body host-claim-copy">
                {linkContext
                  ? "Enter the exact PDS domain. If it is unclaimed, you can verify control with a temporary DNS record. If it is already claimed, its verified operator can approve the connection."
                  : "This directory keeps likely personal PDSes out of public listings by default. If you operate one and want it listed, enter its exact PDS domain. We’ll use the relay data already on hand to prefill the claim."}
              </p>
              <form method="GET" action="/hosts/claim" class="host-claim-form">
                {linkContext && (
                  <input
                    type="hidden"
                    name="link_intent"
                    value={linkContext.token}
                  />
                )}
                <label class="profile-form-field host-claim-domain-field">
                  <span class="profile-form-label">PDS domain</span>
                  <input
                    class="profile-form-input"
                    type="text"
                    name="domain"
                    value={input}
                    placeholder="pds.example.com"
                    autoComplete="url"
                    spellcheck={false}
                    required
                    aria-invalid={error ? "true" : undefined}
                    aria-describedby={error ? `${hintId} ${errorId}` : hintId}
                  />
                  <span id={hintId} class="profile-form-hint">
                    Use the server domain, not necessarily the operator’s social
                    handle or app website.
                  </span>
                </label>
                {error && (
                  <p
                    id={errorId}
                    class="profile-form-status profile-form-status--error"
                    role="alert"
                  >
                    {error}
                  </p>
                )}
                <button
                  type="submit"
                  class="account-dashboard-button account-dashboard-button--primary host-claim-primary-action"
                >
                  Find host
                </button>
              </form>
              <p class="text-body host-claim-privacy-note">
                Only an exact domain match is shown. Hidden personal hosts stay
                private.
              </p>
            </div>
          </div>
        </section>
        <Footer variant="compact" />
      </div>
    </div>
  );
}

async function loadOptionalLinkIntent(
  token: string | null,
  currentDid: string,
): Promise<
  ResolvedAppHostLinkIntent<AppHostLinkSelectorIntent> | null | Response
> {
  if (!token?.trim()) return null;
  const resolved = await resolveAppHostLinkSelectorIntent(token, currentDid);
  if (resolved.ok) return resolved.value;
  return new Response(appHostLinkIntentErrorMessage(resolved.reason), {
    status: 400,
    headers: { "cache-control": "no-store" },
  });
}

function redirectToSignin(url: URL): Response {
  return new Response(null, {
    status: 303,
    headers: { location: detectedHostClaimAuthorizationHref(url) },
  });
}

export function detectedHostClaimAuthorizationHref(url: URL): string {
  const domain = url.searchParams.get("domain")?.trim();
  return oauthSigninUrl({
    next: `/hosts/claim${url.search}`,
    action: "host_claim",
    capabilities: ["host"],
    name: domain || "an account host",
  });
}

function appviewUnavailable(_err: unknown): Response {
  console.error("[appview] detected host claim proxy failed");
  return new Response("Host claiming is temporarily unavailable.", {
    status: 503,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
    },
  });
}
