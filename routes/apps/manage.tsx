import { define } from "../../utils.ts";
import Nav from "../../components/Nav.tsx";
import Footer from "../../components/Footer.tsx";
import CreateProfileForm from "../../islands/CreateProfileForm.tsx";
import ProfileUpdateEditor from "../../islands/ProfileUpdateEditor.tsx";
import AtstoreMigrationButton from "../../islands/AtstoreMigrationButton.tsx";
import { getMessages } from "../../i18n/mod.ts";
import { proxyAppviewPageResponse } from "../../lib/appview-client.ts";
import { getProfileByDid } from "../../lib/registry.ts";
import { loadSession } from "../../lib/oauth.ts";
import { getBskyProfile } from "../../lib/pds.ts";
import { buildAccountMenuProps } from "../../lib/account-menu-props.ts";
import { getEffectiveAccountType } from "../../lib/account-types.ts";
import { listProfileUpdates } from "../../lib/profile-updates.ts";
import { bskyCdnAvatarUrl } from "../../lib/avatar.ts";
import ShareButton from "../../islands/ShareButton.tsx";
import {
  type AtstoreListingRecord,
  buildAtstoreListingFromProfile,
  findExistingAtstoreListingForProfile,
  getAtstoreMigrationReadiness,
} from "../../lib/atstore-migration.ts";
import { findExistingCommunityAppProfile } from "../../lib/community-app-profile.ts";
import { getAppListingByIdentifier } from "../../lib/app-directory.ts";
import { getProfileRecord } from "../../lib/pds.ts";
import type { AccountIndicator, LexiconInterop } from "../../lib/lexicons.ts";
import type { BlobRef, LinkEntry } from "../../lib/lexicons.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const proxied = await proxyAppviewPageResponse(ctx.url, ctx.req).catch(
      (err) => appviewUnavailable("app management", err),
    );
    if (proxied) return proxied;

    const user = ctx.state.user;
    if (!user) {
      return new Response(null, {
        status: 303,
        headers: { location: "/apps/create?intent=project" },
      });
    }
    const accountType = await getEffectiveAccountType(user.did).catch(() =>
      null
    );
    if (accountType !== "project") {
      /**
       * Signed in with a non-project type. Send users to their dashboard
       * with the upgrade modal pre-opened so they can either convert
       * this account or sign in with a different one. Legacy untyped
       * accounts (which the OAuth callback now always assigns) fall
       * through to the user dashboard as well.
       */
      return new Response(null, {
        status: 303,
        headers: { location: "/account?upgrade=app" },
      });
    }

    const t = getMessages(ctx.state.locale);

    let initial: Parameters<typeof CreateProfileForm>[0]["initial"] = null;
    /** When showing a Bluesky-prefilled draft (no registry record yet), and
     *  after a registry record exists, the form previews the avatar through
     *  Bluesky's CDN whenever a did/cid pair is available. */
    let initialAvatarUrl: string | null = null;
    let initialBannerUrl: string | null = null;
    let hasAtstoreListing = false;
    let atstoreListingUri: string | null = null;
    let remoteAtstoreListingUri: string | null = null;
    let atstoreMigrationIssues: string[] = [];
    let atstoreMigrationPreview: AtstoreMigrationPreview | null = null;
    /** Owner-aware lookup: include taken-down rows so the form can
     *  surface a "Your profile has been taken down" banner with the
     *  admin reason instead of pretending no profile exists. */
    const existing = await getProfileByDid(user.did, { includeTakenDown: true })
      .catch(() => null);
    const session = await loadSession(user.did).catch(() => null);
    if (existing) {
      const [listing, sourceRecord, remoteAtstore] = await Promise.all([
        getAppListingByIdentifier(existing.handle).catch(() => null),
        session
          ? getProfileRecord(user.did, session.pdsUrl).catch(() => null)
          : Promise.resolve(null),
        session
          ? findExistingAtstoreListingForProfile(user.did, session.pdsUrl)
            .catch(() => null)
          : Promise.resolve(null),
      ]);
      atstoreListingUri = listing?.atstoreListingUri ?? null;
      remoteAtstoreListingUri = !atstoreListingUri && remoteAtstore
        ? remoteAtstore.uri
        : null;
      hasAtstoreListing = !!atstoreListingUri;
      const readiness = getAtstoreMigrationReadiness(
        existing,
        sourceRecord,
      );
      atstoreMigrationIssues = readiness.issues;
      if (readiness.ok && sourceRecord && !atstoreListingUri) {
        atstoreMigrationPreview = previewForAtstoreRecord(
          buildAtstoreListingFromProfile(existing, sourceRecord),
        );
      }
      initial = {
        name: existing.name,
        description: existing.description,
        mainLink: existing.mainLink,
        iosLink: existing.iosLink,
        androidLink: existing.androidLink,
        categories: existing.categories,
        subcategories: existing.subcategories,
        links: existing.links,
        lexicons: existing.lexicons,
        accountIndicators: existing.accountIndicators,
        screenshots: existing.screenshots.map((entry) => ({
          ref: entry.image.ref.$link,
          mime: entry.image.mimeType,
          size: entry.image.size,
        })),
        avatar: existing.avatarCid && existing.avatarMime
          ? { ref: existing.avatarCid, mime: existing.avatarMime }
          : null,
        banner: existing.bannerCid && existing.bannerMime
          ? { ref: existing.bannerCid, mime: existing.bannerMime }
          : null,
        icon: existing.iconCid && existing.iconMime
          ? {
            ref: existing.iconCid,
            mime: existing.iconMime,
          }
          : null,
        iconBw: existing.iconBwCid && existing.iconBwMime
          ? {
            ref: existing.iconBwCid,
            mime: existing.iconBwMime,
          }
          : null,
        iconAccessStatus: existing.iconAccessStatus,
        iconAccessEmail: existing.iconAccessEmail,
        iconAccessDeniedReason: existing.iconAccessDeniedReason,
      };
    } else {
      if (session) {
        const existingAtstore = await findExistingAtstoreListingForProfile(
          user.did,
          session.pdsUrl,
        ).catch(() => null);
        const atstoreInitial = existingAtstore
          ? initialFromAtstoreRecord(existingAtstore.value, user.did)
          : null;
        if (atstoreInitial) {
          initial = atstoreInitial.initial;
          const communityProfile = await findExistingCommunityAppProfile(
            user.did,
            session.pdsUrl,
          ).catch(() => null);
          const interop = interopFromCommunityProfile(
            communityProfile?.value,
          );
          initial.lexicons = interop.lexicons;
          initial.accountIndicators = interop.accountIndicators;
          initialAvatarUrl = atstoreInitial.initialAvatarUrl;
          initialBannerUrl = atstoreInitial.initialBannerUrl;
          hasAtstoreListing = true;
        } else {
          const bsky = await getBskyProfile(session.pdsUrl, user.did).catch(
            () => null,
          );
          if (bsky) {
            initial = {
              name: bsky.displayName ?? "",
              description: bsky.description ?? "",
              mainLink: null,
              iosLink: null,
              androidLink: null,
              categories: ["app"],
              subcategories: [],
              links: [],
              lexicons: {},
              accountIndicators: [],
              screenshots: [],
              avatar: bsky.avatar
                ? {
                  ref: bsky.avatar.ref.$link,
                  mime: bsky.avatar.mimeType,
                  size: bsky.avatar.size,
                }
                : null,
              banner: null,
              icon: null,
              iconBw: null,
              iconAccessStatus: null,
              iconAccessEmail: null,
              iconAccessDeniedReason: null,
            };
            if (bsky.avatar) {
              initialAvatarUrl = bskyCdnAvatarUrl(
                user.did,
                bsky.avatar.ref.$link,
              );
            }
          }
        }
      }
    }

    /** Surface profile-level takedowns to the owner so they understand
     *  why edits won't publish. The PUT endpoint also returns 403 in
     *  this state, but a banner is much friendlier than a thrown
     *  error after Publish. */
    const takedown = existing?.takedownStatus === "taken_down"
      ? {
        reason: existing.takedownReason ?? "",
        at: existing.takedownAt,
      }
      : null;

    const publicProfileHandle = takedown
      ? null
      : existing?.handle ?? (hasAtstoreListing ? user.handle : null);
    /**
     * Trailing slash is intentional — see the long comment in
     * routes/apps/[handle].tsx. Bluesky's composer otherwise treats
     * `/apps/foo.com` as a Windows executable and skips the unfurl.
     */
    const shareUrl = publicProfileHandle
      ? new URL(
        `/apps/${encodeURIComponent(publicProfileHandle)}/`,
        ctx.url.origin,
      ).href
      : null;
    const shareTitleName = (existing?.name?.trim() ||
      initial?.name?.trim() ||
      publicProfileHandle ||
      user.handle).trim();
    const updates = existing
      ? await listProfileUpdates(user.did, { limit: 8 }).catch(() => [])
      : [];
    return ctx.render(
      <ManagePage
        user={user}
        account={buildAccountMenuProps(ctx.state, publicProfileHandle)}
        initial={initial}
        initialAvatarUrl={initialAvatarUrl}
        initialBannerUrl={initialBannerUrl}
        initialPublished={!!(existing || hasAtstoreListing) && !takedown}
        publicProfileHandle={publicProfileHandle}
        shareUrl={shareUrl}
        shareTitleName={shareTitleName}
        updates={updates.map((update) => ({
          rkey: update.rkey,
          title: update.title,
          body: update.body,
          version: update.version,
          tangledCommitUrl: update.tangledCommitUrl,
          createdAt: update.createdAt,
        }))}
        showUpdates={!!existing}
        atstoreListingUri={atstoreListingUri}
        remoteAtstoreListingUri={remoteAtstoreListingUri}
        atstoreMigrationIssues={atstoreMigrationIssues}
        atstoreMigrationPreview={atstoreMigrationPreview}
        showAtstoreMigration={!!existing && !takedown}
        migrationFocus={ctx.url.searchParams.get("migrate") ===
          "shared-records"}
        takedown={takedown}
        t={t}
      />,
    );
  },
});

