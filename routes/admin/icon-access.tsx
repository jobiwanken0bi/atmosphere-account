/**
 * Admin: SVG-icon access request queue. Lists projects whose owner
 * has submitted a verification request, plus a roster of currently
 * granted projects with a Revoke action.
 */
import { define } from "../../utils.ts";
import Nav from "../../components/Nav.tsx";
import GlassClouds from "../../components/GlassClouds.tsx";
import Footer from "../../components/Footer.tsx";
import AdminIconAccessGrant from "../../islands/AdminIconAccessGrant.tsx";
import AdminIconAccessRow from "../../islands/AdminIconAccessRow.tsx";
import AdminIconAccessRevoke from "../../islands/AdminIconAccessRevoke.tsx";
import AdminIconAccessVerifyButton from "../../islands/AdminIconAccessVerifyButton.tsx";
import { getMessages } from "../../i18n/mod.ts";
import type { Locale } from "../../i18n/mod.ts";
import {
  type GrantedIconAccessRow,
  type IconAccessLookupRow,
  type IconAccessRequestRow,
  listGrantedIconAccess,
  listPendingIconAccess,
  listUnverifiedIconAccess,
} from "../../lib/registry.ts";
import { buildAccountMenuProps } from "../../lib/account-menu-props.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const [pending, unverified, granted] = await Promise.all([
      listPendingIconAccess().catch(() => [] as IconAccessRequestRow[]),
      listUnverifiedIconAccess().catch(() => [] as IconAccessLookupRow[]),
      listGrantedIconAccess().catch(() => [] as GrantedIconAccessRow[]),
    ]);
    return ctx.render(
      <Page
        account={buildAccountMenuProps(ctx.state)}
        pending={pending}
        unverified={unverified}
        granted={granted}
        locale={ctx.state.locale}
      />,
    );
  },
});

interface PageProps {
  account: ReturnType<typeof buildAccountMenuProps>;
  pending: IconAccessRequestRow[];
  unverified: IconAccessLookupRow[];
  granted: GrantedIconAccessRow[];
  locale: Locale;
}

function Page({ account, pending, unverified, granted, locale }: PageProps) {
  const t = getMessages(locale).admin;
  const ti = t.iconAccess;
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
              <h1 class="text-section">{ti.headline}</h1>
              <p class="text-body mt-2">{ti.subhead}</p>
            </header>

            <h2 class="text-card mt-6">{ti.proactiveHeading}</h2>
            <AdminIconAccessGrant
              copy={{
                inputLabel: ti.proactiveInputLabel,
                placeholder: ti.proactivePlaceholder,
                help: ti.proactiveHelp,
                submit: ti.proactiveSubmit,
                successSuffix: ti.proactiveSuccessSuffix,
                notFound: ti.proactiveNotFound,
                error: t.errorPrefix,
              }}
            />

            <h2 class="text-card mt-6">{ti.pendingHeading}</h2>
            {pending.length === 0
              ? <p class="text-body admin-empty">{ti.emptyPending}</p>
              : (
                <div class="admin-icon-list">
                  {pending.map((row) => (
                    <AdminIconAccessRow
                      key={row.did}
                      did={row.did}
                      handle={row.handle}
                      name={row.name}
                      email={row.email}
                      requestedAt={row.requestedAt}
                      copy={{
                        grant: ti.grant,
                        deny: ti.deny,
                        denyPrompt: ti.denyPrompt,
                        grantedLabel: ti.markedGranted,
                        deniedLabel: ti.markedDenied,
                        requestedAtLabel: ti.requestedAtLabel,
                        emailLabel: ti.emailLabel,
                        viewProfile: ti.viewProfile,
                        error: t.errorPrefix,
                      }}
                    />
                  ))}
                </div>
              )}

            <h2 class="text-card mt-6">{ti.unverifiedHeading}</h2>
            {unverified.length === 0
              ? <p class="text-body admin-empty">{ti.emptyUnverified}</p>
              : (
                <div class="admin-icon-list">
                  {unverified.map((row) => (
                    <div class="admin-icon-row" key={row.did}>
                      <div class="admin-icon-row-meta">
                        <p class="admin-icon-row-name">
                          <strong>{row.name}</strong>
                          <span class="admin-icon-row-handle">
                            <a
                              href={`/explore/${
                                encodeURIComponent(row.handle)
                              }`}
                              target="_blank"
                              rel="noopener noreferrer"
                              class="text-link-button"
                            >
                              @{row.handle} ↗
                            </a>
                          </span>
                        </p>
                        <p class="admin-icon-row-did">
                          <code>{row.did}</code>
                        </p>
                        <p class="admin-icon-row-uploaded">
                          {row.status === "denied"
                            ? ti.unverifiedDeniedStatus
                            : ti.unverifiedNeverRequestedStatus}
                        </p>
                      </div>
                      <div class="admin-icon-row-actions">
                        <AdminIconAccessVerifyButton
                          did={row.did}
                          label={ti.grant}
                          doneLabel={ti.markedGranted}
                          errorPrefix={t.errorPrefix}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}

            <h2 class="text-card mt-6">{ti.grantedHeading}</h2>
            {granted.length === 0
              ? <p class="text-body admin-empty">{ti.emptyGranted}</p>
              : (
                <div class="admin-icon-list">
                  {granted.map((row) => {
                    const reviewed = new Date(row.reviewedAt).toISOString()
                      .slice(0, 10);
                    return (
                      <div class="admin-icon-row" key={row.did}>
                        <div class="admin-icon-row-meta">
                          <p class="admin-icon-row-name">
                            <strong>{row.name}</strong>
                            <span class="admin-icon-row-handle">
                              <a
                                href={`/explore/${
                                  encodeURIComponent(row.handle)
                                }`}
                                target="_blank"
                                rel="noopener noreferrer"
                                class="text-link-button"
                              >
                                @{row.handle} ↗
                              </a>
                            </span>
                          </p>
                          <p class="admin-icon-row-did">
                            <code>{row.did}</code>
                          </p>
                          {row.email && (
                            <p class="admin-icon-row-uploaded">
                              <strong>{ti.emailLabel}:</strong> {row.email}
                            </p>
                          )}
                          <p class="admin-icon-row-uploaded">
                            {ti.grantedAtLabel} {reviewed}
                          </p>
                        </div>
                        <div class="admin-icon-row-actions">
                          <AdminIconAccessRevoke
                            did={row.did}
                            label={ti.revoke}
                            promptText={ti.denyPrompt}
                            doneLabel={ti.markedDenied}
                            errorPrefix={t.errorPrefix}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
          </div>
        </section>
        <Footer variant="compact" />
      </div>
    </div>
  );
}
