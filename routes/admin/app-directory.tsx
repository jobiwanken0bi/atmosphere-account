import { define } from "../../utils.ts";
import Nav from "../../components/Nav.tsx";
import Footer from "../../components/Footer.tsx";
import { buildAccountMenuProps } from "../../lib/account-menu-props.ts";
import {
  type AppDirectoryAdminStatus,
  type AppDirectoryMigrationDryRun,
  getAppDirectoryAdminStatus,
  listAppDirectoryMigrationDryRun,
} from "../../lib/app-directory-admin.ts";
import {
  type AppRecordFailure,
  appRecordFailureId,
  listAppRecordFailures,
} from "../../lib/app-directory-failures.ts";
import {
  type AppDirectoryJob,
  type AppDirectoryJobKind,
  enqueueAppDirectoryJob,
  listRecentAppDirectoryJobs,
  startAppDirectoryJob,
} from "../../lib/app-directory-jobs.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const [status, migrationGroups, failures, jobs] = await Promise.all([
      getAppDirectoryAdminStatus(),
      listAppDirectoryMigrationDryRun(48),
      listAppRecordFailures(12),
      listRecentAppDirectoryJobs(8),
    ]);
    return ctx.render(
      <AdminAppDirectoryPage
        account={buildAccountMenuProps(ctx.state)}
        status={status}
        migrationGroups={migrationGroups}
        failures={failures}
        jobs={jobs}
        saved={ctx.url.searchParams.get("saved") ?? null}
      />,
    );
  },
  async POST(ctx) {
    const form = await ctx.req.formData().catch(() => null);
    const action = formText(form, "action");
    const kind = readJobKind(action) ?? "rescore_trending";
    const job = await enqueueAppDirectoryJob(
      kind,
      ctx.state.user?.did ?? "unknown",
    );
    const started = job.status === "queued"
      ? startAppDirectoryJob(job.id)
      : false;
    return new Response(null, {
      status: 303,
      headers: {
        location: `/admin/app-directory?saved=${
          started ? "queued" : "queued-worker"
        }&job=${encodeURIComponent(job.id)}`,
      },
    });
  },
});

