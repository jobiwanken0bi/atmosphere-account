import { define } from "../../utils.ts";
import Nav from "../../components/Nav.tsx";
import GlassClouds from "../../components/GlassClouds.tsx";
import Footer from "../../components/Footer.tsx";
import CreateProfileForm from "../../islands/CreateProfileForm.tsx";
import { getMessages } from "../../i18n/mod.ts";
import { getLicenseByDid, getProfileByDid } from "../../lib/registry.ts";
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
    /** When showing a Bluesky-prefilled draft (no registry record yet), we
     *  display the user's PDS-hosted avatar directly via getBlob. After the
     *  registry record exists, the form switches to the cached
     *  /api/registry/avatar/:did proxy. */
    let initialAvatarUrl: string | null = null;
    const [existing, license] = await Promise.all([
      getProfileByDid(user.did).catch(() => null),
      getLicenseByDid(user.did).catch(() => null),
    ]);
    if (existing) {
      initial = {
        name: existing.name,
        description: existing.description,
        categories: existing.categories,
        subcategories: existing.subcategories,
        links: existing.links,
        bskyClient: existing.bskyClient,
        avatar: existing.avatarCid && existing.avatarMime
          ? { ref: existing.avatarCid, mime: existing.avatarMime }
          : null,
        license: license
          ? {
            type: license.type,
            spdxId: license.spdxId,
            licenseUrl: license.licenseUrl,
            notes: license.notes,
          }
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
            bskyClient: null,
            avatar: bsky.avatar
              ? {
                ref: bsky.avatar.ref.$link,
                mime: bsky.avatar.mimeType,
              }
              : null,
            license: null,
          };
          if (bsky.avatar) {
            const cid = bsky.avatar.ref.$link;
            const u = new URL(
              `${
                session.pdsUrl.replace(/\/$/, "")
              }/xrpc/com.atproto.sync.getBlob`,
            );
            u.searchParams.set("did", user.did);
            u.searchParams.set("cid", cid);
            initialAvatarUrl = u.toString();
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
