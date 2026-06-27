import { useT } from "../i18n/mod.ts";

const atmosphereApps = [
  { name: "Bluesky", file: "bluesky.jpg", ring: "app-bluesky inner-ring" },
  { name: "Spark", file: "spark.png", ring: "app-spark inner-ring" },
  {
    name: "Margin",
    file: "margin.webp",
    ring: "app-margin outer-ring mobile-extra",
  },
  {
    name: "Mu Social",
    file: "mu-social.webp",
    ring: "app-mu inner-ring",
  },
  { name: "Blacksky", file: "blacksky.jpg", ring: "app-blacksky inner-ring" },
  {
    name: "Stream Place",
    file: "stream-place.jpg",
    ring: "app-stream-place inner-ring",
  },
  {
    name: "Popfeed",
    file: "popfeed.jpg",
    ring: "app-popfeed outer-ring mobile-extra",
  },
  {
    name: "Offprint",
    file: "offprint.jpg",
    ring: "app-offprint outer-ring mobile-extra",
  },
  { name: "Leaflet", file: "leaflet.jpg", ring: "app-leaflet inner-ring" },
  {
    name: "Germ",
    file: "germ.jpg",
    ring: "app-germ outer-ring mobile-extra",
  },
  {
    name: "Anisota",
    file: "anisota.webp",
    ring: "app-anisota outer-ring mobile-extra",
  },
  { name: "Tangled", file: "tangled.jpg", ring: "app-tangled inner-ring" },
  {
    name: "Semble",
    file: "semble.jpg",
    ring: "app-semble outer-ring mobile-extra",
  },
  {
    name: "Beacon Bits",
    file: "beacon-bits.jpg",
    ring: "app-beacon-bits outer-ring mobile-extra",
  },
  { name: "Plyr", file: "plyr.jpg", ring: "app-plyr inner-ring" },
  {
    name: "Pckt",
    file: "pckt.webp",
    ring: "app-pckt outer-ring edge-icon mobile-extra",
  },
  {
    name: "Grain",
    file: "grain.svg",
    ring: "app-grain outer-ring mobile-extra",
  },
  {
    name: "Northsky",
    file: "northsky.jpg",
    ring: "app-northsky outer-ring mobile-extra",
  },
  {
    name: "Cartridge",
    file: "cartridge.webp",
    ring: "app-cartridge outer-ring mobile-extra",
  },
  {
    name: "Smoke Signal",
    file: "smoke-signal.jpg",
    ring: "app-smoke-signal outer-ring mobile-extra",
  },
  {
    name: "Blento",
    file: "blento.webp",
    ring: "app-blento outer-ring mobile-extra",
  },
  {
    name: "Surf",
    file: "surf.webp",
    ring: "app-surf outer-ring edge-icon mobile-extra",
  },
  {
    name: "Sifa",
    file: "sifa.webp",
    ring: "app-sifa outer-ring mobile-extra",
  },
  {
    name: "Sill",
    file: "sill.webp",
    ring: "app-sill outer-ring mobile-extra",
  },
];

const ghostApps = Array.from({ length: 60 }, (_, index) => index);

export default function LottieSection() {
  const t = useT();

  return (
    <div class="lottie-section">
      <div class="atmosphere-map" role="img" aria-label={t.lottie.networkAlt}>
        <div class="atmosphere-icon-core">
          <img
            src="/union.svg"
            alt=""
            width="112"
            height="112"
          />
        </div>
        <div class="app-orbit">
          <div class="app-ghost-cloud" aria-hidden="true">
            {ghostApps.map((index) => <span key={index} class="ghost-app" />)}
          </div>
          {atmosphereApps.map((app) => (
            <span key={app.name} class={`app-icon ${app.ring}`}>
              <img
                src={`/atmosphere-apps/${app.file}`}
                alt=""
                loading="lazy"
                decoding="async"
                width={64}
                height={64}
              />
            </span>
          ))}
        </div>
      </div>
      <a
        href="/apps"
        class="explore-cta-primary home-section-cta-button lottie-section-cta"
      >
        {t.lottie.exploreApps}
        <svg
          class="home-explore-cta-arrow"
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
          <path d="M5 12h14M13 5l7 7-7 7" />
        </svg>
      </a>
    </div>
  );
}