function appviewUnavailable(scope: string, err: unknown): Response {
  console.error(`[appview] ${scope} proxy failed:`, err);
  return new Response("App management is temporarily unavailable.", {
    status: 503,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
    },
  });
}

interface AtstoreInitialState {
  initial: NonNullable<Parameters<typeof CreateProfileForm>[0]["initial"]>;
  initialAvatarUrl: string | null;
  initialBannerUrl: string | null;
}

const FORM_AVATAR_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
  "image/avif",
]);
const FORM_BANNER_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);
const FORM_SCREENSHOT_MIME_TYPES = FORM_BANNER_MIME_TYPES;

function interopFromCommunityProfile(value: unknown): {
  lexicons: LexiconInterop;
  accountIndicators: AccountIndicator[];
} {
  const record = asRecord(value);
  const lex = asRecord(record?.lexicons);
  const indicators = Array.isArray(record?.accountIndicators)
    ? record.accountIndicators.flatMap((item): AccountIndicator[] => {
      const row = asRecord(item);
      const collection = str(row?.collection, 256);
      if (!collection) return [];
      const rkey = str(row?.rkey, 256);
      return [{ collection, ...(rkey ? { rkey } : {}) }];
    })
    : [];
  return {
    lexicons: {
      produces: strArray(lex?.produces, 64, 256),
      consumes: strArray(lex?.consumes, 64, 256),
    },
    accountIndicators: indicators,
  };
}

