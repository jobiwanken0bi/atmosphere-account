import Nav from "../../../../components/Nav.tsx";
import Footer from "../../../../components/Footer.tsx";
import DeveloperAppTestConsole from "../../../../islands/DeveloperAppTestConsole.tsx";
import LoginAppLogoReachability from "../../../../islands/LoginAppLogoReachability.tsx";
import { define } from "../../../../utils.ts";
import { proxyAppviewPageResponse } from "../../../../lib/appview-client.ts";
import { buildAccountMenuProps } from "../../../../lib/account-menu-props.ts";
import {
  buildLoginAppProductionChecks,
  buildLoginAppReadiness,
  getLoginAppForOwner,
  type LoginApp,
  loginAppDetailPath,
  type LoginAppIdentityCheck,
  type LoginAppReadiness,
  loginAppStatusLabel,
  LoginRequestError,
  registerLoginAppForOwner,
  requestLoginAppTrustReview,
  splitAllowedReturnUris,
} from "../../../../lib/atmosphere-login.ts";
import { rejectLargeRequest } from "../../../../lib/security.ts";
import { enforceDurableRateLimit } from "../../../../lib/rate-limit.ts";
import {
  type AccountHost,
  listClaimedAccountHostsForOwner,
} from "../../../../lib/account-hosts.ts";

interface DeveloperAppFormValues {
  appName: string;
  appUri: string;
  logoUri: string;
  allowedReturnUris: string;
  preferredAccountHost: string;
}

interface DeveloperAppDetailProps {
  account: ReturnType<typeof buildAccountMenuProps>;
  app: LoginApp | null;
  checks: LoginAppIdentityCheck[];
  readiness: LoginAppReadiness | null;
  defaultOrigin: string;
  values: DeveloperAppFormValues;
  claimedHosts: AccountHost[];
  reviewNotes: string;
  error: string | null;
  message: string | null;
  status: number;
}

const MAX_DEVELOPER_APP_DETAIL_FORM_BYTES = 32_768;

export const handler = define.handlers({
  async GET(ctx) {
    const proxied = await proxyAppviewPageResponse(ctx.url, ctx.req).catch(
      (err) => appviewUnavailable("developer app detail page", err),
    );
    if (proxied) return proxied;

    const user = ctx.state.user;
    if (!user) return redirectToSignin(ctx.url);

    const [app, claimedHosts] = await Promise.all([
      getLoginAppForOwner(
        user.did,
        clientIdFromParams(ctx.params.clientId),
      ).catch(() => null),
      loadPreferredHostChoices(user.did),
    ]);
    if (!app) {
      return ctx.render(
        <DeveloperAppDetailPage
          account={buildAccountMenuProps(ctx.state)}
          app={null}
          checks={[]}
          readiness={null}
          defaultOrigin={ctx.url.origin}
          values={emptyValues()}
          claimedHosts={claimedHosts}
          reviewNotes=""
          error="App registration not found."
          message={null}
          status={404}
        />,
        { status: 404 },
      );
    }

    const checks = await buildLoginAppProductionChecks(app);
    const readiness = buildLoginAppReadiness(app, checks);
    return ctx.render(
      <DeveloperAppDetailPage
        account={buildAccountMenuProps(ctx.state)}
        app={app}
        checks={checks}
        readiness={readiness}
        defaultOrigin={ctx.url.origin}
        values={valuesFromApp(app)}
        claimedHosts={claimedHosts}
        reviewNotes={app.reviewNotes ?? ""}
        error={null}
        message={messageFor(ctx.url.searchParams.get("saved"))}
        status={200}
      />,
    );
  },

  async POST(ctx) {
    const proxied = await proxyAppviewPageResponse(ctx.url, ctx.req).catch(
      (err) => appviewUnavailable("developer app detail update", err),
    );
    if (proxied) return proxied;

    const user = ctx.state.user;
    if (!user) return redirectToSignin(ctx.url);

    const limited = await enforceDurableRateLimit(ctx.req, {
      scope: "developer-app-update",
      capacity: 20,
      refillMs: 60_000,
    });
    if (limited) return limited;

    const large = rejectLargeRequest(
      ctx.req,
      MAX_DEVELOPER_APP_DETAIL_FORM_BYTES,
    );
    if (large) return large;

    const clientId = clientIdFromParams(ctx.params.clientId);
    const claimedHosts = await loadPreferredHostChoices(user.did);
    const app = await getLoginAppForOwner(user.did, clientId).catch(() => null);
    if (!app) {
      return ctx.render(
        <DeveloperAppDetailPage
          account={buildAccountMenuProps(ctx.state)}
          app={null}
          checks={[]}
          readiness={null}
          defaultOrigin={ctx.url.origin}
          values={emptyValues()}
          claimedHosts={claimedHosts}
          reviewNotes=""
          error="App registration not found."
          message={null}
          status={404}
        />,
        { status: 404 },
      );
    }

    const form = await ctx.req.formData().catch(() => null);
    const action = formText(form, "action");
    const values = valuesFromForm(form, app);
    const reviewNotes = formText(form, "review_notes");
    try {
      if (action === "request-review") {
        await requestLoginAppTrustReview(user.did, clientId, reviewNotes);
        return redirectTo(`${loginAppDetailPath(clientId)}?saved=review`);
      }
      await registerLoginAppForOwner(user.did, {
        appName: values.appName,
        clientId,
        appUri: values.appUri,
        logoUri: values.logoUri,
        allowedReturnUris: splitAllowedReturnUris(values.allowedReturnUris),
        preferredAccountHost: values.preferredAccountHost,
      });
      return redirectTo(`${loginAppDetailPath(clientId)}?saved=app`);
    } catch (err) {
      const current = await getLoginAppForOwner(user.did, clientId).catch(() =>
        app
      );
      const checks = current
        ? await buildLoginAppProductionChecks(current)
        : [];
      const readiness = current
        ? buildLoginAppReadiness(current, checks)
        : null;
      const status = err instanceof LoginRequestError ? err.status : 400;
      return ctx.render(
        <DeveloperAppDetailPage
          account={buildAccountMenuProps(ctx.state)}
          app={current}
          checks={checks}
          readiness={readiness}
          defaultOrigin={ctx.url.origin}
          values={values}
          claimedHosts={claimedHosts}
          reviewNotes={reviewNotes}
          error={err instanceof Error ? err.message : String(err)}
          message={null}
          status={status}
        />,
        { status },
      );
    }
  },
});

