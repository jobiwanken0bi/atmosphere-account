import LottieSection from "./LottieSection.tsx";
import { useT } from "../i18n/mod.ts";

export default function OnePlace() {
  const t = useT();

  return (
    <section class="section-sm reveal">
      <div class="container-narrow text-center">
        <LottieSection />
        <h2 class="text-section">{t.onePlace.heading}</h2>
        <div class="divider" />
        <p class="text-body mt-2">{t.onePlace.body}</p>
        <p class="text-body-sm mt-3 hub-examples-label">
          {t.onePlace.examplesLabel}
        </p>
        <div class="hub-visual">
          {t.onePlace.items.map((item) => (
            <span key={item} class="hub-tag">
              {item}
            </span>
          ))}
          <span class="hub-tag hub-tag-more">{t.onePlace.moreTag}</span>
        </div>
      </div>
    </section>
  );
}
