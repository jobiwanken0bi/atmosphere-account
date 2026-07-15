import { define } from "../../utils.ts";
import Nav from "../../components/Nav.tsx";
import Footer from "../../components/Footer.tsx";
import AtmosphereHandle from "../../components/AtmosphereHandle.tsx";
import HostMark from "../../components/hosts/HostMark.tsx";
import BskyIcon from "../../components/icons/BskyIcon.tsx";
import DirectoryIdentityLink from "../../components/DirectoryIdentityLink.tsx";
import HostVisitLink from "../../islands/HostVisitLink.tsx";
import { buildAccountMenuProps } from "../../lib/account-menu-props.ts";
import {
  type AccountHost,
  accountHostAvailability,
  type AccountHostClaim,
  type HostVerificationStatus,
} from "../../lib/account-hosts.ts";
import { getHostDetailFromAppview } from "../../lib/appview-client.ts";
import { buildHostDashboardState } from "../../lib/host-dashboard.ts";
import { hostFriendlyProfile, hostPdsDomain } from "../../lib/host-friendly.ts";
import {
  fetchPdsServerDescription,
  type PdsServerDescription,
  pdsServerDescriptionForAccountHost,
} from "../../lib/pds-server-description.ts";
import { trustedRequestOrigin } from "../../lib/atmosphere-origins.ts";
import { hostHasCurrentConformance } from "../../lib/host-conformance.ts";
import { normalizeHostDirectoryReturnTo } from "../../lib/host-directory-navigation.ts";
import { getResolvedAppLinksForHost } from "../../lib/app-directory.ts";
import type { ResolvedDirectoryAppLink } from "../../lib/app-directory.ts";
import { getMessages, type Messages } from "../../i18n/mod.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const hostId = decodeURIComponent(ctx.params.host).toLowerCase();
    const { host, claim } = await getHostDetailFromAppview(hostId).catch(
      (err) => {
        console.warn("[host] appview host detail failed:", err);
        return { host: null, claim: null };
      },
    );
    if (host) {
      const friendly = hostFriendlyProfile(host);
      const publicOrigin = trustedRequestOrigin(ctx.url, ctx.req.headers);
      ctx.state.pageMeta = {
        title: `${host.displayName} on Atmosphere Hosts`,
        description: friendly.summary,
        ogType: "website",
        canonicalUrl: new URL(
          `/hosts/${encodeURIComponent(host.host)}`,
          publicOrigin,
        ).href,
        imageUrl: host.avatarUrl ?? undefined,
      };
    }
    const [pdsDescription, linkedApps] = host
      ? await Promise.all([
        host.serviceEndpoint
          ? fetchPdsServerDescription(host.serviceEndpoint).catch((err) => {
            console.warn("[host] PDS describeServer failed:", err);
            return null;
          })
          : null,
        getResolvedAppLinksForHost(host).catch((err) => {
          console.warn("[host] linked app lookup failed:", err);
          return [];
        }),
      ])
      : [null, []];
    return ctx.render(
      <HostDetailPage
        host={host}
        claim={claim}
        pdsDescription={host
          ? pdsServerDescriptionForAccountHost(host.host, pdsDescription)
          : null}
        linkedApps={linkedApps}
        directoryCopy={getMessages(ctx.state.locale).hostsDirectory}
        claimed={ctx.url.searchParams.get("claimed") === "1"}
        managed={ctx.url.searchParams.get("managed") === "1"}
        backHref={normalizeHostDirectoryReturnTo(
          ctx.url.searchParams.get("from"),
        )}
        account={buildAccountMenuProps(ctx.state)}
      />,
      { status: host ? 200 : 404 },
    );
  },
});

