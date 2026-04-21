import type { ProfileRow } from "../../lib/registry.ts";
import { useT } from "../../i18n/mod.ts";

interface Props {
  profile: ProfileRow;
}

/**
 * Profile detail hero. When the project has a `mainLink` (the actual
 * app/service URL), the whole hero becomes a button that opens that
 * destination in a new tab — the diagonal arrow in the top-right
 * corner is the affordance. Records without a mainLink (legacy or
 * deliberately empty) render the same content as a static panel so
 * the page still reads correctly.
 */
export default function ProfileHero({ profile }: Props) {
  const t = useT();
  const tCat = t.categories as Record<string, string>;
  const tSub = t.subcategories as Record<string, string>;
  const tBadges = t.badges;
  const featured = profile.featured;
  const cats = profile.categories;
  const hasMainLink = !!profile.mainLink;

  const inner = (
    <>
      {hasMainLink && (
        <span class="profile-hero-arrow" aria-hidden="true">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.4"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <line x1="7" y1="17" x2="17" y2="7"></line>
            <polyline points="9 7 17 7 17 15"></polyline>
          </svg>
        </span>
      )}
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
          {profile.subcategories.map((s) => (
            <span key={s} class="profile-card-sub">
              {tSub[s] ?? s}
            </span>
          ))}
        </div>
        <p class="profile-hero-description">{profile.description}</p>
      </div>
    </>
  );

  if (hasMainLink) {
    return (
      <a
        href={profile.mainLink!}
        target="_blank"
        rel="noopener noreferrer external"
        class="profile-hero glass profile-hero-button"
      >
        {inner}
      </a>
    );
  }
  return <div class="profile-hero glass">{inner}</div>;
}
