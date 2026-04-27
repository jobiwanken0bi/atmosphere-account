import { define } from "../../utils.ts";
import Nav from "../../components/Nav.tsx";
import GlassClouds from "../../components/GlassClouds.tsx";
import Footer from "../../components/Footer.tsx";
import { getMessages } from "../../i18n/mod.ts";
import { buildAccountMenuProps } from "../../lib/account-menu-props.ts";
import { getAppUserByHandle } from "../../lib/account-types.ts";
import { getBskyClient } from "../../lib/bsky-clients.ts";

function bskyCdnAvatarUrl(did: string, cid: string, mime: string): string {
  const ext = mime === "image/png"
    ? "png"
    : mime === "image/webp"
    ? "webp"
    : "jpeg";
  return `https://cdn.bsky.app/img/avatar/plain/${did}/${cid}@${ext}`;
}

export const handler = define.handlers({
  async GET(ctx) {
    const handle = decodeURIComponent(ctx.params.handle ?? "").trim()
      .toLowerCase();
    const profile = handle
      ? await getAppUserByHandle(handle).catch(() => null)
      : null;
    return ctx.render(
      <UserProfilePage
        account={buildAccountMenuProps(ctx.state)}
        profile={profile?.accountType === "user" ? profile : null}
        t={getMessages(ctx.state.locale)}
      />,
      { status: profile?.accountType === "user" ? 200 : 404 },
    );
  },
});

interface UserProfilePageProps {
  account: ReturnType<typeof buildAccountMenuProps>;
  profile: Awaited<ReturnType<typeof getAppUserByHandle>>;
  // deno-lint-ignore no-explicit-any
  t: any;
}

function UserProfilePage({ account, profile, t }: UserProfilePageProps) {
  const copy = t.userProfile;
  if (!profile) {
    return (
      <div id="page-top">
        <GlassClouds />
        <div class="content-layer">
          <Nav account={account} showEffects={false} />
          <section class="user-public-section">
            <div class="container" style={{ maxWidth: "640px" }}>
              <div class="glass user-public-card">
                <h1 class="text-section">{copy.notFoundTitle}</h1>
                <p class="text-body mt-2">{copy.notFoundBody}</p>
              </div>
            </div>
          </section>
          <Footer variant="compact" />
        </div>
      </div>
    );
  }

  const displayName = profile.displayName || profile.handle;
  const avatarUrl = profile.avatarCid && profile.avatarMime
    ? bskyCdnAvatarUrl(profile.did, profile.avatarCid, profile.avatarMime)
    : null;
  const client = getBskyClient(profile.bskyClientId);
  return (
    <div id="page-top">
      <GlassClouds />
      <div class="content-layer">
        <Nav account={account} showEffects={false} />
        <section class="user-public-section">
          <div class="container" style={{ maxWidth: "720px" }}>
            <p>
              <a href="/explore" class="text-link-button">
                ← {copy.backToExplore}
              </a>
            </p>
            <div class="glass user-public-card">
              <div class="user-public-avatar">
                {avatarUrl
                  ? <img src={avatarUrl} alt="" />
                  : <span>{displayName.slice(0, 1).toUpperCase()}</span>}
              </div>
              <div class="user-public-body">
                <h1 class="text-section">{displayName}</h1>
                <p class="user-profile-handle">@{profile.handle}</p>
                {profile.bio && (
                  <p class="text-body user-profile-bio">{profile.bio}</p>
                )}
                <a
                  class="profile-hero-action user-public-client-link"
                  href={client.profileUrl(profile.handle)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <span class="profile-hero-action-icon">
                    <img src={client.iconUrl} alt="" />
                  </span>
                  <span>{copy.openIn(client.name)}</span>
                  <span class="profile-hero-action-arrow" aria-hidden="true">
                    ↗
                  </span>
                </a>
              </div>
            </div>
          </div>
        </section>
        <Footer variant="compact" />
      </div>
    </div>
  );
}
