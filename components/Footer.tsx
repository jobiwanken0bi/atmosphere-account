import { useT } from "../i18n/mod.ts";
import LocaleSwitcher from "./LocaleSwitcher.tsx";

interface FooterProps {
  /**
   * Compact footer for the explore section: drops the marketing
   * tagline and the closing pull-quote (those belong on the homepage)
   * but keeps the logo, link rail, locale switcher, and back-to-top
   * affordance so the page still has a proper foot.
   */
  variant?: "default" | "compact";
}

export default function Footer({ variant = "default" }: FooterProps = {}) {
  const t = useT();
  const compact = variant === "compact";
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
        {!compact && <p class="text-subsection mb-3">{t.footer.tagline}</p>}
        <div class="footer-links">
          <a
            href="https://atproto.com"
            target="_blank"
            rel="noopener noreferrer"
          >
            {t.footer.links.atProtocol}
          </a>
          {
            /* Hide on the explore section — visitors are already there,
            * so the link would just point at the page they're on. */
          }
          {!compact && <a href="/explore">{t.footer.links.exploreApps}</a>}
          <a href="/developer-resources">{t.footer.links.developerResources}</a>
        </div>
        {!compact && <p class="footer-quote">{t.footer.quote()}</p>}
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
