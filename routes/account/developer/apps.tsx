import Nav from "../../../components/Nav.tsx";
import Footer from "../../../components/Footer.tsx";
import AtmosphereHandle from "../../../components/AtmosphereHandle.tsx";
import { define } from "../../../utils.ts";
import { proxyAppviewPageResponse } from "../../../lib/appview-client.ts";
import { buildAccountMenuProps } from "../../../lib/account-menu-props.ts";
import {
  listLoginAppsForOwner,
  type LoginApp,
  loginAppDetailPath,
  loginAppStatusLabel,
  LoginRequestError,
  registerLoginAppForOwner,
  splitAllowedReturnUris,
} from "../../../lib/atmosphere-login.ts";
import { rejectLargeRequest } from "../../../lib/security.ts";
import { enforceDurableRateLimit } from "../../../lib/rate-limit.ts";

interface DeveloperAppFormValues {
  appName: string;
  clientId: string;
  appUri: string;
  logoUri: string;
  allowedReturnUris: string;
}

interface DeveloperAppsPageProps {
  account: ReturnType<typeof buildAccountMenuProps>;
  handle: string;
  apps: LoginApp[];
  values: DeveloperAppFormValues;
  error: string | null;
  saved: boolean;
}

const MAX_DEVELOPER_APP_FORM_BYTES = 32_768;

