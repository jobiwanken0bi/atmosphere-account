import type { ProfileRow } from "../../lib/registry.ts";
import { useT } from "../../i18n/mod.ts";

interface Props {
  profile: ProfileRow;
}

interface LinkRow {
  href: string;
  label: string;
  value: string;
  external?: boolean;
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
  const links: LinkRow[] = [];
  if (profile.website) {
    links.push({
      href: profile.website,
      label: t.website,
      value: trimUrlForDisplay(profile.website),
      external: true,
    });
  }
  if (profile.supportUrl) {
    links.push({
      href: profile.supportUrl,
      label: t.support,
      value: trimUrlForDisplay(profile.supportUrl),
      external: true,
    });
  }
  if (profile.bskyHandle) {
    links.push({
      href: `https://bsky.app/profile/${
        encodeURIComponent(profile.bskyHandle)
      }`,
      label: t.bsky,
      value: `@${profile.bskyHandle}`,
      external: true,
    });
  }
  if (profile.atmosphereHandle) {
    links.push({
      href: `https://${profile.atmosphereHandle}`,
      label: t.atmosphere,
      value: profile.atmosphereHandle,
      external: true,
    });
  }
  if (links.length === 0) return null;
  return (
    <div class="profile-links">
      {links.map((l) => (
        <a
          key={`${l.label}-${l.href}`}
          href={l.href}
          target={l.external ? "_blank" : undefined}
          rel={l.external ? "noopener noreferrer" : undefined}
          class="profile-link"
        >
          <span class="profile-link-label">{l.label}</span>
          <span class="profile-link-value">{l.value}</span>
        </a>
      ))}
    </div>
  );
}
