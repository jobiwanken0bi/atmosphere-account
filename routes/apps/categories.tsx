import { define } from "../../utils.ts";
import Nav from "../../components/Nav.tsx";
import Footer from "../../components/Footer.tsx";
import StoreHero from "../../components/explore/StoreHero.tsx";
import { AppCategoryGrid } from "../../components/explore/AppDirectoryShowcase.tsx";
import { buildAccountMenuProps } from "../../lib/account-menu-props.ts";
import type { AppTagSummary } from "../../lib/app-directory.ts";
import { loadAppsHomeFromAppview } from "../../lib/appview-client.ts";

interface AppCategoriesData {
  tags: AppTagSummary[];
  account: ReturnType<typeof buildAccountMenuProps>;
}

const APP_CATEGORIES_CACHE_TTL_MS = 2 * 60 * 1000;
const APP_CATEGORIES_STALE_MS = 15 * 60 * 1000;

let appCategoriesCache:
  | {
    tags: AppTagSummary[];
    refreshedAt: number;
    refreshPromise?: Promise<AppTagSummary[]>;
  }
  | null = null;

export const handler = define.handlers({
  async GET(ctx) {
    const tags = await loadAppCategories().catch(() => []);

    const data: AppCategoriesData = {
      tags,
      account: buildAccountMenuProps(ctx.state),
    };

    return ctx.render(<AppCategoriesPage data={data} />);
  },
});

async function loadAppCategories(): Promise<AppTagSummary[]> {
  const now = Date.now();
  if (
    appCategoriesCache &&
    now - appCategoriesCache.refreshedAt < APP_CATEGORIES_CACHE_TTL_MS
  ) {
    return appCategoriesCache.tags;
  }
  if (
    appCategoriesCache &&
    now - appCategoriesCache.refreshedAt < APP_CATEGORIES_STALE_MS
  ) {
    refreshAppCategoriesCache();
    return appCategoriesCache.tags;
  }
  return await refreshAppCategoriesCache();
}

function refreshAppCategoriesCache(): Promise<AppTagSummary[]> {
  if (appCategoriesCache?.refreshPromise) {
    return appCategoriesCache.refreshPromise;
  }

  const refreshPromise = loadAppsHomeFromAppview()
    .then((result) => {
      const tags = result.tagSummaries;
      appCategoriesCache = { tags, refreshedAt: Date.now() };
      return tags;
    })
    .catch((err) => {
      if (appCategoriesCache) return appCategoriesCache.tags;
      throw err;
    })
    .finally(() => {
      if (appCategoriesCache) delete appCategoriesCache.refreshPromise;
    });

  appCategoriesCache = appCategoriesCache
    ? { ...appCategoriesCache, refreshPromise }
    : { tags: [], refreshedAt: 0, refreshPromise };
  return refreshPromise;
}

export default function AppCategoriesPage(
  { data }: { data: AppCategoriesData },
) {
  return (
    <div id="page-top">
      <div class="content-layer">
        <Nav account={data.account} active="apps" />
        <div class="app-browse-top-link">
          <div class="container">
            <a href="/apps" class="app-browse-home-link">
              <span class="app-browse-home-arrow" aria-hidden="true">
                ←
              </span>
              <span>Apps home</span>
            </a>
          </div>
        </div>
        <StoreHero
          initialQuery=""
          activeTag={null}
          sort="trending"
          searchAction="/apps/all"
          eyebrow="Collections"
          headline="Browse app collections."
          subhead="Find apps by what they do, then jump into a focused browse page."
        />

        <section class="app-showcase-section app-category-section app-category-section--all">
          <div class="container">
            <div class="app-showcase-heading">
              <div>
                <p class="text-eyebrow">{data.tags.length} collections</p>
                <h2 class="text-subsection">All collections</h2>
              </div>
            </div>
            <AppCategoryGrid tags={data.tags} />
          </div>
        </section>

        <Footer variant="compact" />
      </div>
    </div>
  );
}
