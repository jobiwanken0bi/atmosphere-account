import { define } from "../../utils.ts";
import Nav from "../../components/Nav.tsx";
import GlassClouds from "../../components/GlassClouds.tsx";
import Footer from "../../components/Footer.tsx";
import ProfileHero from "../../components/explore/ProfileHero.tsx";
import ProfileLinks from "../../components/explore/ProfileLinks.tsx";
import { getMessages } from "../../i18n/mod.ts";
import type { Locale } from "../../i18n/mod.ts";
import { getProfileByHandle, type ProfileRow } from "../../lib/registry.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const handle = decodeURIComponent(ctx.params.handle).toLowerCase();
    const profile = await getProfileByHandle(handle).catch(() => null);
    return ctx.render(
      <ProfileDetailPage
        profile={profile}
        signedInDid={ctx.state.user?.did ?? null}
        locale={ctx.state.locale}
      />,
      { status: profile ? 200 : 404 },
    );
  },
});

interface DetailProps {
  profile: ProfileRow | null;
  signedInDid: string | null;
  locale: Locale;
}

function ProfileDetailPage({ profile, signedInDid, locale }: DetailProps) {
  const t = getMessages(locale).explore;
  if (!profile) return <NotFound locale={locale} />;
  const isOwner = signedInDid === profile.did;
  const lastUpdated = new Date(profile.indexedAt).toISOString().slice(0, 10);
  const pdsHost = (() => {
    try {
      return new URL(profile.pdsUrl).host;
    } catch {
      return profile.pdsUrl;
    }
  })();
  return (
    <div id="page-top">
      <GlassClouds />
      <div class="content-layer">
        <Nav />
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
                {t.detail.hostedOn}: <strong>{pdsHost}</strong>
              </span>
            </div>
          </div>
        </section>
        <Footer />
      </div>
    </div>
  );
}

function NotFound({ locale }: { locale: Locale }) {
  const t = getMessages(locale).explore.detail;
  return (
    <div id="page-top">
      <GlassClouds />
      <div class="content-layer">
        <Nav />
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
        <Footer />
      </div>
    </div>
  );
}
