/**
 * Admin overview page. Aggregates moderation/curation queues so the
 * homepage shows what needs attention without per-section visits.
 */
import { define } from "../../utils.ts";
import Nav from "../../components/Nav.tsx";
import GlassClouds from "../../components/GlassClouds.tsx";
import Footer from "../../components/Footer.tsx";
import { getMessages } from "../../i18n/mod.ts";
import type { Locale } from "../../i18n/mod.ts";
import {
  countPendingIconAccess,
  countTakenDownProfiles,
} from "../../lib/registry.ts";
import { countOpenReports } from "../../lib/reports.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const [iconAccessRequests, openReports, takenDown] = await Promise.all([
      countPendingIconAccess().catch(() => 0),
      countOpenReports().catch(() => 0),
      countTakenDownProfiles().catch(() => 0),
    ]);
    return ctx.render(
      <AdminHome
        user={ctx.state.user!}
        iconAccessRequests={iconAccessRequests}
        openReports={openReports}
        takenDown={takenDown}
        locale={ctx.state.locale}
      />,
    );
  },
});

interface AdminHomeProps {
  user: { did: string; handle: string };
  iconAccessRequests: number;
  openReports: number;
  takenDown: number;
  locale: Locale;
}

function AdminHome(
  { user, iconAccessRequests, openReports, takenDown, locale }: AdminHomeProps,
) {
  const t = getMessages(locale).admin;
  return (
    <div id="page-top">
      <GlassClouds />
      <div class="content-layer">
        <Nav
          account={{
            user: { did: user.did, handle: user.handle },
            avatarUrl: "/api/me/avatar",
            publicProfileHandle: null,
          }}
        />
        <section class="admin-section">
          <div class="container" style={{ maxWidth: "920px" }}>
            <header class="admin-header">
              <h1 class="text-section">{t.overview.headline}</h1>
              <p class="text-body mt-2">{t.overview.subhead}</p>
            </header>

            <div class="admin-grid">
              <a href="/admin/icon-access" class="admin-card">
                <p class="admin-card-count">{iconAccessRequests}</p>
                <h2 class="admin-card-title">{t.overview.iconAccessTitle}</h2>
                <p class="admin-card-body">{t.overview.iconAccessBody}</p>
              </a>
              <a href="/admin/reports" class="admin-card">
                <p class="admin-card-count">{openReports}</p>
                <h2 class="admin-card-title">{t.overview.reportsTitle}</h2>
                <p class="admin-card-body">{t.overview.reportsBody}</p>
              </a>
              <a href="/admin/featured" class="admin-card">
                <p class="admin-card-count">★</p>
                <h2 class="admin-card-title">{t.overview.featuredTitle}</h2>
                <p class="admin-card-body">{t.overview.featuredBody}</p>
              </a>
              <a href="/admin/takedowns" class="admin-card">
                <p class="admin-card-count">{takenDown}</p>
                <h2 class="admin-card-title">{t.overview.takedownsTitle}</h2>
                <p class="admin-card-body">{t.overview.takedownsBody}</p>
              </a>
            </div>
          </div>
        </section>
        <Footer variant="compact" />
      </div>
    </div>
  );
}
