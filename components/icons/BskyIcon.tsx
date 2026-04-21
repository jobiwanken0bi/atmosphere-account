interface Props {
  /** CSS class on the wrapping <svg>. Color is inherited via currentColor. */
  class?: string;
}

/**
 * Bluesky butterfly mark, simplified vector. Uses `currentColor` so the
 * icon picks up whatever foreground color the parent sets — that's how
 * we tint it to match the site's blue (#254a9e) rather than rendering
 * the bitmap favicon, which is locked to Bluesky's brand sky-blue.
 *
 * Path is the canonical Bluesky logotype geometry (CC0).
 */
export default function BskyIcon({ class: className }: Props) {
  return (
    <svg
      viewBox="0 0 600 530"
      xmlns="http://www.w3.org/2000/svg"
      class={className}
      aria-hidden="true"
    >
      <path
        fill="currentColor"
        d="M135.72 44.03C202.21 93.94 273.72 195.13 300 249.42c26.28-54.29 97.78-155.49 164.28-205.39C512.26 8.03 590-19.47 590 69.21c0 17.7-10.15 148.79-16.11 170.07-20.7 73.99-96.16 92.87-163.25 81.43 117.27 19.95 147.14 86.07 82.74 152.19-122.27 125.59-175.69-31.51-189.38-71.76-2.51-7.38-3.69-10.83-3.7-7.9-.01-2.93-1.19.52-3.7 7.9-13.69 40.25-67.11 197.35-189.38 71.76-64.4-66.12-34.53-132.24 82.74-152.19-67.09 11.44-142.55-7.44-163.25-81.43C20.15 218 10 86.91 10 69.21 10-19.47 87.74 8.03 135.72 44.03z"
      />
    </svg>
  );
}
