/**
 * Admin: open review report inbox.
 */
import { define } from "../../utils.ts";
import Nav from "../../components/Nav.tsx";
import GlassClouds from "../../components/GlassClouds.tsx";
import Footer from "../../components/Footer.tsx";
import AdminReviewReportRow from "../../islands/AdminReviewReportRow.tsx";
import { getMessages } from "../../i18n/mod.ts";
import type { Locale } from "../../i18n/mod.ts";
import { getProfileByDid } from "../../lib/registry.ts";
import {
  listOpenReviewReports,
  type ReviewReportRow,
} from "../../lib/reviews.ts";
import { buildAccountMenuProps } from "../../lib/account-menu-props.ts";

interface ReviewReportWithHandle extends ReviewReportRow {
  targetHandle: string;
}

export const handler = define.handlers({
  async GET(ctx) {
    const reports = await listOpenReviewReports().catch(() =>
      [] as ReviewReportRow[]
    );
    const enriched: ReviewReportWithHandle[] = await Promise.all(
      reports.map(async (r) => {
        const p = r.review
          ? await getProfileByDid(r.review.targetDid, {
            includeTakenDown: true,
          })
            .catch(() => null)
          : null;
        return {
          ...r,
          targetHandle: p?.handle ?? r.review?.targetDid ?? "unknown",
        };
      }),
    );
    return ctx.render(
      <AdminReviewReportsPage
        account={buildAccountMenuProps(ctx.state)}
        reports={enriched}
        locale={ctx.state.locale}
      />,
    );
  },
});

interface PageProps {
  account: ReturnType<typeof buildAccountMenuProps>;
  reports: ReviewReportWithHandle[];
  locale: Locale;
}

function AdminReviewReportsPage({ account, reports, locale }: PageProps) {
  const t = getMessages(locale).admin;
  return (
    <div id="page-top">
      <GlassClouds />
      <div class="content-layer">
        <Nav account={account} />
        <section class="admin-section">
          <div class="container" style={{ maxWidth: "920px" }}>
            <p>
              <a href="/admin" class="text-link-button">
                ← {t.backToOverview}
              </a>
            </p>
            <header class="admin-header" style={{ marginTop: "0.75rem" }}>
              <h1 class="text-section">{t.reviewReports.headline}</h1>
              <p class="text-body mt-2">{t.reviewReports.subhead}</p>
            </header>

            {reports.length === 0
              ? <p class="text-body admin-empty">{t.reviewReports.empty}</p>
              : (
                <div class="admin-report-list">
                  {reports.map((r) => (
                    <AdminReviewReportRow
                      key={r.id}
                      id={r.id}
                      reviewId={r.reviewId}
                      targetHandle={r.targetHandle}
                      reviewerDid={r.review?.reviewerDid ?? null}
                      reporterDid={r.reporterDid}
                      rating={r.review?.rating ?? null}
                      body={r.review?.body ?? null}
                      reviewStatus={r.review?.status ?? null}
                      reasonLabel={t.reviewReports.reasons[r.reason]}
                      details={r.details}
                      createdAt={r.createdAt}
                      copy={{
                        action: t.reviewReports.action,
                        dismiss: t.reviewReports.dismiss,
                        hide: t.reviewReports.hide,
                        remove: t.reviewReports.remove,
                        restore: t.reviewReports.restore,
                        actionedLabel: t.reviewReports.actionedLabel,
                        dismissedLabel: t.reviewReports.dismissedLabel,
                        hiddenLabel: t.reviewReports.hiddenLabel,
                        removedLabel: t.reviewReports.removedLabel,
                        restoredLabel: t.reviewReports.restoredLabel,
                        notePlaceholder: t.reviewReports.notePlaceholder,
                        reasonLabel: t.reviewReports.reasonLabel,
                        reporterLabel: t.reviewReports.reporterLabel,
                        reviewerLabel: t.reviewReports.reviewerLabel,
                        detailsLabel: t.reviewReports.detailsLabel,
                        reviewLabel: t.reviewReports.reviewLabel,
                        submittedAt: t.reviewReports.submittedAt,
                        error: t.errorPrefix,
                      }}
                    />
                  ))}
                </div>
              )}
          </div>
        </section>
        <Footer variant="compact" />
      </div>
    </div>
  );
}
