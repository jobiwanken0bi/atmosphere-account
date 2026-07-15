import WebsiteIcon from "../components/icons/WebsiteIcon.tsx";
import SignupIcon from "../components/icons/SignupIcon.tsx";

interface HostVisitLinkProps {
  href: string;
  label?: string;
  /** Which glyph to show. `website` (globe) for Explore, `signup`
   * (person-plus) for Create account / Request invite. */
  icon?: "website" | "signup";
}

export default function HostVisitLink(
  { href, label = "Visit host", icon = "website" }: HostVisitLinkProps,
) {
  return (
    <a
      class="profile-hero-action"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
    >
      <span class="profile-hero-action-icon">
        {icon === "signup"
          ? <SignupIcon class="profile-hero-action-icon-svg" />
          : <WebsiteIcon class="profile-hero-action-icon-svg" />}
      </span>
      <span>{label}</span>
      <span class="profile-hero-action-arrow" aria-hidden="true">
        ↗
      </span>
    </a>
  );
}
