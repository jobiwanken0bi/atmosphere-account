export default function Hero() {
  return (
    <section class="hero">
      <p class="hero-eyebrow font-mono">Atmosphere Account</p>
      <h1 class="text-hero">
        The last social account<br />you'll ever need.
      </h1>
      <p class="text-body hero-subhead">
        One account for all your apps. Yours to keep, wherever you go.
      </p>
      <div class="scroll-indicator" aria-hidden="true">
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>
    </section>
  );
}
