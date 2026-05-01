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
import ProfileReviewComposer from "../../islands/ProfileReviewComposer.tsx";
import ReportProfileButton from "../../islands/ReportProfileButton.tsx";
import ShareButton from "../../islands/ShareButton.tsx";
import { getMessages } from "../../i18n/mod.ts";
import type { Locale } from "../../i18n/mod.ts";
import {
  getProfileByDid,
  getProfileByHandle,
  type ProfileRow,
} from "../../lib/registry.ts";
import {
  getOwnReview,
  getReviewSummary,
  listVisibleReviews,
  type ReviewRow,
  type ReviewSummary,
} from "../../lib/reviews.ts";
import { accountProviderName } from "../../lib/account-providers.ts";
import { buildAccountMenuProps } from "../../lib/account-menu-props.ts";
import { getAppUser } from "../../lib/account-types.ts";
import { bskyCdnAvatarUrl } from "../../lib/avatar.ts";
import {
  listProfileUpdates,
  type ProfileUpdateRow,
} from "../../lib/profile-updates.ts";
import { syncProfileByIdentifier } from "../../lib/profile-sync.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const handle = decodeURIComponent(ctx.params.handle).toLowerCase();
    const user = ctx.state.user;
    /** Pull the profile being viewed and (in parallel) the signed-in
     *  user's own registry entry so the AccountMenu can deep-link to
     *  their public page. The lookups are cheap and trigger from the
     *  same DB connection. */
    let [profile, ownerProfile] = await Promise.all([
      getProfileByHandle(handle).catch(() => null),
      user ? getProfileByDid(user.did).catch(() => null) : Promise.resolve(
        null,
      ),
    ]);
    if (!profile) {
      const synced = await syncProfileByIdentifier(handle).catch((err) => {
        console.warn(`[explore] profile sync failed for ${handle}:`, err);
        return false;
      });
      if (synced) {
        profile = await getProfileByHandle(handle).catch(() => null);
      }
    }
    const [reviewSummary, reviews, ownReview, updates] = profile
      ? await Promise.all([
        getReviewSummary(profile.did).catch(() => emptyReviewSummary()),
        listVisibleReviews(profile.did, { limit: 20 }).catch(() => []),
        user ? getOwnReview(profile.did, user.did).catch(() => null) : null,
        listProfileUpdates(profile.did, { limit: 6 }).catch(() => []),
      ])
      : [
        emptyReviewSummary(),
        [] as ReviewRow[],
        null,
        [] as ProfileUpdateRow[],
      ];
    const displayReviews = profile ? await enrichReviews(reviews) : [];
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
    const shareUrl = profile
      ? new URL(
        `/explore/${encodeURIComponent(profile.handle)}/`,
        ctx.url.origin,
      ).href
      : ctx.url.href;
    /**
     * Per-page social meta. When the project has a banner, use the
     * dedicated OG JPEG route (~1200×630, tens of KB) for og:image so link
     * unfurlers and the Bluesky composer get a small asset; full resolution
     * stays on `/api/registry/banner/{did}` for the in-page banner <img>.
     */
    if (profile) {
      const messages = getMessages(ctx.state.locale).explore;
      const pageTitle = `${profile.name} on Atmosphere Account`;
      const pageDescription = profile.description ||
        messages.detail.missingProfile;
      const ogImageUrl = profile.bannerCid
        ? new URL(
          `/api/registry/project-og/${encodeURIComponent(profile.handle)}`,
          ctx.url.origin,
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
        reviewSummary={reviewSummary}
        reviews={displayReviews}
        updates={updates}
        ownReview={ownReview?.status === "visible" ? ownReview : null}
        signedInUser={user ? { did: user.did, handle: user.handle } : null}
        account={buildAccountMenuProps(ctx.state, ownerProfile?.handle ?? null)}
        ownerHandle={ownerProfile?.handle ?? null}
        locale={ctx.state.locale}
        shareUrl={shareUrl}
      />,
      { status: profile ? 200 : 404 },
    );
  },
});

interface DetailProps {
  profile: ProfileRow | null;
  reviewSummary: ReviewSummary;
  reviews: DisplayReview[];
  updates: ProfileUpdateRow[];
  ownReview: ReviewRow | null;
  signedInUser: { did: string; handle: string } | null;
  account: ReturnType<typeof buildAccountMenuProps>;
  ownerHandle: string | null;
  locale: Locale;
  /** Absolute URL of this project page; passed to the Share button so
   *  copy-to-clipboard / Web Share API both get the canonical link. */
  shareUrl: string;
}

function ProfileDetailPage(
  {
    profile,
    reviewSummary,
    reviews,
    updates,
    ownReview,
    signedInUser,
    account,
    ownerHandle: _ownerHandle,
    locale,
    shareUrl,
  }: DetailProps,
) {
  const messages = getMessages(locale);
  const t = messages.explore;
  if (!profile) {
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
  const providerName = accountProviderName(profile.pdsUrl);
  const bannerUrl = profile.bannerCid
    ? `/api/registry/banner/${encodeURIComponent(profile.did)}`
    : null;
  const shareCopy = t.detail.share;
  return (
    <div id="page-top">
      <div class="content-layer">
        <Nav account={account} />
        <section class="explore-profile-detail">
          <div class="container" style={{ maxWidth: "880px" }}>
            <div class="project-page-toolbar">
              <a href="/explore" class="text-link-button">
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
                />
              </div>
            )}
            <div style={{ marginTop: bannerUrl ? "0" : "1rem" }}>
              <ProfileHero profile={profile} />
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
                    loginHref={`/explore/create?next=${
                      encodeURIComponent(`/explore/${profile.handle}`)
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

            {isOwner && (
              <p style={{ marginTop: "1.5rem" }}>
                <a href="/explore/manage" class="explore-cta-primary">
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
                {t.detail.hostedOn}: <strong>{providerName}</strong>
              </span>
            </div>
          </div>
        </section>
        <Footer variant="compact" />
      </div>
    </div>
  );
}

function emptyReviewSummary(): ReviewSummary {
  return { visibleCount: 0, averageRating: null, distribution: null };
}

async function enrichReviews(reviews: ReviewRow[]): Promise<DisplayReview[]> {
  return await Promise.all(
    reviews.map(async (review) => {
      const [appUser, profile] = await Promise.all([
        getAppUser(review.reviewerDid).catch(() => null),
        getProfileByDid(review.reviewerDid).catch(() => null),
      ]);
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
        reviewerProfileHref: appUser?.accountType === "user" && reviewerHandle
          ? `/users/${encodeURIComponent(reviewerHandle)}`
          : null,
      };
    }),
  );
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
        <Nav account={account} />
        <section class="explore-profile-detail">
          <div
            class="container"
            style={{ maxWidth: "640px", textAlign: "center" }}
          >
            <h1 class="text-section">{t.notFoundTitle}</h1>
            <p class="text-body mt-2">{t.notFoundBody}</p>
            <p class="mt-4">
              <a href="/explore" class="explore-cta-primary">
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
