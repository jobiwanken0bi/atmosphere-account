import { define } from "../../utils.ts";
import Nav from "../../components/Nav.tsx";
import Footer from "../../components/Footer.tsx";
import ProfileHero from "../../components/explore/ProfileHero.tsx";
import ProfileScreenshots from "../../components/explore/ProfileScreenshots.tsx";
import ProfileWhatsNew from "../../components/explore/ProfileWhatsNew.tsx";
import ProfileRatingSummary from "../../components/explore/ProfileRatingSummary.tsx";
import ProfileReviewList, {
  type DisplayReview,
} from "../../components/explore/ProfileReviewList.tsx";
import AppCard, {
  AppCollectionBadge,
} from "../../components/explore/AppCard.tsx";
import AppLikeButton, {
  appLikeReauthHref,
} from "../../islands/AppLikeButton.tsx";
import AppReviewList from "../../islands/AppReviewList.tsx";
import ProfileReviewComposer from "../../islands/ProfileReviewComposer.tsx";
import ReportProfileButton from "../../islands/ReportProfileButton.tsx";
import ShareButton from "../../islands/ShareButton.tsx";
import WebsiteIcon from "../../components/icons/WebsiteIcon.tsx";
import BskyIcon from "../../components/icons/BskyIcon.tsx";
import {
  AndroidIcon,
  AppleIcon,
} from "../../components/icons/PlatformIcons.tsx";
import { getMessages } from "../../i18n/mod.ts";
import type { Locale } from "../../i18n/mod.ts";
import {
  getProfileByDid,
  getProfileByHandle,
  listProfilesByDids,
  type ProfileRow,
} from "../../lib/registry.ts";
import {
  getOwnReview,
  getReviewSummary,
  listVisibleReviews,
  type ReviewRow,
  type ReviewSummary,
} from "../../lib/reviews.ts";
import { accountHostName } from "../../lib/account-hosts.ts";
import { buildAccountMenuProps } from "../../lib/account-menu-props.ts";
import { getAppUser, listAppUsersByDids } from "../../lib/account-types.ts";
import { bskyCdnAvatarUrl } from "../../lib/avatar.ts";
import {
  listProfileUpdates,
  type ProfileUpdateRow,
} from "../../lib/profile-updates.ts";
import { appImageUrl } from "../../lib/media.ts";
import { syncProfileByIdentifier } from "../../lib/profile-sync.ts";
import {
  type AppAliasRow,
  type AppListing,
  type AppMirroredReview,
  type AppOwnFavorite,
  type AppOwnReview,
  type AppReviewSort,
  getAppListingByIdentifier,
  getOwnAppFavorite,
  getOwnAppReview,
  listAppAliasesForListing,
  listAppReviewsForListing,
  searchAppDirectory,
} from "../../lib/app-directory.ts";
import {
  type DisplayAppReview,
  enrichAppMirroredReviews,
} from "../../lib/app-review-display.ts";
import {
  type AppActionLink,
  type AppActionLinkKind,
  appActionLinks,
} from "../../lib/app-listing-links.ts";
import {
  appDisplayTaxonomy,
  appPrimaryCollection,
} from "../../lib/app-display.ts";
import { proxyAppviewPageResponse } from "../../lib/appview-client.ts";
import { isAdmin } from "../../lib/admin.ts";
import { isHandle } from "../../lib/identity.ts";
import { trustedRequestOrigin } from "../../lib/atmosphere-origins.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const proxied = await proxyAppviewPageResponse(ctx.url, ctx.req).catch(
      (err) => {
        console.warn("[apps] appview page proxy failed:", err);
        return null;
      },
    );
    if (proxied) return proxied;

    const handle = decodeURIComponent(ctx.params.handle).toLowerCase();
    const user = ctx.state.user;
    const appReviewSort = readAppReviewSort(
      ctx.url.searchParams.get("reviews"),
    );
    /** Pull the profile being viewed and (in parallel) the signed-in
     *  user's own registry entry so the AccountMenu can deep-link to
     *  their public page. The lookups are cheap and trigger from the
     *  same DB connection. */
    let [profile, ownerProfile, appListing, viewerAccount] = await Promise
      .all([
        getProfileByHandle(handle).catch(() => null),
        user ? getProfileByDid(user.did).catch(() => null) : Promise.resolve(
          null,
        ),
        getAppListingByIdentifier(handle, { syncLegacy: false }).catch(
          (err) => {
            console.warn(
              `[apps] app listing lookup failed for ${handle}:`,
              err,
            );
            return null;
          },
        ),
        user ? getAppUser(user.did).catch(() => null) : Promise.resolve(null),
      ]);
    if (!profile && !appListing && isHandle(handle.toLowerCase())) {
      const synced = await syncProfileByIdentifier(handle).catch((err) => {
        console.warn(`[explore] profile sync failed for ${handle}:`, err);
        return false;
      });
      if (synced) {
        profile = await getProfileByHandle(handle).catch(() => null);
      }
    }
    if (!profile && appListing?.legacyProfileDid) {
      profile = await getProfileByDid(appListing.legacyProfileDid).catch(() =>
        null
      );
    }
    if (!appListing && profile) {
      appListing = await getAppListingByIdentifier(profile.handle, {
        syncLegacy: false,
      }).catch(() => null);
    }
    const canInspectAppSources = !!(appListing && user &&
      (user.did === appListing.productDid ||
        user.did === appListing.profileDid ||
        user.did === appListing.legacyProfileDid ||
        isAdmin(user.did)));
    const [
      relatedApps,
      appReviews,
      ownAppReview,
      ownAppFavorite,
      appSourceAliases,
    ] = appListing
      ? await Promise.all([
        relatedListings(appListing).catch(() => []),
        listAppReviewsForListing(appListing.id, {
          limit: 12,
          sort: appReviewSort,
        }).catch((err) => {
          console.warn(
            `[apps] mirrored review lookup failed for ${appListing?.id}:`,
            err,
          );
          return [] as AppMirroredReview[];
        }),
        user
          ? getOwnAppReview(appListing.id, user.did).catch(() => null)
          : null,
        user
          ? getOwnAppFavorite(appListing.id, user.did).catch(() => null)
          : null,
        canInspectAppSources
          ? listAppAliasesForListing(appListing.id).catch(() => [])
          : Promise.resolve([] as AppAliasRow[]),
      ])
      : [[], [] as AppMirroredReview[], null, null, [] as AppAliasRow[]];
    const legacyProfile = profile && !appListing?.atstoreListingUri
      ? profile
      : null;
    const [reviewSummary, reviews, ownReview, updates] = legacyProfile
      ? await Promise.all([
        getReviewSummary(legacyProfile.did).catch(() => emptyReviewSummary()),
        listVisibleReviews(legacyProfile.did, { limit: 20 }).catch(() => []),
        user
          ? getOwnReview(legacyProfile.did, user.did).catch(() => null)
          : null,
        listProfileUpdates(legacyProfile.did, { limit: 6 }).catch(() => []),
      ])
      : [
        emptyReviewSummary(),
        [] as ReviewRow[],
        null,
        [] as ProfileUpdateRow[],
      ];
    const [displayReviews, displayAppReviews] = await Promise.all([
      legacyProfile ? enrichReviews(reviews) : Promise.resolve([]),
      enrichAppMirroredReviews(appReviews),
    ]);
    /**
     * Share URL intentionally ends in `/`. Bluesky's composer runs a
     * client-side `getLikelyType` over the pasted URL: it splits the path
     * by `.`, takes the last segment, and looks it up in a MIME-type
     * table. For handles like `foo.com` the "extension" is `com`, mapped
     * to `application/x-msdownload` (a Windows executable!), so the
     * composer treats the URL as a non-HTML resource and refuses to call
     * Cardyb at all — the link card has no preview image. Adding the
     * trailing slash makes the parsed extension `com/`, which is not in
     * the table, so the composer falls through to its `LikelyType.HTML`
     * default and unfurls the page. Cardyb / our redirect middleware
     * round-trip to the canonical no-slash URL, so the post link still
     * resolves correctly.
     *
     * Bluesky source: https://github.com/bluesky-social/social-app/blob/main/src/lib/link-meta/link-meta.ts
     */
    const publicOrigin = trustedRequestOrigin(ctx.url, ctx.req.headers);
    const currentPublicUrl = new URL(
      `${ctx.url.pathname}${ctx.url.search}`,
      publicOrigin,
    );
    const shareUrl = profile
      ? new URL(
        `/apps/${encodeURIComponent(profile.handle)}/`,
        publicOrigin,
      ).href
      : appListing
      ? new URL(
        `/apps/${encodeURIComponent(appListing.slug)}/`,
        publicOrigin,
      ).href
      : currentPublicUrl.href;
    /**
     * Per-page social meta. When the project has a banner, use the
     * dedicated OG JPEG route (~1200×630, tens of KB) for og:image so link
     * unfurlers and the Bluesky composer get a small asset; full resolution
     * stays on `/api/registry/banner/{did}` for the in-page banner <img>.
     */
    const useAppListingMeta = !!appListing?.atstoreListingUri || !profile;
    if (useAppListingMeta && appListing) {
      const pageTitle = `${appListing.name} on Atmosphere Apps`;
      const imageUrl = appListing.heroUrl || appListing.iconUrl || undefined;
      ctx.state.pageMeta = {
        title: pageTitle,
        description: appListing.description || appListing.tagline ||
          "An Atmosphere app listing.",
        ogType: "website",
        canonicalUrl: shareUrl,
        imageUrl: imageUrl?.startsWith("/")
          ? new URL(imageUrl, publicOrigin).href
          : imageUrl,
        imageAlt: appListing.name,
      };
    } else if (profile) {
      const messages = getMessages(ctx.state.locale).explore;
      const pageTitle = `${profile.name} on Atmosphere Apps`;
      const pageDescription = profile.description ||
        messages.detail.missingProfile;
      const ogImageUrl = profile.bannerCid
        ? new URL(
          `/api/registry/project-og/${encodeURIComponent(profile.handle)}`,
          publicOrigin,
        ).href
        : undefined;
      ctx.state.pageMeta = {
        title: pageTitle,
        description: pageDescription,
        // "website" unfurls more reliably than "profile" (fewer parsers expect
        // profile:* sub-properties). Same visible link card everywhere.
        ogType: "website",
        canonicalUrl: shareUrl,
        imageUrl: ogImageUrl,
        imageAlt: profile.bannerCid
          ? messages.detail.share.bannerAlt(profile.name)
          : undefined,
        imageType: profile.bannerCid ? "image/jpeg" : undefined,
        imageWidth: 1200,
        imageHeight: 630,
      };
    }
    return ctx.render(
      <ProfileDetailPage
        profile={profile}
        appListing={appListing}
        relatedApps={relatedApps}
        appReviews={displayAppReviews}
        ownAppReview={ownAppReview}
        ownAppFavorite={ownAppFavorite}
        appReviewSort={appReviewSort}
        appSourceAliases={appSourceAliases}
        canInspectAppSources={canInspectAppSources}
        reviewSummary={reviewSummary}
        reviews={displayReviews}
        updates={updates}
        ownReview={ownReview?.status === "visible" ? ownReview : null}
        signedInUser={user ? { did: user.did, handle: user.handle } : null}
        account={buildAccountMenuProps(ctx.state, ownerProfile?.handle ?? null)}
        ownerHandle={ownerProfile?.handle ?? null}
        microblogViewerClientId={viewerAccount?.accountType === "user"
          ? viewerAccount.bskyClientId
          : null}
        locale={ctx.state.locale}
        shareUrl={shareUrl}
      />,
      { status: profile || appListing ? 200 : 404 },
    );
  },
});

