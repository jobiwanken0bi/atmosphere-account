/**
 * Admin: curate the featured rail. Mounts an island that owns the
 * checkbox/reorder/badge UI and calls POST /api/admin/featured to
 * publish the result via the curator's OAuth session.
 */
import { define } from "../../utils.ts";
import Nav from "../../components/Nav.tsx";
import GlassClouds from "../../components/GlassClouds.tsx";
import Footer from "../../components/Footer.tsx";
import AdminFeaturedEditor, {
  type FeaturedCandidate,
  type FeaturedEntryDraft,
} from "../../islands/AdminFeaturedEditor.tsx";
import { getMessages } from "../../i18n/mod.ts";
import type { Locale } from "../../i18n/mod.ts";
import {
  listAllProfilesForPicker,
  listFeaturedProfiles,
  type ProfilePickerRow,
  type ProfileRow,
} from "../../lib/registry.ts";
import { buildAccountMenuProps } from "../../lib/account-menu-props.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const [candidates, featured] = await Promise.all([
      listAllProfilesForPicker().catch(() => [] as ProfilePickerRow[]),
      listFeaturedProfiles(48).catch(() => [] as ProfileRow[]),
    ]);
    const initial: FeaturedEntryDraft[] = featured.map((p) => ({
      did: p.did,
      badges: (p.featured?.badges ?? []) as string[],
    }));
    return ctx.render(
      <AdminFeaturedPage
        account={buildAccountMenuProps(ctx.state)}
        candidates={candidates}
        initial={initial}
        locale={ctx.state.locale}
      />,
    );
  },
});

interface PageProps {
  account: ReturnType<typeof buildAccountMenuProps>;
  candidates: FeaturedCandidate[];
  initial: FeaturedEntryDraft[];
  locale: Locale;
}

function AdminFeaturedPage(
  { account, candidates, initial, locale }: PageProps,
) {
  const t = getMessages(locale).admin;
  return (
    <div id="page-top">
      <GlassClouds />
      <div class="content-layer">
        <Nav account={account} />
        <section class="admin-section">
          <div class="container" style={{ maxWidth: "1080px" }}>
            <p>
              <a href="/admin" class="text-link-button">
                ← {t.backToOverview}
              </a>
            </p>
            <header class="admin-header" style={{ marginTop: "0.75rem" }}>
              <h1 class="text-section">{t.featured.headline}</h1>
              <p class="text-body mt-2">{t.featured.subhead}</p>
            </header>

            <AdminFeaturedEditor
              candidates={candidates}
              initial={initial}
              copy={{
                saveAndPublish: t.featured.saveAndPublish,
                saving: t.featured.saving,
                saved: t.featured.saved,
                filterPlaceholder: t.featured.filterPlaceholder,
                featuredHeading: t.featured.featuredHeading,
                candidatesHeading: t.featured.candidatesHeading,
                empty: t.featured.empty,
                moveUp: t.featured.moveUp,
                moveDown: t.featured.moveDown,
                remove: t.featured.remove,
                add: t.featured.add,
                badgesLabel: t.featured.badgesLabel,
                badgeVerified: t.featured.badgeVerified,
                badgeOfficial: t.featured.badgeOfficial,
                error: t.errorPrefix,
              }}
            />
          </div>
        </section>
        <Footer variant="compact" />
      </div>
    </div>
  );
}
