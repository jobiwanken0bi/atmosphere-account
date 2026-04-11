export default function CrossPollination() {
  const contentTypes = [
    { label: "Blog posts", side: "left" },
    { label: "Photos", side: "left" },
    { label: "Music", side: "left" },
    { label: "Videos", side: "left" },
    { label: "Events", side: "left" },
    { label: "Anything new", side: "left" },
  ];

  const destinations = [
    { label: "Social feeds", side: "right" },
    { label: "Galleries", side: "right" },
    { label: "Profiles", side: "right" },
    { label: "Players", side: "right" },
    { label: "Calendars", side: "right" },
    { label: "Apps not yet built", side: "right" },
  ];

  return (
    <section class="section reveal">
      <div class="container">
        <div class="text-center">
          <h2 class="text-section">Post once, show everywhere.</h2>
          <div class="divider" />
          <p class="text-body mt-2" style={{ maxWidth: "640px", margin: "1rem auto 0" }}>
            Wherever you get your podcasts — but for everything.
            Your content flows freely across every app in the Atmosphere.
          </p>
        </div>

        {/* Flow diagram */}
        <div class="flow-diagram">
          <div class="flow-column flow-column-left">
            <div class="flow-column-label font-mono">You create</div>
            {contentTypes.map((item, i) => (
              <div
                key={item.label}
                class={`flow-node flow-node-left glass-subtle ${i === contentTypes.length - 1 ? "flow-node-open" : ""}`}
                style={{ animationDelay: `${i * 0.12}s` }}
              >
                {item.label}
              </div>
            ))}
          </div>

          <div class="flow-center">
            <div class="flow-hub glass">
              <img
                src="/union.svg"
                alt="Atmosphere"
                width="36"
                height="36"
                class="flow-hub-logo"
              />
              <span class="flow-hub-label font-mono">Your Atmosphere Account</span>
            </div>

            {/* Animated connection lines */}
            <div class="flow-lines flow-lines-left" aria-hidden="true">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div key={`l${i}`} class="flow-line" style={{ animationDelay: `${i * 0.15}s` }} />
              ))}
            </div>
            <div class="flow-lines flow-lines-right" aria-hidden="true">
              {[0, 1, 2, 3, 4, 5].map((i) => (
                <div key={`r${i}`} class="flow-line" style={{ animationDelay: `${i * 0.15 + 0.6}s` }} />
              ))}
            </div>
          </div>

          <div class="flow-column flow-column-right">
            <div class="flow-column-label font-mono">It appears in</div>
            {destinations.map((item, i) => (
              <div
                key={item.label}
                class={`flow-node flow-node-right glass-subtle ${i === destinations.length - 1 ? "flow-node-open" : ""}`}
                style={{ animationDelay: `${i * 0.12 + 0.3}s` }}
              >
                {item.label}
              </div>
            ))}
          </div>
        </div>

        <p
          class="text-body-sm text-center mt-3"
          style={{ maxWidth: "520px", margin: "1.5rem auto 0", fontStyle: "italic" }}
        >
          These are just examples. The Atmosphere is open — any app can create
          and surface any kind of content. The possibilities grow with every new app that joins.
        </p>
      </div>
    </section>
  );
}
