import type { AppListing } from "../../lib/app-directory.ts";
import { appPrimaryCollection } from "../../lib/app-display.ts";
import { appImageUrl } from "../../lib/media.ts";
import AtmosphereHandle from "../AtmosphereHandle.tsx";
import ContentVisualIcon from "../icons/ContentVisualIcon.tsx";

interface Props {
  app: AppListing;
  compact?: boolean;
}

export function AppCollectionBadge({ app }: { app: AppListing }) {
  const label = appPrimaryCollection(app) ?? "App";
  return <span class="profile-badge app-collection-badge">{label}</span>;
}

function ratingDetails(
  app: AppListing,
): { score: string; count: number; label: string } | null {
  if (
    !app.atstoreListingUri || app.reviewCount <= 0 ||
    app.averageRating == null
  ) {
    return null;
  }
  const score = app.averageRating.toFixed(1);
  return {
    score,
    count: app.reviewCount,
    label: `${score} stars from ${app.reviewCount} ${
      app.reviewCount === 1 ? "review" : "reviews"
    }`,
  };
}

function hostname(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export default function AppCard({ app, compact = false }: Props) {
  const rating = ratingDetails(app);
  const href = `/apps/${encodeURIComponent(app.slug)}`;
  const host = hostname(app.primaryUrl);
  const description = app.tagline || app.description;
  const category = appPrimaryCollection(app) ?? "App";
  const iconUrl = appImageUrl(app.iconUrl, "icon");
  const icon = iconUrl
    ? (
      <img
        src={iconUrl}
        alt=""
        loading="lazy"
        decoding="async"
        width={96}
        height={96}
      />
    )
    : (
      <div class="profile-card-avatar-fallback" aria-hidden="true">
        {app.name.slice(0, 1).toUpperCase()}
      </div>
    );
  return (
    <a
      href={href}
      class={`glass profile-card app-card${
        compact ? " app-card--compact" : ""
      }`}
      aria-label={compact ? `View ${app.name}` : undefined}
    >
      <div class="app-card-top">
        <div class="profile-card-avatar app-card-icon">{icon}</div>
        <h3 class="profile-card-name">{app.name}</h3>
        {rating && (
          <span
            class="app-card-rating-metric"
            aria-label={rating.label}
          >
            <span aria-hidden="true">{rating.score}</span>
            <span class="app-card-rating-star" aria-hidden="true">
              ★
            </span>
            <span class="app-card-rating-count" aria-hidden="true">
              ({rating.count})
            </span>
          </span>
        )}
        <p
          class={`profile-card-handle${host ? "" : " app-card-placeholder"}`}
          aria-hidden={host ? undefined : "true"}
        >
          <AtmosphereHandle handle={host || "app.example"} />
        </p>
        {app.accountHost && (
          <span
            class="app-card-host-indicator"
            title={`Also operates the ${app.accountHost} account host`}
            aria-label={`Also operates the ${app.accountHost} account host`}
          >
            <svg
              viewBox="0 0 16 16"
              aria-hidden="true"
              focusable="false"
            >
              <rect x="2.5" y="2.5" width="11" height="4" rx="1" />
              <rect x="2.5" y="9.5" width="11" height="4" rx="1" />
              <circle cx="5" cy="4.5" r="0.7" />
              <circle cx="5" cy="11.5" r="0.7" />
            </svg>
            Host
          </span>
        )}
      </div>
      <p
        class={`profile-card-description${
          description ? "" : " app-card-placeholder"
        }`}
        aria-hidden={description ? undefined : "true"}
      >
        {description || "App description placeholder."}
      </p>
      <div class="app-card-footer">
        <div class="app-card-footer-meta">
          <span class="app-card-category-label">{category}</span>
        </div>
        {app.favoriteCount > 0 && (
          <span
            class="app-card-like-metric"
            aria-label={`${app.favoriteCount} ${
              app.favoriteCount === 1 ? "like" : "likes"
            }`}
          >
            <ContentVisualIcon name="like" class="app-card-like-icon" />
            <span aria-hidden="true">
              {app.favoriteCount.toLocaleString()}
            </span>
          </span>
        )}
        <span class="app-card-view">View</span>
      </div>
    </a>
  );
}
