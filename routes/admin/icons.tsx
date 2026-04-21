/**
 * Admin: pending SVG icon review queue. Server-renders one row per
 * pending project + an `AdminIconReview` island that owns the
 * approve / reject buttons.
 */
import { define } from "../../utils.ts";
import Nav from "../../components/Nav.tsx";
import GlassClouds from "../../components/GlassClouds.tsx";
import Footer from "../../components/Footer.tsx";
import AdminIconReview from "../../islands/AdminIconReview.tsx";
import { getMessages } from "../../i18n/mod.ts";
import type { Locale } from "../../i18n/mod.ts";
import { listPendingIcons, type PendingIconRow } from "../../lib/registry.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const queue = await listPendingIcons().catch(() => [] as PendingIconRow[]);
    return ctx.render(
      <AdminIconsPage
        user={ctx.state.user!}
        queue={queue}
        locale={ctx.state.locale}
      />,
    );
  },
});

interface PageProps {
  user: { did: string; handle: string };
  queue: PendingIconRow[];
  locale: Locale;
}

function AdminIconsPage({ user, queue, locale }: PageProps) {
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
            <p>
              <a href="/admin" class="text-link-button">
                ← {t.backToOverview}
              </a>
            </p>
            <header class="admin-header" style={{ marginTop: "0.75rem" }}>
              <h1 class="text-section">{t.icons.headline}</h1>
              <p class="text-body mt-2">{t.icons.subhead}</p>
            </header>

            {queue.length === 0
              ? (
                <p class="text-body admin-empty">
                  {t.icons.empty}
                </p>
              )
              : (
                <div class="admin-icon-list">
                  {queue.map((row) => (
                    <AdminIconReview
                      key={row.did}
                      did={row.did}
                      handle={row.handle}
                      name={row.name}
                      previewUrl={`/api/admin/icons/${
                        encodeURIComponent(row.did)
                      }/preview`}
                      uploadedAt={row.indexedAt}
                      copy={{
                        approve: t.icons.approve,
                        reject: t.icons.reject,
                        rejectReasonPlaceholder:
                          t.icons.rejectReasonPlaceholder,
                        confirmReject: t.icons.confirmReject,
                        submit: t.icons.submitReject,
                        cancel: t.icons.cancel,
                        pending: t.statusBadge.pending,
                        approved: t.icons.markedApproved,
                        rejected: t.icons.markedRejected,
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
