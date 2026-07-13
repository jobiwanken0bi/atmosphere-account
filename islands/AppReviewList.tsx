import { useSignal } from "@preact/signals";
import AtmosphereHandle from "../components/AtmosphereHandle.tsx";
import type { DisplayAppReview } from "../lib/app-review-display.ts";
import type { AppReviewSort } from "../lib/app-directory.ts";

interface Props {
  identifier: string;
  initialReviews: DisplayAppReview[];
  initialSort: AppReviewSort;
  copy: AppReviewListCopy;
}

interface AppReviewListCopy {
  sortLabel: string;
  newest: string;
  highest: string;
  lowest: string;
  sorting: string;
  error: string;
  empty: string;
  reviewerFallback: string;
  stars: string;
}

interface ReviewsResponse {
  reviews: DisplayAppReview[];
  sort: AppReviewSort;
}

export default function AppReviewList(
  { identifier, initialReviews, initialSort, copy }: Props,
) {
  const reviews = useSignal(initialReviews);
  const currentSort = useSignal(initialSort);
  const busySort = useSignal<AppReviewSort | null>(null);
  const error = useSignal("");

  const selectSort = async (sort: AppReviewSort) => {
    if (sort === currentSort.value || busySort.value) return;
    busySort.value = sort;
    error.value = "";
    try {
      const response = await fetch(appReviewApiUrl(identifier, sort), {
        headers: { accept: "application/json" },
      });
      if (!response.ok) throw new Error(copy.error);
      const payload = await response.json() as ReviewsResponse;
      if (!Array.isArray(payload.reviews) || !isReviewSort(payload.sort)) {
        throw new Error(copy.error);
      }
      reviews.value = payload.reviews;
      currentSort.value = payload.sort;
      updateReviewSortUrl(payload.sort);
    } catch (err) {
      error.value = err instanceof Error ? err.message : copy.error;
    } finally {
      busySort.value = null;
    }
  };

  return (
    <div class="app-review-list-island">
      <div class="app-review-list-toolbar">
        <nav class="app-review-sort" aria-label={copy.sortLabel}>
          {reviewSortOptions(copy).map((sort) => (
            <button
              key={sort.value}
              type="button"
              class={`app-review-sort-link${
                currentSort.value === sort.value ? " is-active" : ""
              }`}
              aria-pressed={currentSort.value === sort.value}
              disabled={busySort.value !== null}
              onClick={() => selectSort(sort.value)}
            >
              {sort.label}
            </button>
          ))}
        </nav>
        <span class="app-review-sort-status" aria-live="polite">
          {busySort.value ? copy.sorting : error.value}
        </span>
      </div>
      {reviews.value.length === 0
        ? (
          <p class="text-body profile-reviews-empty">
            {copy.empty}
          </p>
        )
        : (
          <div class="profile-review-cards" aria-busy={!!busySort.value}>
            {reviews.value.map((review) => (
              <AppReviewCard review={review} copy={copy} key={review.uri} />
            ))}
          </div>
        )}
    </div>
  );
}

function AppReviewCard(
  { review, copy }: { review: DisplayAppReview; copy: AppReviewListCopy },
) {
  const reviewer = review.authorName ?? review.authorHandle ??
    copy.reviewerFallback;
  return (
    <article class="profile-review-card glass">
      <header class="profile-review-header">
        <a
          class="profile-review-author-row"
          href={review.authorHref ?? undefined}
          target={review.authorHref?.startsWith("https://")
            ? "_blank"
            : undefined}
          rel={review.authorHref?.startsWith("https://")
            ? "noopener noreferrer"
            : undefined}
        >
          <span class="profile-review-avatar" aria-hidden="true">
            {review.authorAvatarUrl
              ? (
                <img
                  src={review.authorAvatarUrl}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  width={40}
                  height={40}
                />
              )
              : (
                <span>
                  {reviewer.slice(0, 1).toUpperCase()}
                </span>
              )}
          </span>
          <div>
            <p class="profile-review-author">
              {reviewer}
            </p>
            {review.authorHandle && (
              <p class="profile-review-handle">
                <AtmosphereHandle handle={review.authorHandle} />
              </p>
            )}
            <p class="profile-review-date">
              {new Date(review.createdAt).toISOString().slice(0, 10)}
            </p>
          </div>
        </a>
        <p
          class="profile-review-stars"
          aria-label={`${review.rating} ${copy.stars}`}
        >
          {"★".repeat(Math.max(0, Math.min(5, review.rating)))}
          <span aria-hidden="true">
            {"☆".repeat(Math.max(0, 5 - review.rating))}
          </span>
        </p>
      </header>
      {review.body && <p class="profile-review-body">{review.body}</p>}
    </article>
  );
}

function reviewSortOptions(copy: AppReviewListCopy) {
  return [
    { value: "newest" as const, label: copy.newest },
    { value: "highest" as const, label: copy.highest },
    { value: "lowest" as const, label: copy.lowest },
  ];
}

function isReviewSort(value: unknown): value is AppReviewSort {
  return value === "newest" || value === "highest" || value === "lowest";
}

export function appReviewApiUrl(
  identifier: string,
  sort: AppReviewSort,
): string {
  const params = new URLSearchParams({ sort });
  return `/api/apps/${encodeURIComponent(identifier)}/reviews?${params}`;
}

export function reviewSortPageUrl(
  currentUrl: string,
  sort: AppReviewSort,
): string {
  const url = new URL(currentUrl, "https://atmosphere.invalid");
  if (sort === "newest") url.searchParams.delete("reviews");
  else url.searchParams.set("reviews", sort);
  return `${url.pathname}${url.search}${url.hash}`;
}

function updateReviewSortUrl(sort: AppReviewSort): void {
  if (typeof globalThis.history === "undefined") return;
  const next = reviewSortPageUrl(globalThis.location.href, sort);
  globalThis.history.replaceState(globalThis.history.state, "", next);
}
