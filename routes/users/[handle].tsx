import { define } from "../../utils.ts";
import Nav from "../../components/Nav.tsx";
import Footer from "../../components/Footer.tsx";
import AtmosphereHandle from "../../components/AtmosphereHandle.tsx";
import WebsiteIcon from "../../components/icons/WebsiteIcon.tsx";
import { getMessages } from "../../i18n/mod.ts";
import { buildAccountMenuProps } from "../../lib/account-menu-props.ts";
import { getAppUser, getAppUserByHandle } from "../../lib/account-types.ts";
import { bskyCdnAvatarUrl } from "../../lib/avatar.ts";
import { getProfileMicroblogViewer } from "../../lib/bsky-clients.ts";
import { getProfileByHandle } from "../../lib/registry.ts";
import { safePublicProfileWebsiteUrl } from "../../lib/user-profile-links.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const handle = decodeURIComponent(ctx.params.handle ?? "").trim()
      .toLowerCase();
    const [profile, profileOwner, viewer] = handle
      ? await Promise.all([
        getProfileByHandle(handle, { profileType: "user" }).catch(() => null),
        getAppUserByHandle(handle).catch(() => null),
        ctx.state.user
          ? getAppUser(ctx.state.user.did).catch(() => null)
          : Promise.resolve(null),
      ])
      : [null, null, null];
    return ctx.render(
      <UserProfilePage
        account={buildAccountMenuProps(ctx.state)}
        profile={profile}
        microblogViewerClientId={viewer?.accountType === "user"
          ? viewer.bskyClientId
          : null}
        microblogButtonVisible={profileOwner?.bskyButtonVisible ?? true}
        t={getMessages(ctx.state.locale)}
      />,
      { status: profile ? 200 : 404 },
    );
  },
});

interface UserProfilePageProps {
  account: ReturnType<typeof buildAccountMenuProps>;
  profile: Awaited<ReturnType<typeof getProfileByHandle>>;
  microblogViewerClientId: string | null;
  microblogButtonVisible: boolean;
  // deno-lint-ignore no-explicit-any
  t: any;
}

function UserProfilePage(
  { account, profile, microblogViewerClientId, microblogButtonVisible, t }:
    UserProfilePageProps,
) {
  const copy = t.userProfile;
  if (!profile) {
    return (
      <div id="page-top">
        <div class="content-layer">
          <Nav account={account} />
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
  const client = getProfileMicroblogViewer(microblogViewerClientId);
  const websiteUrl = safePublicProfileWebsiteUrl(profile.mainLink);
  return (
    <div id="page-top">
      <div class="content-layer">
        <Nav account={account} />
        <section class="user-public-section">
          <div class="container" style={{ maxWidth: "720px" }}>
            <p>
              <a href="/apps" class="text-link-button">
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
                {microblogButtonVisible && (
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
                <p class="user-profile-handle">
                  <AtmosphereHandle handle={profile.handle} />
                </p>
                {profile.description && (
                  <p class="text-body user-profile-bio">
                    {profile.description}
                  </p>
                )}
                {websiteUrl && (
                  <div class="profile-actions user-public-actions">
                    <a
                      href={websiteUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      class="profile-action"
                    >
                      <span class="profile-action-icon profile-action-icon--brand">
                        <WebsiteIcon class="profile-action-icon-svg" />
                      </span>
                      <span class="profile-action-label">
                        <span class="profile-action-title">Website</span>
                      </span>
                    </a>
                  </div>
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
