import type { AppListing, AppTagSummary } from "../../lib/app-directory.ts";
import { appPrimaryCollection } from "../../lib/app-display.ts";
import { appImageUrl } from "../../lib/media.ts";
import {
  appCollectionForTag,
  appCollectionHref,
  appCollectionKey,
  appCollectionLabel,
} from "../../lib/app-collections.ts";
import AtmosphereHandle from "../AtmosphereHandle.tsx";
import ContentVisualIcon, {
  type ContentVisualIconName,
} from "../icons/ContentVisualIcon.tsx";

interface AppSpotlightProps {
  apps: AppListing[];
}

interface AppCategoryTilesProps {
  tags: AppTagSummary[];
  limit?: number;
  seeAllHref?: string;
}

interface AppDiscoverySplitProps {
  trending: AppListing[];
  fresh: AppListing[];
}

interface AppDirectoryAvailabilityProps {
  hasCards: boolean;
}

function appHref(app: AppListing): string {
  return `/apps/${encodeURIComponent(app.slug)}`;
}

function hostname(value: string | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function signalText(app: AppListing): string | null {
  if (app.reviewCount > 0 && app.averageRating != null) {
    return `${app.averageRating.toFixed(1)} from ${app.reviewCount} reviews`;
  }
  if (app.favoriteCount > 0) {
    return `${app.favoriteCount} ${app.favoriteCount === 1 ? "like" : "likes"}`;
  }
  return null;
}

export function AppDirectoryAvailability(
  { hasCards }: AppDirectoryAvailabilityProps,
) {
  if (hasCards) return null;
  return (
    <section class="app-showcase-section">
      <div class="container">
        <div class="explore-empty glass">
          <h2 class="text-subsection">Apps aren’t available right now.</h2>
          <p class="text-body-sm mt-2">Try again in a moment.</p>
        </div>
      </div>
    </section>
  );
}

export function FreshAppCard(
  { app, compact = false, spotlight = false }: {
    app: AppListing;
    compact?: boolean;
    spotlight?: boolean;
  },
) {
  const iconUrl = appImageUrl(app.iconUrl, "icon");
  const mediaWidth = spotlight ? 1200 : 800;
  const mediaHeight = spotlight ? 630 : 420;
  const bannerUrl = appImageUrl(
    app.heroUrl || app.screenshotUrls[0],
    "media",
    mediaWidth,
    app.heroUrl ? app.heroFallbackUrl : null,
  );
  const bannerFallbackUrl = app.heroUrl
    ? appImageUrl(app.heroFallbackUrl, "media", mediaWidth)
    : null;
  const mediaUrl = bannerUrl || iconUrl;
  const host = hostname(app.primaryUrl);
  const category = appPrimaryCollection(app) ?? "App";
  const signal = spotlight ? signalText(app) : null;

  return (
    <a
      class={`glass app-fresh-card${compact ? " app-fresh-card--compact" : ""}${
        spotlight ? " app-fresh-card--spotlight" : ""
      }`}
      href={appHref(app)}
      aria-label={`View ${app.name}`}
    >
      <span class="app-fresh-media" aria-hidden="true">
        {mediaUrl
          ? (
            <img
              class={bannerUrl ? undefined : "app-fresh-media-icon-backdrop"}
              src={mediaUrl}
              data-fallback-src={bannerFallbackUrl ?? undefined}
              alt=""
              loading={spotlight ? "eager" : "lazy"}
              decoding="async"
              fetchpriority={spotlight ? "high" : undefined}
              width={bannerUrl ? mediaWidth : 128}
              height={bannerUrl ? mediaHeight : 128}
            />
          )
          : <span>{app.name.slice(0, 1).toUpperCase()}</span>}
      </span>
      <span class="app-fresh-footer">
        <span class="app-fresh-icon" aria-hidden="true">
          {iconUrl
            ? (
              <img
                src={iconUrl}
                alt=""
                loading={spotlight ? "eager" : "lazy"}
                decoding="async"
                width={64}
                height={64}
              />
            )
            : <span>{app.name.slice(0, 1).toUpperCase()}</span>}
        </span>
        <span class="app-fresh-copy">
          <span class="app-fresh-title-row">
            <span class="app-fresh-title">{app.name}</span>
            {host && (
              <span class="app-fresh-handle">
                <AtmosphereHandle handle={host} />
              </span>
            )}
          </span>
          <span class="app-fresh-detail-row">
            <span class="app-store-category">{category}</span>
            {signal && <span class="app-fresh-signal">{signal}</span>}
          </span>
        </span>
        <span class="app-fresh-actions">
          <span class="app-fresh-action">View</span>
        </span>
      </span>
    </a>
  );
}

export function AppSpotlight({ apps }: AppSpotlightProps) {
  if (apps.length === 0) return null;
  const [lead, ...secondary] = apps;

  return (
    <section class="app-showcase-section app-showcase-section--spotlight">
      <div class="container">
        <div class="app-showcase-heading">
          <div>
            <p class="text-eyebrow">Featured</p>
            <h2 class="text-subsection">Start with something good</h2>
          </div>
          <a class="app-section-link" href="/apps/all?sort=trending">
            See all
          </a>
        </div>
        <div class="app-spotlight-layout">
          <FreshAppCard app={lead} spotlight />
          <div class="app-promo-column">
            {secondary.slice(0, 2).map((app) => (
              <FreshAppCard key={app.id} app={app} compact />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

export function AppCategoryGrid(
  { tags, balanced = false }: { tags: AppTagSummary[]; balanced?: boolean },
) {
  return (
    <div
      class={`app-category-grid${
        balanced ? " app-category-grid--balanced" : ""
      }`}
    >
      {tags.map((item) => {
        const collection = appCollectionForTag(item.tag);
        const icon = (collection?.icon ?? "app") as ContentVisualIconName;
        return (
          <a
            class={`glass app-category-tile app-category-tile--${
              appCollectionKey(item.tag)
            }`}
            href={appCollectionHref(item.tag)}
            key={item.tag}
          >
            <span class="app-category-icon" aria-hidden="true">
              <ContentVisualIcon
                name={icon}
                class="app-category-icon-svg"
              />
            </span>
            <span class="app-category-copy">
              <span class="app-category-name">
                {appCollectionLabel(item.tag)}
              </span>
              <span class="app-category-count">
                {item.count} {item.count === 1 ? "app" : "apps"}
              </span>
            </span>
          </a>
        );
      })}
    </div>
  );
}

export function AppCategoryTiles(
  { tags, limit, seeAllHref = "/apps/categories" }: AppCategoryTilesProps,
) {
  if (tags.length === 0) return null;
  const visibleTags = typeof limit === "number" ? tags.slice(0, limit) : tags;
  return (
    <section class="app-showcase-section app-category-section">
      <div class="container">
        <div class="app-showcase-heading">
          <div>
            <p class="text-eyebrow">Collections</p>
            <h2 class="text-subsection">Find apps by what they do</h2>
          </div>
          <a class="app-section-link" href={seeAllHref}>
            See all
          </a>
        </div>
        <AppCategoryGrid tags={visibleTags} balanced />
      </div>
    </section>
  );
}

export function AppDiscoverySplit(
  { trending, fresh }: AppDiscoverySplitProps,
) {
  if (trending.length === 0 && fresh.length === 0) return null;
  return (
    <section class="app-showcase-section app-discovery-section">
      <div class="container app-discovery-stack">
        {trending.length > 0 && (
          <div class="app-ranked-panel">
            <div class="app-showcase-heading app-showcase-heading--compact">
              <div>
                <p class="text-eyebrow">Popular right now</p>
                <h2 class="text-subsection">Trending across the Atmosphere</h2>
              </div>
              <a class="app-section-link" href="/apps/all?sort=trending">
                See all
              </a>
            </div>
            <div class="app-ranked-list">
              {trending.slice(0, 6).map((app, index) => {
                const appHost = hostname(app.primaryUrl);
                const signal = app.reviewCount > 0 &&
                    app.averageRating != null
                  ? `${
                    app.averageRating.toFixed(1)
                  } from ${app.reviewCount} reviews`
                  : null;
                const category = appPrimaryCollection(app) ?? "App";
                return (
                  <a
                    class="glass app-ranked-row"
                    href={appHref(app)}
                    key={app.id}
                  >
                    <span class="app-ranked-index">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span class="app-ranked-rail">
                      <span class="app-ranked-icon">
                        {appImageUrl(app.iconUrl, "icon")
                          ? (
                            <img
                              src={appImageUrl(app.iconUrl, "icon")!}
                              alt=""
                              loading="lazy"
                              decoding="async"
                              width={96}
                              height={96}
                            />
                          )
                          : <span>{app.name.slice(0, 1).toUpperCase()}</span>}
                      </span>
                    </span>
                    <span class="app-ranked-copy">
                      <span class="app-ranked-title-row">
                        <span class="app-ranked-title">{app.name}</span>
                        {appHost && (
                          <span class="app-ranked-handle">
                            <AtmosphereHandle handle={appHost} />
                          </span>
                        )}
                      </span>
                      <span class="app-ranked-detail-row">
                        <span class="app-store-category">{category}</span>
                        {signal && (
                          <span class="app-ranked-signal">{signal}</span>
                        )}
                      </span>
                    </span>
                    <span class="app-ranked-action">View</span>
                  </a>
                );
              })}
            </div>
          </div>
        )}
        {fresh.length > 0 && (
          <div class="app-fresh-panel">
            <div class="app-showcase-heading app-showcase-heading--compact">
              <div>
                <p class="text-eyebrow">New and noteworthy</p>
                <h2 class="text-subsection">Fresh apps just added</h2>
              </div>
              <a class="app-section-link" href="/apps/all?sort=newest">
                See all
              </a>
            </div>
            <div class="app-fresh-grid">
              {fresh.slice(0, 3).map((app) => (
                <FreshAppCard key={app.id} app={app} />
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
