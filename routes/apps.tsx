import { define } from "../utils.ts";
import Nav from "../components/Nav.tsx";
import Footer from "../components/Footer.tsx";
import StoreHero from "../components/explore/StoreHero.tsx";
import {
  AppCategoryTiles,
  AppDiscoverySplit,
  AppSpotlight,
} from "../components/explore/AppDirectoryShowcase.tsx";
import { buildAccountMenuProps } from "../lib/account-menu-props.ts";
import type { AppSearchResult } from "../lib/app-directory.ts";
import { loadAppsHomeFromAppview } from "../lib/appview-client.ts";
import { EdgeStaleCache } from "../lib/edge-cache.ts";

interface ExploreData {
  result: AppSearchResult;
  account: ReturnType<typeof buildAccountMenuProps>;
}

const APPS_HOME_CACHE_TTL_MS = 2 * 60 * 1000;
const APPS_HOME_STALE_MS = 15 * 60 * 1000;

const appsHomeCache = new EdgeStaleCache<AppSearchResult>({
  freshMs: APPS_HOME_CACHE_TTL_MS,
  staleMs: APPS_HOME_STALE_MS,
});

export const handler = define.handlers({
  async GET(ctx) {
    const url = ctx.url;
    if (url.searchParams.get("category") === "accountProvider") {
      return redirectLegacyAccountHostsUrl(url);
    }
    if (isBrowseRequest(url)) {
      return redirectBrowseAllUrl(url);
    }

    const result = await loadAppsHomeResult().catch(() =>
      emptyAppsHomeResult()
    );

    const data: ExploreData = {
      result,
      account: buildAccountMenuProps(ctx.state),
    };
    return ctx.render(<ExplorePage data={data} locale={ctx.state.locale} />);
  },
});

async function loadAppsHomeResult(): Promise<AppSearchResult> {
  return await appsHomeCache.get("home", () => loadAppsHomeFromAppview());
}

function emptyAppsHomeResult(): AppSearchResult {
  return {
    apps: [],
    featured: [],
    trending: [],
    fresh: [],
    total: 0,
    page: 1,
    pageSize: 24,
    tags: [],
    tagSummaries: [],
  };
}

interface ExplorePageProps {
  data: ExploreData;
  locale: string;
}

function ExplorePage({ data, locale: _locale }: ExplorePageProps) {
  return (
    <div id="page-top">
      <div class="content-layer">
        <Nav account={data.account} active="apps" />
        <StoreHero
          initialQuery=""
          activeTag={null}
          sort="trending"
          searchAction="/apps/all"
        />

        <AppSpotlight apps={data.result.featured} />
        <AppCategoryTiles
          tags={data.result.tagSummaries}
          limit={9}
          seeAllHref="/apps/categories"
        />
        <AppDiscoverySplit
          trending={data.result.trending}
          fresh={data.result.fresh}
        />

        <section class="section app-directory-bottom-cta">
          <div class="container">
            <DirectoryRegisterCta
              href="/apps/create?intent=project"
              label="Register an app"
              secondaryHref="/apps/all"
              secondaryLabel="See all apps"
            />
          </div>
        </section>

        <Footer variant="compact" />
      </div>
    </div>
  );
}

function redirectLegacyAccountHostsUrl(url: URL): Response {
  const target = new URLSearchParams();
  const query = url.searchParams.get("q")?.trim();
  if (query) target.set("q", query);
  const qs = target.toString();
  return new Response(null, {
    status: 308,
    headers: { location: `/hosts${qs ? `?${qs}` : ""}` },
  });
}

function isBrowseRequest(url: URL): boolean {
  return ["q", "tag", "sort", "page", "category"].some((key) =>
    url.searchParams.has(key)
  );
}

function redirectBrowseAllUrl(url: URL): Response {
  const target = new URLSearchParams();
  for (const key of ["q", "sort", "page"]) {
    const value = url.searchParams.get(key)?.trim();
    if (value) target.set(key, value);
  }
  for (const tag of url.searchParams.getAll("tag")) {
    const value = tag.trim();
    if (value) target.append("tag", value);
  }
  const qs = target.toString();
  return new Response(null, {
    status: 308,
    headers: { location: `/apps/all${qs ? `?${qs}` : ""}` },
  });
}

function DirectoryRegisterCta(
  { href, label, secondaryHref, secondaryLabel }: {
    href: string;
    label: string;
    secondaryHref?: string;
    secondaryLabel?: string;
  },
) {
  return (
    <div class="directory-register-cta">
      {secondaryHref && secondaryLabel && (
        <a href={secondaryHref} class="directory-register-button">
          <span class="directory-register-button-icon" aria-hidden="true">
            ↗
          </span>
          <span>{secondaryLabel}</span>
        </a>
      )}
      <a href={href} class="directory-register-button">
        <span class="directory-register-button-icon" aria-hidden="true">
          +
        </span>
        <span>{label}</span>
      </a>
    </div>
  );
}
