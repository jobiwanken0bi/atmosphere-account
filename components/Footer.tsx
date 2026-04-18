import { useT } from "../i18n/mod.ts";
import LocaleSwitcher from "./LocaleSwitcher.tsx";

export default function Footer() {
  const t = useT();
  return (
    <footer class="footer reveal">
      <div class="container text-center">
        <img
          src="/union.svg"
          alt={t.footer.logoAlt}
          width="40"
          height="40"
          class="footer-logo"
          style={{
            margin: "0 auto 1.5rem",
            opacity: 0.55,
            filter:
              "brightness(0) saturate(100%) invert(12%) sepia(30%) saturate(1500%) hue-rotate(195deg) brightness(95%)",
          }}
        />
        <p class="text-subsection mb-3">{t.footer.tagline}</p>
        <div class="footer-links">
          <a
            href="https://atproto.com"
            target="_blank"
            rel="noopener noreferrer"
          >
            {t.footer.links.atProtocol}
          </a>
          <span class="footer-coming-soon" title={t.footer.links.exploreAppsTitle}>
            {t.footer.links.exploreApps}
          </span>
          <a href="/developer-resources">{t.footer.links.developerResources}</a>
        </div>
        <p class="footer-quote">{t.footer.quote()}</p>
        <a href="#page-top" class="back-to-top mt-4">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <path d="M18 15l-6-6-6 6" />
          </svg>
          {t.footer.backToTop}
        </a>
        <LocaleSwitcher />
      </div>
    </footer>
  );
}
