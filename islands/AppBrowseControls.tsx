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
  const menuOpen = useSignal(false);
  const menuRef = useRef<HTMLDetailsElement | null>(null);
  const selected = new Set(selectedTags);
  const activeFilterCount = selectedTags.length + (sort === "trending" ? 0 : 1);
  const filterLabel = activeFilterCount > 0
    ? `${activeFilterCount} active app ${
      activeFilterCount === 1 ? "setting" : "settings"
    }`
    : "Sort and filter apps";

  useEffect(() => {
    function closeMenu() {
      menuOpen.value = false;
    }

    function onPointerDown(event: PointerEvent) {
      const menu = menuRef.current;
      const node = event.target;
      if (menu && node instanceof Node && !menu.contains(node)) closeMenu();
    }

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") closeMenu();
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
      class="app-browse-control-form hosts-search-form"
      role="search"
    >
      <div class="explore-search-form hosts-search-query">
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
          onInput={(event) =>
            query.value = (event.currentTarget as HTMLInputElement).value}
          class="explore-search-input app-browse-search-input"
        />
        <button type="submit" class="explore-search-submit">
          {t.searchSubmit}
        </button>
      </div>

      <details
        class="hosts-filter-menu app-browse-filter-menu"
        open={menuOpen.value}
        ref={menuRef}
        onToggle={(event) =>
          menuOpen.value = (event.currentTarget as HTMLDetailsElement).open}
      >
        <summary
          class="hosts-filter-trigger"
          aria-label={filterLabel}
          title="Sort and filter apps"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            width="18"
            height="18"
          >
            <path
              d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M10 14v6"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
            />
          </svg>
          <span class="hosts-filter-trigger-label">Sort &amp; filter</span>
          {activeFilterCount > 0 && (
            <span class="hosts-filter-count" aria-label={filterLabel}>
              {activeFilterCount}
            </span>
          )}
        </summary>
        <div class="hosts-filter-popover app-browse-filter-popover">
          <label class="hosts-filter-field">
            <span>Sort</span>
            <select name="sort">
              <option value="trending" selected={sort === "trending"}>
                Trending
              </option>
              <option value="newest" selected={sort === "newest"}>
                Newest
              </option>
              <option value="az" selected={sort === "az"}>
                A–Z
              </option>
            </select>
          </label>

          <fieldset class="app-browse-collection-field">
            <legend>Collections</legend>
            <div class="app-browse-collection-options">
              {tags.length > 0
                ? tags.map((tag) => (
                  <label class="app-browse-collection-option" key={tag}>
                    <input
                      type="checkbox"
                      name="tag"
                      value={tag}
                      defaultChecked={selected.has(tag)}
                    />
                    <span>{appCollectionLabel(tag)}</span>
                  </label>
                ))
                : (
                  <p class="app-browse-collection-empty">
                    No collections available yet.
                  </p>
                )}
            </div>
          </fieldset>

          <button type="submit" class="hosts-filter-apply">
            Apply
          </button>
        </div>
      </details>
    </form>
  );
}
