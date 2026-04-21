import { useT } from "../i18n/mod.ts";

interface Props {
  /** Pixel size of the rendered badge. Defaults to the inline-with-text size. */
  size?: number;
  /** Adds a small block-margin so the badge sits flush with adjacent headings. */
  inline?: boolean;
  /** Override accessible label; defaults to t.badges.verifiedTooltip. */
  label?: string;
}

/**
 * Verified-project seal. Rendered next to the project name anywhere
 * a project is surfaced (listing cards, detail hero, etc.) when the
 * project has cleared admin verification (`iconAccessStatus === "granted"`).
 *
 * The shape is the brand starburst seal with an inset checkmark; fill
 * uses `currentColor` so the colour can be tuned per surface from CSS
 * (default is the primary brand blue via `.profile-verified-badge`).
 */
export default function VerifiedBadge(
  { size = 18, inline = true, label }: Props,
) {
  const t = useT();
  const accessibleLabel = label ?? t.badges.verifiedTooltip;
  return (
    <span
      class={`profile-verified-badge${
        inline ? " profile-verified-badge--inline" : ""
      }`}
      title={accessibleLabel}
      role="img"
      aria-label={accessibleLabel}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        focusable="false"
      >
        <path
          d="M100 52.3438C100 55.8398 99.1602 59.082 97.4805 62.0508C95.8008 65.0195 93.5547 67.3438 90.7227 68.9648C90.8008 69.4922 90.8398 70.3125 90.8398 71.4258C90.8398 76.7188 89.0625 81.2109 85.5469 84.9219C82.0117 88.6523 77.7539 90.5078 72.7734 90.5078C70.5469 90.5078 68.418 90.0977 66.4062 89.2773C64.8438 92.4805 62.5977 95.0586 59.6484 97.0312C56.7187 99.0234 53.4961 100 50 100C46.4258 100 43.1836 99.043 40.293 97.0898C37.3828 95.1563 35.1562 92.5586 33.5938 89.2773C31.582 90.0977 29.4727 90.5078 27.2266 90.5078C22.2461 90.5078 17.9687 88.6523 14.3945 84.9219C10.8203 81.2109 9.04297 76.6992 9.04297 71.4258C9.04297 70.8398 9.12109 70.0195 9.25781 68.9648C6.42578 67.3242 4.17969 65.0195 2.5 62.0508C0.839844 59.082 0 55.8398 0 52.3438C0 48.6328 0.9375 45.2148 2.79297 42.1289C4.64844 39.043 7.14844 36.7578 10.2734 35.2734C9.45312 33.0469 9.04297 30.8008 9.04297 28.5742C9.04297 23.3008 10.8203 18.7891 14.3945 15.0781C17.9687 11.3672 22.2461 9.49219 27.2266 9.49219C29.4531 9.49219 31.582 9.90234 33.5938 10.7227C35.1562 7.51953 37.4023 4.94141 40.3516 2.96875C43.2813 0.996094 46.5039 0 50 0C53.4961 0 56.7187 0.996094 59.6484 2.94922C62.5781 4.92188 64.8438 7.5 66.4062 10.7031C68.418 9.88281 70.5273 9.47266 72.7734 9.47266C77.7539 9.47266 82.0117 11.3281 85.5469 15.0586C89.082 18.7891 90.8398 23.2812 90.8398 28.5547C90.8398 31.0156 90.4687 33.2422 89.7266 35.2539C92.8516 36.7383 95.3516 39.0234 97.207 42.1094C99.0625 45.2148 100 48.6328 100 52.3438ZM47.8711 67.4023L68.5156 36.4844C69.043 35.6641 69.1992 34.7656 69.0234 33.8086C68.8281 32.8516 68.3398 32.0898 67.5195 31.582C66.6992 31.0547 65.8008 30.8789 64.8438 31.0156C63.8672 31.1719 63.0859 31.6406 62.5 32.4609L44.3164 59.8047L35.9375 51.4453C35.1953 50.7031 34.3359 50.3516 33.3789 50.3906C32.4023 50.4297 31.5625 50.7812 30.8203 51.4453C30.1563 52.1094 29.8242 52.9492 29.8242 53.9648C29.8242 54.9609 30.1563 55.8008 30.8203 56.4844L42.3242 67.9883L42.8906 68.4375C43.5547 68.8867 44.2383 69.1016 44.9023 69.1016C46.2109 69.082 47.207 68.5352 47.8711 67.4023Z"
          fill="currentColor"
        />
      </svg>
    </span>
  );
}
