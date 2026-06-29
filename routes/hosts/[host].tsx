import { define } from "../../utils.ts";
import Nav from "../../components/Nav.tsx";
import Footer from "../../components/Footer.tsx";
import AtmosphereHandle from "../../components/AtmosphereHandle.tsx";
import HostMark from "../../components/hosts/HostMark.tsx";
import BskyIcon from "../../components/icons/BskyIcon.tsx";
import HostVisitLink from "../../islands/HostVisitLink.tsx";
import { buildAccountMenuProps } from "../../lib/account-menu-props.ts";
import {
  type AccountHost,
  type AccountHostClaim,
  getAccountHost,
  getAccountHostClaim,
  type HostVerificationStatus,
} from "../../lib/account-hosts.ts";
import { buildHostDashboardState } from "../../lib/host-dashboard.ts";
import { buildHostAccountRoute } from "../../lib/host-account-routing.ts";
import { hostFriendlyProfile } from "../../lib/host-friendly.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const hostId = decodeURIComponent(ctx.params.host).toLowerCase();
    const host = await getAccountHost(hostId).catch(() => null);
    const claim = host
      ? await getAccountHostClaim(host.host).catch(() => null)
      : null;
    if (host) {
      const friendly = hostFriendlyProfile(host);
      ctx.state.pageMeta = {
        title: `${host.displayName} on Atmosphere Hosts`,
        description: friendly.summary,
        ogType: "website",
        canonicalUrl: new URL(
          `/hosts/${encodeURIComponent(host.host)}`,
          ctx.url.origin,
        ).href,
        imageUrl: host.avatarUrl ?? undefined,
      };
    }
    return ctx.render(
      <HostDetailPage
        host={host}
        claim={claim}
        claimed={ctx.url.searchParams.get("claimed") === "1"}
        managed={ctx.url.searchParams.get("managed") === "1"}
        account={buildAccountMenuProps(ctx.state)}
      />,
      { status: host ? 200 : 404 },
    );
  },
});

