export default function YourChoice() {
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
      title: "Moderation",
      body:
        "Subscribe to community-built moderation — labels, filters, and block lists made by the people who understand the problem best. Don't like an app's rules? Layer on your own, or switch apps entirely.",
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
      title: "Algorithms",
      body:
        "Feeds are open — anyone can build one. Switch between them like playlists: friends-only, indie art, slow news, or something deeply niche. No single algorithm quietly decides culture for everyone.",
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
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          <path d="M2 8c0-3.31 2.69-6 6-6" />
          <path d="M22 8c0-3.31-2.69-6-6-6" />
        </svg>
      ),
      title: "Portability",
      body:
        "Move between apps and providers while keeping your connections, posts, and followers — no more starting over. Creators can leave an app without losing their audience; your followers are yours, not rented from a platform.",
    },
  ];

  return (
    <section class="section reveal">
      <div class="container">
        <div class="text-center">
          <h2 class="text-section">Your account, your choice.</h2>
          <div class="divider" />
          <p
            class="text-body mt-2"
            style={{ maxWidth: "640px", margin: "1rem auto 0" }}
          >
            No single company decides what you see, who you follow, or where you
            go. Everything is yours to control.
          </p>
        </div>

        <div class="your-choice-grid">
          {cards.map((c) => (
            <div key={c.title} class="glass feature-card">
              <div class="mod-algo-icon" aria-hidden="true">{c.icon}</div>
              <h3 class="text-subsection mb-1">{c.title}</h3>
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
          Account ownership, moderation, and algorithmic choice — the system is
          locked open by design.
        </p>
      </div>
    </section>
  );
}
