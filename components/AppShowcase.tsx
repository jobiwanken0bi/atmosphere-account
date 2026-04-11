export default function AppShowcase() {
  const categories = [
    {
      name: "Microblogs",
      apps: [
        { name: "Bluesky", url: "https://bsky.app" },
        { name: "Blacksky", url: "https://blacksky.app" },
      ],
    },
    {
      name: "Video",
      apps: [
        { name: "Spark", url: "https://spark.blue" },
        { name: "Stream.place", url: "https://stream.place" },
      ],
    },
    {
      name: "Photos",
      apps: [
        { name: "Flashes", url: "https://flashes.blue" },
      ],
    },
    {
      name: "Blogging",
      apps: [
        { name: "Leaflet", url: "https://leaflet.pub" },
        { name: "Offprint", url: "https://offprint.blog" },
        { name: "Pckt", url: "https://pckt.pub" },
      ],
    },
    {
      name: "Events",
      apps: [
        { name: "Smoke Signal", url: "https://smokesignal.events" },
        { name: "Dandelion", url: "https://dandelion.events" },
        { name: "Calendar City", url: "https://calendar.city" },
      ],
    },
    {
      name: "Music & Reviews",
      apps: [
        { name: "teal.fm", url: "https://teal.fm" },
        { name: "Popfeed", url: "https://popfeed.app" },
      ],
    },
    {
      name: "Collections",
      apps: [
        { name: "Semble", url: "https://semble.social" },
      ],
    },
    {
      name: "Clients",
      apps: [
        { name: "Flux", url: "https://flux.blue" },
        { name: "Skyscraper", url: "#" },
      ],
    },
  ];

  return (
    <section class="section reveal">
      <div class="container">
        <div class="text-center">
          <h2 class="text-section">Explore the Atmosphere.</h2>
          <div class="divider" />
          <p class="text-body mt-2" style={{ maxWidth: "600px", margin: "1rem auto 0" }}>
            A growing ecosystem of apps — all accessible with your one
            Atmosphere account.
          </p>
        </div>
        {categories.map((cat) => (
          <div key={cat.name} style={{ marginTop: "2.5rem" }}>
            <h3 class="text-subsection mb-2" style={{ textAlign: "center" }}>{cat.name}</h3>
            <div class="app-grid" style={{ marginTop: "1rem" }}>
              {cat.apps.map((app) => (
                <a
                  key={app.name}
                  href={app.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="glass app-card"
                  style={{ textDecoration: "none", color: "inherit" }}
                >
                  <div class="app-card-name">{app.name}</div>
                </a>
              ))}
            </div>
          </div>
        ))}
        <p class="text-body-sm text-center mt-4">
          And many more being built every day.
        </p>
      </div>
    </section>
  );
}
