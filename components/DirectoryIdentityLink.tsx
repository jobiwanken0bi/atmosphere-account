interface Props {
  href: string;
  destination: "app" | "host";
}

export default function DirectoryIdentityLink(
  { href, destination }: Props,
) {
  const pointsBack = destination === "host";
  const label = pointsBack ? "Host" : "App";
  const accessibleLabel = pointsBack
    ? "View this account's host profile"
    : "View this account's app profile";

  return (
    <a
      class={`profile-hero-action directory-identity-link directory-identity-link--${destination}`}
      href={href}
      aria-label={accessibleLabel}
      title={accessibleLabel}
    >
      {pointsBack && (
        <span class="directory-identity-link-arrow" aria-hidden="true">
          ←
        </span>
      )}
      <span>{label}</span>
      {!pointsBack && (
        <span class="directory-identity-link-arrow" aria-hidden="true">
          →
        </span>
      )}
    </a>
  );
}
