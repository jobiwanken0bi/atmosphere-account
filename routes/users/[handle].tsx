import { define } from "../../utils.ts";
import Nav from "../../components/Nav.tsx";
import Footer from "../../components/Footer.tsx";
import { getMessages } from "../../i18n/mod.ts";
import { buildAccountMenuProps } from "../../lib/account-menu-props.ts";
import { getAppUserByHandle } from "../../lib/account-types.ts";
import { getBskyClient } from "../../lib/bsky-clients.ts";
import { getProfileByHandle } from "../../lib/registry.ts";

function bskyCdnAvatarUrl(did: string, cid: string): string {
  return `https://cdn.bsky.app/img/avatar/plain/${did}/${cid}`;
}

export const handler = define.handlers({
  async GET(ctx) {
    const handle = decodeURIComponent(ctx.params.handle ?? "").trim()
      .toLowerCase();
    const [profile, appUser] = handle
      ? await Promise.all([
        getProfileByHandle(handle, { profileType: "user" }).catch(() => null),
        getAppUserByHandle(handle).catch(() => null),
      ])
      : [null, null];
    return ctx.render(
      <UserProfilePage
        account={buildAccountMenuProps(ctx.state)}
        profile={profile}
        bskyClientId={appUser?.bskyClientId ?? null}
        bskyButtonVisible={appUser?.bskyButtonVisible ?? true}
        t={getMessages(ctx.state.locale)}
      />,
      { status: profile ? 200 : 404 },
    );
  },
});

interface UserProfilePageProps {
  account: ReturnType<typeof buildAccountMenuProps>;
  profile: Awaited<ReturnType<typeof getProfileByHandle>>;
  bskyClientId: string | null;
  bskyButtonVisible: boolean;
  // deno-lint-ignore no-explicit-any
  t: any;
}

function UserProfilePage(
  { account, profile, bskyClientId, bskyButtonVisible, t }:
    UserProfilePageProps,
) {
  const copy = t.userProfile;
  if (!profile) {
    return (
      <div id="page-top">
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

  const displayName = profile.name || profile.handle;
  const avatarUrl = profile.avatarCid && profile.avatarMime
    ? bskyCdnAvatarUrl(profile.did, profile.avatarCid)
    : null;
  const client = getBskyClient(bskyClientId);
  return (
    <div id="page-top">
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
              <div class="user-public-media">
                <div class="user-public-avatar">
                  {avatarUrl
                    ? <img src={avatarUrl} alt="" decoding="async" />
                    : <span>{displayName.slice(0, 1).toUpperCase()}</span>}
                </div>
                {bskyButtonVisible && (
                  <a
                    class="profile-action profile-action--compact user-public-client-link"
                    href={client.profileUrl(profile.handle)}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={copy.openIn(client.name)}
                    title={copy.openIn(client.name)}
                  >
                    <img
                      src={client.iconUrl}
                      alt=""
                      class="profile-action-icon"
                      loading="lazy"
                      decoding="async"
                    />
                  </a>
                )}
              </div>
              <div class="user-public-body">
                <h1 class="text-section">{displayName}</h1>
                <p class="user-profile-handle">@{profile.handle}</p>
                {profile.description && (
                  <p class="text-body user-profile-bio">
                    {profile.description}
                  </p>
                )}
              </div>
            </div>
          </div>
        </section>
        <Footer variant="compact" />
      </div>
    </div>
  );
}
