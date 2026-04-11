export default function Nav() {
  return (
    <>
      <nav class="nav" id="main-nav">
        <a href="/" class="nav-logo">
          <img src="/union.svg" alt="Atmosphere" width="32" height="32" />
          <span class="nav-logo-text">Atmosphere</span>
        </a>
        <div class="nav-links">
          <span
            class="nav-btn nav-btn-ghost nav-coming-soon"
            title="Coming soon"
          >
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
      <div class="nav-effects-bar" id="nav-effects-bar">
        <label class="nav-sky-switch-label">
          <span class="nav-sky-switch-text">Effects</span>
          <span class="nav-sky-switch">
            <input
              type="checkbox"
              id="sky-effects-toggle"
              class="nav-sky-switch-input"
              defaultChecked
              aria-label="Effects on. Turn off to keep colors and clouds fixed like the first screen."
            />
            <span class="nav-sky-switch-track" aria-hidden="true" />
          </span>
        </label>
      </div>
    </>
  );
}
