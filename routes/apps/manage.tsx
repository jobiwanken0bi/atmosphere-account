import { define } from "../../utils.ts";
import Nav from "../../components/Nav.tsx";
import Footer from "../../components/Footer.tsx";
import CreateProfileForm from "../../islands/CreateProfileForm.tsx";
import ProfileUpdateEditor from "../../islands/ProfileUpdateEditor.tsx";
import AtstoreMigrationButton from "../../islands/AtstoreMigrationButton.tsx";
import { getMessages } from "../../i18n/mod.ts";
import { proxyAppviewPageResponse } from "../../lib/appview-client.ts";
import { getProfileByDid } from "../../lib/registry.ts";
import { getSessionForCapabilities } from "../../lib/oauth.ts";
import {
  describeRepoCollectionsPublic,
  getBskyProfile,
  getProfileRecord,
  getRecordPublic,
} from "../../lib/pds.ts";
import { buildAccountMenuProps } from "../../lib/account-menu-props.ts";
import {
  type AccountHost,
  listManagedAccountHosts,
} from "../../lib/account-hosts.ts";
import { getEffectiveAccountType } from "../../lib/account-types.ts";
import { bskyCdnAvatarUrl } from "../../lib/avatar.ts";
import ShareButton from "../../islands/ShareButton.tsx";
import {
  type AtstoreListingRecord,
  buildAtstoreListingFromProfile,
  findExistingAtstoreListingForProfile,
  getAtstoreMigrationReadiness,
} from "../../lib/atstore-migration.ts";
import { findExistingCommunityAppProfile } from "../../lib/community-app-profile.ts";
import {
  type AppListing,
  getAppListingById,
  getAppListingByIdentifier,
  getManagedAppListingByAccountDid,
} from "../../lib/app-directory.ts";
import { ATSTORE_LISTING_NSID } from "../../lib/app-lexicons.ts";
import type { AccountIndicator, LexiconInterop } from "../../lib/lexicons.ts";
import type { BlobRef, LinkEntry } from "../../lib/lexicons.ts";
import {
  type CollectionSuggestion,
  listCollectionSuggestions,
} from "../../lib/collection-catalog.ts";
import {
  type DirectoryEntityAppLink,
  listDirectoryEntityLinksForApp,
  userControlsAppListing,
} from "../../lib/directory-entity-links.ts";
import {
  APP_MANAGEMENT_CAPABILITIES,
  oauthSigninUrl,
} from "../../lib/oauth-action.ts";
import { existingAppRegistrationRedirect } from "../../lib/app-profile-cardinality.ts";
import {
  listProfileUpdates,
  type ProfileUpdateRow,
} from "../../lib/profile-updates.ts";
import { syncStandardSiteDocumentsForProduct } from "../../lib/standard-site-sync.ts";
import { isAtmosphereStandardSiteUpdateSource } from "../../lib/standard-site-updates.ts";

/**
 * An explicit edit target is trusted only when this DID owns the exact
 * repository record. Perform this check before requesting app-management
 * access so a foreign app URL cannot trigger an irrelevant permission prompt.
 */
export function isEditableRequestedApp(
  app: AppListing,
  userDid: string,
): boolean {
  return userControlsAppListing(app, userDid) &&
    Boolean(app.atstoreListingUri?.startsWith(`at://${userDid}/`));
}

export function primaryAccountHostLink(
  links: DirectoryEntityAppLink[],
): DirectoryEntityAppLink | null {
  const hostingLinks = links.filter((link) =>
    link.relationship !== "host_only"
  );
  return hostingLinks.find((link) => link.status === "verified") ??
    hostingLinks[0] ?? null;
}

