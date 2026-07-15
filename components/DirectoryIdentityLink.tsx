interface Props {
  href: string;
  destination: "app" | "host";
  label?: string;
  accessibleLabel?: string;
}

export default function DirectoryIdentityLink(
  {
    href,
    destination,
    label: labelOverride,
    accessibleLabel: accessibleLabelOverride,
  }: Props,
) {
  const pointsBack = destination === "host";
  const label = labelOverride ?? (pointsBack ? "Host" : "App");
  const accessibleLabel = accessibleLabelOverride ??
    (pointsBack
      ? "View this account's host profile"
      : "View this account's app profile");

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
