import { APP_SUBCATEGORIES } from "../../lib/lexicons.ts";
import { useT } from "../../i18n/mod.ts";

interface Props {
  active?: string | null;
  query?: string;
}

function buildHref(sub: string | null, query?: string): string {
  const params = new URLSearchParams({ category: "app" });
  if (sub) params.set("subcategory", sub);
  if (query) params.set("q", query);
  return `/explore?${params.toString()}`;
}

export default function SubcategoryChips({ active, query }: Props) {
  const t = useT();
  return (
    <div class="explore-subchips">
      <a
        href={buildHref(null, query)}
        class={`explore-subchip ${!active ? "is-active" : ""}`}
      >
        {t.categories.all}
      </a>
      {APP_SUBCATEGORIES.map((s) => (
        <a
          key={s}
          href={buildHref(s, query)}
          class={`explore-subchip ${active === s ? "is-active" : ""}`}
        >
          {t.subcategories[s]}
        </a>
      ))}
    </div>
  );
}