function appviewUnavailable(scope: string, err: unknown): Response {
  console.error(`[appview] ${scope} proxy failed:`, err);
  return new Response(
    "Developer app registration is temporarily unavailable.",
    {
      status: 503,
      headers: {
        "cache-control": "no-store",
        "content-type": "text/plain; charset=utf-8",
      },
    },
  );
}

function DeveloperAppDetailPage(
  {
    account,
    app,
    checks,
    readiness,
    defaultOrigin,
    values,
    claimedHosts,
    reviewNotes,
    error,
    message,
  }: DeveloperAppDetailProps,
) {
  return (
    <div id="page-top">
      <div class="content-layer">
        <Nav account={account} />
        <section class="account-home-section account-dashboard-section">
          <div class="container account-dashboard-container">
            <a
              href="/account/developer/apps#registered-apps"
              class="account-dashboard-text-link"
            >
              Back to developer apps
            </a>

            {!app
              ? (
                <div class="glass account-dashboard-empty mt-4">
                  <h1>App not found</h1>
                  <p>{error ?? "This app registration could not be found."}</p>
                </div>
              )
              : (
                <>
                  <header class="glass account-dashboard-hero account-developer-hero">
                    <div
                      class="login-picker-app-mark account-developer-hero-app-mark"
                      aria-hidden="true"
                    >
                      {app.logoUri
                        ? (
                          <img
                            src={app.logoUri}
                            alt=""
                            loading="lazy"
                            decoding="async"
                          />
                        )
                        : <span>{app.appName.slice(0, 1).toUpperCase()}</span>}
                    </div>
                    <div>
                      <p class="text-eyebrow">Developer app</p>
                      <h1 class="text-section">{app.appName}</h1>
                      <p class="text-body mt-2">
                        Edit app identity, request trusted review, and confirm
                        the exact return URIs Atmosphere can send selection
                        tokens back to.
                      </p>
                    </div>
                    <span class={`login-picker-status is-${app.status}`}>
                      {loginAppStatusLabel(app.status)}
                    </span>
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

                  {readiness && (
                    <RunChecksPanel
                      app={app}
                      checks={checks}
                      readiness={readiness}
                    />
                  )}

                  <div class="account-developer-detail-grid">
                    <form method="post" class="glass account-developer-form">
                      <input type="hidden" name="action" value="save" />
                      <div class="account-dashboard-section-head account-developer-form-head">
                        <div>
                          <p class="text-eyebrow">App identity</p>
                          <h2>Edit registration</h2>
                          <p>
                            Changes to a trusted app will return it to review so
                            the picker never implies stale trust.
                          </p>
                        </div>
                      </div>

                      <label class="profile-form-field">
                        <span class="profile-form-label">App name</span>
                        <input
                          class="profile-form-input"
                          type="text"
                          name="app_name"
                          value={values.appName}
                          autocomplete="off"
                          required
                        />
                      </label>

                      <label class="profile-form-field">
                        <span class="profile-form-label">Client ID</span>
                        <input
                          class="profile-form-input"
                          type="url"
                          value={app.clientId}
                          disabled
                        />
                        <span class="profile-form-hint">
                          Create a new app registration if you need to change
                          the client ID.
                        </span>
                      </label>

                      <label class="profile-form-field">
                        <span class="profile-form-label">Homepage</span>
                        <input
                          class="profile-form-input"
                          type="url"
                          name="app_uri"
                          value={values.appUri}
                          autocomplete="off"
                          required
                        />
                      </label>

                      <label class="profile-form-field">
                        <span class="profile-form-label">Logo URL</span>
                        <input
                          class="profile-form-input"
                          type="url"
                          name="logo_uri"
                          value={values.logoUri}
                          autocomplete="off"
                        />
                      </label>

                      <label class="profile-form-field">
                        <span class="profile-form-label">
                          Allowed return URIs
                        </span>
                        <textarea
                          class="profile-form-input account-developer-textarea"
                          name="allowed_return_uris"
                          rows={6}
                          required
                        >
                          {values.allowedReturnUris}
                        </textarea>
                      </label>

                      <label class="profile-form-field">
                        <span class="profile-form-label">
                          Preferred account host
                        </span>
                        <select
                          class="profile-form-input"
                          name="preferred_account_host"
                          value={values.preferredAccountHost}
                        >
                          <option value="">No preferred host</option>
                          {claimedHosts.map((host) => (
                            <option value={host.host} key={host.host}>
                              {host.displayName} ({host.host})
                            </option>
                          ))}
                        </select>
                        <span class="profile-form-hint">
                          Only a joinable host claimed by this account can be
                          pinned as a recommendation. People can always choose
                          another host.
                        </span>
                      </label>

                      <div class="account-developer-form-actions">
                        <button
                          type="submit"
                          class="profile-form-button-primary"
                        >
                          Save changes
                        </button>
                      </div>
                    </form>

                    <aside class="account-developer-side">
                      <section class="glass account-developer-state-card">
                        <p class="text-eyebrow">Picker preview</p>
                        <PickerPreview app={app} />
                      </section>

                      <section class="glass account-developer-state-card">
                        <p class="text-eyebrow">Review</p>
                        <h2>{reviewHeading(app)}</h2>
                        <p class="account-developer-review-copy">
                          {reviewCopy(app)}
                        </p>
                        {app.reviewDecisionReason && (
                          <p class="account-developer-review-note">
                            {app.reviewDecisionReason}
                          </p>
                        )}
                        {app.status !== "trusted" && app.status !== "blocked" &&
                          (
                            <form
                              method="post"
                              class="account-developer-review-form"
                            >
                              <input
                                type="hidden"
                                name="action"
                                value="request-review"
                              />
                              <label class="profile-form-field">
                                <span class="profile-form-label">
                                  Review notes
                                </span>
                                <textarea
                                  class="profile-form-input account-developer-textarea account-developer-textarea--small"
                                  name="review_notes"
                                  rows={4}
                                  placeholder="Tell us what the app does, who maintains it, and which domains should be trusted."
                                  required
                                >
                                  {reviewNotes}
                                </textarea>
                              </label>
                              <button
                                type="submit"
                                disabled={readiness?.state !== "ready"}
                                class="profile-form-button-secondary profile-form-button-secondary--lg"
                              >
                                {app.reviewStatus === "requested"
                                  ? "Update review request"
                                  : "Request trusted review"}
                              </button>
                              {readiness?.state !== "ready" && (
                                <p class="profile-form-hint">
                                  Run checks must be ready before trusted review
                                  can be requested.
                                </p>
                              )}
                            </form>
                          )}
                      </section>
                    </aside>
                  </div>

                  <section class="account-developer-list">
                    <div class="account-dashboard-section-head">
                      <div>
                        <p class="text-eyebrow">Run checks</p>
                        <h2 id="production-checks">Production checks</h2>
                        <p>
                          These checks cover client ID shape, homepage, logo,
                          HTTPS, exact callbacks, loopback URLs, domain
                          alignment, and review status.
                        </p>
                      </div>
                    </div>
                    <div class="account-developer-check-grid">
                      {checks.map((check) => (
                        <IdentityCheckCard key={check.key} check={check} />
                      ))}
                      <LoginAppLogoReachability url={app.logoUri} />
                    </div>
                  </section>

                  <DeveloperAppTestConsole
                    app={{
                      clientId: app.clientId,
                      appName: app.appName,
                      appUri: app.appUri,
                      logoUri: app.logoUri,
                      allowedReturnUris: app.allowedReturnUris,
                      status: app.status,
                    }}
                    defaultOrigin={defaultOrigin}
                  />

                  <section class="account-developer-list">
                    <div class="account-dashboard-section-head">
                      <div>
                        <p class="text-eyebrow">Return URI allow-list</p>
                        <h2>Exact callbacks</h2>
                        <p>
                          Registered production apps can only receive selection
                          tokens at these exact destinations.
                        </p>
                      </div>
                    </div>
                    <div class="glass account-developer-uri-list">
                      {app.allowedReturnUris.map((uri) => (
                        <code key={uri}>{uri}</code>
                      ))}
                    </div>
                  </section>
                </>
              )}
          </div>
        </section>
        <Footer variant="compact" />
      </div>
    </div>
  );
}