function HostDetailPage(
  { host, claim, claimed, managed, account }: {
    host: AccountHost | null;
    claim: AccountHostClaim | null;
    claimed: boolean;
    managed: boolean;
    account: ReturnType<typeof buildAccountMenuProps>;
  },
) {
  if (!host) {
    return (
      <div id="page-top">
        <div class="content-layer">
          <Nav account={account} active="hosts" />
          <section class="explore-profile-detail">
            <div class="container" style={{ maxWidth: "880px" }}>
              <a href="/hosts" class="text-link-button">
                ← Back to hosts
              </a>
              <div class="glass hosts-empty" style={{ marginTop: "1rem" }}>
                <p class="text-subsection">Host not found.</p>
                <p class="text-body mt-2">
                  This account host may not have been observed or listed yet.
                </p>
              </div>
            </div>
          </section>
          <Footer variant="compact" />
        </div>
      </div>
    );
  }
  const accountRoute = buildHostAccountRoute({ host });
  const dashboard = buildHostDashboardState({ host });
  const accountUrl = accountRoute?.accountManagementUrl ?? null;
  const friendly = hostFriendlyProfile(host);
  const isManagedByCurrentAccount = Boolean(
    claim && account.user && claim.claimantDid === account.user.did,
  );

  return (
    <div id="page-top">
      <div class="content-layer">
        <Nav account={account} active="hosts" />
        <section class="explore-profile-detail host-detail-section">
          <div class="container" style={{ maxWidth: "880px" }}>
            <div class="project-page-toolbar">
              <a href="/hosts" class="text-link-button">
                ← Back to hosts
              </a>
            </div>

            <div class="profile-hero host-detail-hero glass">
              <div class="profile-hero-media host-detail-media">
                <HostMark host={host} />
              </div>
              <div class="profile-hero-body">
                <div class="profile-hero-name-row">
                  <h1 class="profile-hero-name">{host.displayName}</h1>
                </div>
                <p class="profile-hero-handle">
                  {host.profileHandle
                    ? <AtmosphereHandle handle={host.profileHandle} />
                    : host.host}
                </p>
                <div class="profile-hero-meta">
                  <div class="profile-card-categories">
                    <span class="profile-card-category">
                      Account host
                    </span>
                    <span class="profile-card-category">
                      {friendly.location}
                    </span>
                    <span class="profile-card-category">
                      {friendly.signupLabel}
                    </span>
                  </div>
                </div>
                <p class="profile-hero-description">{friendly.summary}</p>
              </div>
              <div class="profile-hero-actions" aria-label="Host actions">
                {host.homepageUrl && (
                  <HostVisitLink
                    href={host.homepageUrl}
                    label={host.signupStatus === "open"
                      ? "Create account"
                      : "Visit host"}
                  />
                )}
                {accountUrl && (
                  <a
                    href={accountUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="profile-form-button-secondary profile-form-button-secondary--lg"
                  >
                    Manage account
                  </a>
                )}
                {host.profileHandle && host.bskyProfileVisible && (
                  <a
                    class="profile-action profile-action--compact"
                    href={bskyProfileHref(host.profileHandle)}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Bluesky profile"
                    title="Bluesky profile"
                  >
                    <span class="profile-action-icon profile-action-icon--brand">
                      <BskyIcon class="profile-action-icon-svg" />
                    </span>
                  </a>
                )}
              </div>
            </div>

            <section class="host-detail-choice-grid" aria-label="Host summary">
              <article class="glass host-detail-choice-card">
                <span class="host-detail-choice-icon" aria-hidden="true">
                  <HostDetailIcon name="fit" />
                </span>
                <div>
                  <p class="text-eyebrow">Best for</p>
                  <h2>{friendly.bestFor}</h2>
                </div>
              </article>
              <article class="glass host-detail-choice-card">
                <span class="host-detail-choice-icon" aria-hidden="true">
                  <HostDetailIcon name="location" />
                </span>
                <div>
                  <p class="text-eyebrow">Data location</p>
                  <h2>{friendly.location}</h2>
                  <p>{friendly.locationDetail}</p>
                </div>
              </article>
              <article class="glass host-detail-choice-card">
                <span class="host-detail-choice-icon" aria-hidden="true">
                  <HostDetailIcon name="handle" />
                </span>
                <div>
                  <p class="text-eyebrow">Handle domain</p>
                  <h2>{friendly.handleLabel}</h2>
                  <p>{friendly.handleDetail}</p>
                </div>
              </article>
              <article class="glass host-detail-choice-card">
                <span class="host-detail-choice-icon" aria-hidden="true">
                  <HostDetailIcon name="signup" />
                </span>
                <div>
                  <p class="text-eyebrow">Joining</p>
                  <h2>{friendly.signupLabel}</h2>
                  <p>{friendly.signupDetail}</p>
                </div>
              </article>
            </section>

            <details class="glass account-home-details host-detail-details">
              <summary>
                Technical details for developers and host operators
              </summary>
              <dl>
                <Fact label="Host domain" value={host.host} />
                <Fact
                  label="Directory status"
                  value={registryStatusLabel(host)}
                />
                <Fact
                  label="Verification"
                  value={verificationLabel(host.verificationStatus)}
                />
                {host.lastObservedAt && (
                  <Fact
                    label="Last seen"
                    value={formatDate(host.lastObservedAt)}
                  />
                )}
                {host.profileCheckedAt && (
                  <Fact
                    label="Profile checked"
                    value={formatDate(host.profileCheckedAt)}
                  />
                )}
                {host.serviceEndpoint && (
                  <Fact
                    label="PDS service endpoint"
                    value={host.serviceEndpoint}
                  />
                )}
                {host.accountManagementUrl && (
                  <Fact
                    label="Account management URL"
                    value={host.accountManagementUrl}
                  />
                )}
                {host.inferredLocation && (
                  <Fact
                    label="Inferred network location"
                    value={host.inferredLocation}
                  />
                )}
                {host.inferredLocationSource && (
                  <Fact
                    label="Location inference source"
                    value={host.inferredLocationSource}
                  />
                )}
                {host.inferredLocationCheckedAt && (
                  <Fact
                    label="Location checked"
                    value={formatDate(host.inferredLocationCheckedAt)}
                  />
                )}
                {dashboard?.manifestUrl && (
                  <Fact
                    label="Optional compatibility manifest"
                    value={dashboard.manifestUrl}
                  />
                )}
                {host.serviceRecordUri && (
                  <Fact label="Service record" value={host.serviceRecordUri} />
                )}
                {host.profileDid && (
                  <Fact label="Profile DID" value={host.profileDid} />
                )}
                {host.matchPatterns.length > 0 && (
                  <div>
                    <dt>Matched addresses</dt>
                    <dd>
                      <span class="host-detail-patterns">
                        {host.matchPatterns.map((pattern) => (
                          <span key={pattern}>{pattern}</span>
                        ))}
                      </span>
                    </dd>
                  </div>
                )}
              </dl>
            </details>

            <div class="host-detail-claim-row">
              {managed && (
                <p class="profile-form-status profile-form-status--ok">
                  Host changes saved.
                </p>
              )}
              {isManagedByCurrentAccount
                ? (
                  <a
                    class="directory-register-button host-detail-claim-button"
                    href={manageHostHref(host)}
                  >
                    <span>Manage host</span>
                  </a>
                )
                : claim
                ? (
                  <p class="host-detail-claim-note">
                    {claimed ? "Claim verified. " : ""}
                    Managed by{" "}
                    <AtmosphereHandle handle={claim.claimantHandle} />
                  </p>
                )
                : (
                  <a
                    class="directory-register-button host-detail-claim-button"
                    href={claimHostHref(host)}
                  >
                    <span class="directory-register-button-icon">+</span>
                    <span>Claim this host</span>
                  </a>
                )}
            </div>
          </div>
        </section>
        <Footer variant="compact" />
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function HostDetailIcon(
  { name }: { name: "fit" | "location" | "handle" | "signup" },
) {
  if (name === "location") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 21s6-5.2 6-11a6 6 0 1 0-12 0c0 5.8 6 11 6 11Z" />
        <circle cx="12" cy="10" r="2.2" />
      </svg>
    );
  }
  if (name === "handle") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <rect x="4.5" y="5.5" width="15" height="13" rx="3" />
        <path d="M7.5 9.5h9" />
        <path d="M8 13h4.8" />
        <path d="M8 16h7" />
      </svg>
    );
  }
  if (name === "signup") {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r="8" />
        <path d="M12 8v8" />
        <path d="M8 12h8" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3.5 19 7.3v5.4c0 4.2-2.8 6.9-7 8-4.2-1.1-7-3.8-7-8V7.3l7-3.8Z" />
      <path d="m8.5 12.3 2.2 2.2 4.8-5" />
    </svg>
  );
}

function claimHostHref(host: AccountHost): string {
  return `/hosts/${encodeURIComponent(host.host)}/claim`;
}

function manageHostHref(host: AccountHost): string {
  return `/hosts/${encodeURIComponent(host.host)}/manage`;
}

function bskyProfileHref(handle: string): string {
  return `https://bsky.app/profile/${encodeURIComponent(handle)}`;
}

function formatDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function registryStatusLabel(host: AccountHost): string {
  if (host.serviceRecordUri) return "Published by host";
  switch (host.source) {
    case "seeded":
      return "Seeded by Atmosphere";
    case "manual":
      return "Needs host record";
    default:
      return "Observed from sign-in";
  }
}

function verificationLabel(status: HostVerificationStatus): string {
  switch (status) {
    case "verified":
      return "Verified";
    case "claimed":
      return "Claimed";
    default:
      return "Observed";
  }
}
