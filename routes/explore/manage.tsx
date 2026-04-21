import { define } from "../../utils.ts";
import Nav from "../../components/Nav.tsx";
import GlassClouds from "../../components/GlassClouds.tsx";
import Footer from "../../components/Footer.tsx";
import CreateProfileForm from "../../islands/CreateProfileForm.tsx";
import { getMessages } from "../../i18n/mod.ts";
import { getProfileByDid } from "../../lib/registry.ts";
import { loadSession } from "../../lib/oauth.ts";
import { getBskyProfile } from "../../lib/pds.ts";

/**
 * Build the deterministic public Bluesky CDN URL for a user's avatar
 * blob. The CDN is a thin cached proxy in front of the user's PDS, so
 * any did/cid pair from `app.bsky.actor.profile` resolves cleanly here
 * with cache headers + the correct content-type. Using this URL avoids
 * routing the prefill avatar through our own server (which adds a hop
 * and can fail in subtle ways on some PDS hosts).
 */
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
    /** Owner-aware lookup: include taken-down rows so the form can
     *  surface a "Your profile has been taken down" banner with the
     *  admin reason instead of pretending no profile exists. */
    const existing = await getProfileByDid(user.did, { includeTakenDown: true })
      .catch(() => null);
    if (existing) {
      initial = {
        name: existing.name,
        description: existing.description,
        mainLink: existing.mainLink,
        categories: existing.categories,
        subcategories: existing.subcategories,
        links: existing.links,
        avatar: existing.avatarCid && existing.avatarMime
          ? { ref: existing.avatarCid, mime: existing.avatarMime }
          : null,
        icon: existing.iconCid && existing.iconMime
          ? {
            ref: existing.iconCid,
            mime: existing.iconMime,
            status: existing.iconStatus,
            rejectedReason: existing.iconRejectedReason,
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
            mainLink: null,
            categories: ["app"],
            subcategories: [],
            links: [],
            avatar: bsky.avatar
              ? {
                ref: bsky.avatar.ref.$link,
                mime: bsky.avatar.mimeType,
              }
              : null,
            icon: null,
          };
          if (bsky.avatar) {
            initialAvatarUrl = bskyCdnAvatarUrl(
              user.did,
              bsky.avatar.ref.$link,
              bsky.avatar.mimeType,
            );
          }
        }
      }
    }

    /** Surface profile-level takedowns to the owner so they understand
     *  why edits won't publish. The PUT endpoint also returns 403 in
     *  this state, but a banner is much friendlier than a thrown
     *  error after Publish. */
    const takedown = existing?.takedownStatus === "taken_down"
      ? {
        reason: existing.takedownReason ?? "",
        at: existing.takedownAt,
      }
      : null;

    return ctx.render(
      <ManagePage
        user={user}
        initial={initial}
        initialAvatarUrl={initialAvatarUrl}
        initialPublished={!!existing && !takedown}
        publicProfileHandle={takedown ? null : existing?.handle ?? null}
        takedown={takedown}
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
  takedown: { reason: string; at: number | null } | null;
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
    takedown,
    t,
  }: ManagePageProps,
) {
  const explore = t.explore;
  const takedownCopy = t.manageTakedown;
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

            {takedown && (
              <div class="manage-takedown-banner" role="alert">
                <strong class="manage-takedown-banner-title">
                  {takedownCopy.title}
                </strong>
                <p class="manage-takedown-banner-body">
                  {takedownCopy.body}
                </p>
                <p class="manage-takedown-banner-reason">
                  <strong>{takedownCopy.reasonLabel}:</strong> {takedown.reason}
                </p>
              </div>
            )}

            <div style={{ marginTop: "2.5rem" }}>
              <CreateProfileForm
                did={user.did}
                handle={user.handle}
                initial={initial}
                initialAvatarUrl={initialAvatarUrl}
                initialPublished={initialPublished}
                publicProfileHandle={publicProfileHandle}
              />
            </div>
          </div>
        </section>
        <Footer variant="compact" />
      </div>
    </div>
  );
}
