import type { AppListing, AppTagSummary } from "../../lib/app-directory.ts";
import {
  appDisplayTaxonomy,
  appPrimaryCollection,
} from "../../lib/app-display.ts";
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
import AppCard, { AppCollectionBadge } from "./AppCard.tsx";

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

function description(app: AppListing): string {
  return app.tagline || app.description ||
    "Explore this app in the Atmosphere.";
}

function signalText(app: AppListing): string | null {
  if (app.reviewCount > 0 && app.averageRating != null) {
    return `${app.averageRating.toFixed(1)} from ${app.reviewCount} reviews`;
  }
  if (app.favoriteCount > 0) return `${app.favoriteCount} saves`;
  return null;
}

export function AppSpotlight({ apps }: AppSpotlightProps) {
  if (apps.length === 0) return null;
  const [lead, ...secondary] = apps;
  const wideMediaUrl = appImageUrl(
    lead.heroUrl || lead.screenshotUrls[0],
    "media",
  );
  const leadIconUrl = appImageUrl(lead.iconUrl, "icon");
  const host = hostname(lead.primaryUrl);
  const leadTaxonomy = appDisplayTaxonomy(lead);
  const leadPrimaryCollection = appPrimaryCollection(lead);
  const leadSignal = signalText(lead);
  const leadCollections = leadPrimaryCollection
    ? leadTaxonomy.collections.filter((collection) =>
      collection !== leadPrimaryCollection
    )
    : leadTaxonomy.collections;

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
          <a class="glass app-spotlight-card" href={appHref(lead)}>
            <div class="app-spotlight-copy">
              <h3>{lead.name}</h3>
              {host && (
                <p class="app-spotlight-host">
                  <AtmosphereHandle handle={host} />
                </p>
              )}
              <div class="app-spotlight-kicker app-spotlight-kicker--below">
                <AppCollectionBadge app={lead} />
                {leadSignal && <span>{leadSignal}</span>}
              </div>
              <p class="app-spotlight-description">{description(lead)}</p>
              <div class="app-spotlight-tags">
                {leadCollections.slice(0, 2).map((collection) => (
                  <span class="is-collection" key={collection}>
                    {collection}
                  </span>
                ))}
                {leadTaxonomy.tags.slice(0, 3).map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
              <span class="app-spotlight-cta">View</span>
            </div>
            <div
              class={`app-spotlight-media${
                wideMediaUrl ? "" : " app-spotlight-media--icon"
              }`}
              aria-hidden="true"
            >
              {wideMediaUrl
                ? (
                  <img
                    src={wideMediaUrl}
                    alt=""
                    loading="eager"
                    decoding="async"
                    fetchpriority="high"
                  />
                )
                : leadIconUrl
                ? (
                  <img
                    class="app-spotlight-big-icon"
                    src={leadIconUrl}
                    alt=""
                    loading="eager"
                    decoding="async"
                    fetchpriority="high"
                    width={192}
                    height={192}
                  />
                )
                : (
                  <div class="app-spotlight-fallback">
                    {lead.name.slice(0, 1).toUpperCase()}
                  </div>
                )}
            </div>
          </a>
          <div class="app-promo-column">
            {secondary.slice(0, 2).map((app) => {
              const appHost = hostname(app.primaryUrl);
              return (
                <a
                  class="glass app-promo-card"
                  href={appHref(app)}
                  aria-label={`View ${app.name}`}
                  key={app.id}
                >
                  <div class="app-promo-icon">
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
                  </div>
                  <div class="app-promo-copy">
                    <h3>{app.name}</h3>
                    {appHost && (
                      <p class="app-promo-handle">
                        <AtmosphereHandle handle={appHost} />
                      </p>
                    )}
                    <div class="app-promo-meta-line">
                      <AppCollectionBadge app={app} />
                    </div>
                    <p>{description(app)}</p>
                    <span class="app-promo-cta-wrap">
                      <span class="app-promo-cta">View</span>
                    </span>
                  </div>
                </a>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

export function AppCategoryGrid({ tags }: { tags: AppTagSummary[] }) {
  return (
    <div class="app-category-grid">
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
            <span class="app-category-name">
              {appCollectionLabel(item.tag)}
            </span>
            <span class="app-category-count">
              {item.count} {item.count === 1 ? "app" : "apps"}
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
        <AppCategoryGrid tags={visibleTags} />
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
                <h2 class="text-subsection">Trending across the ecosystem</h2>
              </div>
              <a class="app-section-link" href="/apps/all?sort=trending">
                See all
              </a>
            </div>
            <div class="app-ranked-list">
              {trending.slice(0, 6).map((app, index) => {
                const appHost = hostname(app.primaryUrl);
                const signal = signalText(app);
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
                      <span class="app-ranked-title">{app.name}</span>
                      <span class="app-ranked-meta">
                        {appHost && <AtmosphereHandle handle={appHost} />}
                        {appHost && signal && (
                          <span class="app-ranked-dot" aria-hidden="true">
                            /
                          </span>
                        )}
                        {signal && <span>{signal}</span>}
                      </span>
                      {app.favoriteCount > 0 &&
                        app.reviewCount > 0 && (
                        <span class="app-ranked-saves">
                          {app.favoriteCount} saves
                        </span>
                      )}
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
                <AppCard key={app.id} app={app} compact />
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
