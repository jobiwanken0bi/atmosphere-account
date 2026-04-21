interface Props {
  class?: string;
}

/**
 * Generic globe / "website" icon used for the Website link button on
 * the public profile. Inline SVG so it inherits `currentColor` and
 * matches the site's blue alongside the branded service marks.
 */
export default function WebsiteIcon({ class: className }: Props) {
  return (
    <svg
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      class={className}
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9.5" />
      <ellipse cx="12" cy="12" rx="4" ry="9.5" />
      <line x1="2.5" y1="12" x2="21.5" y2="12" />
    </svg>
  );
}
