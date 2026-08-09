import type { ComponentChildren } from "preact";
import AtmosphereHandle from "../AtmosphereHandle.tsx";
import type { ReviewRow } from "../../lib/reviews.ts";
import ReportReviewButton from "../../islands/ReportReviewButton.tsx";
import ReviewResponseComposer from "../../islands/ReviewResponseComposer.tsx";
import { oauthSigninUrl } from "../../lib/oauth-action.ts";

export interface DisplayReview extends ReviewRow {
  reviewerName: string | null;
  reviewerHandle: string | null;
  reviewerAvatarUrl: string | null;
  reviewerProfileHref: string | null;
}

interface ReportAuth {
  returnTo: string;
  targetName: string;
  rememberedAccounts: Array<{ did: string; handle: string }>;
  currentDid?: string;
  currentHandle?: string;
}

interface Props {
  reviews: DisplayReview[];
  signedIn: boolean;
  isOwner: boolean;
  action?: ComponentChildren;
  reportAuth: ReportAuth;
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
      done: string;
      sentTitle: string;
      sentBody: string;
      error: string;
      reasons: Record<"harmful" | "spam" | "off_topic" | "other", string>;
    };
    response: {
      button: string;
      updateButton: string;
      deleteButton: string;
      confirmDelete: string;
      bodyLabel: string;
      placeholder: string;
      submit: string;
      submitting: string;
      cancel: string;
      error: string;
    };
  };
}

export default function ProfileReviewList(
  { reviews, signedIn, isOwner, action, reportAuth, copy }: Props,
) {
  return (
    <section class="profile-reviews-panel glass">
      <div class="profile-reviews-panel-header">
        <h2 class="profile-card-section-title">{copy.heading}</h2>
        {action}
      </div>
      {reviews.length === 0
        ? <p class="text-body profile-reviews-empty">{copy.empty}</p>
        : (
          <div class="profile-review-cards">
            {reviews.map((review) => (
              <article class="profile-review-card glass" key={review.id}>
                <header class="profile-review-header">
                  <a
                    class="profile-review-author-row"
                    href={review.reviewerProfileHref ?? undefined}
                  >
                    <span class="profile-review-avatar" aria-hidden="true">
                      {review.reviewerAvatarUrl
                        ? (
                          <img
                            src={review.reviewerAvatarUrl}
                            alt=""
                            loading="lazy"
                            decoding="async"
                            width={40}
                            height={40}
                          />
                        )
                        : (
                          <span>
                            {(review.reviewerName ?? review.reviewerHandle ??
                              copy.reviewerFallback).slice(0, 1).toUpperCase()}
                          </span>
                        )}
                    </span>
                    <div>
                      <p class="profile-review-author">
                        {review.reviewerName ?? review.reviewerHandle ??
                          copy.reviewerFallback}
                      </p>
                      {review.reviewerHandle && (
                        <p class="profile-review-handle">
                          <AtmosphereHandle handle={review.reviewerHandle} />
                        </p>
                      )}
                      <p class="profile-review-date">
                        {new Date(review.createdAt).toISOString().slice(0, 10)}
                        {review.updatedAt > review.createdAt && (
                          <span>· {copy.edited}</span>
                        )}
                      </p>
                    </div>
                  </a>
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
                {isOwner && reportAuth.currentDid &&
                  reportAuth.currentHandle && (
                  <ReviewResponseComposer
                    reviewId={review.id}
                    initialBody={review.response?.body ?? ""}
                    returnTo={reportAuth.returnTo}
                    targetName={reportAuth.targetName}
                    currentDid={reportAuth.currentDid}
                    currentHandle={reportAuth.currentHandle}
                    rememberedAccounts={reportAuth.rememberedAccounts}
                    copy={copy.response}
                  />
                )}
                <ReportReviewButton
                  reviewId={review.id}
                  signedIn={signedIn}
                  loginHref={reviewReportSigninHref(reportAuth, review.id)}
                  returnTo={reviewReportReturnTo(
                    reportAuth.returnTo,
                    review.id,
                  )}
                  targetName={reportAuth.targetName}
                  rememberedAccounts={reportAuth.rememberedAccounts}
                  currentDid={reportAuth.currentDid}
                  currentHandle={reportAuth.currentHandle}
                  copy={copy.report}
                />
              </article>
            ))}
          </div>
        )}
    </section>
  );
}

export function reviewReportReturnTo(
  returnTo: string,
  reviewId: number,
): string {
  const url = new URL(returnTo, "https://atmosphereaccount.invalid");
  url.searchParams.set("report", String(reviewId));
  return `${url.pathname}${url.search}${url.hash}`;
}

function reviewReportSigninHref(
  auth: ReportAuth,
  reviewId: number,
): string {
  return oauthSigninUrl({
    action: "report_review",
    name: auth.targetName,
    next: reviewReportReturnTo(auth.returnTo, reviewId),
    capabilities: ["identity"],
  });
}
