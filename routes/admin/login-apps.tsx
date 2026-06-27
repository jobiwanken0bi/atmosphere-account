import { define } from "../../utils.ts";
import Nav from "../../components/Nav.tsx";
import Footer from "../../components/Footer.tsx";
import { buildAccountMenuProps } from "../../lib/account-menu-props.ts";
import {
  buildLoginAppProductionChecks,
  listLoginAppsForTrustReview,
  type LoginApp,
  type LoginAppIdentityCheck,
  loginAppStatusLabel,
  moderateLoginAppTrustReview,
} from "../../lib/atmosphere-login.ts";

interface LoginAppReviewRow {
  app: LoginApp;
  checks: LoginAppIdentityCheck[];
}

interface PageProps {
  account: ReturnType<typeof buildAccountMenuProps>;
  rows: LoginAppReviewRow[];
  message: string | null;
  error: string | null;
}

export const handler = define.handlers({
  async GET(ctx) {
    const rows = await loadRows();
    return ctx.render(
      <Page
        account={buildAccountMenuProps(ctx.state)}
        rows={rows}
        message={messageFor(ctx.url.searchParams.get("saved"))}
        error={null}
      />,
    );
  },

  async POST(ctx) {
    const form = await ctx.req.formData().catch(() => null);
    const clientId = formText(form, "client_id");
    const action = formText(form, "action");
    const reason = formText(form, "reason");
    try {
      if (
        action !== "approve" && action !== "reject" && action !== "block"
      ) {
        throw new Error("Unknown review action.");
      }
      if (!ctx.state.user) throw new Error("Admin account missing.");
      await moderateLoginAppTrustReview({
        clientId,
        adminDid: ctx.state.user.did,
        action,
        reason,
      });
      return new Response(null, {
        status: 303,
        headers: { location: `/admin/login-apps?saved=${action}` },
      });
    } catch (err) {
      const rows = await loadRows();
      return ctx.render(
        <Page
          account={buildAccountMenuProps(ctx.state)}
          rows={rows}
          message={null}
          error={err instanceof Error ? err.message : String(err)}
        />,
        { status: 400 },
      );
    }
  },
});

function Page({ account, rows, message, error }: PageProps) {
  return (
    <div id="page-top">
      <div class="content-layer">
        <Nav account={account} />
        <section class="admin-section">
          <div class="container" style={{ maxWidth: "980px" }}>
            <p>
              <a href="/admin" class="text-link-button">
                ← Back to admin
              </a>
            </p>
            <header class="admin-header" style={{ marginTop: "0.75rem" }}>
              <h1 class="text-section">Atmosphere Login app reviews</h1>
              <p class="text-body mt-2">
                Review app identity, allowed return URIs, and trust notes before
                promoting an app to Trusted in the picker.
              </p>
            </header>

            {message && (
              <p class="profile-form-status profile-form-status--ok">
                {message}
              </p>
            )}
            {error && (
              <p class="profile-form-status profile-form-status--error">
                {error}
              </p>
            )}

            {rows.length === 0
              ? (
                <div class="glass account-dashboard-empty">
                  <h2>No app trust requests</h2>
                  <p>
                    Developer requests for Trusted status will appear here.
                  </p>
                </div>
              )
              : (
                <div class="admin-icon-list">
                  {rows.map(({ app, checks }) => (
                    <ReviewCard key={app.clientId} app={app} checks={checks} />
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

function ReviewCard(
  { app, checks }: { app: LoginApp; checks: LoginAppIdentityCheck[] },
) {
  return (
    <article class="admin-icon-row admin-login-app-row">
      <div class="admin-icon-row-meta">
        <p class="admin-icon-row-name">
          <strong>{app.appName}</strong>
          <span class={`login-picker-status is-${app.status}`}>
            {loginAppStatusLabel(app.status)}
          </span>
        </p>
        <p class="admin-icon-row-did">
          <code>{app.clientId}</code>
        </p>
        {app.appUri && (
          <p class="admin-icon-row-uploaded">
            <strong>Homepage:</strong>{" "}
            <a
              href={app.appUri}
              target="_blank"
              rel="noopener noreferrer"
              class="text-link-button"
            >
              {app.appUri} ↗
            </a>
          </p>
        )}
        {app.contactDid && (
          <p class="admin-icon-row-uploaded">
            <strong>Owner:</strong> <code>{app.contactDid}</code>
          </p>
        )}
        <p class="admin-icon-row-uploaded">
          Requested {formatWhen(app.reviewRequestedAt)}
        </p>
        {app.reviewNotes && (
          <blockquote class="admin-login-app-notes">
            {app.reviewNotes}
          </blockquote>
        )}

        <div class="admin-login-app-checks">
          {checks.map((check) => (
            <span
              key={check.key}
              class={`admin-login-app-check is-${check.status}`}
              title={check.body}
            >
              {check.label}
            </span>
          ))}
        </div>

        <details class="admin-login-app-details">
          <summary>Allowed return URIs</summary>
          <ul>
            {app.allowedReturnUris.map((uri) => <li key={uri}>{uri}</li>)}
          </ul>
        </details>
      </div>
      <form
        method="post"
        class="admin-icon-row-actions admin-login-app-actions"
      >
        <input type="hidden" name="client_id" value={app.clientId} />
        <label class="profile-form-field">
          <span class="profile-form-label">Decision note</span>
          <textarea
            class="profile-form-input account-developer-textarea--small"
            name="reason"
            rows={3}
            placeholder="Optional note shown to the developer when rejected or blocked."
          />
        </label>
        <div class="admin-login-app-button-row">
          <button
            type="submit"
            name="action"
            value="approve"
            class="profile-form-button-primary"
          >
            Approve trusted
          </button>
          <button
            type="submit"
            name="action"
            value="reject"
            class="profile-form-button-secondary"
          >
            Reject
          </button>
          <button
            type="submit"
            name="action"
            value="block"
            class="profile-form-button-danger"
          >
            Block
          </button>
        </div>
      </form>
    </article>
  );
}

async function loadRows(): Promise<LoginAppReviewRow[]> {
  const apps = await listLoginAppsForTrustReview().catch(() => []);
  return await Promise.all(
    apps.map(async (app) => ({
      app,
      checks: await buildLoginAppProductionChecks(app),
    })),
  );
}

function formText(form: FormData | null, key: string): string {
  const value = form?.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function messageFor(value: string | null): string | null {
  if (value === "approve") return "App marked Trusted.";
  if (value === "reject") return "Review request rejected.";
  if (value === "block") return "App blocked.";
  return null;
}

function formatWhen(value: number | null): string {
  if (!value) return "recently";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}
