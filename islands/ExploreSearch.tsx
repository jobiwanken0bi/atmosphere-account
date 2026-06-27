import { useSignal } from "@preact/signals";
import { useT } from "../i18n/mod.ts";

interface Props {
  initialQuery: string;
  activeTag?: string | null;
  sort?: string | null;
  action?: string;
}

/**
 * Submits a synchronous GET so SSR rendering and shareable
 * URLs work without JS. The island only enhances by giving the input
 * controlled-state behaviour and a clearable affordance.
 */
export default function ExploreSearch(
  { initialQuery, activeTag, sort, action = "/apps/all" }: Props,
) {
  const t = useT().explore;
  const value = useSignal(initialQuery ?? "");

  return (
    <form
      action={action}
      method="GET"
      class="explore-search-form"
      role="search"
    >
      <label class="visually-hidden" for="explore-search-input">
        {t.searchPlaceholder}
      </label>
      <input
        id="explore-search-input"
        name="q"
        type="search"
        autoComplete="off"
        spellcheck={false}
        placeholder={t.searchPlaceholder}
        value={value.value}
        onInput={(e) =>
          value.value = (e.currentTarget as HTMLInputElement).value}
        class="explore-search-input"
      />
      {activeTag && <input type="hidden" name="tag" value={activeTag} />}
      {sort && sort !== "trending" && (
        <input type="hidden" name="sort" value={sort} />
      )}
      <button type="submit" class="explore-search-submit">
        {t.searchSubmit}
      </button>
    </form>
  );
}