export const handler = define.handlers({
  async GET(ctx) {
    const proxied = await proxyAppviewPageResponse(ctx.url, ctx.req).catch(
      (err) => appviewUnavailable("app management", err),
    );
    if (proxied) return proxied;

    const next = `${ctx.url.pathname}${ctx.url.search}`;
    const creatingAdditionalApp = ctx.url.searchParams.get("new") === "1";
    const requestedAppId = ctx.url.searchParams.get("app")?.trim();
    const user = ctx.state.user;
    if (!user) {
      return new Response(null, {
        status: 303,
        headers: {
          location: oauthSigninUrl({
            next,
            action: "app",
            capabilities: APP_MANAGEMENT_CAPABILITIES,
            name: "your app",
          }),
        },
      });
    }
    let existingManagedApp: Awaited<
      ReturnType<typeof getManagedAppListingByAccountDid>
    >;
    try {
      existingManagedApp = await getManagedAppListingByAccountDid(user.did);
    } catch (error) {
      return appviewUnavailable("app ownership", error);
    }
    const registrationRedirect = existingAppRegistrationRedirect({
      creatingNew: creatingAdditionalApp,
      existingApp: existingManagedApp,
      ownerDid: user.did,
    });
    if (registrationRedirect) {
      return new Response(null, {
        status: 303,
        headers: {
          location: registrationRedirect,
          "cache-control": "no-store",
        },
      });
    }
    let requestedManagedApp: AppListing | null = null;
    if (requestedAppId) {
      try {
        requestedManagedApp = await getAppListingById(requestedAppId);
      } catch (error) {
        return appviewUnavailable("app management", error);
      }
      if (!requestedManagedApp) {
        return new Response("App listing not found.", { status: 404 });
      }
      if (!isEditableRequestedApp(requestedManagedApp, user.did)) {
        return new Response("This account cannot manage that app listing.", {
          status: 403,
        });
      }
    }
    const accountType = await getEffectiveAccountType(user.did).catch(() =>
      null
    );
    // `project` remains a compatibility marker for the one legacy app record,
    // not an authorization role. An owner-facing listing lookup also covers
    // ATStore apps and apps hidden from the public directory.
    if (
      accountType !== "project" && !existingManagedApp &&
      !creatingAdditionalApp && !requestedAppId
    ) {
      return new Response(null, {
        status: 303,
        headers: { location: "/account/apps-hosts" },
      });
    }
    const requiredCapabilities = APP_MANAGEMENT_CAPABILITIES;
    const authorized = await getSessionForCapabilities(
      user.did,
      requiredCapabilities,
      { quiet: true },
    );
    if (!authorized) {
      return new Response(null, {
        status: 303,
        headers: {
          location: oauthSigninUrl({
            next,
            action: "app",
            capabilities: requiredCapabilities,
            name: requestedManagedApp?.name ?? "your app",
          }),
        },
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
    let selectedManagedApp: Awaited<ReturnType<typeof getAppListingById>> =
      null;
    /** Owner-aware lookup: include taken-down rows so the form can
     *  surface a "Your profile has been taken down" banner with the
     *  admin reason instead of pretending no profile exists. */
    const existing = await getProfileByDid(user.did, { includeTakenDown: true })
      .catch(() => null);
    const session = authorized;
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
      atstoreListingUri ??= existingManagedApp?.atstoreListingUri ?? null;
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
          atstoreListingUri = existingAtstore?.uri ??
            existingManagedApp?.atstoreListingUri ?? null;
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

    if (requestedManagedApp && session) {
      const rkey = requestedManagedApp.atstoreListingUri!.split("/").at(-1) ??
        "";
      const record = rkey
        ? await getRecordPublic(
          session.pdsUrl,
          user.did,
          ATSTORE_LISTING_NSID,
          rkey,
        ).catch(() => null)
        : null;
      const selectedInitial = record
        ? initialFromAtstoreRecord(record.value, user.did)
        : null;
      if (!selectedInitial) {
        return new Response("The app listing record could not be loaded.", {
          status: 503,
        });
      }
      selectedManagedApp = requestedManagedApp;
      initial = selectedInitial.initial;
      initialAvatarUrl = selectedInitial.initialAvatarUrl;
      initialBannerUrl = selectedInitial.initialBannerUrl;
      hasAtstoreListing = true;
      atstoreListingUri = requestedManagedApp.atstoreListingUri;
      remoteAtstoreListingUri = null;
      atstoreMigrationIssues = [];
      atstoreMigrationPreview = null;
    }

    /** Surface profile-level takedowns to the owner so they understand
     *  why edits won't publish. The PUT endpoint also returns 403 in
     *  this state, but a banner is much friendlier than a thrown
     *  error after Publish. */
    const takedown = !selectedManagedApp &&
        existing?.takedownStatus === "taken_down"
      ? {
        reason: existing.takedownReason ?? "",
        at: existing.takedownAt,
      }
      : null;

    const publicProfileHandle = creatingAdditionalApp
      ? null
      : takedown
      ? null
      : selectedManagedApp?.slug ?? existingManagedApp?.slug ??
        existing?.handle ??
        (hasAtstoreListing ? user.handle : null);
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
    const detectedCollections = session
      ? await describeRepoCollectionsPublic(session.pdsUrl, user.did).catch(
        () => [],
      )
      : [];
    const collectionSuggestions = await listCollectionSuggestions(
      detectedCollections,
    );
    const managedAppListing = creatingAdditionalApp
      ? null
      : selectedManagedApp ?? existingManagedApp ??
        await getAppListingByIdentifier(user.did, {
          syncLegacy: false,
        }).catch(() => null);
    const accountHostLink = managedAppListing
      ? primaryAccountHostLink(
        await listDirectoryEntityLinksForApp(managedAppListing.id).catch(
          () => [],
        ),
      )
      : null;
    const managedAccountHosts = await listManagedAccountHosts(user.did).catch(
      () => [],
    );
    const canManageProductUpdates = !creatingAdditionalApp &&
      managedAppListing?.productDid === user.did;
    if (canManageProductUpdates) {
      await syncStandardSiteDocumentsForProduct(user.did).catch(() => null);
    }
    const profileUpdates = canManageProductUpdates
      ? await listProfileUpdates(user.did, { limit: 40 }).catch(() => [])
      : [];
    return ctx.render(
      <ManagePage
        user={user}
        account={buildAccountMenuProps(ctx.state, publicProfileHandle)}
        initial={creatingAdditionalApp ? null : initial}
        initialAvatarUrl={creatingAdditionalApp ? null : initialAvatarUrl}
        initialBannerUrl={creatingAdditionalApp ? null : initialBannerUrl}
        initialPublished={creatingAdditionalApp
          ? false
          : !!(existing || hasAtstoreListing) && !takedown}
        collectionSuggestions={collectionSuggestions}
        publicProfileHandle={publicProfileHandle}
        shareUrl={shareUrl}
        shareTitleName={shareTitleName}
        atstoreListingUri={creatingAdditionalApp ? null : atstoreListingUri}
        remoteAtstoreListingUri={remoteAtstoreListingUri}
        atstoreMigrationIssues={atstoreMigrationIssues}
        atstoreMigrationPreview={atstoreMigrationPreview}
        showAtstoreMigration={!creatingAdditionalApp && !selectedManagedApp &&
          !!existing && !takedown}
        migrationFocus={ctx.url.searchParams.get("migrate") ===
          "shared-records"}
        managedAppListingId={managedAppListing?.id ?? null}
        accountHostLink={accountHostLink}
        managedAccountHosts={managedAccountHosts}
        profileUpdates={managedAppListing
          ? profileUpdates.filter((update) =>
            isAtmosphereStandardSiteUpdateSource(
              update.source,
              managedAppListing.id,
            )
          )
          : []}
        canManageProductUpdates={canManageProductUpdates}
        createNewListing={creatingAdditionalApp}
        reauthReturnTo={next}
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
  collectionSuggestions: CollectionSuggestion[];
  publicProfileHandle: string | null;
  /** Absolute project page URL when published; null if no live listing yet. */
  shareUrl: string | null;
  /** Display name for native share / clipboard context. */
  shareTitleName: string;
  atstoreListingUri: string | null;
  remoteAtstoreListingUri: string | null;
  atstoreMigrationIssues: string[];
  atstoreMigrationPreview: AtstoreMigrationPreview | null;
  showAtstoreMigration: boolean;
  migrationFocus: boolean;
  managedAppListingId: string | null;
  accountHostLink: DirectoryEntityAppLink | null;
  managedAccountHosts: AccountHost[];
  profileUpdates: ProfileUpdateRow[];
  canManageProductUpdates: boolean;
  createNewListing: boolean;
  reauthReturnTo: string;
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
    collectionSuggestions,
    publicProfileHandle,
    shareUrl,
    shareTitleName,
    atstoreListingUri,
    remoteAtstoreListingUri,
    atstoreMigrationIssues,
    atstoreMigrationPreview,
    showAtstoreMigration,
    migrationFocus,
    managedAppListingId,
    accountHostLink,
    managedAccountHosts,
    profileUpdates,
    canManageProductUpdates,
    createNewListing,
    reauthReturnTo,
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
        <main
          class="explore-manage"
          id="main-content"
          style={{ paddingTop: "8rem" }}
        >
          <div class="container" style={{ maxWidth: "920px" }}>
            <div class="manage-header">
              <div>
                <h1 class="text-section">
                  {createNewListing
                    ? "Register an app"
                    : explore.manage.headline}
                </h1>
                <p class="text-body mt-2">
                  {createNewListing
                    ? "Create the app profile represented by this Atmosphere account. After publishing, you can connect its account host."
                    : explore.manage.subhead}
                </p>
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
              {!createNewListing && (
                <AppHostingSummary
                  link={accountHostLink}
                  managedHosts={managedAccountHosts}
                  initialPublished={initialPublished}
                  managedAppListingId={managedAppListingId}
                />
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
                collectionSuggestions={collectionSuggestions}
                publicProfileHandle={publicProfileHandle}
                managedAppIdentifier={managedAppListingId}
                hasAccountHost={!!accountHostLink}
                createNewListing={createNewListing}
                atstoreListingUri={atstoreListingUri}
                reauthReturnTo={reauthReturnTo}
                rememberedAccounts={account.rememberedAccounts}
              />
              {!createNewListing && managedAppListingId &&
                canManageProductUpdates &&
                initialPublished && (
                <ProfileUpdateEditor
                  appId={managedAppListingId}
                  projectDid={user.did}
                  currentHandle={user.handle}
                  rememberedAccounts={account.rememberedAccounts}
                  initialUpdates={profileUpdates}
                  disabled={!!takedown}
                />
              )}
            </div>
          </div>
        </main>
        <Footer variant="compact" />
      </div>
    </div>
  );
}

export function AppHostingSummary(
  {
    link,
    managedHosts = [],
    initialPublished,
    managedAppListingId,
  }: {
    link: DirectoryEntityAppLink | null;
    managedHosts?: Array<Pick<AccountHost, "host" | "displayName">>;
    initialPublished: boolean;
    managedAppListingId: string | null;
  },
) {
  const ownedHosts = managedHosts.filter((host) => host.host.trim());
  const ownedHost = ownedHosts.length === 1 ? ownedHosts[0] : null;
  const ownedHostTitle = ownedHost
    ? ownedHost.displayName?.trim() || ownedHost.host
    : ownedHosts.length > 1
    ? `${ownedHosts.length} account host listings`
    : null;
  const manageHref = managedAppListingId
    ? `/apps/manage/host?app=${encodeURIComponent(managedAppListingId)}`
    : null;
  return (
    <section class="glass directory-relationship-entry owner-app-relationship-entry">
      <div>
        <p class="text-eyebrow">Account hosting</p>
        {link
          ? (
            <>
              <h2>{link.hostDisplayName}</h2>
              <p>
                {link.host} is the account host for this app.
              </p>
              <span
                class={`relationship-status relationship-status--${link.status}`}
              >
                {link.status === "verified"
                  ? "Verified"
                  : "Waiting for host approval"}
              </span>
            </>
          )
          : (
            <>
              <h2>{ownedHostTitle ?? "Connect an account host"}</h2>
              <p>
                {ownedHost
                  ? `This account also manages the ${ownedHost.host} account host listing. Manage account hosting if it provides accounts for this app.`
                  : ownedHosts.length > 1
                  ? `This account also manages ${ownedHosts.length} account host listings. Manage account hosting to choose one for this app.`
                  : "Choose the one PDS domain that provides accounts for this app."}
              </p>
            </>
          )}
      </div>
      <div class="owner-app-relationship-actions">
        {link && manageHref
          ? (
            <>
              <a class="directory-register-button" href={manageHref}>
                Manage account hosting
              </a>
              <a
                class="text-link-button"
                href={`/hosts/${encodeURIComponent(link.host)}`}
              >
                View host
              </a>
            </>
          )
          : initialPublished && manageHref
          ? (
            <a class="directory-register-button" href={manageHref}>
              {ownedHosts.length > 0
                ? "Manage account hosting"
                : "Connect account host"}
            </a>
          )
          : (
            <p class="profile-form-hint">
              Publish the app profile first, then connect its PDS.
            </p>
          )}
        {!link && ownedHost
          ? (
            <a
              class="text-link-button"
              href={`/hosts/${encodeURIComponent(ownedHost.host)}/manage`}
            >
              Manage host listing
            </a>
          )
          : (
            <a class="text-link-button" href="/account/apps-hosts">
              Manage listings
            </a>
          )}
      </div>
    </section>
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
      label: "Shows on ATStore",
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
        "When you publish, this site writes shared app records from this app account.",
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
          {hasDestination
            ? "Destination link ready"
            : "Add one destination link"}
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
