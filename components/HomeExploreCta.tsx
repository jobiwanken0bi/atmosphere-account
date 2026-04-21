import { useT } from "../i18n/mod.ts";

/**
 * Closing call-to-action on the marketing homepage. Sits between the
 * "Your account, your choice" section and the footer to give visitors
 * a clear next step into the explore registry.
 *
 * Only used on `/` — the explore pages already are the destination,
 * so there's no point repeating the CTA there.
 */
export default function HomeExploreCta() {
  const t = useT().homeCta;
  return (
    <section class="section reveal home-explore-cta">
      <div class="container text-center">
        <h2 class="text-section">{t.headline}</h2>
        <div class="divider" />
        <p
          class="text-body mt-2"
          style={{ maxWidth: "560px", margin: "1rem auto 0" }}
        >
          {t.body}
        </p>
        <p class="mt-4">
          <a
            href="/explore"
            class="explore-cta-primary home-explore-cta-button"
          >
            {t.button}
            <svg
              class="home-explore-cta-arrow"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M5 12h14M13 5l7 7-7 7" />
            </svg>
          </a>
        </p>
      </div>
    </section>
  );
}
