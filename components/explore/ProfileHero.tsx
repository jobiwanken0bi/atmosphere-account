import type { ProfileRow } from "../../lib/registry.ts";
import { PUBLIC_CATEGORIES } from "../../lib/lexicons.ts";
import { useT } from "../../i18n/mod.ts";
import VerifiedBadge from "../VerifiedBadge.tsx";
import WebsiteIcon from "../icons/WebsiteIcon.tsx";
import { AndroidIcon, AppleIcon } from "../icons/PlatformIcons.tsx";

interface Props {
  profile: ProfileRow;
}

/**
 * Profile detail hero. Primary app destinations live in a right-side rail;
 * secondary Atmosphere/custom links render below the card.
 */
export default function ProfileHero({ profile }: Props) {
  const t = useT();
  const tCat = t.categories as Record<string, string>;
  const tSub = t.subcategories as Record<string, string>;
  const tBadges = t.badges;
  const tLink = t.linkKinds;
  const featured = profile.featured;
  const publicCategories = profile.categories.filter((c) =>
    (PUBLIC_CATEGORIES as readonly string[]).includes(c)
  );
  const appSubcategories = publicCategories.includes("app")
    ? profile.subcategories
    : [];
  const primaryLinks = [
    profile.mainLink
      ? {
        title: tLink.website,
        href: profile.mainLink,
        icon: <WebsiteIcon class="profile-hero-action-icon-svg" />,
      }
      : null,
    profile.iosLink
      ? {
        title: "iOS",
        href: profile.iosLink,
        icon: <AppleIcon class="profile-hero-action-icon-svg" />,
      }
      : null,
    profile.androidLink
      ? {
        title: "Android",
        href: profile.androidLink,
        icon: <AndroidIcon class="profile-hero-action-icon-svg" />,
      }
      : null,
  ].filter((link): link is NonNullable<typeof link> => link !== null);

  return (
    <div class="profile-hero glass">
      <div class="profile-hero-avatar">
        {profile.avatarCid
          ? (
            <img
              src={`/api/registry/avatar/${encodeURIComponent(profile.did)}`}
              alt={profile.name}
              decoding="async"
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
          {profile.iconAccessStatus === "granted" && (
            <VerifiedBadge
              size={22}
            />
          )}
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
        {(publicCategories.length > 0 || appSubcategories.length > 0) && (
          <div class="profile-hero-meta">
            {publicCategories.length > 0 && (
              <div class="profile-card-categories">
                {publicCategories.map((c) => (
                  <span key={c} class="profile-card-category">
                    {tCat[c] ?? c}
                  </span>
                ))}
              </div>
            )}
            {appSubcategories.length > 0 && (
              <div class="profile-card-subcategories">
                {appSubcategories.map((s) => (
                  <span key={s} class="profile-card-sub">
                    {tSub[s] ?? s}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
        {profile.description && (
          <p class="profile-hero-description">{profile.description}</p>
        )}
      </div>
      {primaryLinks.length > 0 && (
        <div class="profile-hero-actions" aria-label="Primary links">
          {primaryLinks.map((link) => (
            <a
              class="profile-hero-action"
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              key={link.href}
            >
              <span class="profile-hero-action-icon">{link.icon}</span>
              <span>{link.title}</span>
              <span class="profile-hero-action-arrow" aria-hidden="true">
                ↗
              </span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
