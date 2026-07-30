interface Props {
  class?: string;
}

/**
 * Person-plus "create account" / sign-up icon. Inline SVG matching the
 * WebsiteIcon stroke style so it inherits `currentColor` and sits alongside
 * the other host action-button icons.
 */
export default function SignupIcon({ class: className }: Props) {
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
      <circle cx="9" cy="8" r="3.75" />
      <path d="M2.75 19.5a6.25 6.25 0 0 1 12.5 0" />
      <line x1="19" y1="7.5" x2="19" y2="13.5" />
      <line x1="16" y1="10.5" x2="22" y2="10.5" />
    </svg>
  );
}
