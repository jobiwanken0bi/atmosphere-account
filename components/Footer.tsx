export default function Footer() {
  return (
    <footer class="footer reveal">
      <div class="container text-center">
        <img
          src="/union.svg"
          alt="Atmosphere"
          width="40"
          height="40"
          class="footer-logo"
          style={{
            margin: "0 auto 1.5rem",
            opacity: 0.55,
            filter: "brightness(0) saturate(100%) invert(12%) sepia(30%) saturate(1500%) hue-rotate(195deg) brightness(95%)",
          }}
        />
        <p class="text-subsection mb-3">
          Building a better internet, owned by the people.
        </p>
        <div class="footer-links">
          <a
            href="https://atproto.com"
            target="_blank"
            rel="noopener noreferrer"
          >
            AT Protocol
          </a>
          <span class="footer-coming-soon" title="Coming soon">Explore Apps</span>
        </div>
        <p class="footer-quote">
          "You never change things by fighting the existing reality. To change
          something, build a new model that makes the existing model obsolete."
          <br />
          <span style={{ opacity: 0.75 }}>— Buckminster Fuller</span>
        </p>
        <p
          class="text-body-sm mt-4"
          style={{ opacity: 0.38, fontSize: "0.8rem" }}
        >
          Atmosphere Account is an open-source project.
        </p>
        <a href="#page-top" class="back-to-top">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M18 15l-6-6-6 6" />
          </svg>
          Back to top
        </a>
      </div>
    </footer>
  );
}
