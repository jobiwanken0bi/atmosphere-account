import type { ProfileRow } from "../../lib/registry.ts";
import ProfileCard from "./ProfileCard.tsx";
import { useT } from "../../i18n/mod.ts";

interface Props {
  profiles: ProfileRow[];
}

export default function FeaturedRail({ profiles }: Props) {
  const t = useT().explore;
  if (profiles.length === 0) return null;
  return (
    <section class="featured-rail">
      <div class="container">
        <h2 class="text-subsection featured-rail-heading">{t.featured}</h2>
        <div class="featured-rail-track">
          {profiles.map((p) => (
            <div key={p.did} class="featured-rail-item">
              <ProfileCard profile={p} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
