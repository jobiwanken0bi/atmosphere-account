import { useT } from "../i18n/mod.ts";

export default function CrossPollination() {
  const t = useT();
  const contentTypes = t.crossPollination.contentTypes;
  const destinations = t.crossPollination.destinations;

  return (
    <section class="section reveal">
      <div class="container">
        <div class="text-center">
          <h2 class="text-section">{t.crossPollination.heading}</h2>
          <div class="divider" />
          <p
            class="text-body mt-2"
            style={{ maxWidth: "640px", margin: "1rem auto 0" }}
          >
            {t.crossPollination.intro}
          </p>
        </div>

        {/* Flow diagram */}
        <div class="flow-diagram">
          <div class="flow-column flow-column-left">
            <div class="flow-column-label font-mono">
              {t.crossPollination.youCreate}
            </div>
            {contentTypes.map((label, i) => (
              <div
                key={label}
                class={`flow-node flow-node-left glass-subtle ${
                  i === contentTypes.length - 1 ? "flow-node-open" : ""
                }`}
                style={{ animationDelay: `${i * 0.12}s` }}
              >
                {label}
              </div>
            ))}
          </div>

          <div class="flow-center">
            <div class="flow-hub glass">
              <img
                src="/union.svg"
                alt={t.crossPollination.hubLogoAlt}
                width="36"
                height="36"
                class="flow-hub-logo"
              />
              <span class="flow-hub-label font-mono">
                {t.crossPollination.hubLabel}
              </span>
            </div>

            {/* Animated connection lines */}
            <div class="flow-lines flow-lines-left" aria-hidden="true">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div
                  key={`l${i}`}
                  class="flow-line"
                  style={{ animationDelay: `${i * 0.15}s` }}
                />
              ))}
            </div>
            <div class="flow-lines flow-lines-right" aria-hidden="true">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div
                  key={`r${i}`}
                  class="flow-line"
                  style={{ animationDelay: `${i * 0.15 + 0.6}s` }}
                />
              ))}
            </div>
          </div>

          <div class="flow-column flow-column-right">
            <div class="flow-column-label font-mono">
              {t.crossPollination.itAppearsIn}
            </div>
            {destinations.map((label, i) => (
              <div
                key={label}
                class={`flow-node flow-node-right glass-subtle ${
                  i === destinations.length - 1 ? "flow-node-open" : ""
                }`}
                style={{ animationDelay: `${i * 0.12 + 0.3}s` }}
              >
                {label}
              </div>
            ))}
          </div>
        </div>

        <p
          class="text-body-sm text-center mt-3"
          style={{
            maxWidth: "520px",
            margin: "1.5rem auto 0",
            fontStyle: "italic",
          }}
        >
          {t.crossPollination.footnote}
        </p>
      </div>
    </section>
  );
}
