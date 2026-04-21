import type { ProfileRow } from "../../lib/registry.ts";
import { useT } from "../../i18n/mod.ts";

interface Props {
  profile: ProfileRow;
}

/**
 * The profile card is the primary surface of /explore. The whole card
 * is clickable and lands the visitor on the project's `mainLink` (the
 * actual app/service/page) — a small top-right arrow signals the
 * external destination. Legacy records that pre-date `mainLink` fall
 * back to the local /explore/<handle> detail page so the card never
 * 404s, just degrades gracefully.
 */
export default function ProfileCard({ profile }: Props) {
  const t = useT();
  const tCat = t.categories as Record<string, string>;
  const cats = profile.categories.slice(0, 3);
  const featured = profile.featured;

  const isExternal = !!profile.mainLink;
  const href = profile.mainLink ??
    `/explore/${encodeURIComponent(profile.handle)}`;

  return (
    <a
      href={href}
      class="glass profile-card profile-card-button"
      {...(isExternal
        ? { target: "_blank", rel: "noopener noreferrer external" }
        : {})}
    >
      <span class="profile-card-arrow" aria-hidden="true">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <line x1="7" y1="17" x2="17" y2="7"></line>
          <polyline points="9 7 17 7 17 15"></polyline>
        </svg>
      </span>

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
