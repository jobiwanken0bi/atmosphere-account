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
 * Renders the public profile's action buttons. We iterate `profile.links`
 * in author-defined order and resolve each entry to a render-ready
 * bundle via `resolveLink`. The resolver tags each link with an
 * optional `iconKind` so we can render the on-brand inline SVG (which
 * inherits the site's blue via currentColor) for known services, while
 * still falling back to favicons / glyphs for everything else.
 *
 * URL subtitles are intentionally hidden for atmosphere services and
 * the website button — the title alone is enough; the URL is a
 * destination, not metadata. Custom links keep their subtitle so the
 * user knows where they're going.
 */
export default function ProfileLinks({ profile }: Props) {
  const t = useT();
  const tLink = t.linkKinds;

  const resolved = profile.links
    .map((entry) => resolveLink(entry, profile.handle, tLink))
    .filter((r): r is NonNullable<typeof r> => r !== null);

  if (resolved.length === 0) return null;

  return (
    <div class="profile-actions">
      {resolved.map((r, i) => (
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