function AdminAppDirectoryPage(
  {
    account,
    status,
    migrationGroups,
    failures,
    jobs,
    saved,
  }: {
    account: ReturnType<typeof buildAccountMenuProps>;
    status: AppDirectoryAdminStatus;
    migrationGroups: AppDirectoryMigrationDryRun[];
    failures: AppRecordFailure[];
    jobs: AppDirectoryJob[];
    saved: string | null;
  },
) {
  return (
    <div id="page-top">
      <div class="content-layer">
        <Nav account={account} />
        <section class="admin-section">
          <div class="container" style={{ maxWidth: "1080px" }}>
            <p>
              <a href="/admin" class="text-link-button">
                ← Back to admin
              </a>
            </p>
            <header class="admin-header" style={{ marginTop: "0.75rem" }}>
              <h1 class="text-section">App directory data</h1>
              <p class="text-body mt-2">
                ATStore ingestion, review/favorite completeness, trending, and
                migration status.
              </p>
              {saved === "rescored" && (
                <p class="admin-app-directory-notice">
                  Trending scores were rescored.
                </p>
              )}
              {saved === "queued" && (
                <p class="admin-app-directory-notice">
                  Job queued. Recent runs update below.
                </p>
              )}
              {saved === "queued-worker" && (
                <p class="admin-app-directory-notice">
                  Job queued. Production web does not run heavy backfills
                  in-process; run the worker task to process it.
                </p>
              )}
              {saved === "retried" && (
                <p class="admin-app-directory-notice">
                  Failed record retried and imported.
                </p>
              )}
              {saved === "failure-cleared" && (
                <p class="admin-app-directory-notice">
                  Failed record cleared.
                </p>
              )}
            </header>

            <div class="admin-grid admin-app-directory-grid">
              <StatusCard label="Listings" value={status.listings} />
              <StatusCard
                label="ATStore listings"
                value={status.atstoreListings}
              />
              <StatusCard
                label="Atmosphere listings"
                value={status.atmosphereListings}
              />
              <StatusCard label="Source records" value={status.sourceRecords} />
              <StatusCard label="Reviews" value={status.reviews} />
              <StatusCard label="Favorites" value={status.favorites} />
              <StatusCard label="Failed records" value={status.failedRecords} />
            </div>

            <section class="glass admin-app-directory-panel">
              <div>
                <p class="text-eyebrow">Freshness</p>
                <h2 class="profile-card-section-title">Ingestion status</h2>
              </div>
              <dl class="admin-app-directory-facts">
                <Fact
                  label="Latest listing record"
                  value={formatWhen(status.latestRecordIndexedAt)}
                />
                <Fact
                  label="Latest review"
                  value={formatWhen(status.latestReviewIndexedAt)}
                />
                <Fact
                  label="Latest favorite"
                  value={formatWhen(status.latestFavoriteIndexedAt)}
                />
                <Fact
                  label="Jetstream cursor"
                  value={status.jetstreamCursor == null
                    ? "Not observed"
                    : String(status.jetstreamCursor)}
                />
                <Fact
                  label="Cursor updated"
                  value={formatWhen(status.jetstreamCursorUpdatedAt)}
                />
                <Fact
                  label="ATStore listing repo"
                  value={status.configuredListingRepo ?? "Not configured"}
                />
                <Fact
                  label="Social repos"
                  value={status.configuredSocialRepos.length > 0
                    ? status.configuredSocialRepos.join(", ")
                    : "Not configured"}
                />
              </dl>
              {status.missingSocialRepoWarning && (
                <p class="admin-app-directory-warning">
                  Historical reviews/favorites are incomplete until
                  `ATSTORE_SOCIAL_REPO_DIDS` or an independent relay/replay
                  source is configured. Live Jetstream can still ingest future
                  records.
                </p>
              )}
            </section>

            <section class="glass admin-app-directory-panel">
              <div class="admin-app-directory-actions-heading">
                <div>
                  <p class="text-eyebrow">Actions</p>
                  <h2 class="profile-card-section-title">Maintenance</h2>
                </div>
                <form
                  method="POST"
                  action="/admin/app-directory"
                  class="admin-app-directory-action-form"
                >
                  <input
                    type="hidden"
                    name="action"
                    value="rescore_trending"
                  />
                  <button class="button-primary" type="submit">
                    Rescore trending
                  </button>
                </form>
              </div>
              <div class="admin-app-directory-action-grid">
                <ActionForm
                  action="backfill_listings"
                  title="Backfill listings"
                  body={status.configuredListingRepo
                    ? `Imports listing records from ${status.configuredListingRepo}.`
                    : "Needs ATSTORE_REPO_DID before it can import listing records."}
                />
                <ActionForm
                  action="backfill_social"
                  title="Backfill reviews/favorites"
                  body="Requires social repo DIDs or a relay/replay export. The web UI reports the gap so we do not imply historical totals are complete."
                />
                <ActionNote
                  title="Failed records"
                  body="Parser rejects from the worker/backfill are stored below. Re-run backfill after fixing adapters; successful records clear their failure rows."
                />
              </div>
              {jobs.length === 0
                ? (
                  <p class="text-body admin-empty">
                    No app-directory jobs have run yet.
                  </p>
                )
                : <JobList jobs={jobs} />}
            </section>

            <section class="glass admin-app-directory-panel">
              <div>
                <p class="text-eyebrow">Diagnostics</p>
                <h2 class="profile-card-section-title">
                  Failed record imports
                </h2>
              </div>
              {failures.length === 0
                ? (
                  <p class="text-body admin-empty">
                    No failed app-directory records.
                  </p>
                )
                : (
                  <div class="admin-app-directory-candidates">
                    {failures.map((failure) => (
                      <article
                        class="admin-app-directory-candidate"
                        key={failure.uri}
                      >
                        <div>
                          <h3>{failure.reason}</h3>
                          <p>{failure.uri}</p>
                          <p>
                            {failure.sourceType} · {failure.collection} · seen
                            {" "}
                            {failure.count} time{failure.count === 1 ? "" : "s"}
                          </p>
                        </div>
                        <div class="admin-app-directory-row-actions">
                          <span class="admin-app-directory-failure-time">
                            {formatWhen(failure.lastSeenAt)}
                          </span>
                          <a
                            href={`/admin/app-directory/failures/${
                              appRecordFailureId(failure.uri)
                            }`}
                            class="directory-register-button"
                          >
                            Inspect
                          </a>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
            </section>

            <section class="glass admin-app-directory-panel">
              <div>
                <p class="text-eyebrow">Migration</p>
                <h2 class="profile-card-section-title">
                  Atmosphere-only apps
                </h2>
                <p class="text-body">
                  {status.migrationCandidates}{" "}
                  candidate{status.migrationCandidates === 1 ? "" : "s"}{" "}
                  can move to ATStore records. This is a dry-run view; no
                  records are published from here.
                </p>
              </div>
              {migrationGroups.every((group) => group.candidates.length === 0)
                ? <p class="text-body admin-empty">No migration candidates.</p>
                : (
                  <div class="admin-app-directory-migration-groups">
                    {migrationGroups.map((group) => (
                      <MigrationGroup group={group} key={group.status} />
                    ))}
                  </div>
                )}
            </section>
          </div>
        </section>
        <Footer variant="compact" />
      </div>
    </div>
  );
}

function StatusCard({ label, value }: { label: string; value: number }) {
  return (
    <article class="admin-card admin-app-directory-stat">
      <p class="admin-card-count">{value}</p>
      <h2 class="admin-card-title">{label}</h2>
    </article>
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

function ActionForm(
  { action, title, body }: {
    action: AppDirectoryJobKind;
    title: string;
    body: string;
  },
) {
  return (
    <form
      method="POST"
      action="/admin/app-directory"
      class="admin-app-directory-action-note"
    >
      <input type="hidden" name="action" value={action} />
      <h3>{title}</h3>
      <p>{body}</p>
      <button class="directory-register-button" type="submit">
        Run
      </button>
    </form>
  );
}

function ActionNote({ title, body }: { title: string; body: string }) {
  return (
    <article class="admin-app-directory-action-note">
      <h3>{title}</h3>
      <p>{body}</p>
    </article>
  );
}

function JobList({ jobs }: { jobs: AppDirectoryJob[] }) {
  return (
    <div class="admin-app-directory-jobs">
      {jobs.map((job) => (
        <article class="admin-app-directory-job" key={job.id}>
          <div>
            <h3>{jobKindLabel(job.kind)}</h3>
            <p>
              {job.status} · {job.progressLabel ?? "No progress yet"} ·{" "}
              {formatWhen(job.updatedAt)}
            </p>
            {job.error && <p class="admin-app-directory-warning">{job.error}
            </p>}
          </div>
          <dl>
            <Fact label="Listings" value={String(job.listingsImported)} />
            <Fact label="Reviews" value={String(job.reviewsImported)} />
            <Fact label="Favorites" value={String(job.favoritesImported)} />
            <Fact label="Seen" value={String(job.recordsSeen)} />
            <Fact label="Failed" value={String(job.recordsFailed)} />
            <Fact label="Rescored" value={String(job.rescored)} />
          </dl>
        </article>
      ))}
    </div>
  );
}

function MigrationGroup({ group }: { group: AppDirectoryMigrationDryRun }) {
  return (
    <section class="admin-app-directory-migration-group">
      <header>
        <div>
          <h3>{group.label}</h3>
          <p>{group.description}</p>
        </div>
        <span>{group.candidates.length}</span>
      </header>
      {group.candidates.length === 0
        ? <p class="text-body admin-empty">No apps in this group.</p>
        : (
          <div class="admin-app-directory-candidates">
            {group.candidates.slice(0, 8).map((candidate) => (
              <article
                class="admin-app-directory-candidate"
                key={candidate.id}
              >
                <div>
                  <h3>{candidate.name}</h3>
                  <p>{candidate.primaryUrl ?? candidate.slug}</p>
                  {candidate.issue && (
                    <p class="admin-app-directory-warning">
                      {candidate.issue}
                    </p>
                  )}
                </div>
                <a
                  href={`/apps/${encodeURIComponent(candidate.slug)}`}
                  class="directory-register-button"
                >
                  Inspect
                </a>
              </article>
            ))}
          </div>
        )}
    </section>
  );
}

function formatWhen(value: number | null): string {
  return value ? new Date(value).toLocaleString("en-US") : "Not observed";
}

function formText(form: FormData | null, key: string): string {
  const value = form?.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function readJobKind(value: string): AppDirectoryJobKind | null {
  if (
    value === "backfill_listings" || value === "backfill_social" ||
    value === "rescore_trending"
  ) {
    return value;
  }
  return null;
}

function jobKindLabel(kind: AppDirectoryJobKind): string {
  if (kind === "backfill_listings") return "Backfill listings";
  if (kind === "backfill_social") return "Backfill reviews/favorites";
  return "Rescore trending";
}