function HostDetailPage(
  {
    host,
    claim,
    pdsDescription,
    linkedApps,
    directoryCopy,
    claimed,
    managed,
    backHref,
    account,
  }: {
    host: AccountHost | null;
    claim: AccountHostClaim | null;
    pdsDescription: PdsServerDescription | null;
    linkedApps: ResolvedDirectoryAppLink[];
    directoryCopy: Messages["hostsDirectory"];
    claimed: boolean;
    managed: boolean;
    backHref: string;
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
              <a href={backHref} class="text-link-button">
                ← Back to hosts
              </a>
              <div class="glass hosts-empty" style={{ marginTop: "1rem" }}>
                <p class="text-subsection">Host not found.</p>
                <p class="text-body mt-2">
                  This account host may not be listed yet.
                </p>
              </div>
            </div>
          </section>
          <Footer variant="compact" />
        </div>
      </div>
    );
  }
  const dashboard = buildHostDashboardState({ host });
  const friendly = hostFriendlyProfile(host);
  const signupSummary = hostSignupSummary(host, pdsDescription);
  const temporarilyUnavailable = accountHostAvailability(host) === "grace";
  const handleSummary = hostHandleSummary(friendly, pdsDescription);
  const isManagedByCurrentAccount = Boolean(
    claim && account.user && claim.claimantDid === account.user.did,
  );
  const canOfferSignup = Boolean(
    host.signupUrl &&
      (host.verificationStatus === "claimed" ||
        host.verificationStatus === "verified" || host.source === "seeded") &&
      (host.signupStatus === "open" ||
        host.signupStatus === "invite_required"),
  );

  return (
    <div id="page-top">
      <div class="content-layer">
        <Nav account={account} active="hosts" />
        <section class="explore-profile-detail host-detail-section">
          <div class="container" style={{ maxWidth: "880px" }}>
            <div class="project-page-toolbar">
              <a href={backHref} class="text-link-button">
                ← Back to hosts
              </a>
            </div>

            <div class="profile-hero host-detail-hero glass">
              <div class="profile-hero-media host-detail-media">
                <HostMark host={host} />
                {host.profileHandle && host.bskyProfileVisible && (
                  <div class="profile-hero-secondary-actions">
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
                  </div>
                )}
              </div>
              <div class="profile-hero-body">
                <div class="profile-hero-name-row">
                  <h1 class="profile-hero-name">{host.displayName}</h1>
                </div>
                {host.profileHandle && (
                  <p class="profile-hero-handle">
                    <AtmosphereHandle handle={host.profileHandle} />
                  </p>
                )}
                <p class="host-detail-domain">
                  {directoryCopy.hostDomain}: {hostPdsDomain(host)}
                </p>
                {(host.observedAccountCount > 0 || temporarilyUnavailable) && (
                  <div
                    class="host-detail-status-row"
                    aria-label={directoryCopy.availabilityLabel}
                  >
                    {host.observedAccountCount > 0 && (
                      <span class="host-card-account-count">
                        {directoryCopy.accounts(host.observedAccountCount)}
                      </span>
                    )}
                    {temporarilyUnavailable && (
                      <span class="host-card-unavailable">
                        {directoryCopy.temporarilyUnavailable}
                      </span>
                    )}
                  </div>
                )}
                <div class="profile-hero-meta">
                  <div class="profile-card-categories">
                    <span class="profile-card-category">
                      Account host
                    </span>
                    <span class="profile-card-category">
                      {friendly.location}
                    </span>
                    <span class="profile-card-category">
                      {signupSummary.label}
                    </span>
                    {hostHasCurrentConformance(host) && (
                      <span class="profile-card-category host-card-conformance">
                        {directoryCopy.compatibilityChecked}
                      </span>
                    )}
                  </div>
                </div>
                <p class="profile-hero-description">{friendly.summary}</p>
              </div>
              <div class="profile-hero-actions" aria-label="Host actions">
                {linkedApps.map((app) => (
                  <DirectoryIdentityLink
                    key={app.slug}
                    href={`/apps/${encodeURIComponent(app.slug)}`}
                    destination="app"
                    label={app.relationship === "same_operator"
                      ? `${app.name} app`
                      : "App"}
                    accessibleLabel={`View the ${app.name} app profile`}
                  />
                ))}
                {host.homepageUrl && (
                  <HostVisitLink
                    href={host.homepageUrl}
                    label="Explore"
                  />
                )}
                {canOfferSignup && (
                  <HostVisitLink
                    href={host.signupUrl!}
                    label={host.signupStatus === "invite_required"
                      ? "Request invite"
                      : "Create account"}
                  />
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
                  <p class="text-eyebrow">Handle endings</p>
                  <h2>{handleSummary.label}</h2>
                  <p>{handleSummary.detail}</p>
                </div>
              </article>
              <article class="glass host-detail-choice-card">
                <span class="host-detail-choice-icon" aria-hidden="true">
                  <HostDetailIcon name="signup" />
                </span>
                <div>
                  <p class="text-eyebrow">Joining</p>
                  <h2>{signupSummary.label}</h2>
                  <p>{signupSummary.detail}</p>
                </div>
              </article>
            </section>

            <details class="glass account-home-details host-detail-details">
              <summary>Advanced</summary>
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
                {hostHasCurrentConformance(host) && (
                  <Fact
                    label="Compatibility"
                    value={`Passed required checks through ${
                      formatDate(host.conformanceExpiresAt!)
                    }`}
                  />
                )}
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
                {pdsDescription && (
                  <Fact
                    label="PDS signup facts"
                    value={pdsSignupFactsLabel(pdsDescription)}
                  />
                )}
                {pdsDescription?.availableUserDomains.length
                  ? (
                    <Fact
                      label="PDS handle endings"
                      value={pdsDescription.availableUserDomains.join(", ")}
                    />
                  )
                  : null}
                {pdsDescription?.termsOfServiceUrl && (
                  <Fact
                    label="PDS terms"
                    value={pdsDescription.termsOfServiceUrl}
                  />
                )}
                {pdsDescription?.privacyPolicyUrl && (
                  <Fact
                    label="PDS privacy"
                    value={pdsDescription.privacyPolicyUrl}
                  />
                )}
                {pdsDescription?.contactEmail && (
                  <Fact
                    label="PDS contact"
                    value={pdsDescription.contactEmail}
                  />
                )}
                {pdsDescription?.did && (
                  <Fact label="PDS DID" value={pdsDescription.did} />
                )}
                {pdsDescription && (
                  <Fact
                    label="PDS checked"
                    value={formatDate(pdsDescription.checkedAt)}
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

function hostSignupSummary(
  host: AccountHost,
  pds: PdsServerDescription | null,
): { label: string; detail: string } {
  const friendly = hostFriendlyProfile(host);
  if (host.signupStatus === "closed") {
    return {
      label: "Closed for now",
      detail: "This host is not currently advertising new account signups.",
    };
  }

  if (pds) {
    const invite = pds.inviteCodeRequired === true;
    const phone = pds.phoneVerificationRequired === true;
    const knowsInvite = pds.inviteCodeRequired !== null;
    const knowsPhone = pds.phoneVerificationRequired !== null;
    if (invite && phone) {
      return {
        label: "Invite and phone required",
        detail:
          "This host asks for an invite code and phone verification when creating a new account.",
      };
    }
    if (invite) {
      return {
        label: "Invite required",
        detail:
          "This host asks for an invite code before creating a new account.",
      };
    }
    if (phone) {
      return {
        label: "Phone required",
        detail:
          "This host asks for phone verification when creating a new account.",
      };
    }
    if (
      (knowsInvite || knowsPhone || pds.availableUserDomains.length > 0) &&
      pds.inviteCodeRequired !== true &&
      pds.phoneVerificationRequired !== true
    ) {
      return {
        label: "Open signup",
        detail:
          "This host says new accounts do not need an invite or phone verification.",
      };
    }
  }

  return { label: friendly.signupLabel, detail: friendly.signupDetail };
}

function hostHandleSummary(
  friendly: ReturnType<typeof hostFriendlyProfile>,
  pds: PdsServerDescription | null,
): { label: string; detail: string } {
  if (!pds?.availableUserDomains.length) {
    const baseDetail = friendly.handleDetail.replace(/\.$/, "");
    return {
      label: friendly.handleLabel,
      detail: /own domain/i.test(baseDetail)
        ? `${baseDetail}.`
        : `${baseDetail}. You can also use your own domain.`,
    };
  }

  const domains = pds.availableUserDomains;
  const visible = domains.slice(0, 3).join(", ");
  const extra = domains.length > 3 ? ` +${domains.length - 3} more` : "";
  return {
    label: `${visible}${extra}`,
    detail:
      "These are the handle endings this host can give new accounts. You can also use your own domain.",
  };
}

function pdsSignupFactsLabel(pds: PdsServerDescription): string {
  const facts: string[] = [];
  if (pds.inviteCodeRequired === true) {
    facts.push("invite required");
  } else if (pds.inviteCodeRequired === false) {
    facts.push("no invite required");
  }
  if (pds.phoneVerificationRequired === true) {
    facts.push("phone required");
  } else if (pds.phoneVerificationRequired === false) {
    facts.push("no phone required");
  }
  if (pds.availableUserDomains.length > 0) {
    facts.push(
      `handle endings: ${pds.availableUserDomains.slice(0, 5).join(", ")}`,
    );
  }
  return facts.length ? facts.join("; ") : "No public signup facts advertised";
}

function formatDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function registryStatusLabel(host: AccountHost): string {
  if (host.serviceRecordUri) {
    return host.verificationStatus === "claimed" ||
        host.verificationStatus === "verified"
      ? "Published by host"
      : "Published AT Protocol record";
  }
  switch (host.source) {
    case "seeded":
      return "Seeded by Atmosphere";
    case "manual":
      return "Needs host record";
    default:
      return "Seen through account activity";
  }
}

function verificationLabel(status: HostVerificationStatus): string {
  switch (status) {
    case "verified":
      return "Verified";
    case "claimed":
      return "Claimed";
    default:
      return "Listed";
  }
}
