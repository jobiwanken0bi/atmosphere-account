import { useT } from "../../i18n/mod.ts";
import { appCollectionLabel } from "../../lib/app-collections.ts";
import type { AppDirectorySort } from "../../lib/app-directory.ts";

interface Props {
  active?: string | null;
  query?: string;
  sort?: AppDirectorySort;
  tags?: string[];
  action?: string;
  compact?: boolean;
}

function clearHref(query?: string, action = "/apps/all"): string {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  const qs = params.toString();
  return `${action}${qs ? `?${qs}` : ""}`;
}

export default function AppFilterDropdown(
  {
    active,
    query,
    sort = "trending",
    tags = [],
    action = "/apps/all",
    compact = false,
  }: Props,
) {
  const t = useT();
  return (
    <form
      class={`app-filter-form${compact ? " app-filter-form--compact" : ""}`}
      method="GET"
      action={action}
    >
      <label class="app-filter-label" for="app-filter-select">
        {t.explore.appFilterLabel}
      </label>
      {query && <input type="hidden" name="q" value={query} />}
      <div class="app-filter-control">
        <select
          id="app-filter-select"
          name="tag"
          class="app-filter-select"
        >
          <option value="" selected={!active}>
            {t.explore.appFilterAll}
          </option>
          {tags.map((tag) => (
            <option
              key={tag}
              value={tag}
              selected={active === tag}
            >
              {appCollectionLabel(tag)}
            </option>
          ))}
        </select>
        <select
          name="sort"
          aria-label="Sort apps"
          class="app-filter-select app-filter-select--sort"
        >
          <option value="trending" selected={sort === "trending"}>
            Trending
          </option>
          <option value="newest" selected={sort === "newest"}>
            Newest
          </option>
          <option value="az" selected={sort === "az"}>
            A-Z
          </option>
        </select>
        <button class="app-filter-submit" type="submit">
          {t.explore.appFilterSubmit}
        </button>
      </div>
      {active && (
        <a class="app-filter-clear" href={clearHref(query, action)}>
          {t.explore.clearFilter}
        </a>
      )}
    </form>
  );
}
