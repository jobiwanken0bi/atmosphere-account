import WebsiteIcon from "../components/icons/WebsiteIcon.tsx";

interface HostVisitLinkProps {
  href: string;
}

export default function HostVisitLink({ href }: HostVisitLinkProps) {
  return (
    <a
      class="profile-hero-action"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(event) => {
        if (
          event.defaultPrevented || event.button !== 0 || event.metaKey ||
          event.ctrlKey || event.shiftKey || event.altKey
        ) {
          return;
        }
        event.preventDefault();
        globalThis.open(href, "_blank", "noopener,noreferrer");
      }}
    >
      <span class="profile-hero-action-icon">
        <WebsiteIcon class="profile-hero-action-icon-svg" />
      </span>
      <span>Visit host</span>
      <span class="profile-hero-action-arrow" aria-hidden="true">
        ↗
      </span>
    </a>
  );
}
