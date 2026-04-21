import { useT } from "../i18n/mod.ts";
import RegistryApiPlayground from "../islands/RegistryApiPlayground.tsx";

export default function DeveloperResources() {
  const t = useT();
  const tApi = t.developerResources.api;
  return (
    <>
      <section class="section-sm reveal">
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

      <section class="section-sm reveal">
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

      {/* Profile API: interactive playground + endpoint reference. The
          endpoint reference is server-rendered so it's discoverable
          without JS; the playground itself is a small island that
          handles fetch + copy interactions client-side. */}
      <section class="section-sm reveal">
        <div class="container-narrow">
          <div class="text-center">
            <h2 class="text-subsection">{tApi.heading}</h2>
            <div class="divider" />
            <p class="text-body mt-2 mb-4">{tApi.intro}</p>
          </div>

          <RegistryApiPlayground />

          <h3 class="text-subsection mt-5">{tApi.endpointsHeading}</h3>
          <div class="divider" />
          <dl class="api-endpoints">
            {(["profile", "search", "featured", "avatar"] as const).map(
              (key) => {
                const e = tApi.endpoints[key];
                return (
                  <div class="api-endpoint" key={key}>
                    <dt class="api-endpoint-path">
                      <span class="api-endpoint-method">{e.method}</span>
                      <code>{e.path}</code>
                      {"params" in e && e.params && (
                        <code class="api-endpoint-params">{e.params}</code>
                      )}
                    </dt>
                    <dd class="api-endpoint-summary">{e.summary}</dd>
                    <dd class="api-endpoint-cache">
                      <code>cache-control: {e.cache}</code>
                    </dd>
                  </div>
                );
              },
            )}
          </dl>

          <h3 class="text-subsection mt-5">{tApi.schemaHeading}</h3>
          <div class="divider" />
          <p class="text-body mt-2 mb-3">{tApi.schemaBody}</p>
          <div class="badge-downloads">
            <a
              href="/lexicons/com.atmosphereaccount.registry.profile.json"
              download="com.atmosphereaccount.registry.profile.json"
              class="badge-download-btn font-mono"
            >
              {tApi.downloadLexicon}
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
