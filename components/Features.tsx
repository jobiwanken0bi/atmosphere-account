import type { ComponentChildren } from "preact";
import { useT } from "../i18n/mod.ts";

function Icon({ children }: { children: ComponentChildren }) {
  return (
    <div class="feature-icon">
      <svg
        width="20"
        height="20"
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
  key: (
    <Icon>
      <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4" />
    </Icon>
  ),
};

function PersonalDomainDemo() {
  return (
    <span
      class="personal-domain-demo"
      aria-label="You change your handle from you.bsky.social to you.com"
    >
      <span class="personal-domain-demo-glow" aria-hidden="true" />
      <span class="personal-domain-demo-avatar" aria-hidden="true">
        <svg
          width="26"
          height="26"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.55"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <circle cx="12" cy="8" r="3.4" />
          <path d="M5.4 19.2c1.18-3.02 3.48-4.52 6.6-4.52s5.42 1.5 6.6 4.52" />
        </svg>
      </span>
      <span class="personal-domain-demo-route" aria-hidden="true">
        <span class="personal-domain-demo-prefix">you.</span>
        <span class="personal-domain-demo-handle-window">
          <span class="personal-domain-demo-handle personal-domain-demo-handle--old">
            bsky.social
          </span>
          <span class="personal-domain-demo-handle personal-domain-demo-handle--new">
            com
          </span>
        </span>
      </span>
    </span>
  );
}

export default function Features() {
  const t = useT();
  const features = [
    {
      icon: icons.globe,
      handleDemo: false,
      ...t.features.items.universalIdentity,
    },
    { icon: icons.key, handleDemo: false, ...t.features.items.ownAccount },
    {
      icon: icons.blocks,
      handleDemo: false,
      ...t.features.items.anyoneBuilds,
    },
    { icon: icons.domain, handleDemo: true, ...t.features.items.personalSites },
  ];

  return (
    <section class="section reveal">
      <div class="container">
        <div class="text-center">
          <h2 class="text-section">{t.features.heading}</h2>
          <div class="divider" />
        </div>
        <div class="feature-grid">
          {features.map((f) => (
            <div
              key={f.title}
              class={`glass feature-card${
                f.handleDemo ? " feature-card--with-demo" : ""
              }`}
            >
              <div class="feature-card-title-row">
                {f.icon}
                <h3 class="text-subsection">{f.title}</h3>
              </div>
              <p
                class={`text-body-sm${
                  f.handleDemo ? " feature-card-body--with-inline-demo" : ""
                }`}
              >
                {f.handleDemo && <PersonalDomainDemo />}
                {f.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
