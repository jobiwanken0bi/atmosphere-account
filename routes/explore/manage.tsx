import { define } from "../../utils.ts";
import Nav from "../../components/Nav.tsx";
import Footer from "../../components/Footer.tsx";
import CreateProfileForm from "../../islands/CreateProfileForm.tsx";
import ProfileUpdateEditor from "../../islands/ProfileUpdateEditor.tsx";
import { getMessages } from "../../i18n/mod.ts";
import { getProfileByDid } from "../../lib/registry.ts";
import { loadSession } from "../../lib/oauth.ts";
import { getBskyProfile } from "../../lib/pds.ts";
import { buildAccountMenuProps } from "../../lib/account-menu-props.ts";
import { getEffectiveAccountType } from "../../lib/account-types.ts";
import { listProfileUpdates } from "../../lib/profile-updates.ts";
import { bskyCdnAvatarUrl } from "../../lib/avatar.ts";
import ShareButton from "../../islands/ShareButton.tsx";

export const handler = define.handlers({
  async GET(ctx) {
    const user = ctx.state.user;
    if (!user) {
      return new Response(null, {
        status: 303,
        headers: { location: "/explore/create?intent=project" },
      });
    }
    const accountType = await getEffectiveAccountType(user.did).catch(() =>
      null
    );
    if (accountType !== "project") {
      /**
       * Signed in with a non-project type. Send users to their dashboard
       * with the upgrade modal pre-opened so they can either convert
       * this account or sign in with a different one. Legacy untyped
       * accounts (which the OAuth callback now always assigns) fall
       * through to the user dashboard as well.
       */
      return new Response(null, {
        status: 303,
        headers: { location: "/account/reviews?upgrade=1" },
      });
    }

    const t = getMessages(ctx.state.locale);

    let initial: Parameters<typeof CreateProfileForm>[0]["initial"] = null;
    /** When showing a Bluesky-prefilled draft (no registry record yet), and
     *  after a registry record exists, the form previews the avatar through
     *  Bluesky's CDN whenever a did/cid pair is available. */
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
        banner: existing.bannerCid && existing.bannerMime
          ? { ref: existing.bannerCid, mime: existing.bannerMime }
          : null,
        icon: existing.iconCid && existing.iconMime
          ? {
            ref: existing.iconCid,
            mime: existing.iconMime,
          }
          : null,
        iconBw: existing.iconBwCid && existing.iconBwMime
          ? {
            ref: existing.iconBwCid,
            mime: existing.iconBwMime,
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
            banner: null,
            icon: null,
            iconBw: null,
            iconAccessStatus: null,
            iconAccessEmail: null,
            iconAccessDeniedReason: null,
          };
          if (bsky.avatar) {
            initialAvatarUrl = bskyCdnAvatarUrl(
              user.did,
              bsky.avatar.ref.$link,
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
    /**
     * Trailing slash is intentional — see the long comment in
     * routes/explore/[handle].tsx. Bluesky's composer otherwise treats
     * `/explore/foo.com` as a Windows executable and skips the unfurl.
     */
    const shareUrl = publicProfileHandle
      ? new URL(
        `/explore/${encodeURIComponent(publicProfileHandle)}/`,
        ctx.url.origin,
      ).href
      : null;
    const shareTitleName = (existing?.name?.trim() ||
      initial?.name?.trim() ||
      publicProfileHandle ||
      user.handle).trim();
    const updates = existing
      ? await listProfileUpdates(user.did, { limit: 8 }).catch(() => [])
      : [];
    return ctx.render(
      <ManagePage
        user={user}
        account={buildAccountMenuProps(ctx.state, publicProfileHandle)}
        initial={initial}
        initialAvatarUrl={initialAvatarUrl}
        initialPublished={!!existing && !takedown}
        publicProfileHandle={publicProfileHandle}
        shareUrl={shareUrl}
        shareTitleName={shareTitleName}
        updates={updates.map((update) => ({
          rkey: update.rkey,
          title: update.title,
          body: update.body,
          version: update.version,
          tangledCommitUrl: update.tangledCommitUrl,
          createdAt: update.createdAt,
        }))}
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
  /** Absolute project page URL when published; null if no live listing yet. */
  shareUrl: string | null;
  /** Display name for native share / clipboard context. */
  shareTitleName: string;
  updates: Parameters<typeof ProfileUpdateEditor>[0]["initialUpdates"];
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
    shareUrl,
    shareTitleName,
    updates,
    takedown,
    t,
  }: ManagePageProps,
) {
  const explore = t.explore;
  const shareCopy = explore.detail.share;
  const takedownCopy = t.manageTakedown;
  return (
    <div id="page-top">
      <div class="content-layer">
        <Nav account={account} />
        <section class="explore-manage" style={{ paddingTop: "8rem" }}>
          <div class="container" style={{ maxWidth: "920px" }}>
            <div class="manage-header">
              <div>
                <h1 class="text-section">{explore.manage.headline}</h1>
                <p class="text-body mt-2">{explore.manage.subhead}</p>
              </div>
              {shareUrl && (
                <ShareButton
                  url={shareUrl}
                  title={shareCopy.shareTitle(shareTitleName)}
                  copy={{
                    button: shareCopy.button,
                    copyLink: shareCopy.copyLink,
                    copied: shareCopy.copied,
                    copyFailed: shareCopy.copyFailed,
                  }}
                />
              )}
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

            <div style={{ marginTop: "1.25rem" }}>
              <ProfileUpdateEditor
                initialUpdates={updates}
                disabled={!initialPublished || !!takedown}
              />
            </div>
          </div>
        </section>
        <Footer variant="compact" />
      </div>
    </div>
  );
}
