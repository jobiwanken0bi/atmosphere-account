export default function ModerationAndAlgorithms() {
  return (
    <section class="section reveal">
      <div class="container">
        <div class="text-center">
          <h2 class="text-section">You choose the rules.</h2>
          <div class="divider" />
          <p class="text-body mt-2" style={{ maxWidth: "640px", margin: "1rem auto 0" }}>
            In the Atmosphere, no single company decides what you see or what
            counts as acceptable. Moderation and algorithms are yours to choose.
          </p>
        </div>

        <div class="mod-algo-grid">
          <div class="glass mod-algo-card">
            <div class="mod-algo-icon" aria-hidden="true">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
            </div>
            <h3 class="text-subsection mb-1">Moderation</h3>
            <p class="text-body-sm">
              Each app can set its own rules, and users can subscribe to
              third-party moderation services that layer on top — labels, filters,
              and block lists created and managed by the very communities they aim
              to protect. Who understands a community's needs better than the
              people who live in it?
            </p>
            <p class="text-body-sm mt-2">
              If you don't like how an app handles moderation, you don't have to
              argue with a support bot. You can add another moderation layer, or
              switch to a different app entirely — one that better fits your
              values.
            </p>
          </div>

          <div class="glass mod-algo-card">
            <div class="mod-algo-icon" aria-hidden="true">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
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
            </div>
            <h3 class="text-subsection mb-1">Algorithms</h3>
            <p class="text-body-sm">
              Feeds are open. Anyone can build and run one. You can pick which
              algorithm you use, or switch between them like playlists — a
              friends-only feed, an independent art feed, a slow news feed, or
              something deeply niche that feels alive rather than gamed.
            </p>
            <p class="text-body-sm mt-2">
              No single algorithm quietly decides culture for billions of people.
              Feeds compete on taste, care, and usefulness — not on how
              effectively they can keep you stuck. Open algorithms are
              censorship-resistant: no amount of sucking up to authoritarian
              governments can shift what users see.
            </p>
          </div>
        </div>

        <p
          class="text-body-sm text-center mt-3"
          style={{ maxWidth: "560px", margin: "1.5rem auto 0", fontStyle: "italic" }}
        >
          Together, account ownership, moderation, and algorithmic choice make
          exploitation difficult to sustain. The system is locked open by design.
        </p>
      </div>
    </section>
  );
}