interface DetailProps {
  profile: ProfileRow | null;
  appListing: AppListing | null;
  relatedApps: AppListing[];
  appReviews: DisplayAppReview[];
  ownAppReview: AppOwnReview | null;
  ownAppFavorite: AppOwnFavorite | null;
  appReviewSort: AppReviewSort;
  appSourceAliases: AppAliasRow[];
  canInspectAppSources: boolean;
  reviewSummary: ReviewSummary;
  reviews: DisplayReview[];
  updates: ProfileUpdateRow[];
  ownReview: ReviewRow | null;
  signedInUser: { did: string; handle: string } | null;
  account: ReturnType<typeof buildAccountMenuProps>;
  ownerHandle: string | null;
  microblogViewerClientId: string | null;
  locale: Locale;
  /** Absolute URL of this project page; passed to the Share button so
   *  copy-to-clipboard / Web Share API both get the canonical link. */
  shareUrl: string;
}

function ProfileDetailPage(
  {
    profile,
    appListing,
    relatedApps,
    appReviews,
    ownAppReview,
    ownAppFavorite,
    appReviewSort,
    appSourceAliases,
    canInspectAppSources,
    reviewSummary,
    reviews,
    updates,
    ownReview,
    signedInUser,
    account,
    ownerHandle: _ownerHandle,
    microblogViewerClientId,
    locale,
    shareUrl,
  }: DetailProps,
) {
  const messages = getMessages(locale);
  const t = messages.explore;
  if (appListing?.atstoreListingUri) {
    return (
      <AppListingDetailPage
        app={appListing}
        relatedApps={relatedApps}
        reviews={appReviews}
        ownReview={ownAppReview}
        ownFavorite={ownAppFavorite}
        reviewSort={appReviewSort}
        sourceAliases={appSourceAliases}
        canInspectSources={canInspectAppSources}
        locale={locale}
        signedInUser={signedInUser}
        account={account}
        microblogViewerClientId={microblogViewerClientId}
        shareUrl={shareUrl}
      />
    );
  }
  if (!profile) {
    if (appListing) {
      return (
        <AppListingDetailPage
          app={appListing}
          relatedApps={relatedApps}
          reviews={appReviews}
          ownReview={ownAppReview}
          ownFavorite={ownAppFavorite}
          reviewSort={appReviewSort}
          sourceAliases={appSourceAliases}
          canInspectSources={canInspectAppSources}
          locale={locale}
          signedInUser={signedInUser}
          account={account}
          microblogViewerClientId={microblogViewerClientId}
          shareUrl={shareUrl}
        />
      );
    }
    return (
      <NotFound
        locale={locale}
        signedInUser={signedInUser}
        account={account}
      />
    );
  }
  const isOwner = signedInUser?.did === profile.did;
  const lastUpdated = new Date(profile.indexedAt).toISOString().slice(0, 10);
  /** PDS hosts are usually per-shard (e.g. shimeji.us-east.host.bsky.network)
   *  which isn't useful in UI. Collapse known umbrella PDSes to their
   *  brand name (Bluesky, etc.) and fall back to the bare host. */
  const hostName = accountHostName(profile.pdsUrl);
  const bannerUrl = profile.bannerCid
    ? `/api/registry/banner/${encodeURIComponent(profile.did)}`
    : null;
  const shareCopy = t.detail.share;
  return (
    <div id="page-top">
      <div class="content-layer">
        <Nav account={account} active="apps" />
        <section class="explore-profile-detail">
          <div class="container" style={{ maxWidth: "880px" }}>
            <div class="project-page-toolbar">
              <a href="/apps" class="text-link-button">
                ← {t.detail.backToExplore}
              </a>
              <ShareButton
                url={shareUrl}
                title={shareCopy.shareTitle(profile.name)}
                copy={{
                  button: shareCopy.button,
                  copyLink: shareCopy.copyLink,
                  copied: shareCopy.copied,
                  copyFailed: shareCopy.copyFailed,
                }}
              />
            </div>
            {bannerUrl && (
              <div class="project-page-banner" aria-hidden={false}>
                <img
                  src={bannerUrl}
                  alt={shareCopy.bannerAlt(profile.name)}
                  class="project-page-banner-img"
                  loading="lazy"
                  decoding="async"
                  width={1200}
                  height={630}
                />
              </div>
            )}
            <div style={{ marginTop: bannerUrl ? "0" : "1rem" }}>
              <ProfileHero
                profile={profile}
                microblogViewerClientId={microblogViewerClientId}
              />
            </div>
            <ProfileScreenshots profile={profile} />

            <div class="profile-reviews-shell">
              <ProfileRatingSummary
                summary={reviewSummary}
                copy={{
                  heading: messages.reviews.summary.heading,
                  threshold: messages.reviews.summary.threshold,
                  average: messages.reviews.summary.average,
                  distributionLabel: messages.reviews.summary.distributionLabel,
                }}
              />
              <ProfileReviewList
                reviews={reviews}
                signedIn={!!signedInUser}
                isOwner={isOwner}
                action={
                  <ProfileReviewComposer
                    targetId={profile.handle}
                    signedIn={!!signedInUser}
                    isOwner={isOwner}
                    loginHref={`/signin?next=${
                      encodeURIComponent(`/apps/${profile.handle}`)
                    }`}
                    ownReview={ownReview
                      ? {
                        id: ownReview.id,
                        rating: ownReview.rating,
                        body: ownReview.body,
                      }
                      : null}
                    copy={{
                      heading: messages.reviews.composer.heading,
                      modalBody: messages.reviews.composer.modalBody,
                      signedOut: messages.reviews.composer.signedOut,
                      ownerNote: messages.reviews.composer.ownerNote,
                      ratingLabel: messages.reviews.composer.ratingLabel,
                      bodyLabel: messages.reviews.composer.bodyLabel,
                      bodyPlaceholder:
                        messages.reviews.composer.bodyPlaceholder,
                      charsRemainingSuffix:
                        messages.reviews.composer.charsRemainingSuffix,
                      submit: messages.reviews.composer.submit,
                      update: messages.reviews.composer.update,
                      submitting: messages.reviews.composer.submitting,
                      delete: messages.reviews.composer.delete,
                      signIn: messages.reviews.composer.signIn,
                      cancel: messages.reviews.composer.cancel,
                      saved: messages.reviews.composer.saved,
                      deleted: messages.reviews.composer.deleted,
                      error: messages.reviews.composer.error,
                    }}
                  />
                }
                copy={{
                  heading: messages.reviews.list.heading,
                  empty: messages.reviews.list.empty,
                  reviewerFallback: messages.reviews.list.reviewerFallback,
                  edited: messages.reviews.list.edited,
                  ownerResponse: messages.reviews.list.ownerResponse,
                  report: messages.reviews.report,
                  response: messages.reviews.response,
                }}
              />
            </div>

            <ProfileWhatsNew
              updates={updates}
              copy={{
                heading: t.detail.whatsNew.heading,
                empty: t.detail.whatsNew.empty,
                versionHistory: t.detail.whatsNew.versionHistory,
                viewCommit: t.detail.whatsNew.viewCommit,
                readFullUpdate: t.detail.whatsNew.readFullUpdate,
              }}
            />

            {relatedApps.length > 0 && (
              <RelatedAppsSection
                apps={relatedApps}
              />
            )}

            {isOwner && (
              <p style={{ marginTop: "1.5rem" }}>
                <a href="/apps/manage" class="explore-cta-primary">
                  {t.detail.editProfile}
                </a>
              </p>
            )}

            {!isOwner && (
              <ReportProfileButton
                targetId={profile.handle}
                signedIn={!!signedInUser}
                copy={{
                  button: messages.report.button,
                  modalTitle: messages.report.modalTitle,
                  modalBody: messages.report.modalBody,
                  reasonLabel: messages.report.reasonLabel,
                  detailsLabel: messages.report.detailsLabel,
                  detailsPlaceholder: messages.report.detailsPlaceholder,
                  submit: messages.report.submit,
                  submitting: messages.report.submitting,
                  cancel: messages.report.cancel,
                  sentTitle: messages.report.sentTitle,
                  sentBody: messages.report.sentBody,
                  duplicate: messages.report.duplicate,
                  error: messages.report.error,
                  reasons: messages.report.reasons,
                }}
              />
            )}

            <div class="profile-footer">
              <span>
                {t.detail.lastUpdated}: <strong>{lastUpdated}</strong>
              </span>
              <span>
                {t.detail.hostedOn}: <strong>{hostName}</strong>
              </span>
            </div>
          </div>
        </section>
        <Footer variant="compact" />
      </div>
    </div>
  );
}

