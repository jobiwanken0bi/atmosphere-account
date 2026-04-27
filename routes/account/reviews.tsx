import { define } from "../../utils.ts";
import Nav from "../../components/Nav.tsx";
import GlassClouds from "../../components/GlassClouds.tsx";
import Footer from "../../components/Footer.tsx";
import UserReviewRow from "../../islands/UserReviewRow.tsx";
import { getMessages } from "../../i18n/mod.ts";
import { buildAccountMenuProps } from "../../lib/account-menu-props.ts";
import { getEffectiveAccountType } from "../../lib/account-types.ts";
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

    const reviews = await listReviewsByReviewer(user.did).catch(() => []);
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
        reviews={enriched}
        t={getMessages(ctx.state.locale)}
      />,
    );
  },
});

interface AccountReviewsPageProps {
  account: ReturnType<typeof buildAccountMenuProps>;
  handle: string;
  reviews: ReviewWithTarget[];
  // deno-lint-ignore no-explicit-any
  t: any;
}

function AccountReviewsPage(
  { account, handle, reviews, t }: AccountReviewsPageProps,
) {
  const copy = t.accountReviews;
  return (
    <div id="page-top">
      <GlassClouds />
      <div class="content-layer">
        <Nav account={account} />
        <section class="account-reviews-section">
          <div class="container" style={{ maxWidth: "820px" }}>
            <header class="account-reviews-header">
              <p class="text-eyebrow">{copy.eyebrow}</p>
              <h1 class="text-section">{copy.headline}</h1>
              <p class="text-body mt-2">{copy.subhead(handle)}</p>
            </header>

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