function PickerPreview({ app }: { app: LoginApp }) {
  return (
    <div class="login-picker-card account-developer-picker-preview">
      <header class="login-picker-app">
        <span class="login-picker-app-mark" aria-hidden="true">
          {app.logoUri
            ? <img src={app.logoUri} alt="" loading="lazy" decoding="async" />
            : <span>{app.appName.slice(0, 1).toUpperCase()}</span>}
        </span>
        <div class="login-picker-app-copy">
          <p class="login-picker-label">Continue to</p>
          <h2>{app.appName}</h2>
          <p>{displayUrl(app.appUri)}</p>
        </div>
        <span class={`login-picker-status is-${app.status}`}>
          {loginAppStatusLabel(app.status)}
        </span>
      </header>
      <div
        class={`login-picker-notice login-picker-notice--${noticeTone(app)}`}
      >
        <strong>{loginAppStatusLabel(app.status)}</strong>
        <span>{noticeCopy(app)}</span>
      </div>
    </div>
  );
}

function IdentityCheckCard({ check }: { check: LoginAppIdentityCheck }) {
  return (
    <article class={`glass account-developer-check is-${check.status}`}>
      <span>
        {check.status === "pass"
          ? "Pass"
          : check.status === "warn"
          ? "Check"
          : "Fix"}
      </span>
      <h3>{check.label}</h3>
      <p>{check.body}</p>
      {check.href && (
        <a
          href={check.href}
          target="_blank"
          rel="noopener noreferrer"
          class="account-dashboard-text-link"
        >
          {check.hrefLabel ?? "Open"}
        </a>
      )}
    </article>
  );
}

