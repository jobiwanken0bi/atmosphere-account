import { define } from "../../../../utils.ts";
import Nav from "../../../../components/Nav.tsx";
import Footer from "../../../../components/Footer.tsx";
import { buildAccountMenuProps } from "../../../../lib/account-menu-props.ts";
import {
  type AppRecordFailure,
  clearAppRecordFailure,
  getAppRecordFailure,
  uriFromAppRecordFailureId,
} from "../../../../lib/app-directory-failures.ts";
import { retryAppRecordFailure } from "../../../../lib/atstore-backfill.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const failure = await loadFailure(ctx.params.id);
    if (!failure) return new Response("Not found", { status: 404 });
    return ctx.render(
      <FailurePage
        account={buildAccountMenuProps(ctx.state)}
        failure={failure}
        saved={ctx.url.searchParams.get("saved") ?? null}
        reason={ctx.url.searchParams.get("reason") ?? null}
      />,
    );
  },
  async POST(ctx) {
    const failure = await loadFailure(ctx.params.id);
    if (!failure) return new Response("Not found", { status: 404 });
    const form = await ctx.req.formData().catch(() => null);
    const action = formText(form, "action");

    if (action === "clear") {
      await clearAppRecordFailure(failure.uri);
      return redirect("/admin/app-directory?saved=failure-cleared");
    }

    if (action === "retry") {
      const result = await retryAppRecordFailure(failure);
      if (result.ok) {
        return redirect("/admin/app-directory?saved=retried");
      }
      return redirect(
        `/admin/app-directory/failures/${
          encodeURIComponent(ctx.params.id)
        }?saved=retry-failed&reason=${
          encodeURIComponent(result.reason ?? "retry_failed")
        }`,
      );
    }

    return redirect(
      `/admin/app-directory/failures/${encodeURIComponent(ctx.params.id)}`,
    );
  },
});

function FailurePage(
  {
    account,
    failure,
    saved,
    reason,
  }: {
    account: ReturnType<typeof buildAccountMenuProps>;
    failure: AppRecordFailure;
    saved: string | null;
    reason: string | null;
  },
) {
  return (
    <div id="page-top">
      <div class="content-layer">
        <Nav account={account} />
        <section class="admin-section">
          <div class="container" style={{ maxWidth: "920px" }}>
            <p>
              <a href="/admin/app-directory" class="text-link-button">
                ← Back to app directory data
              </a>
            </p>
            <header class="admin-header" style={{ marginTop: "0.75rem" }}>
              <p class="text-eyebrow">Failed record</p>
              <h1 class="text-section">Record import inspector</h1>
              <p class="text-body mt-2">
                Retry a failed ATStore record after adapter fixes, or clear it
                if the source record is obsolete.
              </p>
              {saved === "retry-failed" && (
                <p class="admin-app-directory-warning">
                  Retry failed: {reason ?? failure.reason}
                </p>
              )}
            </header>

            <section class="glass admin-app-directory-panel">
              <div class="admin-app-directory-actions-heading">
                <div>
                  <h2 class="profile-card-section-title">{failure.reason}</h2>
                  <p class="text-body">
                    Seen {failure.count} time{failure.count === 1 ? "" : "s"}.
                  </p>
                </div>
                <div class="admin-app-directory-row-actions">
                  <form method="POST">
                    <input type="hidden" name="action" value="retry" />
                    <button class="button-primary" type="submit">
                      Retry this record
                    </button>
                  </form>
                  <form method="POST">
                    <input type="hidden" name="action" value="clear" />
                    <button class="directory-register-button" type="submit">
                      Clear if obsolete
                    </button>
                  </form>
                </div>
              </div>
              <dl class="admin-app-directory-facts">
                <Fact label="Collection" value={failure.collection} />
                <Fact label="Source type" value={failure.sourceType} />
                <Fact label="Repo DID" value={failure.repoDid} />
                <Fact label="Rkey" value={failure.rkey} />
                <Fact
                  label="First seen"
                  value={formatWhen(failure.firstSeenAt)}
                />
                <Fact
                  label="Last seen"
                  value={formatWhen(failure.lastSeenAt)}
                />
              </dl>
              <div class="admin-app-directory-raw">
                <p class="text-eyebrow">AT URI</p>
                <code>{failure.uri}</code>
              </div>
            </section>
          </div>
        </section>
        <Footer variant="compact" />
      </div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

async function loadFailure(id: string): Promise<AppRecordFailure | null> {
  const uri = uriFromAppRecordFailureId(id);
  return uri ? await getAppRecordFailure(uri) : null;
}

function formText(form: FormData | null, key: string): string {
  const value = form?.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function redirect(location: string): Response {
  return new Response(null, { status: 303, headers: { location } });
}

function formatWhen(value: number | null): string {
  return value ? new Date(value).toLocaleString("en-US") : "Not observed";
}
