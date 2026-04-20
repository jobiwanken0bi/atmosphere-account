import { CATEGORIES, type Category } from "../../lib/lexicons.ts";
import { useT } from "../../i18n/mod.ts";

interface Props {
  active?: string | null;
  query?: string;
}

function buildHref(category: string | null, query?: string): string {
  const params = new URLSearchParams();
  if (category) params.set("category", category);
  if (query) params.set("q", query);
  const qs = params.toString();
  return `/explore${qs ? `?${qs}` : ""}`;
}

export default function CategoryTabs({ active, query }: Props) {
  const t = useT();
  return (
    <nav class="explore-category-tabs" aria-label={t.explore.browseBy}>
      <a
        href={buildHref(null, query)}
        class={`explore-category-tab ${!active ? "is-active" : ""}`}
      >
        {t.categories.all}
      </a>
      {CATEGORIES.map((c: Category) => (
        <a
          key={c}
          href={buildHref(c, query)}
          class={`explore-category-tab ${active === c ? "is-active" : ""}`}
        >
          {t.categories[c]}
        </a>
      ))}
    </nav>
  );
}
