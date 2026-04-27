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
import { countOpenReviewReports } from "../../lib/reviews.ts";
import { buildAccountMenuProps } from "../../lib/account-menu-props.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const [iconAccessRequests, openReports, openReviewReports, takenDown] =
      await Promise.all([
        countPendingIconAccess().catch(() => 0),
        countOpenReports().catch(() => 0),
        countOpenReviewReports().catch(() => 0),
        countTakenDownProfiles().catch(() => 0),
      ]);
    return ctx.render(
      <AdminHome
        account={buildAccountMenuProps(ctx.state)}
        iconAccessRequests={iconAccessRequests}
        openReports={openReports}
        openReviewReports={openReviewReports}
        takenDown={takenDown}
        locale={ctx.state.locale}
      />,
    );
  },
});

interface AdminHomeProps {
  account: ReturnType<typeof buildAccountMenuProps>;
  iconAccessRequests: number;
  openReports: number;
  openReviewReports: number;
  takenDown: number;
  locale: Locale;
}

function AdminHome(
  {
    account,
    iconAccessRequests,
    openReports,
    openReviewReports,
    takenDown,
    locale,
  }: AdminHomeProps,
) {
  const t = getMessages(locale).admin;
  return (
    <div id="page-top">
      <GlassClouds />
      <div class="content-layer">
        <Nav account={account} />
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
              <a href="/admin/reviews" class="admin-card">
                <p class="admin-card-count">{openReviewReports}</p>
                <h2 class="admin-card-title">
                  {t.overview.reviewReportsTitle}
                </h2>
                <p class="admin-card-body">{t.overview.reviewReportsBody}</p>
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
