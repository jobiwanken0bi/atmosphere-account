import { define } from "../../utils.ts";
import Nav from "../../components/Nav.tsx";
import Footer from "../../components/Footer.tsx";
import { buildAccountMenuProps } from "../../lib/account-menu-props.ts";
import {
  buildLoginAppProductionChecks,
  countLoginAppsForTrustReview,
  listLoginAppsForTrustReview,
  type LoginApp,
  type LoginAppIdentityCheck,
  loginAppStatusLabel,
  LoginRequestError,
  moderateLoginAppTrustReview,
} from "../../lib/atmosphere-login.ts";
import { readAdminFormRequest } from "../../lib/admin-request.ts";

interface LoginAppReviewRow {
  app: LoginApp;
  checks: LoginAppIdentityCheck[];
}

interface PageProps {
  account: ReturnType<typeof buildAccountMenuProps>;
  rows: LoginAppReviewRow[];
  pagination: LoginAppReviewPagination;
  message: string | null;
  error: string | null;
}

export interface LoginAppReviewPagination {
  page: number;
  pageSize: number;
  pageCount: number;
  total: number;
  offset: number;
  first: number;
  last: number;
}

export const LOGIN_APP_REVIEW_PAGE_SIZE = 20;
const LOGIN_APP_REVIEW_CHECK_CONCURRENCY = 4;

export const handler = define.handlers({
  async GET(ctx) {
    const requestedPage = parseLoginAppReviewPage(
      ctx.url.searchParams.get("page"),
    );
    let data: Awaited<ReturnType<typeof loadReviewPage>>;
    try {
      data = await loadReviewPage(requestedPage);
    } catch (error) {
      return appviewUnavailable(error);
    }
    return ctx.render(
      <LoginAppReviewPage
        account={buildAccountMenuProps(ctx.state)}
        rows={data.rows}
        pagination={data.pagination}
        message={messageFor(ctx.url.searchParams.get("saved"))}
        error={null}
      />,
    );
  },

  async POST(ctx) {
    const parsed = await readAdminFormRequest(ctx.req);
    if (!parsed.ok) return parsed.response;
    const form = parsed.value;
    const clientId = formText(form, "client_id");
    const expectedReviewRevision = formText(form, "review_revision");
    const action = formText(form, "action");
    const reason = formText(form, "reason");
    const requestedPage = parseLoginAppReviewPage(
      formText(form, "page") || ctx.url.searchParams.get("page"),
    );
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
        expectedReviewRevision,
      });
      return new Response(null, {
        status: 303,
        headers: {
          location: loginAppReviewSavedHref(requestedPage, action),
        },
      });
    } catch (err) {
      let data: Awaited<ReturnType<typeof loadReviewPage>>;
      try {
        data = await loadReviewPage(requestedPage);
      } catch (loadError) {
        return appviewUnavailable(loadError);
      }
      return ctx.render(
        <LoginAppReviewPage
          account={buildAccountMenuProps(ctx.state)}
          rows={data.rows}
          pagination={data.pagination}
          message={null}
          error={err instanceof Error ? err.message : String(err)}
        />,
        { status: err instanceof LoginRequestError ? err.status : 400 },
      );
    }
  },
});

export function LoginAppReviewPage(
  { account, rows, pagination, message, error }: PageProps,
) {
  return (
    <div id="page-top">
      <div class="content-layer">
        <Nav account={account} />
        <main id="main-content" class="admin-section">
          <div class="container" style={{ maxWidth: "980px" }}>
            <p>
              <a href="/admin" class="text-link-button">
                ← Back to admin
              </a>
            </p>
            <header class="admin-header" style={{ marginTop: "0.75rem" }}>
              <h1 class="text-section">Login with Atmosphere app reviews</h1>
              <p class="text-body mt-2">
                Review app identity, allowed return URIs, and trust notes before
                promoting an app to Trusted in the picker.
              </p>
              <p class="text-body mt-2">
                {reviewRangeLabel(pagination)}
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
                  <h2>
                    {pagination.total === 0
                      ? "No app trust requests"
                      : "No requests on this page"}
                  </h2>
                  <p>
                    {pagination.total === 0
                      ? "Developer requests for Trusted status will appear here."
                      : "The queue changed while this page was loading. Use Previous to continue reviewing."}
                  </p>
                </div>
              )
              : (
                <div class="admin-icon-list">
                  {rows.map(({ app, checks }) => (
                    <ReviewCard
                      key={app.clientId}
                      app={app}
                      checks={checks}
                      page={pagination.page}
                    />
                  ))}
                </div>
              )}
            <LoginAppReviewPaginationNav pagination={pagination} />
          </div>
        </main>
        <Footer variant="compact" />
      </div>
    </div>
  );
}

