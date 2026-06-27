import { useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import { useT } from "../i18n/mod.ts";
import { appCollectionLabel } from "../lib/app-collections.ts";
import type { AppDirectorySort } from "../lib/app-directory.ts";

interface Props {
  initialQuery: string;
  selectedTags: string[];
  sort: AppDirectorySort;
  tags: string[];
}

export default function AppBrowseControls(
  { initialQuery, selectedTags, sort, tags }: Props,
) {
  const t = useT().explore;
  const query = useSignal(initialQuery ?? "");
  const filtersRef = useRef<HTMLDivElement | null>(null);
  const collectionOpen = useSignal(false);
  const sortOpen = useSignal(false);
  const selected = new Set(selectedTags);
  const collectionLabel = selectedTags.length === 0
    ? "All collections"
    : selectedTags.length === 1
    ? appCollectionLabel(selectedTags[0])
    : `${selectedTags.length} collections`;

  useEffect(() => {
    function closeMenus() {
      collectionOpen.value = false;
      sortOpen.value = false;
    }

    function onPointerDown(event: PointerEvent) {
      if (!filtersRef.current) return;
      const node = event.target;
      if (node instanceof Node && !filtersRef.current.contains(node)) {
        closeMenus();
      }
    }

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") closeMenus();
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <form
      action="/apps/all"
      method="GET"
      class="app-browse-control-form"
      role="search"
    >
      {selectedTags.map((tag) => (
        <input key={tag} type="hidden" name="tag" value={tag} />
      ))}
      {sort !== "trending" && <input type="hidden" name="sort" value={sort} />}

      <div class="app-browse-search-control">
        <label class="visually-hidden" for="app-browse-search-input">
          {t.searchPlaceholder}
        </label>
        <input
          id="app-browse-search-input"
          name="q"
          type="search"
          autoComplete="off"
          spellcheck={false}
          placeholder={t.searchPlaceholder}
          value={query.value}
          onInput={(e) =>
            query.value = (e.currentTarget as HTMLInputElement).value}
          class="app-browse-search-input"
        />
        <button type="submit" class="app-browse-search-submit">
          {t.searchSubmit}
        </button>
      </div>

      <div
        class="app-browse-filter-pill"
        aria-label="App filters"
        ref={filtersRef}
      >
        <details
          class="app-browse-collection-menu"
          open={collectionOpen.value}
          onToggle={(event) => {
            const isOpen = (event.currentTarget as HTMLDetailsElement).open;
            collectionOpen.value = isOpen;
            if (isOpen) sortOpen.value = false;
          }}
        >
          <summary class="app-browse-dropdown-trigger">
            <span class="app-browse-dropdown-label">Collections</span>
            <span class="app-browse-dropdown-value">{collectionLabel}</span>
            <span class="app-browse-dropdown-chevron" aria-hidden="true">
              ▾
            </span>
          </summary>
          <div class="app-browse-collection-popover glass">
            {tags.map((tag) => (
              <a
                class="app-browse-checkbox-row"
                href={toggleCollectionHref(
                  initialQuery,
                  selectedTags,
                  sort,
                  tag,
                )}
                key={tag}
                role="menuitemcheckbox"
                aria-checked={selected.has(tag)}
              >
                <span class="app-browse-checkbox" aria-hidden="true">
                  {selected.has(tag) ? "✓" : ""}
                </span>
                <span>{appCollectionLabel(tag)}</span>
              </a>
            ))}
            {selectedTags.length > 0 && (
              <a
                class="app-browse-clear-link"
                href={clearCollectionHref(initialQuery, sort)}
              >
                Clear collections
              </a>
            )}
          </div>
        </details>

        <details
          class="app-browse-sort-menu"
          open={sortOpen.value}
          onToggle={(event) => {
            const isOpen = (event.currentTarget as HTMLDetailsElement).open;
            sortOpen.value = isOpen;
            if (isOpen) collectionOpen.value = false;
          }}
        >
          <summary class="app-browse-dropdown-trigger">
            <span class="app-browse-dropdown-label">Sort</span>
            <span class="app-browse-dropdown-value">{sortLabel(sort)}</span>
            <span class="app-browse-dropdown-chevron" aria-hidden="true">
              ▾
            </span>
          </summary>
          <div class="app-browse-sort-popover glass">
            <a
              class={sortOptionClass(sort, "trending")}
              href={sortHref(initialQuery, selectedTags, "trending")}
            >
              Trending
            </a>
            <a
              class={sortOptionClass(sort, "newest")}
              href={sortHref(initialQuery, selectedTags, "newest")}
            >
              Newest
            </a>
            <a
              class={sortOptionClass(sort, "az")}
              href={sortHref(initialQuery, selectedTags, "az")}
            >
              A-Z
            </a>
          </div>
        </details>
      </div>
    </form>
  );
}

function clearCollectionHref(query: string, sort: AppDirectorySort): string {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  if (sort !== "trending") params.set("sort", sort);
  const qs = params.toString();
  return `/apps/all${qs ? `?${qs}` : ""}`;
}

function toggleCollectionHref(
  query: string,
  selectedTags: string[],
  sort: AppDirectorySort,
  tag: string,
): string {
  const selected = new Set(selectedTags);
  if (selected.has(tag)) {
    selected.delete(tag);
  } else {
    selected.add(tag);
  }
  return browseHref(query, [...selected], sort);
}

function sortHref(
  query: string,
  selectedTags: string[],
  sort: AppDirectorySort,
): string {
  return browseHref(query, selectedTags, sort);
}

function browseHref(
  query: string,
  selectedTags: string[],
  sort: AppDirectorySort,
): string {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  for (const tag of selectedTags) params.append("tag", tag);
  if (sort !== "trending") params.set("sort", sort);
  const qs = params.toString();
  return `/apps/all${qs ? `?${qs}` : ""}`;
}

function sortLabel(sort: AppDirectorySort): string {
  if (sort === "newest") return "Newest";
  if (sort === "az") return "A-Z";
  return "Trending";
}

function sortOptionClass(
  current: AppDirectorySort,
  option: AppDirectorySort,
): string {
  return `app-browse-sort-option${current === option ? " is-active" : ""}`;
}
