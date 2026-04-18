import { useT } from "../i18n/mod.ts";

export default function Hero() {
  const t = useT();
  return (
    <section class="hero">
      <p class="hero-eyebrow font-mono">{t.hero.eyebrow}</p>
      <h1 class="text-hero">{t.hero.headline()}</h1>
      <p class="text-body hero-subhead">{t.hero.subhead}</p>
      <div class="scroll-indicator" aria-hidden="true">
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>
    </section>
  );
}
