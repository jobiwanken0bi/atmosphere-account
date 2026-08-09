import Nav from "../../../../components/Nav.tsx";
import Footer from "../../../../components/Footer.tsx";
import DeveloperAppTestConsole from "../../../../islands/DeveloperAppTestConsole.tsx";
import LoginAppLogoReachability from "../../../../islands/LoginAppLogoReachability.tsx";
import ConfirmedActionForm from "../../../../islands/ConfirmedActionForm.tsx";
import { define } from "../../../../utils.ts";
import { proxyAppviewPageResponse } from "../../../../lib/appview-client.ts";
import { buildAccountMenuProps } from "../../../../lib/account-menu-props.ts";
import {
  buildLoginAppProductionChecks,
  buildLoginAppReadiness,
  deleteLoginAppForOwner,
  getLoginAppForOwner,
  getLoginAppProfileForOwner,
  listLoginPreferredHostChoicesForApp,
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
import {
  readFormDataRequestWithLimit,
  rejectLargeRequest,
  RequestBodyTooLargeError,
} from "../../../../lib/security.ts";
import { enforceDurableRateLimit } from "../../../../lib/rate-limit.ts";
import { type AccountHost } from "../../../../lib/account-hosts.ts";
import { developerAuthorizationHref } from "../../../../lib/oauth-entry-context.ts";
import {
  loginEnvironmentLabel,
  loginEnvironmentStatusLabel,
} from "../../../../lib/login-environment-display.ts";
import { PreferredHostField } from "../apps.tsx";
import { developerAppAccessRedirect } from "../../../../lib/developer-app-access.ts";

type LoginAppProfile = NonNullable<
  Awaited<ReturnType<typeof getLoginAppProfileForOwner>>
>;

interface DeveloperAppFormValues {
  allowedReturnUris: string;
  preferredAccountHost: string;
}

interface DeveloperAppDetailProps {
  account: ReturnType<typeof buildAccountMenuProps>;
  profile: LoginAppProfile;
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
      () => appviewUnavailable(),
    );
    if (proxied) return proxied;

    const user = ctx.state.user;
    if (!user) return redirectToSignin(ctx.url);

    const accessRedirect = await developerAppAccessRedirect(user.did).catch(
      () => appviewUnavailable(),
    );
    if (accessRedirect) return accessRedirect;

    let profile: LoginAppProfile | null;
    try {
      profile = await getLoginAppProfileForOwner(user.did);
    } catch {
      return appviewUnavailable();
    }
    if (!profile) return appviewUnavailable();

    let app: LoginApp | null;
    try {
      app = await getLoginAppForOwner(
        user.did,
        clientIdFromParams(ctx.params.clientId),
      );
    } catch {
      return appviewUnavailable();
    }
    let claimedHosts: AccountHost[];
    try {
      claimedHosts = await loadPreferredHostChoices(user.did, profile);
    } catch {
      return appviewUnavailable();
    }
    if (!app) {
      return ctx.render(
        <DeveloperAppDetailPage
          account={buildAccountMenuProps(ctx.state)}
          profile={profile}
          app={null}
          checks={[]}
          readiness={null}
          defaultOrigin={ctx.url.origin}
          values={emptyValues()}
          claimedHosts={claimedHosts}
          reviewNotes=""
          error="Login environment not found."
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
        profile={profile}
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
      () => appviewUnavailable(),
    );
    if (proxied) return proxied;

    const user = ctx.state.user;
    if (!user) return redirectToSignin(ctx.url);

    const accessRedirect = await developerAppAccessRedirect(user.did).catch(
      () => appviewUnavailable(),
    );
    if (accessRedirect) return accessRedirect;

    let profile: LoginAppProfile | null;
    try {
      profile = await getLoginAppProfileForOwner(user.did);
    } catch {
      return appviewUnavailable();
    }
    if (!profile) return appviewUnavailable();

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
    let claimedHosts: AccountHost[];
    try {
      claimedHosts = await loadPreferredHostChoices(user.did);
    } catch {
      return appviewUnavailable();
    }
    let app: LoginApp | null;
    try {
      app = await getLoginAppForOwner(user.did, clientId);
    } catch {
      return appviewUnavailable();
    }
    if (!app) {
      return ctx.render(
        <DeveloperAppDetailPage
          account={buildAccountMenuProps(ctx.state)}
          profile={profile}
          app={null}
          checks={[]}
          readiness={null}
          defaultOrigin={ctx.url.origin}
          values={emptyValues()}
          claimedHosts={claimedHosts}
          reviewNotes=""
          error="Login environment not found."
          message={null}
          status={404}
        />,
        { status: 404 },
      );
    }

    let form: FormData | null;
    try {
      form = await readFormDataRequestWithLimit(
        ctx.req,
        MAX_DEVELOPER_APP_DETAIL_FORM_BYTES,
      );
    } catch (error) {
      return new Response(
        error instanceof RequestBodyTooLargeError
          ? "request body too large"
          : "invalid login environment form",
        { status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
      );
    }
    const action = formText(form, "action");
    const values = valuesFromForm(form, app);
    const reviewNotes = formText(form, "review_notes");
    try {
      if (action === "delete") {
        return await deleteLoginEnvironmentAction(
          user.did,
          clientId,
          formText(form, "confirm_client_id"),
        );
      }
      if (action === "request-review") {
        await requestLoginAppTrustReview(user.did, clientId, reviewNotes);
        return redirectTo(`${loginAppDetailPath(clientId)}?saved=review`);
      }
      if (action !== "save") {
        throw new LoginRequestError("Unknown login environment action");
      }
      await registerLoginAppForOwner(user.did, {
        clientId,
        allowedReturnUris: splitAllowedReturnUris(values.allowedReturnUris),
        preferredAccountHost: values.preferredAccountHost,
        expectedEnvironmentRevision: formText(
          form,
          "expected_environment_revision",
        ),
      });
      return redirectTo(`${loginAppDetailPath(clientId)}?saved=environment`);
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
          profile={profile}
          app={current}
          checks={checks}
          readiness={readiness}
          defaultOrigin={ctx.url.origin}
          values={status === 409 && current ? valuesFromApp(current) : values}
          claimedHosts={claimedHosts}
          reviewNotes={reviewNotes}
          error={err instanceof LoginRequestError
            ? err.message
            : "The login environment could not be saved. Please try again."}
          message={null}
          status={status}
        />,
        { status },
      );
    }
  },
});

