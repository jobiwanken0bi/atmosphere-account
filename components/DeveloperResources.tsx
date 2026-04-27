import { useT } from "../i18n/mod.ts";
import SvgIconDownloads from "../islands/SvgIconDownloads.tsx";

const PROFILE_SCHEMA_URL =
  "https://tangled.org/joebasser.com/atmosphere-account/blob/main/lexicons/com/atmosphereaccount/registry/profile.json";

export default function DeveloperResources() {
  const t = useT();
  return (
    <>
      <section class="section-sm">
        <div class="container-narrow text-center">
          <h1 class="text-section">{t.developerResources.heading}</h1>
          <div class="divider" />
          <p class="text-body mt-2 mb-4">{t.developerResources.intro}</p>
          <div class="badge-display">
            <img
              src="/sign-in-box.svg"
              alt={t.developerResources.badgeAlt}
            />
          </div>
          <div class="badge-downloads">
            <a
              href="/sign-in-box.svg"
              download="atmosphere-sign-in-badge.svg"
              class="badge-download-btn font-mono"
            >
              {t.developerResources.downloadBadge}
            </a>
            <a
              href="/union.svg"
              download="atmosphere-logo.svg"
              class="badge-download-btn font-mono"
            >
              {t.developerResources.downloadLogo}
            </a>
          </div>
          <p class="text-body-sm mt-3">{t.developerResources.badgeFootnote}</p>
        </div>
      </section>

      <section class="section-sm" id="project-icons">
        <div class="container-narrow text-center">
          <h2 class="text-subsection">{t.developerResources.lottieHeading}</h2>
          <div class="divider" />
          <p class="text-body mt-2 mb-3">{t.developerResources.lottieIntro}</p>
          <div class="badge-downloads">
            <a
              href="/atmosphere.json"
              download="atmosphere-hero.lottie.json"
              class="badge-download-btn font-mono"
            >
              {t.developerResources.downloadLottie}
            </a>
            <a
              href="/lottie-icons.zip"
              download="atmosphere-lottie-icons.zip"
              class="badge-download-btn font-mono"
            >
              {t.developerResources.downloadIcons}
            </a>
          </div>
        </div>
      </section>

      <section class="section-sm">
        <div class="container-narrow text-center">
          <h2 class="text-subsection">{t.developerResources.icons.heading}</h2>
          <div class="divider" />
          <p class="text-body mt-2 mb-3">
            {t.developerResources.icons.intro}
          </p>
          <SvgIconDownloads />
        </div>
      </section>

      <section class="section-sm">
        <div class="container-narrow text-center">
          <h2 class="text-subsection">{t.developerResources.schemaHeading}</h2>
          <div class="divider" />
          <p class="text-body mt-2 mb-3">{t.developerResources.schemaBody}</p>
          <div class="badge-downloads">
            <a
              href={PROFILE_SCHEMA_URL}
              target="_blank"
              rel="noopener noreferrer"
              class="badge-download-btn font-mono"
            >
              {t.developerResources.viewSchema}
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