export const handler = define.handlers({
  async GET(ctx) {
    const proxied = await proxyAppviewPageResponse(ctx.url, ctx.req).catch(
      (err) => appviewUnavailable("developer apps page", err),
    );
    if (proxied) return proxied;

    const user = ctx.state.user;
    if (!user) {
      return redirectToSignin(ctx.url);
    }
    const apps = await listLoginAppsForOwner(user.did).catch(() => []);
    return ctx.render(
      <DeveloperAppsPage
        account={buildAccountMenuProps(ctx.state)}
        handle={user.handle}
        apps={apps}
        values={emptyValues()}
        error={null}
        saved={ctx.url.searchParams.get("saved") === "1"}
      />,
    );
  },

  async POST(ctx) {
    const proxied = await proxyAppviewPageResponse(ctx.url, ctx.req).catch(
      (err) => appviewUnavailable("developer app registration", err),
    );
    if (proxied) return proxied;

    const user = ctx.state.user;
    if (!user) {
      return redirectToSignin(ctx.url);
    }
    const limited = await enforceDurableRateLimit(ctx.req, {
      scope: "developer-app-registration",
      capacity: 12,
      refillMs: 60_000,
    });
    if (limited) return limited;
    const large = rejectLargeRequest(ctx.req, MAX_DEVELOPER_APP_FORM_BYTES);
    if (large) return large;
    const form = await ctx.req.formData().catch(() => null);
    const values = valuesFromForm(form);
    try {
      await registerLoginAppForOwner(user.did, {
        appName: values.appName,
        clientId: values.clientId,
        appUri: values.appUri,
        logoUri: values.logoUri,
        allowedReturnUris: splitAllowedReturnUris(values.allowedReturnUris),
      });
      return new Response(null, {
        status: 303,
        headers: {
          location: "/account/developer/apps?saved=1#registered-apps",
        },
      });
    } catch (err) {
      const apps = await listLoginAppsForOwner(user.did).catch(() => []);
      const status = err instanceof LoginRequestError ? err.status : 400;
      return ctx.render(
        <DeveloperAppsPage
          account={buildAccountMenuProps(ctx.state)}
          handle={user.handle}
          apps={apps}
          values={values}
          error={err instanceof Error ? err.message : String(err)}
          saved={false}
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

function DeveloperAppsPage(
  { account, handle, apps, values, error, saved }: DeveloperAppsPageProps,
) {
  return (
    <div id="page-top">
      <div class="content-layer">
        <Nav account={account} />
        <section class="account-home-section account-dashboard-section">
          <div class="container account-dashboard-container">
            <a href="/account#applications" class="account-dashboard-text-link">
              Back to account
            </a>

            <header class="glass account-dashboard-hero account-developer-hero">
              <div class="account-dashboard-hero-mark" aria-hidden="true">
                <img src="/union.svg" alt="" width="36" height="36" />
              </div>
              <div>
                <p class="text-eyebrow">Developer apps</p>
                <h1 class="text-section">Register apps for Atmosphere Login</h1>
                <p class="text-body mt-2">
                  App registrations are owned by{" "}
                  <AtmosphereHandle handle={handle} />. Production apps must use
                  exact allowed return URIs before the picker will send back a
                  selection token.
                </p>
              </div>
            </header>

            <div class="account-developer-grid">
              <form method="post" class="glass account-developer-form">
                <div class="account-dashboard-section-head account-developer-form-head">
                  <div>
                    <p class="text-eyebrow">Register app</p>
                    <h2>App identity</h2>
                    <p>
                      This is what people see in the shared picker before your
                      app starts its own AT Protocol OAuth flow.
                    </p>
                  </div>
                </div>

                {saved && (
                  <p class="profile-form-status profile-form-status--ok">
                    App registration saved.
                  </p>
                )}
                {error && (
                  <p class="profile-form-status profile-form-status--error">
                    {error}
                  </p>
                )}

                <label class="profile-form-field">
                  <span class="profile-form-label">App name</span>
                  <input
                    class="profile-form-input"
                    type="text"
                    name="app_name"
                    value={values.appName}
                    placeholder="Example App"
                    autocomplete="off"
                    required
                  />
                </label>

                <label class="profile-form-field">
                  <span class="profile-form-label">Client ID</span>
                  <input
                    class="profile-form-input"
                    type="url"
                    name="client_id"
                    value={values.clientId}
                    placeholder="https://app.example.com/oauth/client-metadata.json"
                    autocomplete="off"
                    required
                  />
                  <span class="profile-form-hint">
                    Use HTTPS in production. Loopback HTTP is only accepted for
                    local development.
                  </span>
                </label>

                <label class="profile-form-field">
                  <span class="profile-form-label">Homepage</span>
                  <input
                    class="profile-form-input"
                    type="url"
                    name="app_uri"
                    value={values.appUri}
                    placeholder="https://app.example.com"
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
                    placeholder="https://app.example.com/icon.png"
                    autocomplete="off"
                  />
                  <span class="profile-form-hint">
                    Optional, but strongly recommended so the picker can show a
                    recognizable app mark.
                  </span>
                </label>

                <label class="profile-form-field">
                  <span class="profile-form-label">Allowed return URIs</span>
                  <textarea
                    class="profile-form-input account-developer-textarea"
                    name="allowed_return_uris"
                    rows={5}
                    placeholder={`https://app.example.com/auth/atmosphere/selected\nhttps://app.example.com/oauth/callback`}
                    required
                  >
                    {values.allowedReturnUris}
                  </textarea>
                  <span class="profile-form-hint">
                    One per line. Production matching is exact, including path,
                    query, scheme, host, and port.
                  </span>
                </label>

                <div class="account-developer-form-actions">
                  <button type="submit" class="profile-form-button-primary">
                    Register app
                  </button>
                  <a
                    href="/docs/atmosphere-login#register-app"
                    class="profile-form-button-secondary profile-form-button-secondary--lg"
                  >
                    Read the rules
                  </a>
                </div>
              </form>

              <aside class="account-developer-side">
                <section class="glass account-developer-state-card">
                  <p class="text-eyebrow">Review states</p>
                  <h2>What the picker will show</h2>
                  <ReviewState
                    status="development"
                    body="Loopback-only local apps. Useful while developing on this machine."
                  />
                  <ReviewState
                    status="unverified"
                    body="Self-registered production apps. The picker warns people before they continue."
                  />
                  <ReviewState
                    status="trusted"
                    body="Reviewed apps with a verified identity and exact return URI allow-list."
                  />
                  <ReviewState
                    status="blocked"
                    body="Apps that cannot use Atmosphere Login."
                  />
                </section>
              </aside>
            </div>

            <section id="registered-apps" class="account-developer-list">
              <div class="account-dashboard-section-head">
                <div>
                  <p class="text-eyebrow">
                    Owned by <AtmosphereHandle handle={handle} />
                  </p>
                  <h2>Registered apps</h2>
                  <p>
                    These apps can open the Atmosphere picker with the exact
                    allowed return URIs listed below.
                  </p>
                </div>
                <span class="account-home-pill">{apps.length} apps</span>
              </div>
              {apps.length === 0
                ? (
                  <div class="glass account-dashboard-empty">
                    <h3>No developer apps yet</h3>
                    <p>
                      Register your first app to give the picker a clear name,
                      logo, homepage, and return URI allow-list.
                    </p>
                  </div>
                )
                : (
                  <div class="account-developer-app-grid">
                    {apps.map((app) => (
                      <DeveloperAppCard key={app.clientId} app={app} />
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

function ReviewState(
  { status, body }: { status: LoginApp["status"]; body: string },
) {
  return (
    <article class={`account-developer-review-state is-${status}`}>
      <span>{loginAppStatusLabel(status)}</span>
      <p>{body}</p>
    </article>
  );
}

function DeveloperAppCard({ app }: { app: LoginApp }) {
  return (
    <article class="glass account-developer-app-card">
      <div class="account-developer-app-top">
        <span class="login-picker-app-mark" aria-hidden="true">
          {app.logoUri
            ? <img src={app.logoUri} alt="" loading="lazy" decoding="async" />
            : <span>{app.appName.slice(0, 1).toUpperCase()}</span>}
        </span>
        <div>
          <h3>{app.appName}</h3>
          <p>{displayUrl(app.appUri)}</p>
        </div>
        <span class={`login-picker-status is-${app.status}`}>
          {loginAppStatusLabel(app.status)}
        </span>
      </div>
      {app.reviewStatus === "requested" && (
        <p class="account-developer-review-mini">Trusted review requested</p>
      )}
      {app.reviewStatus === "rejected" && (
        <p class="account-developer-review-mini account-developer-review-mini--warn">
          Trusted review needs changes
        </p>
      )}
      <dl class="account-developer-app-details">
        <div>
          <dt>Client ID</dt>
          <dd>{app.clientId}</dd>
        </div>
        <div>
          <dt>Allowed return URIs</dt>
          <dd>
            <ul>
              {app.allowedReturnUris.map((uri) => <li key={uri}>{uri}</li>)}
            </ul>
          </dd>
        </div>
      </dl>
      {app.appUri && (
        <div class="account-developer-card-actions">
          <a
            href={loginAppDetailPath(app.clientId)}
            class="account-dashboard-text-link"
          >
            Manage app
          </a>
          <a
            href={app.appUri}
            target="_blank"
            rel="noopener noreferrer"
            class="account-dashboard-text-link"
          >
            Visit homepage
          </a>
        </div>
      )}
      {!app.appUri && (
        <a
          href={loginAppDetailPath(app.clientId)}
          class="account-dashboard-text-link"
        >
          Manage app
        </a>
      )}
    </article>
  );
}

function redirectToSignin(url: URL): Response {
  return new Response(null, {
    status: 303,
    headers: {
      location: `/signin?next=${encodeURIComponent(url.pathname + url.search)}`,
    },
  });
}

function emptyValues(): DeveloperAppFormValues {
  return {
    appName: "",
    clientId: "",
    appUri: "",
    logoUri: "",
    allowedReturnUris: "",
  };
}

function valuesFromForm(form: FormData | null): DeveloperAppFormValues {
  return {
    appName: formText(form, "app_name"),
    clientId: formText(form, "client_id"),
    appUri: formText(form, "app_uri"),
    logoUri: formText(form, "logo_uri"),
    allowedReturnUris: formText(form, "allowed_return_uris"),
  };
}

function formText(form: FormData | null, key: string): string {
  const value = form?.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function displayUrl(value: string | null): string {
  if (!value) return "No homepage";
  try {
    const url = new URL(value);
    return url.hostname;
  } catch {
    return value;
  }
}