function initialFromAtstoreRecord(
  value: unknown,
  did: string,
): AtstoreInitialState | null {
  const record = asRecord(value);
  if (!record) return null;
  const name = str(record.name, 60);
  const externalUrl = httpUrl(record.externalUrl);
  const icon = blobRef(record.icon);
  if (!name || !externalUrl || !icon) return null;
  const links = linksFromAtstore(record.links, externalUrl);
  const hero = blobRef(record.heroImage);
  const screenshots = Array.isArray(record.screenshots)
    ? record.screenshots
      .map(blobRef)
      .filter((blob): blob is BlobRef =>
        !!blob && FORM_SCREENSHOT_MIME_TYPES.has(blob.mimeType.toLowerCase())
      )
      .slice(0, 4)
    : [];

  return {
    initial: {
      name,
      description: str(record.description, 500) ??
        str(record.tagline, 500) ?? "",
      mainLink: externalUrl,
      iosLink: links.iosLink,
      androidLink: links.androidLink,
      categories: ["app"],
      subcategories: strArray(record.appTags, 10, 32),
      links: links.links,
      lexicons: {},
      accountIndicators: [],
      screenshots: screenshots.map((screenshot) => {
        const previewUrl = blobPreviewUrl(did, screenshot);
        return {
          ref: screenshot.ref.$link,
          mime: screenshot.mimeType,
          size: screenshot.size,
          ...(previewUrl ? { previewUrl } : {}),
        };
      }),
      avatar: {
        ref: icon.ref.$link,
        mime: icon.mimeType,
        size: icon.size,
      },
      banner: hero && FORM_BANNER_MIME_TYPES.has(hero.mimeType.toLowerCase())
        ? {
          ref: hero.ref.$link,
          mime: hero.mimeType,
          size: hero.size,
        }
        : null,
      icon: null,
      iconBw: null,
      iconAccessStatus: null,
      iconAccessEmail: null,
      iconAccessDeniedReason: null,
    },
    initialAvatarUrl: blobPreviewUrl(did, icon),
    initialBannerUrl: hero &&
        FORM_BANNER_MIME_TYPES.has(hero.mimeType.toLowerCase())
      ? blobPreviewUrl(did, hero)
      : null,
  };
}

