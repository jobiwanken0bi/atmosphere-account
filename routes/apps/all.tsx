import { define } from "../../utils.ts";
import Nav from "../../components/Nav.tsx";
import Footer from "../../components/Footer.tsx";
import StoreHero from "../../components/explore/StoreHero.tsx";
import AppGrid from "../../components/explore/AppGrid.tsx";
import AppBrowseControls from "../../islands/AppBrowseControls.tsx";
import { buildAccountMenuProps } from "../../lib/account-menu-props.ts";
import {
  type AppDirectorySort,
  type AppSearchResult,
} from "../../lib/app-directory.ts";
import { searchAppsFromAppview } from "../../lib/appview-client.ts";
import { appCollectionLabel } from "../../lib/app-collections.ts";
import { EdgeStaleCache } from "../../lib/edge-cache.ts";

interface BrowseAppsData {
  query: string;
  tags: string[];
  sort: AppDirectorySort;
  page: number;
  pageSize: number;
  total: number;
  result: AppSearchResult;
  account: ReturnType<typeof buildAccountMenuProps>;
}

const APP_BROWSE_CACHE_TTL_MS = 30 * 1000;
const APP_BROWSE_STALE_MS = 5 * 60 * 1000;
const APP_BROWSE_CACHE_MAX_ENTRIES = 48;

const appBrowseCache = new EdgeStaleCache<AppSearchResult>({
  freshMs: APP_BROWSE_CACHE_TTL_MS,
  staleMs: APP_BROWSE_STALE_MS,
  maxEntries: APP_BROWSE_CACHE_MAX_ENTRIES,
});

export const handler = define.handlers({
  async GET(ctx) {
    const url = ctx.url;
    const tags = readTags(url.searchParams);
    const sort = readSort(url.searchParams.get("sort"));
    const query = url.searchParams.get("q")?.trim() ?? "";
    const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);

    const result = await loadAppBrowseResult({ query, tags, sort, page })
      .catch(() => emptyBrowseResult(page));

    const data: BrowseAppsData = {
      query,
      tags,
      sort,
      page,
      pageSize: result.pageSize,
      total: result.total,
      result,
      account: buildAccountMenuProps(ctx.state),
    };

    return ctx.render(<BrowseAppsPage data={data} />);
  },
});

async function loadAppBrowseResult(input: {
  query: string;
  tags: string[];
  sort: AppDirectorySort;
  page: number;
}): Promise<AppSearchResult> {
  const key = appBrowseCacheKey(input);
  return await appBrowseCache.get(key, () =>
    searchAppsFromAppview({
      query: input.query || undefined,
      tag: input.tags.length > 0 ? input.tags : undefined,
      sort: input.sort,
      page: input.page,
    }));
}

function appBrowseCacheKey(input: {
  query: string;
  tags: string[];
  sort: AppDirectorySort;
  page: number;
}): string {
  const tags = [...input.tags].sort().join(",");
  return JSON.stringify({
    q: input.query.trim().toLocaleLowerCase(),
    tags,
    sort: input.sort,
    page: input.page,
  });
}

function emptyBrowseResult(page: number): AppSearchResult {
  return {
    apps: [],
    featured: [],
    trending: [],
    fresh: [],
    total: 0,
    page,
    pageSize: 24,
    tags: [],
    tagSummaries: [],
  };
}

function BrowseAppsPage({ data }: { data: BrowseAppsData }) {
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
          initialQuery={data.query}
          activeTag={data.tags[0] ?? null}
          sort={data.sort}
          searchAction="/apps/all"
          eyebrow="Browse apps"
          headline="Browse all Atmosphere apps."
          subhead="Search the directory, choose a collection, or sort by what is new."
          controls={
            <AppBrowseControls
              initialQuery={data.query}
              selectedTags={data.tags}
              sort={data.sort}
              tags={data.result.tags}
            />
          }
        />

        <section class="explore-controls app-browse-controls">
          <div class="container">
            <div class="app-directory-results-heading app-directory-results-heading--left">
              <p class="text-eyebrow">{resultLabel(data)}</p>
              <h2 class="text-subsection">{browseTitle(data)}</h2>
            </div>
          </div>
        </section>

        <section id="app-results" class="section app-browse-results-section">
          <div class="container">
            <AppGrid
              apps={data.result.apps}
              filtered={Boolean(data.query) || data.tags.length > 0}
              resetHref="/apps/all"
            />
            <AppPagination
              page={data.page}
              pageSize={data.pageSize}
              total={data.total}
              query={data.query}
              tags={data.tags}
              sort={data.sort}
            />
            <DirectoryRegisterCta
              href="/apps/create?intent=project"
              label="Register an app"
            />
          </div>
        </section>

        <Footer variant="compact" />
      </div>
    </div>
  );
}

function readSort(value: string | null): AppDirectorySort {
  return value === "newest" || value === "az" ? value : "trending";
}

function readTags(searchParams: URLSearchParams): string[] {
  const tags = searchParams.getAll("tag").flatMap((tag) =>
    tag.split(",").map((part) => part.trim()).filter(Boolean)
  );
  return [...new Set(tags)];
}

function browseTitle(data: BrowseAppsData): string {
  if (data.query) return `Search results for "${data.query}"`;
  if (data.tags.length === 1) return appCollectionLabel(data.tags[0]);
  if (data.tags.length > 1) return `${data.tags.length} collections`;
  return "All apps";
}

function resultLabel(data: BrowseAppsData): string {
  const count = `${data.total} ${data.total === 1 ? "app" : "apps"}`;
  if (data.tags.length > 0) return `${count} in selected collections`;
  if (data.query) return count;
  return count;
}

function pageHref(
  nextPage: number,
  data: {
    query: string;
    tags: string[];
    sort: AppDirectorySort;
  },
): string {
  const params = new URLSearchParams();
  if (data.query) params.set("q", data.query);
  for (const tag of data.tags) params.append("tag", tag);
  if (data.sort !== "trending") params.set("sort", data.sort);
  if (nextPage > 1) params.set("page", String(nextPage));
  const qs = params.toString();
  return `/apps/all${qs ? `?${qs}` : ""}`;
}

function AppPagination(
  {
    page,
    pageSize,
    total,
    query,
    tags,
    sort,
  }: {
    page: number;
    pageSize: number;
    total: number;
    query: string;
    tags: string[];
    sort: AppDirectorySort;
  },
) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (pageCount <= 1) return null;
  const data = { query, tags, sort };
  return (
    <nav class="app-pagination" aria-label="Apps pagination">
      {page > 1
        ? (
          <a class="app-pagination-link" href={pageHref(page - 1, data)}>
            Previous
          </a>
        )
        : <span class="app-pagination-link is-disabled">Previous</span>}
      <span class="app-pagination-status">
        Page {Math.min(page, pageCount)} of {pageCount}
      </span>
      {page < pageCount
        ? (
          <a class="app-pagination-link" href={pageHref(page + 1, data)}>
            Next
          </a>
        )
        : <span class="app-pagination-link is-disabled">Next</span>}
    </nav>
  );
}

function DirectoryRegisterCta(
  { href, label }: { href: string; label: string },
) {
  return (
    <div class="directory-register-cta">
      <a href={href} class="directory-register-button">
        <span class="directory-register-button-icon" aria-hidden="true">
          +
        </span>
        <span>{label}</span>
      </a>
    </div>
  );
}
