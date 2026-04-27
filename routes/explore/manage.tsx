import { define } from "../../utils.ts";
import Nav from "../../components/Nav.tsx";
import GlassClouds from "../../components/GlassClouds.tsx";
import Footer from "../../components/Footer.tsx";
import CreateProfileForm from "../../islands/CreateProfileForm.tsx";
import { getMessages } from "../../i18n/mod.ts";
import { getProfileByDid } from "../../lib/registry.ts";
import { loadSession } from "../../lib/oauth.ts";
import { getBskyProfile } from "../../lib/pds.ts";
import { buildAccountMenuProps } from "../../lib/account-menu-props.ts";
import { getEffectiveAccountType } from "../../lib/account-types.ts";

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
    const accountType = await getEffectiveAccountType(user.did).catch(() =>
      null
    );
    if (accountType !== "project") {
      return new Response(null, {
        status: 303,
        headers: {
          location: accountType === "user"
            ? "/account/reviews"
            : "/account/type",
        },
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
        iosLink: existing.iosLink,
        androidLink: existing.androidLink,
        categories: existing.categories,
        subcategories: existing.subcategories,
        links: existing.links,
        screenshots: existing.screenshots.map((entry) => ({
          ref: entry.image.ref.$link,
          mime: entry.image.mimeType,
          size: entry.image.size,
        })),
        avatar: existing.avatarCid && existing.avatarMime
          ? { ref: existing.avatarCid, mime: existing.avatarMime }
          : null,
        icon: existing.iconCid && existing.iconMime
          ? {
            ref: existing.iconCid,
            mime: existing.iconMime,
          }
          : null,
        iconAccessStatus: existing.iconAccessStatus,
        iconAccessEmail: existing.iconAccessEmail,
        iconAccessDeniedReason: existing.iconAccessDeniedReason,
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
            iosLink: null,
            androidLink: null,
            categories: ["app"],
            subcategories: [],
            links: [],
            screenshots: [],
            avatar: bsky.avatar
              ? {
                ref: bsky.avatar.ref.$link,
                mime: bsky.avatar.mimeType,
              }
              : null,
            icon: null,
            iconAccessStatus: null,
            iconAccessEmail: null,
            iconAccessDeniedReason: null,
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

    const publicProfileHandle = takedown ? null : existing?.handle ?? null;
    return ctx.render(
      <ManagePage
        user={user}
        account={buildAccountMenuProps(ctx.state, publicProfileHandle)}
        initial={initial}
        initialAvatarUrl={initialAvatarUrl}
        initialPublished={!!existing && !takedown}
        publicProfileHandle={publicProfileHandle}
        takedown={takedown}
        t={t}
      />,
    );
  },
});

interface ManagePageProps {
  user: { did: string; handle: string };
  account: ReturnType<typeof buildAccountMenuProps>;
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
    account,
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
        <Nav account={account} />
        <section class="explore-manage" style={{ paddingTop: "8rem" }}>
          <div class="container" style={{ maxWidth: "920px" }}>
            <div class="manage-header">
              <div>
                <h1 class="text-section">{explore.manage.headline}</h1>
                <p class="text-body mt-2">{explore.manage.subhead}</p>
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
