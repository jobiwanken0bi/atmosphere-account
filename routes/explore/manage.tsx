import { define } from "../../utils.ts";
import Nav from "../../components/Nav.tsx";
import GlassClouds from "../../components/GlassClouds.tsx";
import Footer from "../../components/Footer.tsx";
import CreateProfileForm from "../../islands/CreateProfileForm.tsx";
import { getMessages } from "../../i18n/mod.ts";
import { getProfileByDid } from "../../lib/registry.ts";
import { loadSession } from "../../lib/oauth.ts";
import { getBskyProfile } from "../../lib/pds.ts";

/** Route the prefill avatar through our own proxy (which streams the
 *  PDS blob with friendly content-type + cache headers) rather than
 *  embedding the raw PDS getBlob URL into an <img>. Some PDS hosts
 *  don't serve blobs cleanly to a browser <img> tag (content-type,
 *  redirects, CORS quirks), but they all work fine for a server-to-
 *  server fetch. */
const ME_AVATAR_PROXY = "/api/me/avatar";

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
    /** When showing a Bluesky-prefilled draft (no registry record yet), we
     *  display the user's PDS-hosted avatar directly via getBlob. After the
     *  registry record exists, the form switches to the cached
     *  /api/registry/avatar/:did proxy. */
    let initialAvatarUrl: string | null = null;
    const existing = await getProfileByDid(user.did).catch(() => null);
    if (existing) {
      initial = {
        name: existing.name,
        description: existing.description,
        categories: existing.categories,
        subcategories: existing.subcategories,
        links: existing.links,
        avatar: existing.avatarCid && existing.avatarMime
          ? { ref: existing.avatarCid, mime: existing.avatarMime }
          : null,
      };
    } else {
      const session = await loadSession(user.did);
      if (session) {
        const bsky = await getBskyProfile(session.pdsUrl, user.did).catch(() =>
          null
        );
        if (bsky) {
          initial = {
            name: bsky.displayName ?? "",
            description: bsky.description ?? "",
            categories: ["app"],
            subcategories: [],
            links: [],
            avatar: bsky.avatar
              ? {
                ref: bsky.avatar.ref.$link,
                mime: bsky.avatar.mimeType,
              }
              : null,
          };
          if (bsky.avatar) {
            initialAvatarUrl = ME_AVATAR_PROXY;
          }
        }
      }
    }

    return ctx.render(
      <ManagePage
        user={user}
        initial={initial}
        initialAvatarUrl={initialAvatarUrl}
        initialPublished={!!existing}
        publicProfileHandle={existing?.handle ?? null}
        t={t}
      />,
    );
  },
});

interface ManagePageProps {
  user: { did: string; handle: string };
  initial: Parameters<typeof CreateProfileForm>[0]["initial"];
  initialAvatarUrl: string | null;
  initialPublished: boolean;
  publicProfileHandle: string | null;
  // deno-lint-ignore no-explicit-any
  t: any;
}

function ManagePage(
  {
    user,
    initial,
    initialAvatarUrl,
    initialPublished,
    publicProfileHandle,
    t,
  }: ManagePageProps,
) {
  const explore = t.explore;
  return (
    <div id="page-top">
      <GlassClouds />
      <div class="content-layer">
        <Nav
          account={{
            user: { did: user.did, handle: user.handle },
            avatarUrl: "/api/me/avatar",
            publicProfileHandle,
          }}
        />
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
                initialAvatarUrl={initialAvatarUrl}
                initialPublished={initialPublished}
              />
            </div>
          </div>
        </section>
        <Footer variant="compact" />
      </div>
    </div>
  );
}
