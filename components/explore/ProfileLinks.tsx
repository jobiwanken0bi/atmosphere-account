import type { ProfileRow } from "../../lib/registry.ts";
import { getBskyClient } from "../../lib/bsky-clients.ts";
import { resolveLink } from "../../lib/link-kinds.ts";
import { useT } from "../../i18n/mod.ts";

interface Props {
  profile: ProfileRow;
}

/**
 * Renders the public profile's action buttons:
 *   1. The Bluesky button (always shown — every Atmosphere account has one).
 *   2. Each entry from `profile.links`, in author-defined order.
 *   3. A "View license" button when the joined license row provides a URL.
 *
 * Link kind → icon/label mapping lives in `lib/link-kinds.ts` so the
 * editor (CreateProfileForm) and this view stay in sync.
 */
export default function ProfileLinks({ profile }: Props) {
  const t = useT();
  const tDetail = t.explore.detail;
  const tLink = t.linkKinds;
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
            {tDetail.openOn} {client.name}
          </span>
          <span class="profile-action-sub">{client.domain}</span>
        </span>
      </a>

      {profile.links.map((entry) => {
        const r = resolveLink(entry, tLink);
        return (
          <a
            class="profile-action"
            href={r.url}
            target="_blank"
            rel="noopener noreferrer"
            key={r.url}
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
        );
      })}

      {profile.license?.licenseUrl && (
        <a
          class="profile-action"
          href={profile.license.licenseUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          <span class="profile-action-icon profile-action-icon--glyph">©</span>
          <span class="profile-action-label">
            <span class="profile-action-title">
              {tDetail.license.viewLicense}
            </span>
            <span class="profile-action-sub">
              {profile.license.spdxId ??
                (t.licenseTypes as Record<string, string>)[
                  profile.license.type
                ] ?? profile.license.type}
            </span>
          </span>
        </a>
      )}
    </div>
  );
}
