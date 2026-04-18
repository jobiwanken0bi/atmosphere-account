import { useT } from "../i18n/mod.ts";

export default function Nav() {
  const t = useT();
  return (
    <>
      <nav class="nav" id="main-nav">
        <a href="/" class="nav-logo">
          <img src="/union.svg" alt={t.nav.logoAlt} width="26" height="26" />
          <span class="nav-logo-text">{t.nav.brand}</span>
        </a>
        <div class="nav-links">
          <span
            class="nav-btn nav-btn-ghost nav-coming-soon"
            title={t.nav.exploreComingSoon}
          >
            {t.nav.explore}
          </span>
          <a
            href="https://atproto.com"
            target="_blank"
            rel="noopener noreferrer"
            class="nav-btn nav-btn-glass"
          >
            {t.nav.protocol}
          </a>
        </div>
      </nav>
      <div class="nav-effects-bar" id="nav-effects-bar">
        <label class="nav-sky-switch-label">
          <span class="nav-sky-switch-text">{t.nav.effects}</span>
          <span class="nav-sky-switch">
            <input
              type="checkbox"
              id="sky-effects-toggle"
              class="nav-sky-switch-input"
              defaultChecked
              aria-label={t.nav.effectsOn}
            />
            <span class="nav-sky-switch-track" aria-hidden="true" />
          </span>
        </label>
      </div>
    </>
  );
}
