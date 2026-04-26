import type { ProfileRow } from "../../lib/registry.ts";
import {
  type ResolvedIconKind,
  resolveLink,
} from "../../lib/atmosphere-links.ts";
import { useT } from "../../i18n/mod.ts";
import BskyIcon from "../icons/BskyIcon.tsx";
import TangledIcon from "../icons/TangledIcon.tsx";
import WebsiteIcon from "../icons/WebsiteIcon.tsx";

interface Props {
  profile: ProfileRow;
}

/**
 * Renders the public profile's action buttons. Top-level app destinations
 * (`mainLink`, `iosLink`, `androidLink`) always render first as Web / iOS /
 * Android buttons. Then we iterate `profile.links` in author-defined order
 * for Atmosphere and custom links.
 *
 * URL subtitles are intentionally hidden for atmosphere services and
 * platform buttons — the title alone is enough; the URL is a destination,
 * not metadata.
 */
export default function ProfileLinks({ profile }: Props) {
  const t = useT();
  const tLink = t.linkKinds;

  const appLinks = [
    profile.mainLink
      ? {
        title: tLink.website,
        subtitle: "",
        iconUrl: null,
        glyph: "↗",
        href: profile.mainLink,
        iconKind: "website" as const,
      }
      : null,
    profile.iosLink
      ? {
        title: "iOS",
        subtitle: "",
        iconUrl: null,
        glyph: "iOS",
        href: profile.iosLink,
        iconKind: "ios" as const,
      }
      : null,
    profile.androidLink
      ? {
        title: "Android",
        subtitle: "",
        iconUrl: null,
        glyph: "A",
        href: profile.androidLink,
        iconKind: "android" as const,
      }
      : null,
  ].filter((r): r is NonNullable<typeof r> => r !== null);

  const resolved = profile.links
    // The form no longer emits `website`; old records may still carry it
    // as the former Landing Page button, which should no longer render.
    .filter((entry) => entry.kind !== "website")
    .map((entry) => resolveLink(entry, profile.handle, tLink))
    .filter((r): r is NonNullable<typeof r> => r !== null);

  const actions = [...appLinks, ...resolved];

  if (actions.length === 0) return null;

  return (
    <div class="profile-actions">
      {actions.map((r, i) => (
        <a
          class={i === 0
            ? "profile-action profile-action--primary"
            : "profile-action"}
          href={r.href}
          target="_blank"
          rel="noopener noreferrer"
          key={`${r.href}-${i}`}
        >
          {renderIcon(r.iconKind, r.iconUrl, r.glyph)}
          <span class="profile-action-label">
            <span class="profile-action-title">{r.title}</span>
          </span>
        </a>
      ))}
    </div>
  );
}

/**
 * Pick the right icon renderer in priority order:
 *   1. branded inline SVG (matches site palette via currentColor)
 *   2. external favicon URL (e.g. alt Bluesky clients)
 *   3. text glyph fallback
 */
function renderIcon(
  iconKind: ResolvedIconKind | undefined,
  iconUrl: string | null,
  glyph: string,
) {
  if (iconKind === "bsky") {
    return (
      <span class="profile-action-icon profile-action-icon--brand">
        <BskyIcon class="profile-action-icon-svg" />
      </span>
    );
  }
  if (iconKind === "tangled") {
    return (
      <span class="profile-action-icon profile-action-icon--brand">
        <TangledIcon class="profile-action-icon-svg" />
      </span>
    );
  }
  if (iconKind === "website") {
    return (
      <span class="profile-action-icon profile-action-icon--brand">
        <WebsiteIcon class="profile-action-icon-svg" />
      </span>
    );
  }
  if (iconKind === "ios") {
    return (
      <span class="profile-action-icon profile-action-icon--brand">
        <AppleIcon class="profile-action-icon-svg" />
      </span>
    );
  }
  if (iconKind === "android") {
    return (
      <span class="profile-action-icon profile-action-icon--brand">
        <AndroidIcon class="profile-action-icon-svg" />
      </span>
    );
  }
  if (iconUrl) {
    return (
      <img
        src={iconUrl}
        alt=""
        class="profile-action-icon"
        loading="lazy"
        decoding="async"
      />
    );
  }
  return (
    <span class="profile-action-icon profile-action-icon--glyph">{glyph}</span>
  );
}

function AppleIcon({ class: className }: { class?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      class={className}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M16.53 12.52c-.02-2.1 1.72-3.12 1.8-3.17-1.01-1.48-2.55-1.68-3.08-1.7-1.29-.13-2.54.77-3.19.77-.67 0-1.68-.75-2.76-.73-1.4.02-2.7.83-3.42 2.1-1.48 2.56-.38 6.32 1.04 8.39.71 1.02 1.54 2.16 2.62 2.12 1.06-.04 1.46-.68 2.74-.68 1.27 0 1.64.68 2.76.66 1.14-.02 1.86-1.03 2.54-2.06.82-1.17 1.14-2.32 1.15-2.38-.02-.01-2.18-.84-2.2-3.32Z" />
      <path d="M14.4 6.28c.57-.71.96-1.67.85-2.64-.82.04-1.84.57-2.43 1.26-.52.61-.99 1.61-.86 2.55.92.07 1.85-.47 2.44-1.17Z" />
    </svg>
  );
}

function AndroidIcon({ class: className }: { class?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      class={className}
      fill="none"
      stroke="currentColor"
      stroke-width="1.7"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M7.5 9.5h9a3 3 0 0 1 3 3v4.25a1.75 1.75 0 0 1-1.75 1.75H6.25a1.75 1.75 0 0 1-1.75-1.75V12.5a3 3 0 0 1 3-3Z" />
      <path d="M8 9.5 6.5 6.75" />
      <path d="m16 9.5 1.5-2.75" />
      <path d="M8.25 14h.01" />
      <path d="M15.75 14h.01" />
      <path d="M8 18.5v1.75" />
      <path d="M16 18.5v1.75" />
    </svg>
  );
}
