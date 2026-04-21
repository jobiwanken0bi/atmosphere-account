/**
 * Admin: list of currently taken-down profiles, with per-row Restore.
 * Server-renders one row per taken-down profile and mounts an island
 * so each can be restored inline without a full reload.
 */
import { define } from "../../utils.ts";
import Nav from "../../components/Nav.tsx";
import GlassClouds from "../../components/GlassClouds.tsx";
import Footer from "../../components/Footer.tsx";
import AdminTakedownRow from "../../islands/AdminTakedownRow.tsx";
import { getMessages } from "../../i18n/mod.ts";
import type { Locale } from "../../i18n/mod.ts";
import {
  listTakenDownProfiles,
  type TakenDownProfileRow,
} from "../../lib/registry.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const rows = await listTakenDownProfiles().catch(
      () => [] as TakenDownProfileRow[],
    );
    return ctx.render(
      <AdminTakedownsPage
        user={ctx.state.user!}
        rows={rows}
        locale={ctx.state.locale}
      />,
    );
  },
});

interface PageProps {
  user: { did: string; handle: string };
  rows: TakenDownProfileRow[];
  locale: Locale;
}

function AdminTakedownsPage({ user, rows, locale }: PageProps) {
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
              <h1 class="text-section">{t.takedowns.headline}</h1>
              <p class="text-body mt-2">{t.takedowns.subhead}</p>
            </header>

            {rows.length === 0
              ? <p class="text-body admin-empty">{t.takedowns.empty}</p>
              : (
                <div class="admin-report-list">
                  {rows.map((r) => (
                    <AdminTakedownRow
                      key={r.did}
                      did={r.did}
                      handle={r.handle}
                      name={r.name}
                      reason={r.takedownReason}
                      by={r.takedownBy}
                      at={r.takedownAt}
                      copy={{
                        reasonLabel: t.takedowns.reasonLabel,
                        byLabel: t.takedowns.byLabel,
                        atLabel: t.takedowns.atLabel,
                        restore: t.takedowns.restore,
                        confirmRestore: t.takedowns.confirmRestore,
                        restored: t.takedowns.restored,
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
