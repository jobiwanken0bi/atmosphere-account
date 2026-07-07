import WebsiteIcon from "../components/icons/WebsiteIcon.tsx";

interface HostVisitLinkProps {
  href: string;
  label?: string;
}

export default function HostVisitLink(
  { href, label = "Visit host" }: HostVisitLinkProps,
) {
  return (
    <a
      class="profile-hero-action"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
    >
      <span class="profile-hero-action-icon">
        <WebsiteIcon class="profile-hero-action-icon-svg" />
      </span>
      <span>{label}</span>
      <span class="profile-hero-action-arrow" aria-hidden="true">
        ↗
      </span>
    </a>
  );
}
