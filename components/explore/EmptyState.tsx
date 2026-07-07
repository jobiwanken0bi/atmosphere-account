import { useT } from "../../i18n/mod.ts";

interface Props {
  /** When set, the empty result is due to an active search/filter rather than
   *  a genuinely empty directory — show recovery copy + a clear-filters link. */
  filtered?: boolean;
  /** Href that clears the active filters (e.g. the unfiltered browse page). */
  resetHref?: string;
}

export default function EmptyState({ filtered, resetHref }: Props = {}) {
  const t = useT().explore;
  if (filtered) {
    return (
      <div class="explore-empty glass">
        <p class="text-subsection">{t.noMatch}</p>
        <p class="text-body-sm mt-2">{t.noMatchSubtle}</p>
        {resetHref && (
          <a
            href={resetHref}
            class="profile-form-button-secondary"
            style={{ marginTop: "1.25rem" }}
          >
            {t.clearFilters}
          </a>
        )}
      </div>
    );
  }
  return (
    <div class="explore-empty glass">
      <p class="text-subsection">{t.nothingHere}</p>
      <p class="text-body-sm mt-2">{t.nothingHereSubtle}</p>
    </div>
  );
}
