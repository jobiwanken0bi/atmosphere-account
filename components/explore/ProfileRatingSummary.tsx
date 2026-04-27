import {
  REVIEW_AGGREGATE_MIN_COUNT,
  type ReviewSummary,
} from "../../lib/reviews.ts";

interface Props {
  summary: ReviewSummary;
  copy: {
    heading: string;
    threshold: (count: number, needed: number) => string;
    average: (rating: string, count: number) => string;
    distributionLabel: (stars: number, count: number) => string;
  };
}

export default function ProfileRatingSummary({ summary, copy }: Props) {
  const hasAggregate = summary.averageRating != null && summary.distribution;
  return (
    <section class="profile-reviews-summary glass">
      <div>
        <h2 class="profile-card-section-title">{copy.heading}</h2>
        {hasAggregate
          ? (
            <p class="profile-reviews-average">
              <span aria-hidden="true">★</span> {copy.average(
                summary.averageRating!.toFixed(1),
                summary.visibleCount,
              )}
            </p>
          )
          : (
            <p class="profile-reviews-threshold">
              {copy.threshold(
                summary.visibleCount,
                Math.max(0, REVIEW_AGGREGATE_MIN_COUNT - summary.visibleCount),
              )}
            </p>
          )}
      </div>
      {hasAggregate && (
        <div class="profile-rating-distribution">
          {[5, 4, 3, 2, 1].map((stars) => {
            const count = summary.distribution![stars as 1 | 2 | 3 | 4 | 5];
            const pct = summary.visibleCount > 0
              ? Math.round((count / summary.visibleCount) * 100)
              : 0;
            return (
              <div class="profile-rating-row" key={stars}>
                <span>{stars}★</span>
                <div
                  class="profile-rating-bar"
                  aria-label={copy.distributionLabel(stars, count)}
                >
                  <span style={{ width: `${pct}%` }} />
                </div>
                <span>{count}</span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
