import type { ProfileRow } from "../../lib/registry.ts";
import {
  type ResolvedIconKind,
  resolveLink,
} from "../../lib/atmosphere-links.ts";
import { useT } from "../../i18n/mod.ts";
import BskyIcon from "../icons/BskyIcon.tsx";
import TangledIcon from "../icons/TangledIcon.tsx";

interface Props {
  profile: ProfileRow;
}

/**
 * Renders secondary public profile links. Primary destinations (`mainLink`,
 * `iosLink`, `androidLink`) live inside the hero card.
 *
 * URL subtitles are intentionally hidden for these buttons — the title alone
 * is enough; the URL is a destination, not metadata.
 */
export default function ProfileLinks({ profile }: Props) {
  const t = useT();
  const tLink = t.linkKinds;

  const resolved = profile.links
    // The form no longer emits `website`; old records may still carry it
    // as the former Landing Page button, which should no longer render.
    .filter((entry) => entry.kind !== "website")
    .map((entry) => resolveLink(entry, profile.handle, tLink))
    .filter((r): r is NonNullable<typeof r> => r !== null);

  const actions = resolved;

  if (actions.length === 0) return null;

  return (
    <div class="profile-actions">
      {actions.map((r, i) => {
        const compact = r.iconKind === "bsky" || r.iconKind === "tangled";
        return (
          <a
            class={compact
              ? "profile-action profile-action--compact"
              : "profile-action"}
            href={r.href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={compact ? r.title : undefined}
            title={compact ? r.title : undefined}
            key={`${r.href}-${i}`}
          >
            {renderIcon(r.iconKind, r.iconUrl, r.glyph)}
            {!compact && (
              <span class="profile-action-label">
                <span class="profile-action-title">{r.title}</span>
              </span>
            )}
          </a>
        );
      })}
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