function RunChecksPanel(
  { app, checks, readiness }: {
    app: LoginApp;
    checks: LoginAppIdentityCheck[];
    readiness: LoginAppReadiness;
  },
) {
  const passCount = checks.filter((check) => check.status === "pass").length;
  const warnCount = checks.filter((check) => check.status === "warn").length;
  const failCount = checks.filter((check) => check.status === "fail").length;
  return (
    <section class={`glass account-developer-run-checks is-${readiness.tone}`}>
      <div class="account-developer-run-checks-copy">
        <p class="text-eyebrow">Run checks</p>
        <h2>{readiness.label}</h2>
        <p>{readiness.body}</p>
        <div class="account-developer-check-counts" aria-label="Check summary">
          <span>{passCount} pass</span>
          <span>{warnCount} check</span>
          <span>{failCount} fix</span>
        </div>
      </div>
      <div class="account-developer-run-checks-actions">
        <span class={`account-developer-readiness-pill is-${readiness.state}`}>
          {readiness.label}
        </span>
        <a
          class="profile-form-button-secondary profile-form-button-secondary--lg"
          href={`${loginAppDetailPath(app.clientId)}#production-checks`}
        >
          Run checks
        </a>
      </div>
    </section>
  );
}

function clientIdFromParams(value: string | undefined): string {
  return decodeURIComponent(value ?? "");
}