function appviewUnavailable(): Response {
  console.error("[appview] developer environment unavailable");
  return new Response(
    "Developer settings are temporarily unavailable.",
    {
      status: 503,
      headers: {
        "cache-control": "no-store",
        "content-type": "text/plain; charset=utf-8",
      },
    },
  );
}

export function DeveloperAppDetailPage(
  {
    account,
    profile,
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
        <section
          id="main-content"
          class="account-home-section account-dashboard-section"
        >
          <div class="container account-dashboard-container">
            <a
              href="/account/developer/apps#login-environments"
              class="account-dashboard-text-link"
            >
              <span aria-hidden="true">←</span> Back
            </a>

            {!app
              ? (
                <div class="glass account-dashboard-empty mt-4">
                  <h1 class="text-section">Login environment not found</h1>
                  <p>
                    {error ?? "This login environment could not be found."}
                  </p>
                </div>
              )
              : (
                <>
                  <header class="glass account-dashboard-hero account-developer-hero">
                    <div
                      class="login-picker-app-mark account-developer-hero-app-mark"
                      aria-hidden="true"
                    >
                      {profile.logoUri
                        ? (
                          <img
                            src={profile.logoUri}
                            alt=""
                            loading="lazy"
                            decoding="async"
                          />
                        )
                        : <span>{profile.name.slice(0, 1).toUpperCase()}</span>}
                    </div>
                    <div>
                      <p class="text-eyebrow">Login environment</p>
                      <h1 class="text-section">
                        {loginEnvironmentLabel(app.clientId)}
                      </h1>
                      <p class="text-body mt-2">
                        Manage the client ID and exact return URLs for{" "}
                        {profile.name}. Its name, homepage, and logo come from
                        the app profile.
                      </p>
                    </div>
                    <span class={`login-picker-status is-${app.status}`}>
                      {loginEnvironmentStatusLabel(app.status)}
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
                    <form
                      method="post"
                      class="glass account-developer-form"
                      data-submit-once="true"
                    >
                      <input type="hidden" name="action" value="save" />
                      <input
                        type="hidden"
                        name="expected_environment_revision"
                        value={app.environmentRevision ?? ""}
                      />
                      <div class="account-dashboard-section-head account-developer-form-head">
                        <div>
                          <p class="text-eyebrow">Environment settings</p>
                          <h2>Edit login environment</h2>
                          <p>
                            Security changes to a trusted environment will
                            return it to review.
                          </p>
                        </div>
                      </div>

                      <label class="profile-form-field">
                        <span class="profile-form-label">Client ID</span>
                        <input
                          class="profile-form-input"
                          type="url"
                          value={app.clientId}
                          disabled
                        />
                        <span class="profile-form-hint">
                          Add another environment if you need a different client
                          ID.
                        </span>
                      </label>

                      <label class="profile-form-field">
                        <span class="profile-form-label">
                          Exact return URLs
                        </span>
                        <textarea
                          class="profile-form-input account-developer-textarea"
                          name="allowed_return_uris"
                          rows={6}
                          required
                        >
                          {values.allowedReturnUris}
                        </textarea>
                        <span class="profile-form-hint">
                          One per line. Scheme, host, port, path, and query must
                          match exactly.
                        </span>
                      </label>

                      <PreferredHostField
                        hosts={claimedHosts}
                        value={values.preferredAccountHost}
                      />

                      <div class="account-developer-form-actions">
                        <button
                          type="submit"
                          class="profile-form-button-primary"
                          data-pending-label="Saving changes…"
                        >
                          <span data-submit-once-label>Save changes</span>
                        </button>
                      </div>
                    </form>

                    <aside class="account-developer-side">
                      <section class="glass account-developer-state-card">
                        <p class="text-eyebrow">App identity</p>
                        <div class="account-developer-profile-link-row">
                          <strong>{profile.name}</strong>
                          <a
                            href={`/apps/manage?app=${
                              encodeURIComponent(profile.listingId)
                            }`}
                            class="account-dashboard-text-link"
                          >
                            Edit profile
                          </a>
                        </div>
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
                              data-submit-once="true"
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
                                data-pending-label="Requesting review…"
                              >
                                <span data-submit-once-label>
                                  {app.reviewStatus === "requested"
                                    ? "Update review request"
                                    : "Request trusted review"}
                                </span>
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
                          These checks cover the client ID, exact callbacks,
                          derived app identity, HTTPS, domain alignment, and
                          review status.
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

                  <section class="glass account-developer-danger-card">
                    <div>
                      <p class="text-eyebrow">Danger zone</p>
                      <h2>Delete environment</h2>
                      <p>
                        Remove this client ID and its return URLs. Apps using it
                        will no longer be able to start Login with Atmosphere.
                      </p>
                    </div>
                    <ConfirmedActionForm
                      action={loginAppDetailPath(app.clientId)}
                      fields={{
                        action: "delete",
                        confirm_client_id: app.clientId,
                      }}
                      label="Delete environment"
                      confirmation={`Delete ${
                        loginEnvironmentLabel(app.clientId)
                      }? Apps using this client ID will stop working with the Login with Atmosphere picker.`}
                      buttonClass="profile-form-button-danger"
                    />
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
  try {
    return decodeURIComponent(value ?? "");
  } catch {
    return "";
  }
}

function redirectToSignin(url: URL): Response {
  return redirectTo(developerAuthorizationHref(url));
}

function redirectTo(location: string): Response {
  return new Response(null, { status: 303, headers: { location } });
}

export async function deleteLoginEnvironmentAction(
  ownerDid: string,
  clientId: string,
  confirmedClientId: string,
  remove: (
    ownerDid: string,
    clientId: string,
  ) => Promise<boolean> = deleteLoginAppForOwner,
): Promise<Response> {
  if (confirmedClientId !== clientId) {
    throw new LoginRequestError(
      "Reload this login environment before deleting it.",
      409,
    );
  }
  if (!await remove(ownerDid, clientId)) {
    throw new LoginRequestError("Login environment not found", 404);
  }
  return redirectTo(
    "/account/developer/apps?deleted=1#login-environments",
  );
}

function emptyValues(): DeveloperAppFormValues {
  return {
    allowedReturnUris: "",
    preferredAccountHost: "",
  };
}

function valuesFromApp(app: LoginApp): DeveloperAppFormValues {
  return {
    allowedReturnUris: app.allowedReturnUris.join("\n"),
    preferredAccountHost: app.preferredAccountHost ?? "",
  };
}

function valuesFromForm(
  form: FormData | null,
  fallback: LoginApp,
): DeveloperAppFormValues {
  return {
    allowedReturnUris: formText(form, "allowed_return_uris") ||
      fallback.allowedReturnUris.join("\n"),
    preferredAccountHost: form?.has("preferred_account_host")
      ? formText(form, "preferred_account_host")
      : fallback.preferredAccountHost ?? "",
  };
}

async function loadPreferredHostChoices(
  did: string,
  profile?: LoginAppProfile,
): Promise<AccountHost[]> {
  return await listLoginPreferredHostChoicesForApp(did, profile);
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
  if (value === "environment") return "Login environment updated.";
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
    return "This environment is shown as trusted for the app in the picker.";
  }
  if (app.status === "blocked") {
    return "This environment cannot use Login with Atmosphere.";
  }
  if (app.reviewStatus === "requested") {
    return "This environment is in the trust review queue.";
  }
  if (app.reviewStatus === "rejected") {
    return "The last trusted review request was not approved. Update details and request review again.";
  }
  return "Request review when the app profile and exact return URLs are ready.";
}

function noticeTone(app: LoginApp): "trusted" | "development" | "unverified" {
  if (app.status === "trusted") return "trusted";
  if (app.status === "development") return "development";
  return "unverified";
}

function noticeCopy(app: LoginApp): string {
  if (app.status === "trusted") {
    return "This app identity and its allowed return URLs have been reviewed.";
  }
  if (app.status === "development") {
    return "This looks like a local development app. Only continue if you opened this flow yourself.";
  }
  if (app.status === "blocked") {
    return "This app is unavailable for Login with Atmosphere.";
  }
  return "This login environment has not been reviewed yet. Check the app profile and exact return URLs before continuing.";
}
