import { useT } from "../../i18n/mod.ts";
import ExploreSearch from "../../islands/ExploreSearch.tsx";

interface Props {
  initialQuery: string;
  signedIn: boolean;
}

export default function StoreHero({ initialQuery, signedIn }: Props) {
  const t = useT().explore;
  return (
    <section class="explore-hero">
      <div class="container">
        <p class="text-eyebrow">{t.heroEyebrow}</p>
        <h1 class="text-section">{t.heroHeadline}</h1>
        <p class="text-body mt-2 explore-hero-subhead">{t.heroSubhead}</p>
        <div class="explore-hero-actions">
          <ExploreSearch initialQuery={initialQuery} />
          <a
            href={signedIn ? "/explore/manage" : "/explore/create"}
            class="explore-cta-primary"
          >
            {signedIn ? t.manageYourProfile : t.submitYourProject}
          </a>
        </div>
      </div>
    </section>
  );
}
