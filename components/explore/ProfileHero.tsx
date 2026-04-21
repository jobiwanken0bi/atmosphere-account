import type { ProfileRow } from "../../lib/registry.ts";
import { useT } from "../../i18n/mod.ts";

interface Props {
  profile: ProfileRow;
}

export default function ProfileHero({ profile }: Props) {
  const t = useT();
  const tCat = t.categories as Record<string, string>;
  const tSub = t.subcategories as Record<string, string>;
  const tBadges = t.badges;
  const featured = profile.featured;
  const cats = profile.categories;

  return (
    <div class="profile-hero glass">
      <div class="profile-hero-avatar">
        {profile.avatarCid
          ? (
            <img
              src={`/api/registry/avatar/${encodeURIComponent(profile.did)}`}
              alt={profile.name}
            />
          )
          : (
            <div class="profile-hero-avatar-fallback" aria-hidden="true">
              {profile.name.slice(0, 1).toUpperCase()}
            </div>
          )}
      </div>
      <div class="profile-hero-body">
        <div class="profile-hero-name-row">
          <h1 class="profile-hero-name">{profile.name}</h1>
          {featured?.badges?.includes("official") && (
            <span class="profile-badge profile-badge--official">
              {tBadges.official}
            </span>
          )}
          {featured?.badges?.includes("verified") &&
            !featured.badges.includes("official") && (
            <span class="profile-badge profile-badge--verified">
              {tBadges.verified}
            </span>
          )}
        </div>
        <p class="profile-hero-handle">@{profile.handle}</p>
        <div class="profile-hero-meta">
          {cats.map((c) => (
            <span key={c} class="profile-card-category">
              {tCat[c] ?? c}
            </span>
          ))}
          {profile.license?.type === "openSource" && (
            <span class="profile-card-sub profile-card-sub--oss">
              {t.explore.detail.openSourceBadge}
            </span>
          )}
          {profile.subcategories.map((s) => (
            <span key={s} class="profile-card-sub">
              {tSub[s] ?? s}
            </span>
          ))}
        </div>
        <p class="profile-hero-description">{profile.description}</p>
      </div>
    </div>
  );
}
