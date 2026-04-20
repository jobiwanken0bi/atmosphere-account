import { useT } from "../../i18n/mod.ts";

export default function EmptyState() {
  const t = useT().explore;
  return (
    <div class="explore-empty glass">
      <p class="text-subsection">{t.nothingHere}</p>
      <p class="text-body-sm mt-2">{t.nothingHereSubtle}</p>
      <a href="/explore/create" class="explore-cta-primary mt-4">
        {t.submitYourProject}
      </a>
    </div>
  );
}
