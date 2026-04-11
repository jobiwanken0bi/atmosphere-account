export default function SignInBadge() {
  return (
    <section class="section-sm reveal">
      <div class="container-narrow text-center">
        <h2 class="text-section">For developers.</h2>
        <div class="divider" />
        <p class="text-body mt-2 mb-4">
          Building an Atmosphere app? Let your users know they can sign in with
          their Atmosphere account.
        </p>
        <div class="badge-display">
          <img src="/sign-in-box.svg" alt="Sign in with your Atmosphere Account" />
        </div>
        <div class="badge-downloads">
          <a
            href="/sign-in-box.svg"
            download="atmosphere-sign-in-badge.svg"
            class="badge-download-btn font-mono"
          >
            Download badge (SVG)
          </a>
          <a
            href="/union.svg"
            download="atmosphere-logo.svg"
            class="badge-download-btn font-mono"
          >
            Download logo (SVG)
          </a>
        </div>
        <p class="text-body-sm mt-3">
          Add this badge to your sign-in page to help users understand the Atmosphere.
        </p>
      </div>
    </section>
  );
}