function ReviewCard(
  { app, checks, page }: {
    app: LoginApp;
    checks: LoginAppIdentityCheck[];
    page: number;
  },
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
        <input type="hidden" name="page" value={String(page)} />
        <input
          type="hidden"
          name="review_revision"
          value={app.reviewRevision ?? ""}
        />
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
            disabled={!app.identityAvailable ||
              app.loginAvailability !== "available" ||
              !app.reviewRevision}
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

async function loadReviewPage(requestedPage: number): Promise<{
  rows: LoginAppReviewRow[];
  pagination: LoginAppReviewPagination;
}> {
  const total = await countLoginAppsForTrustReview();
  const pagination = loginAppReviewPagination(requestedPage, total);
  const apps = await listLoginAppsForTrustReview({
    limit: pagination.pageSize,
    offset: pagination.offset,
  });
  const rows = await mapWithConcurrency(
    apps,
    LOGIN_APP_REVIEW_CHECK_CONCURRENCY,
    async (app) => ({
      app,
      checks: await buildLoginAppProductionChecks(app),
    }),
  );
  return { rows, pagination };
}

export function parseLoginAppReviewPage(
  value: string | null | undefined,
): number {
  const raw = value?.trim() ?? "";
  if (!/^[1-9]\d*$/.test(raw)) return 1;
  const page = Number(raw);
  return Number.isSafeInteger(page) ? page : 1;
}

export function loginAppReviewPagination(
  requestedPage: number,
  total: number,
  pageSize = LOGIN_APP_REVIEW_PAGE_SIZE,
): LoginAppReviewPagination {
  const safeTotal = Number.isFinite(total) ? Math.max(0, Math.trunc(total)) : 0;
  const requestedPageSize = Math.trunc(pageSize);
  const safePageSize = Number.isFinite(requestedPageSize) &&
      requestedPageSize > 0
    ? requestedPageSize
    : LOGIN_APP_REVIEW_PAGE_SIZE;
  const pageCount = Math.max(1, Math.ceil(safeTotal / safePageSize));
  const safeRequestedPage = Number.isFinite(requestedPage)
    ? Math.max(1, Math.trunc(requestedPage))
    : 1;
  const page = Math.min(safeRequestedPage, pageCount);
  const offset = (page - 1) * safePageSize;
  return {
    page,
    pageSize: safePageSize,
    pageCount,
    total: safeTotal,
    offset,
    first: safeTotal === 0 ? 0 : offset + 1,
    last: Math.min(safeTotal, offset + safePageSize),
  };
}

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  map: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const requestedConcurrency = Math.trunc(concurrency);
  const limit = Number.isFinite(requestedConcurrency) &&
      requestedConcurrency > 0
    ? Math.min(requestedConcurrency, items.length)
    : 1;
  const results = new Array<R>(items.length);
  let cursor = 0;
  const worker = async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await map(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}

export function LoginAppReviewPaginationNav(
  { pagination }: { pagination: LoginAppReviewPagination },
) {
  if (pagination.pageCount <= 1) return null;
  return (
    <nav class="app-pagination" aria-label="App review pagination">
      {pagination.page > 1
        ? (
          <a
            class="app-pagination-link"
            href={loginAppReviewPageHref(pagination.page - 1)}
            rel="prev"
          >
            Previous
          </a>
        )
        : <span class="app-pagination-link is-disabled">Previous</span>}
      <span class="app-pagination-status">
        Page {pagination.page} of {pagination.pageCount}
      </span>
      {pagination.page < pagination.pageCount
        ? (
          <a
            class="app-pagination-link"
            href={loginAppReviewPageHref(pagination.page + 1)}
            rel="next"
          >
            Next
          </a>
        )
        : <span class="app-pagination-link is-disabled">Next</span>}
    </nav>
  );
}

function loginAppReviewPageHref(page: number): string {
  return page > 1 ? `/admin/login-apps?page=${page}` : "/admin/login-apps";
}

function loginAppReviewSavedHref(page: number, action: string): string {
  const params = new URLSearchParams({ saved: action });
  if (page > 1) params.set("page", String(page));
  return `/admin/login-apps?${params.toString()}`;
}

function reviewRangeLabel(pagination: LoginAppReviewPagination): string {
  if (pagination.total === 0) return "No requests awaiting review.";
  return `Showing ${pagination.first}–${pagination.last} of ${pagination.total} requests.`;
}

function appviewUnavailable(error: unknown): Response {
  console.error("[admin] login app review queue unavailable:", error);
  return new Response("The app review queue is temporarily unavailable.", {
    status: 503,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
    },
  });
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