function redirectToSignin(url: URL): Response {
  return redirectTo(
    `/signin?next=${encodeURIComponent(url.pathname + url.search)}`,
  );
}

function redirectTo(location: string): Response {
  return new Response(null, { status: 303, headers: { location } });
}

function emptyValues(): DeveloperAppFormValues {
  return {
    appName: "",
    appUri: "",
    logoUri: "",
    allowedReturnUris: "",
    preferredAccountHost: "",
  };
}

function valuesFromApp(app: LoginApp): DeveloperAppFormValues {
  return {
    appName: app.appName,
    appUri: app.appUri ?? "",
    logoUri: app.logoUri ?? "",
    allowedReturnUris: app.allowedReturnUris.join("\n"),
    preferredAccountHost: app.preferredAccountHost ?? "",
  };
}

function valuesFromForm(
  form: FormData | null,
  fallback: LoginApp,
): DeveloperAppFormValues {
  return {
    appName: formText(form, "app_name") || fallback.appName,
    appUri: formText(form, "app_uri") || fallback.appUri || "",
    logoUri: formText(form, "logo_uri"),
    allowedReturnUris: formText(form, "allowed_return_uris") ||
      fallback.allowedReturnUris.join("\n"),
    preferredAccountHost: formText(form, "preferred_account_host"),
  };
}

async function loadPreferredHostChoices(did: string): Promise<AccountHost[]> {
  const hosts = await listClaimedAccountHostsForOwner(did).catch(() => []);
  return hosts.filter((host) =>
    !!host.signupUrl &&
    (host.signupStatus === "open" || host.signupStatus === "invite_required")
  );
}

function formText(form: FormData | null, key: string): string {
  const value = form?.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function displayUrl(value: string | null): string {
  if (!value) return "No homepage";
  try {
    return new URL(value).hostname;
  } catch {
    return value;
  }
}

function messageFor(value: string | null): string | null {
  if (value === "app") return "App registration updated.";
  if (value === "review") return "Trusted review requested.";
  return null;
}

function reviewHeading(app: LoginApp): string {
  if (app.status === "trusted") return "Trusted";
  if (app.status === "blocked") return "Blocked";
  if (app.reviewStatus === "requested") return "Review requested";
  if (app.reviewStatus === "rejected") return "Review needed";
  return "Request trusted review";
}

function reviewCopy(app: LoginApp): string {
  if (app.status === "trusted") {
    return "This app is shown as trusted in the picker.";
  }
  if (app.status === "blocked") {
    return "This app cannot use Atmosphere Login.";
  }
  if (app.reviewStatus === "requested") {
    return "Atmosphere has this app in the trust review queue.";
  }
  if (app.reviewStatus === "rejected") {
    return "The last trusted review request was not approved. Update details and request review again.";
  }
  return "Request review when the app identity, logo, homepage, and exact return URIs are ready.";
}

function noticeTone(app: LoginApp): "trusted" | "development" | "unverified" {
  if (app.status === "trusted") return "trusted";
  if (app.status === "development") return "development";
  return "unverified";
}

function noticeCopy(app: LoginApp): string {
  if (app.status === "trusted") {
    return "Atmosphere has reviewed this app identity and its allowed return URIs.";
  }
  if (app.status === "development") {
    return "This looks like a local development app. Only continue if you opened this flow yourself.";
  }
  if (app.status === "blocked") {
    return "This app is unavailable for Atmosphere Login.";
  }
  return "This app has not been reviewed by Atmosphere yet. Check the app name, logo, and homepage before continuing.";
}
