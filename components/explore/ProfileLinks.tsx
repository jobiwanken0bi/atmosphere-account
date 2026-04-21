import type { ProfileRow } from "../../lib/registry.ts";
import { resolveLink } from "../../lib/atmosphere-links.ts";
import { useT } from "../../i18n/mod.ts";

interface Props {
  profile: ProfileRow;
}

/**
 * Renders the public profile's action buttons. We iterate `profile.links`
 * in author-defined order and resolve each entry to a render-ready
 * bundle via `resolveLink` (which knows about atmosphere kinds, custom
 * websites, etc.). The handle is passed in so atmosphere kinds can
 * derive their default URL from it.
 *
 * Buttons are visually consistent — the first one in the list naturally
 * becomes the "primary" CTA via the `:first-child` selector in CSS.
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
          class={i === 0 ? "profile-action profile-action--primary" : "profile-action"}
          href={r.href}
          target="_blank"
          rel="noopener noreferrer"
          key={`${r.href}-${i}`}
        >
          {r.iconUrl
            ? (
              <img
                src={r.iconUrl}
                alt=""
                class="profile-action-icon"
                loading="lazy"
                decoding="async"
              />
            )
            : (
              <span class="profile-action-icon profile-action-icon--glyph">
                {r.glyph}
              </span>
            )}
          <span class="profile-action-label">
            <span class="profile-action-title">{r.title}</span>
            <span class="profile-action-sub">{r.subtitle}</span>
          </span>
        </a>
      ))}
    </div>
  );
}
