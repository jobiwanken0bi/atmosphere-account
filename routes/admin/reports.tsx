/**
 * Admin: open report inbox. Server-renders one row per open report and
 * mounts an island so each can be actioned/dismissed inline.
 */
import { define } from "../../utils.ts";
import Nav from "../../components/Nav.tsx";
import GlassClouds from "../../components/GlassClouds.tsx";
import Footer from "../../components/Footer.tsx";
import AdminReportRow from "../../islands/AdminReportRow.tsx";
import { getMessages } from "../../i18n/mod.ts";
import type { Locale } from "../../i18n/mod.ts";
import { getProfileByDid } from "../../lib/registry.ts";
import { listOpenReports, type ReportRow } from "../../lib/reports.ts";
import { buildAccountMenuProps } from "../../lib/account-menu-props.ts";

interface ReportWithHandle extends ReportRow {
  targetHandle: string;
}

export const handler = define.handlers({
  async GET(ctx) {
    const reports = await listOpenReports().catch(() => [] as ReportRow[]);
    /** Resolve target handles in parallel — without this the table just
     *  shows DIDs which makes it harder to scan. */
    const enriched: ReportWithHandle[] = await Promise.all(
      reports.map(async (r) => {
        // Admin tooling — show handles even for already-taken-down
        // targets so the queue stays scannable after a moderation pass.
        const p = await getProfileByDid(r.targetDid, { includeTakenDown: true })
          .catch(() => null);
        return { ...r, targetHandle: p?.handle ?? r.targetDid };
      }),
    );
    return ctx.render(
      <AdminReportsPage
        account={buildAccountMenuProps(ctx.state)}
        reports={enriched}
        locale={ctx.state.locale}
      />,
    );
  },
});

interface PageProps {
  account: ReturnType<typeof buildAccountMenuProps>;
  reports: ReportWithHandle[];
  locale: Locale;
}

function AdminReportsPage({ account, reports, locale }: PageProps) {
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
              <h1 class="text-section">{t.reports.headline}</h1>
              <p class="text-body mt-2">{t.reports.subhead}</p>
            </header>

            {reports.length === 0
              ? <p class="text-body admin-empty">{t.reports.empty}</p>
              : (
                <div class="admin-report-list">
                  {reports.map((r) => (
                    <AdminReportRow
                      key={r.id}
                      id={r.id}
                      targetDid={r.targetDid}
                      targetHandle={r.targetHandle}
                      reporterDid={r.reporterDid}
                      reason={r.reason}
                      reasonLabel={t.reports.reasons[r.reason]}
                      details={r.details}
                      createdAt={r.createdAt}
                      copy={{
                        action: t.reports.action,
                        dismiss: t.reports.dismiss,
                        takedown: t.reports.takedown,
                        takedownPrompt: t.reports.takedownPrompt,
                        takedownDoneLabel: t.reports.takedownDoneLabel,
                        actionedLabel: t.reports.actionedLabel,
                        dismissedLabel: t.reports.dismissedLabel,
                        noteLabel: t.reports.noteLabel,
                        notePlaceholder: t.reports.notePlaceholder,
                        reasonLabel: t.reports.reasonLabel,
                        reporterLabel: t.reports.reporterLabel,
                        anonymousReporter: t.reports.anonymousReporter,
                        detailsLabel: t.reports.detailsLabel,
                        submittedAt: t.reports.submittedAt,
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