function blobPreviewUrl(did: string, blob: BlobRef): string | null {
  if (!FORM_AVATAR_MIME_TYPES.has(blob.mimeType.toLowerCase())) return null;
  return `/api/atproto/blob?did=${encodeURIComponent(did)}&cid=${
    encodeURIComponent(blob.ref.$link)
  }`;
}

function linksFromAtstore(
  value: unknown,
  primaryUrl: string,
): { iosLink: string | null; androidLink: string | null; links: LinkEntry[] } {
  let iosLink: string | null = null;
  let androidLink: string | null = null;
  const links: LinkEntry[] = [];
  if (!Array.isArray(value)) return { iosLink, androidLink, links };
  const primary = canonicalUrl(primaryUrl);
  for (const item of value) {
    const row = asRecord(item);
    if (!row) continue;
    const url = httpUrl(row.url);
    if (!url) continue;
    const type = str(row.type, 32)?.toLowerCase() ?? "other";
    if (type === "ios" && !iosLink) {
      iosLink = url;
      continue;
    }
    if (type === "android" && !androidLink) {
      androidLink = url;
      continue;
    }
    if (canonicalUrl(url) === primary) continue;
    links.push({
      kind: "other",
      url,
      label: str(row.label, 64) ?? labelForAtstoreLinkType(type),
    });
  }
  return { iosLink, androidLink, links: links.slice(0, 12) };
}

function labelForAtstoreLinkType(type: string): string {
  if (type === "bsky") return "Bluesky";
  if (type === "tangled") return "Tangled";
  if (type === "supper") return "Supper";
  if (type === "docs") return "Docs";
  if (type === "source") return "Source";
  return "Link";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function str(value: unknown, max: number): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, max)
    : null;
}

function strArray(value: unknown, maxItems: number, max: number): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const text = str(item, max);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= maxItems) break;
  }
  return out;
}

