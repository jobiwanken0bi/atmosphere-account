import { define } from "../../utils.ts";
import Nav from "../../components/Nav.tsx";
import Footer from "../../components/Footer.tsx";
import UserBskyClientPicker from "../../islands/UserBskyClientPicker.tsx";
import UserReviewRow from "../../islands/UserReviewRow.tsx";
import UpgradeToProjectModal from "../../islands/UpgradeToProjectModal.tsx";
import { getMessages } from "../../i18n/mod.ts";
import { buildAccountMenuProps } from "../../lib/account-menu-props.ts";
import {
  getAppUser,
  getEffectiveAccountType,
} from "../../lib/account-types.ts";
import { bskyCdnAvatarUrl } from "../../lib/avatar.ts";
import { getProfileByDid } from "../../lib/registry.ts";
import { listReviewsByReviewer, type ReviewRow } from "../../lib/reviews.ts";

interface ReviewWithTarget extends ReviewRow {
  targetHandle: string;
  targetName: string;
}

export const handler = define.handlers({
  async GET(ctx) {
    const user = ctx.state.user;
    if (!user) {
      return new Response(null, {
        status: 303,
        headers: { location: "/explore/create" },
      });
    }
    const accountType = await getEffectiveAccountType(user.did).catch(() =>
      null
    );
    if (!accountType) {
      return new Response(null, {
        status: 303,
        headers: { location: "/account/type" },
      });
    }

    const [appUser, reviews] = await Promise.all([
      getAppUser(user.did).catch(() => null),
      listReviewsByReviewer(user.did).catch(() => []),
    ]);
    const enriched: ReviewWithTarget[] = await Promise.all(
      reviews.map(async (review) => {
        const target = await getProfileByDid(review.targetDid, {
          includeTakenDown: true,
        }).catch(() => null);
        return {
          ...review,
          targetHandle: target?.handle ?? review.targetDid,
          targetName: target?.name ?? review.targetDid,
        };
      }),
    );

    /**
     * `?upgrade=1` is set by entry points that want to nudge a user-typed
     * account towards converting to a project (e.g. clicking "Submit
     * your project" while already signed in as a user). The dashboard
     * island opens the upgrade modal automatically when this flag is
     * present and strips the param from the URL after mount.
     */
    const autoOpenUpgrade = ctx.url.searchParams.get("upgrade") === "1";

    return ctx.render(
      <AccountReviewsPage
        account={buildAccountMenuProps(ctx.state)}
        handle={user.handle}
        profile={appUser}
        reviews={enriched}
        autoOpenUpgrade={autoOpenUpgrade}
        t={getMessages(ctx.state.locale)}
      />,
    );
  },
});

interface AccountReviewsPageProps {
  account: ReturnType<typeof buildAccountMenuProps>;
  handle: string;
  profile: Awaited<ReturnType<typeof getAppUser>>;
  reviews: ReviewWithTarget[];
  autoOpenUpgrade: boolean;
  // deno-lint-ignore no-explicit-any
  t: any;
}

function AccountReviewsPage(
  { account, handle, profile, reviews, autoOpenUpgrade, t }:
    AccountReviewsPageProps,
) {
  const copy = t.accountReviews;
  const avatarUrl = profile?.avatarCid && profile.avatarMime
    ? bskyCdnAvatarUrl(profile.did, profile.avatarCid)
    : null;
  const displayName = profile?.displayName || handle;
  return (
    <div id="page-top">
      <div class="content-layer">
        <Nav account={account} />
        <section class="account-reviews-section">
          <div class="container" style={{ maxWidth: "820px" }}>
            <header class="account-reviews-header">
              <div class="account-reviews-header-row">
                <div>
                  <p class="text-eyebrow">{copy.eyebrow}</p>
                  <h1 class="text-section">{copy.headline}</h1>
                </div>
                <UpgradeToProjectModal
                  initiallyOpen={autoOpenUpgrade}
                  copy={copy.upgrade}
                />
              </div>
              <p class="text-body mt-2">{copy.subhead(handle)}</p>
            </header>

            <section class="glass user-profile-settings">
              <div class="user-profile-preview">
                <div class="user-profile-avatar">
                  {avatarUrl
                    ? (
                      <img
                        src={avatarUrl}
                        alt=""
                        loading="lazy"
                        decoding="async"
                      />
                    )
                    : <span>{displayName.slice(0, 1).toUpperCase()}</span>}
                </div>
                <div>
                  <h2>{displayName}</h2>
                  <p class="user-profile-handle">@{handle}</p>
                  {profile?.bio && <p class="user-profile-bio">{profile.bio}
                  </p>}
                  <a
                    class="profile-form-button-secondary user-profile-view-link"
                    href={`/users/${encodeURIComponent(handle)}`}
                  >
                    {copy.viewProfile}
                  </a>
                </div>
              </div>
              <UserBskyClientPicker
                displayName={displayName}
                bio={profile?.bio ?? ""}
                selectedClientId={profile?.bskyClientId ?? null}
                visible={profile?.bskyButtonVisible ?? true}
                nameLabel={copy.nameLabel}
                namePlaceholder={copy.namePlaceholder}
                bioLabel={copy.bioLabel}
                bioPlaceholder={copy.bioPlaceholder}
                label={copy.clientLabel}
                displayLabel={copy.displayBskyButton}
                settingsLabel={copy.configureBskyClient}
                saveLabel={copy.saveClient}
                savingLabel={copy.saving}
                savedLabel={copy.saved}
                errorLabel={copy.saveError}
                cancelLabel={copy.cancel}
                doneLabel={copy.done}
              />
            </section>

            <h2 class="user-reviews-heading">{copy.reviewsHeading}</h2>
            {reviews.length === 0
              ? (
                <div class="glass account-reviews-empty">
                  <p class="text-body">{copy.empty}</p>
                  <a href="/explore" class="explore-cta-primary">
                    {copy.explore}
                  </a>
                </div>
              )
              : (
                <div class="user-review-list">
                  {reviews.map((review) => (
                    <UserReviewRow
                      key={review.id}
                      reviewId={review.id}
                      targetHandle={review.targetHandle}
                      targetName={review.targetName}
                      rating={review.rating}
                      body={review.body}
                      updatedAt={review.updatedAt}
                      copy={{
                        viewProject: copy.viewProject,
                        delete: copy.delete,
                        deleting: copy.deleting,
                        deleted: copy.deleted,
                        error: copy.error,
                      }}
                    />
                  ))}
                </div>
              )}
          </div>
        </section>
        <Footer variant="compact" />
      </div>
    </div>
  );
}
