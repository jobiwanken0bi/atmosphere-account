import { define } from "../../utils.ts";
import Nav from "../../components/Nav.tsx";
import GlassClouds from "../../components/GlassClouds.tsx";
import Footer from "../../components/Footer.tsx";
import ProfileHero from "../../components/explore/ProfileHero.tsx";
import ProfileLinks from "../../components/explore/ProfileLinks.tsx";
import { getMessages } from "../../i18n/mod.ts";
import type { Locale } from "../../i18n/mod.ts";
import {
  getProfileByDid,
  getProfileByHandle,
  type ProfileRow,
} from "../../lib/registry.ts";
import { accountProviderName } from "../../lib/account-providers.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const handle = decodeURIComponent(ctx.params.handle).toLowerCase();
    const user = ctx.state.user;
    /** Pull the profile being viewed and (in parallel) the signed-in
     *  user's own registry entry so the AccountMenu can deep-link to
     *  their public page. The lookups are cheap and trigger from the
     *  same DB connection. */
    const [profile, ownerProfile] = await Promise.all([
      getProfileByHandle(handle).catch(() => null),
      user ? getProfileByDid(user.did).catch(() => null) : Promise.resolve(
        null,
      ),
    ]);
    return ctx.render(
      <ProfileDetailPage
        profile={profile}
        signedInUser={user
          ? { did: user.did, handle: user.handle }
          : null}
        ownerHandle={ownerProfile?.handle ?? null}
        locale={ctx.state.locale}
      />,
      { status: profile ? 200 : 404 },
    );
  },
});

interface DetailProps {
  profile: ProfileRow | null;
  signedInUser: { did: string; handle: string } | null;
  ownerHandle: string | null;
  locale: Locale;
}

function ProfileDetailPage(
  { profile, signedInUser, ownerHandle, locale }: DetailProps,
) {
  const t = getMessages(locale).explore;
  if (!profile) {
    return (
      <NotFound
        locale={locale}
        signedInUser={signedInUser}
        ownerHandle={ownerHandle}
      />
    );
  }
  const isOwner = signedInUser?.did === profile.did;
  const account = {
    user: signedInUser,
    avatarUrl: signedInUser ? "/api/me/avatar" : null,
    publicProfileHandle: ownerHandle,
  };
  const lastUpdated = new Date(profile.indexedAt).toISOString().slice(0, 10);
  /** PDS hosts are usually per-shard (e.g. shimeji.us-east.host.bsky.network)
   *  which isn't useful in UI. Collapse known umbrella PDSes to their
   *  brand name (Bluesky, etc.) and fall back to the bare host. */
  const providerName = accountProviderName(profile.pdsUrl);
  return (
    <div id="page-top">
      <GlassClouds />
      <div class="content-layer">
        <Nav account={account} />
        <section class="explore-profile-detail">
          <div class="container" style={{ maxWidth: "880px" }}>
            <p>
              <a href="/explore" class="text-link-button">
                ← {t.detail.backToExplore}
              </a>
            </p>
            <div style={{ marginTop: "1rem" }}>
              <ProfileHero profile={profile} />
            </div>
            <ProfileLinks profile={profile} />

            {isOwner && (
              <p style={{ marginTop: "1.5rem" }}>
                <a href="/explore/manage" class="explore-cta-primary">
                  {t.detail.editProfile}
                </a>
              </p>
            )}

            <div class="profile-footer">
              <span>
                {t.detail.lastUpdated}: <strong>{lastUpdated}</strong>
              </span>
              <span>
                {t.detail.hostedOn}: <strong>{providerName}</strong>
              </span>
            </div>
          </div>
        </section>
        <Footer variant="compact" />
      </div>
    </div>
  );
}

function NotFound(
  { locale, signedInUser, ownerHandle }: {
    locale: Locale;
    signedInUser: { did: string; handle: string } | null;
    ownerHandle: string | null;
  },
) {
  const t = getMessages(locale).explore.detail;
  const account = {
    user: signedInUser,
    avatarUrl: signedInUser ? "/api/me/avatar" : null,
    publicProfileHandle: ownerHandle,
  };
  return (
    <div id="page-top">
      <GlassClouds />
      <div class="content-layer">
        <Nav account={account} />
        <section class="explore-profile-detail">
          <div
            class="container"
            style={{ maxWidth: "640px", textAlign: "center" }}
          >
            <h1 class="text-section">{t.notFoundTitle}</h1>
            <p class="text-body mt-2">{t.notFoundBody}</p>
            <p class="mt-4">
              <a href="/explore" class="explore-cta-primary">
                ← {t.backToExplore}
              </a>
            </p>
          </div>
        </section>
        <Footer variant="compact" />
      </div>
    </div>
  );
}
