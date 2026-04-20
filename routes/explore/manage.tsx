import { define } from "../../utils.ts";
import Nav from "../../components/Nav.tsx";
import GlassClouds from "../../components/GlassClouds.tsx";
import Footer from "../../components/Footer.tsx";
import CreateProfileForm from "../../islands/CreateProfileForm.tsx";
import { getMessages } from "../../i18n/mod.ts";
import { getProfileByDid } from "../../lib/registry.ts";
import { loadSession } from "../../lib/oauth.ts";
import { getBskyProfile } from "../../lib/pds.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const user = ctx.state.user;
    if (!user) {
      return new Response(null, {
        status: 303,
        headers: { location: "/explore/create" },
      });
    }

    const t = getMessages(ctx.state.locale);

    let initial: Parameters<typeof CreateProfileForm>[0]["initial"] = null;
    const existing = await getProfileByDid(user.did).catch(() => null);
    if (existing) {
      initial = {
        name: existing.name,
        description: existing.description,
        category: existing.category,
        subcategories: existing.subcategories,
        website: existing.website,
        supportUrl: existing.supportUrl,
        bskyHandle: existing.bskyHandle,
        atmosphereHandle: existing.atmosphereHandle,
        tags: existing.tags,
        avatar: existing.avatarCid && existing.avatarMime
          ? { ref: existing.avatarCid, mime: existing.avatarMime }
          : null,
      };
    } else {
      // Pre-fill from app.bsky.actor.profile if no registry entry yet.
      const session = await loadSession(user.did);
      if (session) {
        const bsky = await getBskyProfile(session.pdsUrl, user.did).catch(() =>
          null
        );
        if (bsky) {
          initial = {
            name: bsky.displayName ?? "",
            description: bsky.description ?? "",
            category: "app",
            subcategories: [],
            website: null,
            supportUrl: null,
            bskyHandle: user.handle,
            atmosphereHandle: user.handle,
            tags: [],
            avatar: bsky.avatar
              ? {
                ref: bsky.avatar.ref.$link,
                mime: bsky.avatar.mimeType,
              }
              : null,
          };
        }
      }
    }

    return ctx.render(
      <ManagePage
        user={user}
        initial={initial}
        t={t}
      />,
    );
  },
});

interface ManagePageProps {
  user: { did: string; handle: string };
  initial: Parameters<typeof CreateProfileForm>[0]["initial"];
  // deno-lint-ignore no-explicit-any
  t: any;
}

function ManagePage({ user, initial, t }: ManagePageProps) {
  const explore = t.explore;
  return (
    <div id="page-top">
      <GlassClouds />
      <div class="content-layer">
        <Nav />
        <section class="explore-manage" style={{ paddingTop: "8rem" }}>
          <div class="container" style={{ maxWidth: "920px" }}>
            <div class="manage-header">
              <div>
                <h1 class="text-section">{explore.manage.headline}</h1>
                <p class="text-body mt-2">{explore.manage.subhead}</p>
              </div>
              <div class="manage-header-aside">
                <p class="text-body-sm">
                  {explore.manage.signedInAs} <strong>@{user.handle}</strong>
                </p>
                <form method="POST" action="/oauth/logout" class="inline-form">
                  <button type="submit" class="text-link-button">
                    {explore.manage.signOut}
                  </button>
                </form>
              </div>
            </div>

            <div style={{ marginTop: "2.5rem" }}>
              <CreateProfileForm
                did={user.did}
                handle={user.handle}
                initial={initial}
              />
            </div>
          </div>
        </section>
        <Footer />
      </div>
    </div>
  );
}
