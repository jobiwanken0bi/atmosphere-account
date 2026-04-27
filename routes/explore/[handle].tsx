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
  return (
    <div id="page-top">
      <div class="content-layer">
        <Nav account={account} />
        <section class="explore-profile-detail">
          <div class="container" style={{ maxWidth: "880px" }}>
            <p>
              <a href="/explore" class="text-link-button">
                ← {t.detail.backToExplore}
              </a>
            </p>
            <div style={{ marginTop: "1rem" }}>
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
