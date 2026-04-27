import type { ComponentChildren } from "preact";
import type { ReviewRow } from "../../lib/reviews.ts";
import ReportReviewButton from "../../islands/ReportReviewButton.tsx";
import ReviewResponseComposer from "../../islands/ReviewResponseComposer.tsx";

export interface DisplayReview extends ReviewRow {
  reviewerHandle: string | null;
}

interface Props {
  reviews: DisplayReview[];
  signedIn: boolean;
  isOwner: boolean;
  action?: ComponentChildren;
  copy: {
    heading: string;
    empty: string;
    reviewerFallback: string;
    edited: string;
    ownerResponse: string;
    report: {
      button: string;
      modalTitle: string;
      modalBody: string;
      reasonLabel: string;
      detailsLabel: string;
      detailsPlaceholder: string;
      submit: string;
      submitting: string;
      cancel: string;
      sentTitle: string;
      sentBody: string;
      signInRequired: string;
      error: string;
      reasons: Record<"harmful" | "spam" | "off_topic" | "other", string>;
    };
    response: {
      button: string;
      updateButton: string;
      deleteButton: string;
      placeholder: string;
      submit: string;
      submitting: string;
      cancel: string;
      error: string;
    };
  };
}

export default function ProfileReviewList(
  { reviews, signedIn, isOwner, action, copy }: Props,
) {
  return (
    <section class="profile-reviews-panel glass">
      <div class="profile-reviews-panel-header">
        <h2 class="profile-reviews-heading">{copy.heading}</h2>
        {action}
      </div>
      {reviews.length === 0
        ? <p class="text-body profile-reviews-empty">{copy.empty}</p>
        : (
          <div class="profile-review-cards">
            {reviews.map((review) => (
              <article class="profile-review-card glass" key={review.id}>
                <header class="profile-review-header">
                  <div>
                    <p class="profile-review-author">
                      {review.reviewerHandle
                        ? `@${review.reviewerHandle}`
                        : copy.reviewerFallback}
                    </p>
                    <p class="profile-review-date">
                      {new Date(review.createdAt).toISOString().slice(0, 10)}
                      {review.updatedAt > review.createdAt && (
                        <span>· {copy.edited}</span>
                      )}
                    </p>
                  </div>
                  <p
                    class="profile-review-stars"
                    aria-label={`${review.rating} stars`}
                  >
                    {"★".repeat(review.rating)}
                    <span aria-hidden="true">
                      {"☆".repeat(5 - review.rating)}
                    </span>
                  </p>
                </header>
                {review.body && <p class="profile-review-body">{review.body}
                </p>}
                {review.response && (
                  <div class="profile-review-response">
                    <p class="profile-review-response-label">
                      {copy.ownerResponse}
                    </p>
                    <p>{review.response.body}</p>
                  </div>
                )}
                {isOwner && (
                  <ReviewResponseComposer
                    reviewId={review.id}
                    initialBody={review.response?.body ?? ""}
                    copy={copy.response}
                  />
                )}
                <ReportReviewButton
                  reviewId={review.id}
                  signedIn={signedIn}
                  copy={copy.report}
                />
              </article>
            ))}
          </div>
        )}
    </section>
  );
}
