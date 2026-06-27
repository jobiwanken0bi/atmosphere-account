import type { AppListing } from "../../lib/app-directory.ts";
import {
  appDisplayTaxonomy,
  appPrimaryCollection,
} from "../../lib/app-display.ts";
import { appImageUrl } from "../../lib/media.ts";
import AtmosphereHandle from "../AtmosphereHandle.tsx";

interface Props {
  app: AppListing;
  compact?: boolean;
}

export function AppCollectionBadge({ app }: { app: AppListing }) {
  const label = appPrimaryCollection(app) ?? "App";
  return <span class="profile-badge app-collection-badge">{label}</span>;
}

function ratingLabel(app: AppListing): string | null {
  if (
    !app.atstoreListingUri || app.reviewCount <= 0 ||
    app.averageRating == null
  ) {
    return null;
  }
  return `${app.averageRating.toFixed(1)} (${app.reviewCount})`;
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
  const rating = ratingLabel(app);
  const href = `/apps/${encodeURIComponent(app.slug)}`;
  const taxonomy = appDisplayTaxonomy(app);
  const primaryCollection = appPrimaryCollection(app);
  const collections = taxonomy.collections.slice(0, compact ? 1 : 2);
  const visibleCollections = primaryCollection
    ? collections.filter((collection) => collection !== primaryCollection)
    : collections;
  const tags = taxonomy.tags.slice(0, compact ? 1 : 3);
  const host = hostname(app.primaryUrl);
  const description = app.tagline || app.description;
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
      {compact
        ? (
          <div class="app-card-rail">
            <div class="profile-card-avatar app-card-icon">{icon}</div>
          </div>
        )
        : <div class="profile-card-avatar app-card-icon">{icon}</div>}
      <div class="profile-card-body">
        <div class="profile-card-title-row">
          <h3 class="profile-card-name">{app.name}</h3>
          <AppCollectionBadge app={app} />
        </div>
        <p
          class={`profile-card-handle${host ? "" : " app-card-placeholder"}`}
          aria-hidden={host ? undefined : "true"}
        >
          <AtmosphereHandle handle={host || "app.example"} />
        </p>
        <p
          class={`profile-card-description${
            description ? "" : " app-card-placeholder"
          }`}
          aria-hidden={description ? undefined : "true"}
        >
          {description || "App description placeholder."}
        </p>
        <div class="profile-card-meta app-card-meta">
          {(visibleCollections.length > 0 || tags.length > 0) && (
            <div class="app-card-taxonomy">
              {visibleCollections.length > 0 && (
                <div class="profile-card-categories">
                  {visibleCollections.map((collection) => (
                    <span key={collection} class="profile-card-category">
                      {collection}
                    </span>
                  ))}
                </div>
              )}
              {tags.length > 0 && (
                <div class="profile-card-subcategories">
                  {tags.map((tag) => (
                    <span key={tag} class="profile-card-sub">{tag}</span>
                  ))}
                </div>
              )}
            </div>
          )}
          <div class="app-card-signals">
            {rating && <span>{rating}</span>}
            {app.favoriteCount > 0 && <span>{app.favoriteCount} saved</span>}
          </div>
        </div>
        {compact && <span class="app-card-compact-cta">View</span>}
      </div>
    </a>
  );
}
