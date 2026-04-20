import type { ProfileRow } from "../../lib/registry.ts";
import { getBskyClient } from "../../lib/bsky-clients.ts";
import { useT } from "../../i18n/mod.ts";

interface Props {
  profile: ProfileRow;
}

function trimUrlForDisplay(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname.replace(/\/$/, "")}`;
  } catch {
    return url;
  }
}

export default function ProfileLinks({ profile }: Props) {
  const t = useT().explore.detail;
  const client = getBskyClient(profile.bskyClient);
  const bskyHref = client.profileUrl(profile.handle);

  return (
    <div class="profile-actions">
      <a
        class="profile-action profile-action--primary"
        href={bskyHref}
        target="_blank"
        rel="noopener noreferrer"
      >
        <img
          src={client.iconUrl}
          alt=""
          class="profile-action-icon"
          loading="lazy"
          decoding="async"
        />
        <span class="profile-action-label">
          <span class="profile-action-title">
            {t.openOn} {client.name}
          </span>
          <span class="profile-action-sub">{client.domain}</span>
        </span>
      </a>
      {profile.website && (
        <a
          class="profile-action"
          href={profile.website}
          target="_blank"
          rel="noopener noreferrer"
        >
          <span class="profile-action-icon profile-action-icon--glyph">
            ↗
          </span>
          <span class="profile-action-label">
            <span class="profile-action-title">{t.website}</span>
            <span class="profile-action-sub">
              {trimUrlForDisplay(profile.website)}
            </span>
          </span>
        </a>
      )}
    </div>
  );
}