interface AppListingDetailProps {
  app: AppListing;
  relatedApps: AppListing[];
  reviews: DisplayAppReview[];
  ownReview: AppOwnReview | null;
  ownFavorite: AppOwnFavorite | null;
  reviewSort: AppReviewSort;
  sourceAliases: AppAliasRow[];
  canInspectSources: boolean;
  locale: Locale;
  signedInUser: { did: string; handle: string } | null;
  account: ReturnType<typeof buildAccountMenuProps>;
  microblogViewerClientId: string | null;
  shareUrl: string;
}

function AppListingDetailPage(
  {
    app,
    relatedApps,
    reviews,
    ownReview,
    ownFavorite,
    reviewSort,
    sourceAliases,
    canInspectSources,
    locale,
    signedInUser,
    account,
    microblogViewerClientId,
    shareUrl,
  }: AppListingDetailProps,
) {
  const shareTitle = `${app.name} on Atmosphere Apps`;
  const isOwner = signedInUser?.did === app.productDid ||
    signedInUser?.did === app.profileDid ||
    signedInUser?.did === app.legacyProfileDid;
  return (
    <div id="page-top">
      <div class="content-layer">
        <Nav account={account} active="apps" />
        <section class="explore-profile-detail app-detail-section">
          <div class="container" style={{ maxWidth: "980px" }}>
            <div class="project-page-toolbar">
              <a href="/apps" class="text-link-button">
                ← Back to apps
              </a>
              <ShareButton
                url={shareUrl}
                title={shareTitle}
                copy={{
                  button: "Share",
                  copyLink: "Copy link",
                  copied: "Copied",
                  copyFailed: "Could not copy",
                }}
              />
            </div>

            {app.heroUrl && (
              <div class="project-page-banner app-detail-banner">
                <img
                  src={app.heroUrl}
                  alt=""
                  class="project-page-banner-img"
                  loading="eager"
                  decoding="async"
                  fetchpriority="high"
                  width={1200}
                  height={630}
                />
              </div>
            )}

            <AppListingHero
              app={app}
              microblogViewerClientId={microblogViewerClientId}
            />

            {app.screenshotUrls.length > 0 && (
              <section class="app-detail-screenshots glass">
                <h2 class="profile-card-section-title">Media</h2>
                <div class="app-detail-screenshot-grid">
                  {app.screenshotUrls.slice(0, 6).map((url, index) => (
                    <img
                      src={url}
                      alt={`${app.name} screenshot ${index + 1}`}
                      loading="lazy"
                      decoding="async"
                      width={960}
                      height={540}
                      key={url}
                    />
                  ))}
                </div>
              </section>
            )}

            <AppReviewsSection
              app={app}
              reviews={reviews}
              ownReview={ownReview}
              ownFavorite={ownFavorite}
              reviewSort={reviewSort}
              signedInUser={signedInUser}
              isOwner={isOwner}
              locale={locale}
            />

            {relatedApps.length > 0 && (
              <RelatedAppsSection
                apps={relatedApps}
              />
            )}

            {canInspectSources && (
              <AppTechnicalDetails app={app} aliases={sourceAliases} />
            )}
          </div>
        </section>
        <Footer variant="compact" />
      </div>
    </div>
  );
}

