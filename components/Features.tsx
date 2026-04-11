function Icon({ children }: { children: any }) {
  return (
    <div class="feature-icon">
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        {children}
      </svg>
    </div>
  );
}

const icons = {
  globe: (
    <Icon>
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </Icon>
  ),
  atSign: (
    <Icon>
      <circle cx="12" cy="12" r="4" />
      <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94" />
    </Icon>
  ),
  blocks: (
    <Icon>
      <rect x="2" y="6" width="8" height="8" rx="1" />
      <rect x="14" y="6" width="8" height="8" rx="1" />
      <rect x="8" y="14" width="8" height="8" rx="1" />
      <path d="M8 2h8v4H8z" opacity="0.4" />
    </Icon>
  ),
  domain: (
    <Icon>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </Icon>
  ),
};

export default function Features() {
  const features = [
    {
      icon: icons.globe,
      title: "Works everywhere",
      description:
        "Your Atmosphere account works on every Atmosphere app. One login, hundreds of apps.",
    },
    {
      icon: icons.atSign,
      title: "Universal identity",
      description:
        "Use the same @handle in every app. When someone mentions you, it works everywhere — one identity, recognized across the Atmosphere.",
    },
    {
      icon: icons.blocks,
      title: "Anyone can build",
      description:
        "Developers can build new apps on the Atmosphere and tap into an existing network from day one.",
    },
    {
      icon: icons.domain,
      title: "Great for personal websites",
      description:
        "Your @handle can be your own domain. Your identity, your brand — no handle squatting.",
    },
  ];

  return (
    <section class="section reveal">
      <div class="container">
        <div class="text-center">
          <h2 class="text-section">Built different.</h2>
          <div class="divider" />
        </div>
        <div class="feature-grid">
          {features.map((f) => (
            <div key={f.title} class="glass feature-card">
              {f.icon}
              <h3 class="text-subsection mb-1">{f.title}</h3>
              <p class="text-body-sm">{f.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
