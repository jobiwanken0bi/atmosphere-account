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
  type HostSignupStatus,
  type HostVerificationStatus,
} from "../../lib/account-hosts.ts";
import {
  type HostSourceRecord,
  listHostProtocolRecords,
} from "../../lib/host-record-indexing.ts";
import {
  buildHostDashboardState,
  type HostDashboardCapability,
  hostDashboardCapabilityStatusLabel,
} from "../../lib/host-dashboard.ts";
import { buildHostAccountRoute } from "../../lib/host-account-routing.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const hostId = decodeURIComponent(ctx.params.host).toLowerCase();
    const host = await getAccountHost(hostId).catch(() => null);
    const claim = host
      ? await getAccountHostClaim(host.host).catch(() => null)
      : null;
    const sourceRecords = host
      ? await listHostProtocolRecords(host.host).catch(() => [])
      : [];
    if (host) {
      ctx.state.pageMeta = {
        title: `${host.displayName} on Atmosphere Hosts`,
        description: host.description,
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
        sourceRecords={sourceRecords}
      />,
      { status: host ? 200 : 404 },
    );
  },
});

function HostDetailPage(
  { host, claim, claimed, managed, account, sourceRecords }: {
    host: AccountHost | null;
    claim: AccountHostClaim | null;
    claimed: boolean;
    managed: boolean;
    account: ReturnType<typeof buildAccountMenuProps>;
    sourceRecords: HostSourceRecord[];
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
                  <span
                    class={`host-status host-status-${host.verificationStatus}`}
                  >
                    {verificationLabel(host.verificationStatus)}
                  </span>
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
                      {signupLabel(host.signupStatus)}
                    </span>
                  </div>
                </div>
                <p class="profile-hero-description">{host.description}</p>
              </div>
              <div class="profile-hero-actions" aria-label="Host actions">
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
                {host.homepageUrl && <HostVisitLink href={host.homepageUrl} />}
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

            <div class="host-detail-grid">
              <section class="glass host-detail-card">
                <p class="text-eyebrow">Overview</p>
                <dl class="host-card-facts host-detail-facts">
                  <Fact label="Host address" value={host.host} />
                  {host.serviceEndpoint && (
                    <Fact label="PDS endpoint" value={host.serviceEndpoint} />
                  )}
                  <Fact label="Signup" value={signupLabel(host.signupStatus)} />
                  <Fact
                    label="Registry status"
                    value={registryStatusLabel(host)}
                  />
                  {host.profileHandle && (
                    <div>
                      <dt>Host account</dt>
                      <dd>
                        <AtmosphereHandle handle={host.profileHandle} />
                      </dd>
                    </div>
                  )}
                </dl>
              </section>

              <section class="glass host-detail-card">
                <p class="text-eyebrow">Status</p>
                <dl class="host-card-facts host-detail-facts">
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
                </dl>
              </section>
            </div>

            {dashboard && (
              <section class="glass host-detail-card host-detail-dashboard-card">
                <div class="host-detail-dashboard-head">
                  <div>
                    <p class="text-eyebrow">Account page</p>
                    <h2>Host-owned controls</h2>
                    <p class="text-body">
                      Atmosphere can route you to this host's PDS account page.
                      Passwords, devices, OAuth grants, account deletion,
                      backups, and recovery remain owned by the host.
                    </p>
                  </div>
                  {accountUrl && (
                    <a
                      href={accountUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      class="profile-form-button-secondary profile-form-button-secondary--lg"
                    >
                      Open host account page
                    </a>
                  )}
                </div>
                <div class="host-detail-capability-grid">
                  {dashboard.capabilities.map((capability) => (
                    <HostCapabilitySummary
                      key={capability.key}
                      capability={capability}
                    />
                  ))}
                </div>
              </section>
            )}

            <details class="glass account-home-details host-detail-details">
              <summary>Technical details</summary>
              <dl>
                <Fact label="Host domain" value={host.host} />
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
              {sourceRecords.length > 0 && (
                <div class="host-source-records">
                  <h3>Indexed host records</h3>
                  <div class="host-source-record-list">
                    {sourceRecords.map((record) => (
                      <HostSourceRecordRow
                        key={record.uri}
                        record={record}
                      />
                    ))}
                  </div>
                </div>
              )}
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

function HostSourceRecordRow({ record }: { record: HostSourceRecord }) {
  return (
    <article class="host-source-record">
      <div>
        <strong>{hostCollectionLabel(record.collection)}</strong>
        <span>
          {record.authorHandle
            ? <AtmosphereHandle handle={record.authorHandle} />
            : record.repoDid}
        </span>
      </div>
      <code>{record.uri}</code>
      <p>
        {record.deletedAt
          ? `Deleted ${formatDate(record.deletedAt)}`
          : `Indexed ${formatDate(record.indexedAt)}`}
        {record.cid ? ` · CID ${record.cid}` : ""}
      </p>
    </article>
  );
}

function hostCollectionLabel(collection: string): string {
  if (collection.endsWith(".service")) return "Host service";
  if (collection.endsWith(".profile")) return "Host profile";
  return collection;
}

function HostCapabilitySummary(
  { capability }: { capability: HostDashboardCapability },
) {
  return (
    <article
      class={`host-detail-capability host-detail-capability--${capability.state}`}
    >
      <span>{capability.label}</span>
      <strong>{hostDashboardCapabilityStatusLabel(capability.state)}</strong>
    </article>
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

function signupLabel(status: HostSignupStatus): string {
  switch (status) {
    case "open":
      return "Open signup";
    case "invite_required":
      return "Invite required";
    case "closed":
      return "Closed";
    default:
      return "Status being checked";
  }
}