function AppListingHero(
  { app, microblogViewerClientId }: {
    app: AppListing;
    microblogViewerClientId: string | null;
  },
) {
  const links = appActionLinks(app, { microblogViewerClientId });
  const taxonomy = appDisplayTaxonomy(app);
  const primaryCollection = appPrimaryCollection(app);
  const visibleCollections = primaryCollection
    ? taxonomy.collections.filter((collection) =>
      collection !== primaryCollection
    )
    : taxonomy.collections;
  const displayPlatforms = app.atstoreListingUri ? [] : app.platforms;
  const iconUrl = appImageUrl(app.iconUrl, "icon");
  return (
    <div class="profile-hero app-detail-hero glass">
      <div class="app-detail-hero-summary">
        <div class="profile-hero-media">
          <div class="profile-hero-avatar">
            {iconUrl
              ? (
                <img
                  src={iconUrl}
                  alt=""
                  decoding="async"
                  width={160}
                  height={160}
                />
              )
              : (
                <div class="profile-hero-avatar-fallback" aria-hidden="true">
                  {app.name.slice(0, 1).toUpperCase()}
                </div>
              )}
          </div>
        </div>
        <div class="profile-hero-body app-detail-hero-body">
          <div class="app-detail-hero-heading">
            <div class="app-detail-hero-title">
              <div class="profile-hero-name-row">
                <h1 class="profile-hero-name">{app.name}</h1>
                <AppCollectionBadge app={app} />
              </div>
              {app.primaryUrl && (
                <p class="profile-hero-handle">{displayHost(app.primaryUrl)}</p>
              )}
              {(visibleCollections.length > 0 || taxonomy.tags.length > 0) &&
                (
                  <div class="profile-hero-meta app-detail-hero-categories">
                    {visibleCollections.length > 0 && (
                      <div class="profile-card-categories">
                        {visibleCollections.slice(0, 3).map((collection) => (
                          <span
                            key={collection}
                            class="profile-card-category"
                          >
                            {collection}
                          </span>
                        ))}
                      </div>
                    )}
                    {taxonomy.tags.length > 0 && (
                      <div class="profile-card-subcategories">
                        {taxonomy.tags.slice(0, 6).map((tag) => (
                          <span key={tag} class="profile-card-sub">{tag}</span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
            </div>
            <div class="app-detail-hero-side">
              {links.length > 0 && (
                <div class="profile-hero-actions" aria-label="App links">
                  {links.map((link) => (
                    <a
                      class={`profile-hero-action${
                        isCompactAppAction(link.kind)
                          ? " profile-hero-action--icon-only"
                          : ""
                      }`}
                      href={link.uri}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={link.label}
                      title={link.label}
                      key={`${link.role ?? link.label ?? "link"}-${link.uri}`}
                    >
                      <span class="profile-hero-action-icon app-detail-link-icon">
                        {renderAppActionIcon(link)}
                      </span>
                      {!isCompactAppAction(link.kind) && (
                        <>
                          <span>{link.label}</span>
                          <span
                            class="profile-hero-action-arrow"
                            aria-hidden="true"
                          >
                            ↗
                          </span>
                        </>
                      )}
                    </a>
                  ))}
                </div>
              )}
              {displayPlatforms.length > 0 && (
                <div class="profile-hero-meta app-detail-hero-platforms">
                  <div class="profile-card-categories">
                    {displayPlatforms.map((platform) => (
                      <span key={platform} class="profile-card-category">
                        {platform}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      {(app.description || app.tagline) && (
        <p class="profile-hero-description app-detail-hero-description">
          {formatAppDescription(app.description || app.tagline || "")}
        </p>
      )}
    </div>
  );
}

function renderAppActionIcon(
  link: Pick<AppActionLink, "kind" | "iconUrl" | "label">,
) {
  const { kind } = link;
  if (kind === "website") {
    return <WebsiteIcon class="profile-hero-action-icon-svg" />;
  }
  if (kind === "bluesky") {
    if (link.iconUrl) {
      return (
        <img
          src={link.iconUrl}
          alt=""
          class="profile-hero-action-icon-img"
          loading="lazy"
          decoding="async"
        />
      );
    }
    return <BskyIcon class="profile-hero-action-icon-svg" />;
  }
  if (kind === "ios") {
    return <AppleIcon class="profile-hero-action-icon-svg" />;
  }
  if (kind === "android") {
    return <AndroidIcon class="profile-hero-action-icon-svg" />;
  }
  return <span aria-hidden="true">↗</span>;
}

function isCompactAppAction(kind: AppActionLinkKind): boolean {
  return kind === "bluesky" || kind === "ios" || kind === "android";
}

function AppReviewsSection(
  {
    app,
    reviews,
    ownReview,
    ownFavorite,
    reviewSort,
    signedInUser,
    isOwner,
    locale,
  }: {
    app: AppListing;
    reviews: DisplayAppReview[];
    ownReview: AppOwnReview | null;
    ownFavorite: AppOwnFavorite | null;
    reviewSort: AppReviewSort;
    signedInUser: { did: string; handle: string } | null;
    isOwner: boolean;
    locale: Locale;
  },
) {
  const messages = getMessages(locale);
  const detailPath = `/apps/${app.slug}`;
  const encodedIdentifier = encodeURIComponent(app.slug);
  const loginHref = `/signin?next=${encodeURIComponent(detailPath)}`;
  const reauthHref = signedInUser
    ? appLikeReauthHref(signedInUser.handle, detailPath)
    : loginHref;
  const reviewSummary = app.reviewCount > 0 && app.averageRating != null
    ? messages.reviews.summary.average(
      app.averageRating.toFixed(1),
      app.reviewCount,
    )
    : app.atstoreListingUri
    ? messages.reviews.list.empty
    : messages.reviews.app.sharedRecordPending;
  return (
    <section class="profile-reviews-panel glass app-detail-reviews">
      <div class="profile-reviews-panel-header app-detail-reviews-header">
        <div>
          <h2 class="profile-card-section-title">
            {messages.reviews.list.heading}
          </h2>
          <p class="app-detail-review-summary">{reviewSummary}</p>
          {isOwner && app.favoriteCount > 0 && (
            <p class="app-detail-review-meta">
              {messages.reviews.app.likeCount(app.favoriteCount)}
            </p>
          )}
        </div>
        {app.atstoreListingUri && (
          <div class="app-detail-review-actions">
            <AppLikeButton
              identifier={app.slug}
              signedIn={!!signedInUser}
              isOwner={isOwner}
              loginHref={loginHref}
              reauthHref={reauthHref}
              initiallyLiked={!!ownFavorite}
              count={app.favoriteCount}
              copy={messages.reviews.app.like}
            />
            <ProfileReviewComposer
              targetId={app.slug}
              signedIn={!!signedInUser}
              isOwner={isOwner}
              loginHref={loginHref}
              submitEndpoint={`/api/apps/${encodedIdentifier}/reviews`}
              deleteEndpoint={`/api/apps/${encodedIdentifier}/reviews/me`}
              maxBodyLength={8000}
              ownReview={ownReview
                ? {
                  id: 0,
                  rating: ownReview.rating,
                  body: ownReview.body,
                }
                : null}
              copy={{
                heading: messages.reviews.composer.heading,
                modalBody: messages.reviews.composer.modalBody,
                signedOut: messages.reviews.composer.signedOut,
                ownerNote: messages.reviews.composer.ownerNote,
                ratingLabel: messages.reviews.composer.ratingLabel,
                bodyLabel: messages.reviews.composer.bodyLabel,
                bodyPlaceholder: messages.reviews.composer.bodyPlaceholder,
                charsRemainingSuffix:
                  messages.reviews.composer.charsRemainingSuffix,
                submit: messages.reviews.composer.submit,
                update: messages.reviews.composer.update,
                submitting: messages.reviews.composer.submitting,
                delete: messages.reviews.composer.delete,
                signIn: messages.reviews.composer.signIn,
                cancel: messages.reviews.composer.cancel,
                saved: messages.reviews.composer.saved,
                deleted: messages.reviews.composer.deleted,
                error: messages.reviews.composer.error,
              }}
            />
          </div>
        )}
      </div>
      {app.atstoreListingUri && (
        <AppReviewList
          identifier={app.slug}
          initialReviews={reviews}
          initialSort={reviewSort}
          copy={{
            sortLabel: messages.reviews.app.sort.label,
            newest: messages.reviews.app.sort.newest,
            highest: messages.reviews.app.sort.highest,
            lowest: messages.reviews.app.sort.lowest,
            sorting: messages.reviews.app.sort.sorting,
            error: messages.reviews.app.sort.error,
            empty: messages.reviews.list.empty,
            reviewerFallback: messages.reviews.list.reviewerFallback,
            stars: messages.reviews.app.stars,
          }}
        />
      )}
    </section>
  );
}

function RelatedAppsSection({ apps }: { apps: AppListing[] }) {
  return (
    <section class="app-detail-related">
      <div class="app-directory-section-heading">
        <h2 class="text-subsection featured-rail-heading">Related apps</h2>
      </div>
      <div class="featured-rail-track app-rail-track">
        {apps.map((app) => (
          <div key={app.id} class="featured-rail-item app-rail-item">
            <AppCard app={app} compact />
          </div>
        ))}
      </div>
    </section>
  );
}

function AppTechnicalDetails(
  { app, aliases }: { app: AppListing; aliases: AppAliasRow[] },
) {
  return (
    <details class="glass account-home-details app-detail-technical">
      <summary>Source and merge details</summary>
      <dl>
        <div>
          <dt>Primary URL</dt>
          <dd>{app.primaryUrl ?? "None"}</dd>
        </div>
        {app.productDid && (
          <div>
            <dt>Product account DID</dt>
            <dd>{app.productDid}</dd>
          </div>
        )}
        <div>
          <dt>Canonical record</dt>
          <dd>{app.canonicalUri}</dd>
        </div>
        {app.atstoreListingUri && (
          <div>
            <dt>ATStore listing</dt>
            <dd>{app.atstoreListingUri}</dd>
          </div>
        )}
        {app.communityProfileUri && (
          <div>
            <dt>Community profile</dt>
            <dd>{app.communityProfileUri}</dd>
          </div>
        )}
        {app.legacyProfileDid && (
          <div>
            <dt>Atmosphere profile DID</dt>
            <dd>{app.legacyProfileDid}</dd>
          </div>
        )}
        {app.sourceRefs.atmosphere && (
          <div>
            <dt>Atmosphere source</dt>
            <dd>{app.sourceRefs.atmosphere}</dd>
          </div>
        )}
        {aliases.length > 0 && (
          <div>
            <dt>Merge aliases</dt>
            <dd>
              <ul class="app-detail-alias-list">
                {aliases.slice(0, 16).map((alias) => (
                  <li key={alias.aliasKey}>
                    <code>{alias.aliasKey}</code>
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        )}
      </dl>
    </details>
  );
}

async function relatedListings(app: AppListing): Promise<AppListing[]> {
  const tag = app.categorySlugs[0] ?? app.tags[0];
  if (!tag) return [];
  const result = await searchAppDirectory({
    tag,
    pageSize: 5,
    includeSections: false,
    includeTags: false,
    includeTotal: false,
    syncLegacy: false,
  });
  return result.apps.filter((item) => item.id !== app.id).slice(0, 3);
}

function readAppReviewSort(value: string | null): AppReviewSort {
  return value === "highest" || value === "lowest" ? value : "newest";
}

function displayHost(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return value;
  }
}

function formatAppDescription(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .replace(/([:;.!?])(?=[A-Z])/g, "$1 ")
    .replace(/([a-z])([A-Z][a-z])/g, "$1 $2");
}

function emptyReviewSummary(): ReviewSummary {
  return { visibleCount: 0, averageRating: null, distribution: null };
}

async function enrichReviews(reviews: ReviewRow[]): Promise<DisplayReview[]> {
  const reviewerDids = uniqueDids(reviews.map((review) => review.reviewerDid));
  const [appUsers, profiles] = await Promise.all([
    listAppUsersByDids(reviewerDids).catch(() => new Map()),
    listProfilesByDids(reviewerDids).catch(() => new Map()),
  ]);
  return reviews.map((review) => {
    const appUser = appUsers.get(review.reviewerDid) ?? null;
    const profile = profiles.get(review.reviewerDid) ?? null;
    const reviewerName = appUser?.displayName ?? profile?.name ?? null;
    const reviewerHandle = appUser?.handle ?? profile?.handle ?? null;
    const reviewerAvatarUrl = appUser?.avatarCid && appUser.avatarMime
      ? bskyCdnAvatarUrl(review.reviewerDid, appUser.avatarCid)
      : profile?.avatarCid
      ? bskyCdnAvatarUrl(review.reviewerDid, profile.avatarCid)
      : null;
    return {
      ...review,
      reviewerName,
      reviewerHandle,
      reviewerAvatarUrl,
      reviewerProfileHref: microblogProfileHref(reviewerHandle),
    };
  });
}

function uniqueDids(dids: string[]): string[] {
  return [...new Set(dids.map((did) => did.trim()).filter(Boolean))];
}

function microblogProfileHref(handle: string | null): string | null {
  const clean = handle?.replace(/^@/, "").trim();
  return clean ? `https://bsky.app/profile/${encodeURIComponent(clean)}` : null;
}

function NotFound(
  { locale, signedInUser: _signedInUser, account }: {
    locale: Locale;
    signedInUser: { did: string; handle: string } | null;
    account: ReturnType<typeof buildAccountMenuProps>;
  },
) {
  const t = getMessages(locale).explore.detail;
  return (
    <div id="page-top">
      <div class="content-layer">
        <Nav account={account} active="apps" />
        <section class="explore-profile-detail">
          <div
            class="container"
            style={{ maxWidth: "640px", textAlign: "center" }}
          >
            <h1 class="text-section">{t.notFoundTitle}</h1>
            <p class="text-body mt-2">{t.notFoundBody}</p>
            <p class="mt-4">
              <a href="/apps" class="explore-cta-primary">
                ← {t.backToExplore}
              </a>
            </p>
          </div>
        </section>
        <Footer variant="compact" />
      </div>
    </div>
  );
}
