import { useT } from "../i18n/mod.ts";

export default function YourChoice() {
  const t = useT();
  const cards = [
    {
      icon: (
        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
        </svg>
      ),
      ...t.yourChoice.cards.moderation,
    },
    {
      icon: (
        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <line x1="4" y1="21" x2="4" y2="14" />
          <line x1="4" y1="10" x2="4" y2="3" />
          <line x1="12" y1="21" x2="12" y2="12" />
          <line x1="12" y1="8" x2="12" y2="3" />
          <line x1="20" y1="21" x2="20" y2="16" />
          <line x1="20" y1="12" x2="20" y2="3" />
          <circle cx="4" cy="12" r="2" />
          <circle cx="12" cy="10" r="2" />
          <circle cx="20" cy="14" r="2" />
        </svg>
      ),
      ...t.yourChoice.cards.algorithms,
    },
    {
      icon: (
        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M6 12h12M6 7L3 12L6 17M18 7L21 12L18 17" />
        </svg>
      ),
      ...t.yourChoice.cards.portability,
    },
  ];

  return (
    <section class="section reveal">
      <div class="container">
        <div class="text-center">
          <h2 class="text-section">{t.yourChoice.heading}</h2>
          <div class="divider" />
          <p
            class="text-body mt-2"
            style={{ maxWidth: "640px", margin: "1rem auto 0" }}
          >
            {t.yourChoice.intro}
          </p>
        </div>

        <div class="your-choice-grid">
          {cards.map((c) => (
            <div key={c.title} class="glass feature-card">
              <div class="feature-card-title-row">
                <span
                  class="mod-algo-icon mod-algo-icon--inline"
                  aria-hidden="true"
                >
                  {c.icon}
                </span>
                <h3 class="text-subsection">{c.title}</h3>
              </div>
              <p class="text-body-sm">{c.body}</p>
            </div>
          ))}
        </div>

        <p
          class="text-body-sm text-center mt-3"
          style={{
            maxWidth: "560px",
            margin: "1.5rem auto 0",
            fontStyle: "italic",
          }}
        >
          {t.yourChoice.footnote}
        </p>
      </div>
    </section>
  );
}
