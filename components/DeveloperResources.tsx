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
          <div class="badge-downloads">
            <a href="/docs" class="badge-download-btn font-mono">
              Open full docs
            </a>
          </div>
        </div>
      </section>

      <section class="section-sm" id="atmosphere-login">
        <div class="container-narrow">
          <div class="developer-login-card glass">
            <div>
              <p class="text-eyebrow">Atmosphere Login</p>
              <h2 class="text-subsection">A shared account picker for apps</h2>
              <p class="text-body mt-2">
                Add the branded button, send users to the hosted Atmosphere
                picker, then start your own AT Protocol OAuth flow with the
                selected handle.
              </p>
            </div>
            <pre class="developer-code-block"><code>{`<button
  data-atmosphere-login
  data-client-id="https://app.example.com/oauth/client-metadata.json"
  data-return-uri="https://app.example.com/auth/atmosphere/selected"
></button>
<script src="https://atmosphereaccount.com/atmosphere-login.js"></script>`}</code></pre>
            <p class="text-body-sm">
              Selection tokens are ES256 JWTs. Verify them with
              <code>/login/jwks.json</code>, then complete your app's own
              atproto OAuth flow using the returned handle as the login hint.
            </p>
            <pre class="developer-code-block"><code>{`const result = await verifyAtmosphereSelectionToken({
  token,
  publicJwk,
  expectedIssuer: "https://atmosphereaccount.com",
  expectedAudience: "https://app.example.com/oauth/client-metadata.json",
  expectedState: state,
  expectedReturnUri: "https://app.example.com/auth/atmosphere/selected",
});`}</code></pre>
          </div>
        </div>
      </section>

      <section class="section-sm" id="host-account-routing">
        <div class="container-narrow">
          <div class="developer-login-card glass">
            <div>
              <p class="text-eyebrow">Host Account Routing</p>
              <h2 class="text-subsection">
                Send users to PDS-owned account controls
              </h2>
              <p class="text-body mt-2">
                Hosts publish their PDS service endpoint so Atmosphere can send
                users to the host-owned account page for apps, devices,
                passwords, keys, backups, restore, and migration.
              </p>
            </div>
            <pre class="developer-code-block"><code>{`{
  "host": "host.example",
  "displayName": "Example Host",
  "serviceEndpoint": "https://pds.host.example",
  "accountManagementUrl": "https://pds.host.example/account",
  "createdAt": "2026-06-26T00:00:00.000Z"
}`}</code></pre>
            <pre class="developer-code-block"><code>{`deno task host:dashboard:check host.example
curl "https://atmosphereaccount.com/api/hosts/dashboard/validate?host=host.example"`}</code></pre>
            <div class="badge-downloads badge-downloads--left">
              <a
                href="/atmosphere-host-dashboard.schema.json"
                class="badge-download-btn font-mono"
              >
                Manifest schema
              </a>
              <a
                href="/examples/atmosphere-host-dashboard.example.json"
                class="badge-download-btn font-mono"
              >
                Example manifest
              </a>
              <a href="/hosts" class="badge-download-btn font-mono">
                Host directory
              </a>
            </div>
            <p class="text-body-sm">
              Optional capability metadata can describe what a host supports,
              but Atmosphere does not own passwords, grants, rotation keys,
              backup custody, account deletion, or migration.
            </p>
          </div>
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