function httpUrl(value: unknown): string | null {
  const raw = str(value, 2048);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

function canonicalUrl(value: string): string {
  const url = new URL(value);
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  return url.toString().replace(/\/$/, "");
}

function blobRef(value: unknown): BlobRef | null {
  const blob = asRecord(value);
  const ref = asRecord(blob?.ref);
  if (!blob || !ref) return null;
  const cid = str(ref.$link, 256) ?? str(ref.link, 256);
  const mimeType = str(blob.mimeType, 128);
  const size = Number(blob.size);
  if (!cid || !mimeType || !Number.isFinite(size)) return null;
  return {
    $type: "blob",
    ref: { $link: cid },
    mimeType,
    size,
  };
}

interface ManagePageProps {
  user: { did: string; handle: string };
  account: ReturnType<typeof buildAccountMenuProps>;
  initial: Parameters<typeof CreateProfileForm>[0]["initial"];
  initialAvatarUrl: string | null;
  initialBannerUrl: string | null;
  initialPublished: boolean;
  publicProfileHandle: string | null;
  /** Absolute project page URL when published; null if no live listing yet. */
  shareUrl: string | null;
  /** Display name for native share / clipboard context. */
  shareTitleName: string;
  updates: Parameters<typeof ProfileUpdateEditor>[0]["initialUpdates"];
  showUpdates: boolean;
  atstoreListingUri: string | null;
  remoteAtstoreListingUri: string | null;
  atstoreMigrationIssues: string[];
  atstoreMigrationPreview: AtstoreMigrationPreview | null;
  showAtstoreMigration: boolean;
  migrationFocus: boolean;
  takedown: { reason: string; at: number | null } | null;
  // deno-lint-ignore no-explicit-any
  t: any;
}

function ManagePage(
  {
    user,
    account,
    initial,
    initialAvatarUrl,
    initialBannerUrl,
    initialPublished,
    publicProfileHandle,
    shareUrl,
    shareTitleName,
    updates,
    showUpdates,
    atstoreListingUri,
    remoteAtstoreListingUri,
    atstoreMigrationIssues,
    atstoreMigrationPreview,
    showAtstoreMigration,
    migrationFocus,
    takedown,
    t,
  }: ManagePageProps,
) {
  const explore = t.explore;
  const shareCopy = explore.detail.share;
  const takedownCopy = t.manageTakedown;
  return (
    <div id="page-top">
      <div class="content-layer">
        <Nav account={account} active="apps" />
        <section class="explore-manage" style={{ paddingTop: "8rem" }}>
          <div class="container" style={{ maxWidth: "920px" }}>
            <div class="manage-header">
              <div>
                <h1 class="text-section">{explore.manage.headline}</h1>
                <p class="text-body mt-2">{explore.manage.subhead}</p>
              </div>
              {shareUrl && (
                <ShareButton
                  url={shareUrl}
                  title={shareCopy.shareTitle(shareTitleName)}
                  copy={{
                    button: shareCopy.button,
                    copyLink: shareCopy.copyLink,
                    copied: shareCopy.copied,
                    copyFailed: shareCopy.copyFailed,
                  }}
                />
              )}
            </div>

            {takedown && (
              <div class="manage-takedown-banner" role="alert">
                <strong class="manage-takedown-banner-title">
                  {takedownCopy.title}
                </strong>
                <p class="manage-takedown-banner-body">
                  {takedownCopy.body}
                </p>
                <p class="manage-takedown-banner-reason">
                  <strong>{takedownCopy.reasonLabel}:</strong> {takedown.reason}
                </p>
              </div>
            )}

            <div style={{ marginTop: "2.5rem" }}>
              <OwnerAppSummary
                initial={initial}
                initialPublished={initialPublished}
                atstoreListingUri={atstoreListingUri}
                remoteAtstoreListingUri={remoteAtstoreListingUri}
                publicProfileHandle={publicProfileHandle}
              />
              {initialPublished && (
                <section class="glass directory-relationship-entry owner-app-relationship-entry">
                  <div>
                    <p class="text-eyebrow">Host identity</p>
                    <h2>Connect this app to an account host</h2>
                    <p>
                      Define whether the host is part of this product or run by
                      the same organization. A different host account must
                      approve the connection before it appears publicly.
                    </p>
                  </div>
                  <a class="directory-register-button" href="/apps/manage/host">
                    Manage host connection
                  </a>
                </section>
              )}
              {showAtstoreMigration && migrationFocus && (
                <MigrationSection
                  atstoreListingUri={atstoreListingUri}
                  remoteAtstoreListingUri={remoteAtstoreListingUri}
                  atstoreMigrationIssues={atstoreMigrationIssues}
                  atstoreMigrationPreview={atstoreMigrationPreview}
                />
              )}
              <CreateProfileForm
                did={user.did}
                handle={user.handle}
                initial={initial}
                initialAvatarUrl={initialAvatarUrl}
                initialBannerUrl={initialBannerUrl}
                initialPublished={initialPublished}
                publicProfileHandle={publicProfileHandle}
              />
            </div>

            {showAtstoreMigration && !migrationFocus && (
              <MigrationSection
                atstoreListingUri={atstoreListingUri}
                remoteAtstoreListingUri={remoteAtstoreListingUri}
                atstoreMigrationIssues={atstoreMigrationIssues}
                atstoreMigrationPreview={atstoreMigrationPreview}
              />
            )}

            {showUpdates && (
              <div style={{ marginTop: "1.25rem" }}>
                <ProfileUpdateEditor
                  initialUpdates={updates}
                  disabled={!initialPublished || !!takedown}
                />
              </div>
            )}
          </div>
        </section>
        <Footer variant="compact" />
      </div>
    </div>
  );
}

function MigrationSection(
  {
    atstoreListingUri,
    remoteAtstoreListingUri,
    atstoreMigrationIssues,
    atstoreMigrationPreview,
  }: {
    atstoreListingUri: string | null;
    remoteAtstoreListingUri: string | null;
    atstoreMigrationIssues: string[];
    atstoreMigrationPreview: AtstoreMigrationPreview | null;
  },
) {
  return (
    <section class="glass atstore-migration-card">
      <div class="atstore-migration-copy">
        <p class="text-eyebrow">Shared app records</p>
        <h2>Move this listing to shared records</h2>
        <p>
          New app listings publish shared records. Existing Atmosphere-only apps
          can be moved over so community app profiles, ATStore reviews,
          favorites, and discovery all use the shared app ecosystem.
        </p>
      </div>
      <AtstoreMigrationButton
        disabled={atstoreMigrationIssues.length > 0 && !remoteAtstoreListingUri}
        initialUri={atstoreListingUri}
        remoteUri={remoteAtstoreListingUri}
        issues={atstoreMigrationIssues}
        preview={atstoreMigrationPreview}
      />
    </section>
  );
}

function OwnerAppSummary(
  {
    initial,
    initialPublished,
    atstoreListingUri,
    remoteAtstoreListingUri,
    publicProfileHandle,
  }: {
    initial: Parameters<typeof CreateProfileForm>[0]["initial"];
    initialPublished: boolean;
    atstoreListingUri: string | null;
    remoteAtstoreListingUri: string | null;
    publicProfileHandle: string | null;
  },
) {
  const hasIcon = !!initial?.avatar;
  const hasDestination = !!(
    initial?.mainLink || initial?.iosLink || initial?.androidLink
  );
  const state = atstoreListingUri
    ? {
      tone: "ok",
      label: "ATStore-backed",
      title: "Shared app record active",
      body:
        "Edits from this page update shared app records for interoperable discovery, reviews, and favorites.",
    }
    : remoteAtstoreListingUri
    ? {
      tone: "attention",
      label: "Remote shared record found",
      title: "Sync shared records",
      body:
        "This account already has an ATStore listing on its PDS. Sync it below and publish the community app profile.",
    }
    : initialPublished
    ? {
      tone: "attention",
      label: "Legacy Atmosphere record",
      title: "Migration available",
      body:
        "This app is still using the older Atmosphere listing record. Complete the requirements below, then migrate it to shared app records.",
    }
    : {
      tone: "ok",
      label: "New app listing",
      title: "Publishes shared records by default",
      body:
        "When you publish, Atmosphere writes shared app records from this app account.",
    };
  return (
    <section class={`glass owner-app-summary owner-app-summary--${state.tone}`}>
      <div class="owner-app-summary-copy">
        <p class="text-eyebrow">{state.label}</p>
        <h2>{state.title}</h2>
        <p>{state.body}</p>
      </div>
      <div class="owner-app-requirements" aria-label="Publishing requirements">
        <span
          class={`owner-app-requirement ${hasIcon ? "is-ready" : "needs-work"}`}
        >
          {hasIcon ? "App icon ready" : "Needs app icon"}
        </span>
        <span
          class={`owner-app-requirement ${
            hasDestination ? "is-ready" : "needs-work"
          }`}
        >
          {hasDestination ? "Destination link ready" : "Needs Web/iOS/Android"}
        </span>
        {publicProfileHandle && (
          <a
            href={`/apps/${encodeURIComponent(publicProfileHandle)}`}
            class="owner-app-requirement owner-app-requirement--link"
          >
            View app page
          </a>
        )}
      </div>
    </section>
  );
}

interface AtstoreMigrationPreview {
  name: string;
  slug: string;
  externalUrl: string;
  collections: string[];
  tags: string[];
  linkLabels: string[];
  screenshotCount: number;
  migratedFromAtUri: string | null;
}

function previewForAtstoreRecord(
  record: AtstoreListingRecord,
): AtstoreMigrationPreview {
  return {
    name: record.name,
    slug: record.slug,
    externalUrl: record.externalUrl,
    collections: record.categorySlug,
    tags: record.appTags ?? [],
    linkLabels: (record.links ?? []).map((link) => link.label || link.type),
    screenshotCount: record.screenshots?.length ?? 0,
    migratedFromAtUri: record.migratedFromAtUri ?? null,
  };
}
