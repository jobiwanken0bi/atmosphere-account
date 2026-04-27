import type { ProfileRow } from "../../lib/registry.ts";
import { useT } from "../../i18n/mod.ts";
import VerifiedBadge from "../VerifiedBadge.tsx";

interface Props {
  profile: ProfileRow;
}

/**
 * Listing-grid card. Clicking the card opens the project's profile
 * detail page (/explore/<handle>) — visitors get the description,
 * Atmosphere services, Web / iOS / Android links, and any custom buttons
 * on the detail page.
 */
export default function ProfileCard({ profile }: Props) {
  const t = useT();
  const tCat = t.categories as Record<string, string>;
  const cats = profile.categories.slice(0, 3);
  const featured = profile.featured;

  return (
    <a
      href={`/explore/${encodeURIComponent(profile.handle)}`}
      class="glass profile-card"
    >
      <div class="profile-card-avatar">
        {profile.avatarCid
          ? (
            <img
              src={`/api/registry/avatar/${encodeURIComponent(profile.did)}`}
              alt=""
              loading="lazy"
            />
          )
          : (
            <div class="profile-card-avatar-fallback" aria-hidden="true">
              {profile.name.slice(0, 1).toUpperCase()}
            </div>
          )}
      </div>
      <div class="profile-card-body">
        <div class="profile-card-title-row">
          <h3 class="profile-card-name">{profile.name}</h3>
          {profile.iconAccessStatus === "granted" && (
            <VerifiedBadge
              size={16}
            />
          )}
          {featured?.badges?.includes("official") && (
            <span class="profile-badge profile-badge--official">
              {t.badges.official}
            </span>
          )}
          {featured?.badges?.includes("verified") &&
            !featured.badges.includes("official") && (
            <span class="profile-badge profile-badge--verified">
              {t.badges.verified}
            </span>
          )}
        </div>
        <p class="profile-card-handle">@{profile.handle}</p>
        {profile.description && (
          <p class="profile-card-description">{profile.description}</p>
        )}
        <p class="profile-card-meta">
          {cats.map((c) => (
            <span key={c} class="profile-card-category">
              {tCat[c] ?? c}
            </span>
          ))}
          {profile.subcategories.slice(0, 2).map((s) => {
            const sub = (t.subcategories as Record<string, string>)[s] ?? s;
            return (
              <span key={s} class="profile-card-sub">
                {sub}
              </span>
            );
          })}
        </p>
      </div>
    </a>
  );
}
