import { useT } from "../i18n/mod.ts";

export default function WhatIsAtmosphere() {
  const t = useT();
  return (
    <section class="section reveal">
      <div class="container-narrow text-center">
        <h2 class="text-section">{t.whatIs.heading}</h2>
        <div class="divider" />
        <div
          class="glass-strong"
          style={{ padding: "2.5rem 2rem", marginTop: "2rem" }}
        >
          {t.whatIs.paragraphs.map((render, i) => (
            <p
              key={i}
              class={i === 0 ? "text-body" : "text-body mt-3"}
            >
              {render()}
            </p>
          ))}
        </div>
        <p
          class="text-body-sm text-center"
          style={{ marginTop: "1.25rem", fontStyle: "italic", opacity: 0.78 }}
        >
          {t.whatIs.footnote()}
        </p>
      </div>
    </section>
  );
}
