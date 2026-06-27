import LottieSection from "./LottieSection.tsx";
import { useT } from "../i18n/mod.ts";
import ContentVisualIcon, {
  type ContentVisualIconName,
} from "./icons/ContentVisualIcon.tsx";

const onePlaceIcons: ContentVisualIconName[] = [
  "post",
  "like",
  "follow",
  "comment",
  "list",
  "video",
  "photo",
  "blog",
  "review",
];

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
          {t.onePlace.items.map((item, index) => (
            <span key={item} class="hub-tag">
              <span class="hub-tag-icon">
                <ContentVisualIcon
                  name={onePlaceIcons[index] ?? "new"}
                  class="hub-tag-icon-svg"
                />
              </span>
              <span class="hub-tag-label">{item}</span>
            </span>
          ))}
          <span class="hub-tag hub-tag-more">
            <span class="hub-tag-icon">
              <ContentVisualIcon name="new" class="hub-tag-icon-svg" />
            </span>
            <span class="hub-tag-label">{t.onePlace.moreTag}</span>
          </span>
        </div>
      </div>
    </section>
  );
}
