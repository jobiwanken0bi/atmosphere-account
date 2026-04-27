import { define } from "../../utils.ts";
import Nav from "../../components/Nav.tsx";
import Footer from "../../components/Footer.tsx";
import UserBskyClientPicker from "../../islands/UserBskyClientPicker.tsx";
import UserReviewRow from "../../islands/UserReviewRow.tsx";
import { getMessages } from "../../i18n/mod.ts";
import { buildAccountMenuProps } from "../../lib/account-menu-props.ts";
import {
  getAppUser,
  getEffectiveAccountType,
} from "../../lib/account-types.ts";
import { getProfileByDid } from "../../lib/registry.ts";
import { listReviewsByReviewer, type ReviewRow } from "../../lib/reviews.ts";

function bskyCdnAvatarUrl(did: string, cid: string): string {
  return `https://cdn.bsky.app/img/avatar/plain/${did}/${cid}`;
}

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

    return ctx.render(
      <AccountReviewsPage
        account={buildAccountMenuProps(ctx.state)}
        handle={user.handle}
        profile={appUser}
        reviews={enriched}
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
  // deno-lint-ignore no-explicit-any
  t: any;
}

function AccountReviewsPage(
  { account, handle, profile, reviews, t }: AccountReviewsPageProps,
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
              <p class="text-eyebrow">{copy.eyebrow}</p>
              <h1 class="text-section">{copy.headline}</h1>
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
                selectedClientId={profile?.bskyClientId ?? null}
                label={copy.clientLabel}
                saveLabel={copy.saveClient}
              />
            </section>

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
