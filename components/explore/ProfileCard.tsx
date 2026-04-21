import type { ProfileRow } from "../../lib/registry.ts";
import { useT } from "../../i18n/mod.ts";

interface Props {
  profile: ProfileRow;
}

export default function ProfileCard({ profile }: Props) {
  const t = useT();
  const tCat = t.categories as Record<string, string>;
  /** Show every category the project applies to (e.g. "App + Account
   *  provider"), capped to keep the card from getting busy. */
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
        <p class="profile-card-description">{profile.description}</p>
        <p class="profile-card-meta">
          {cats.map((c) => (
            <span key={c} class="profile-card-category">
              {tCat[c] ?? c}
            </span>
          ))}
          {profile.openSource && (
            <span class="profile-card-sub profile-card-sub--oss">
              {t.explore.detail.openSourceBadge}
            </span>
          )}
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
