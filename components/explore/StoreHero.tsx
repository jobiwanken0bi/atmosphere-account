import type { ComponentChildren } from "preact";
import { useT } from "../../i18n/mod.ts";
import ExploreSearch from "../../islands/ExploreSearch.tsx";

interface Props {
  initialQuery: string;
  activeTag?: string | null;
  sort?: string | null;
  searchAction?: string;
  eyebrow?: string;
  headline?: string;
  subhead?: string;
  controls?: ComponentChildren;
  homeHref?: string;
  homeLabel?: string;
}

export default function StoreHero(
  {
    initialQuery,
    activeTag,
    sort,
    searchAction = "/apps/all",
    eyebrow,
    headline,
    subhead,
    controls,
    homeHref,
    homeLabel = "Apps home",
  }: Props,
) {
  const t = useT().explore;
  return (
    <section class="explore-hero">
      <div class="container">
        {homeHref && (
          <div class="explore-hero-back">
            <a href={homeHref} class="app-browse-home-link">
              <span class="app-browse-home-arrow" aria-hidden="true">
                ←
              </span>
              <span>{homeLabel}</span>
            </a>
          </div>
        )}
        <p class="text-eyebrow">{eyebrow ?? t.heroEyebrow}</p>
        <h1 class="text-section">{headline ?? t.heroHeadline}</h1>
        <p class="text-body mt-2 explore-hero-subhead">
          {subhead ?? t.heroSubhead}
        </p>
        <div class="explore-hero-actions">
          {controls ?? (
            <ExploreSearch
              initialQuery={initialQuery}
              activeTag={activeTag}
              sort={sort}
              action={searchAction}
            />
          )}
        </div>
      </div>
    </section>
  );
}
