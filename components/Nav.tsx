export default function Nav() {
  return (
    <nav class="nav" id="main-nav">
      <a href="/" class="nav-logo">
        <img src="/union.svg" alt="Atmosphere" width="32" height="32" />
        <span class="nav-logo-text">Atmosphere</span>
      </a>
      <div class="nav-links">
        <span class="nav-btn nav-btn-ghost nav-coming-soon" title="Coming soon">
          Explore
        </span>
        <a
          href="https://atproto.com"
          target="_blank"
          rel="noopener noreferrer"
          class="nav-btn nav-btn-glass"
        >
          Protocol
        </a>
      </div>
    </nav>
  );
}
