export default function BlueskySection() {
  return (
    <section class="section reveal">
      <div class="container">
        <div class="text-center">
          <h2 class="text-section">Choose your provider.</h2>
          <div class="divider" />
          <p
            class="text-body mt-2"
            style={{ maxWidth: "640px", margin: "1rem auto 0" }}
          >
            Your Atmosphere account lives with a <strong>provider</strong>{" "}
            — a service that stores your data and keeps it available across
            every app. That provider might be an app you already use, or a host
            that only holds accounts. You pick who hosts your account, and you
            can switch any time.
          </p>
        </div>

        <div class="provider-grid">
          <div class="glass provider-card">
            <div class="provider-card-badge font-mono">Most popular</div>
            <div class="provider-logo-row">
              <svg
                width="28"
                height="28"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <rect x="2" y="3" width="20" height="18" rx="2" />
                <path d="M6 8h12M8 12h5M8 16h8" />
              </svg>
              <span class="provider-name font-mono">Apps</span>
            </div>
            <p class="text-body-sm">
              Apps such as Bluesky{" "}
              <a
                href="https://bsky.app"
                target="_blank"
                rel="noopener noreferrer"
                class="provider-bluesky-icon-link"
                aria-label="Bluesky website"
              >
                <svg
                  class="provider-bluesky-icon"
                  width="18"
                  height="18"
                  viewBox="0 0 600 530"
                  fill="currentColor"
                  xmlns="http://www.w3.org/2000/svg"
                  aria-hidden="true"
                >
                  <path d="M135.72 44.03C202.216 93.951 273.74 195.17 300 249.49C326.26 195.17 397.784 93.951 464.28 44.03C512.378 8.502 588 -22.418 588 69.85C588 90.97 576.42 192.07 570 213.89C548.2 284.29 472.94 303.23 405.91 292.28C521.44 315.16 549.46 397.65 489.46 480.13C377.23 634.08 316.03 475.75 302.29 436.08C300.83 431.89 300.16 429.94 300 429.94C299.84 429.94 299.17 431.89 297.71 436.08C283.97 475.76 222.77 634.08 110.54 480.13C50.54 397.65 78.56 315.16 194.09 292.28C127.06 303.23 51.8 284.29 30 213.89C23.58 192.07 12 90.97 12 69.85C12 -22.418 87.622 8.502 135.72 44.03Z" />
                </svg>
              </a>{" "}
              are also account providers. When you sign up, they provide an
              account for you and your data is hosted by them. Some apps are not
              account providers: they are just apps, and you sign in with an
              account hosted somewhere else.
            </p>
          </div>

          <div class="glass provider-card">
            <div class="provider-logo-row">
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
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
              </svg>
              <span class="provider-name font-mono">Independent providers</span>
            </div>
            <p class="text-body-sm">
              Independent providers are account hosts — they are not apps
              themselves, they only hold your account and data. A growing number
              of them offer Atmosphere accounts: some are community-run, some
              focus on privacy.
            </p>
          </div>

          <div class="glass provider-card">
            <div class="provider-logo-row">
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
                <path d="M12 2L2 7l10 5 10-5-10-5z" />
                <path d="M2 17l10 5 10-5" />
                <path d="M2 12l10 5 10-5" />
              </svg>
              <span class="provider-name font-mono">Self-host</span>
            </div>
            <p class="text-body-sm">
              Technical users can run their own provider. Full control over your
              data, on your own infrastructure. The Atmosphere is open — anyone
              can be a provider.
            </p>
          </div>
        </div>

        <p
          class="text-body-sm text-center mt-3"
          style={{
            maxWidth: "520px",
            margin: "1.5rem auto 0",
            fontStyle: "italic",
          }}
        >
          No matter which provider you choose, your account works everywhere and
          you can move to a different provider at any time — no data lost.
        </p>
      </div>
    </section>
  );
}
