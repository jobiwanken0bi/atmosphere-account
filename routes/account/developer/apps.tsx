import Nav from "../../../components/Nav.tsx";
import Footer from "../../../components/Footer.tsx";
import AtmosphereHandle from "../../../components/AtmosphereHandle.tsx";
import ConfirmedActionForm from "../../../islands/ConfirmedActionForm.tsx";
import type { FreshContext } from "fresh";
import { define, type State } from "../../../utils.ts";
import { proxyAppviewPageResponse } from "../../../lib/appview-client.ts";
import { buildAccountMenuProps } from "../../../lib/account-menu-props.ts";
import {
  deleteLoginAppForOwner,
  getLoginAppProfileForOwner,
  listLoginAppsForOwner,
  listLoginPreferredHostChoicesForApp,
  listRecoverableLoginAppsForOwner,
  type LoginApp,
  loginAppDetailPath,
  LoginRequestError,
  registerLoginAppForOwner,
  splitAllowedReturnUris,
} from "../../../lib/atmosphere-login.ts";
import {
  readFormDataRequestWithLimit,
  rejectLargeRequest,
  RequestBodyTooLargeError,
} from "../../../lib/security.ts";
import { enforceDurableRateLimit } from "../../../lib/rate-limit.ts";
import {
  type AccountHost,
  listManagedAccountHosts,
} from "../../../lib/account-hosts.ts";
import { developerAppAccessRedirect } from "../../../lib/developer-app-access.ts";
import { developerAuthorizationHref } from "../../../lib/oauth-entry-context.ts";
import {
  loginEnvironmentLabel,
  loginEnvironmentStatusLabel,
} from "../../../lib/login-environment-display.ts";

type LoginAppProfile = NonNullable<
  Awaited<ReturnType<typeof getLoginAppProfileForOwner>>
>;

interface DeveloperAppFormValues {
  clientId: string;
  allowedReturnUris: string;
  preferredAccountHost: string;
}

interface DeveloperAppsPageProps {
  account: ReturnType<typeof buildAccountMenuProps>;
  handle: string;
  profile: LoginAppProfile;
  apps: LoginApp[];
  preferredHosts: AccountHost[];
  values: DeveloperAppFormValues;
  error: string | null;
  saved: boolean;
  deleted?: boolean;
}

export type DeveloperAccessRecoveryReason =
  | "no_app"
  | "host_only"
  | "ambiguous";

interface DeveloperAccessRecoveryProps {
  account: ReturnType<typeof buildAccountMenuProps>;
  handle: string;
  reason?: DeveloperAccessRecoveryReason;
  orphanApps?: LoginApp[];
  deleted?: boolean;
}

const MAX_DEVELOPER_APP_FORM_BYTES = 32_768;

export const handler = define.handlers({
  async GET(ctx) {
    const proxied = await proxyAppviewPageResponse(ctx.url, ctx.req).catch(
      () => appviewUnavailable(),
    );
    if (proxied) return proxied;

    const user = ctx.state.user;
    if (!user) return redirectToSignin(ctx.url);

    const accessResponse = await developerAccessResponse(
      ctx,
      user.handle,
    ).catch(() => appviewUnavailable());
    if (accessResponse) return accessResponse;

    let profile: LoginAppProfile | null;
    try {
      profile = await getLoginAppProfileForOwner(user.did);
    } catch (error) {
      return error instanceof LoginRequestError
        ? await developerAccessResponse(ctx, user.handle, error).catch(() =>
          appviewUnavailable()
        ) ?? appviewUnavailable()
        : appviewUnavailable();
    }
    if (!profile) return appviewUnavailable();

    let apps: LoginApp[];
    try {
      apps = await listLoginAppsForOwner(user.did, profile);
    } catch {
      return appviewUnavailable();
    }
    let preferredHosts: AccountHost[];
    try {
      preferredHosts = await loadPreferredHostChoices(user.did, profile);
    } catch {
      return appviewUnavailable();
    }
    return ctx.render(
      <DeveloperAppsPage
        account={buildAccountMenuProps(ctx.state)}
        handle={user.handle}
        profile={profile}
        apps={apps}
        preferredHosts={preferredHosts}
        values={emptyValues()}
        error={null}
        saved={ctx.url.searchParams.get("saved") === "1"}
        deleted={ctx.url.searchParams.get("deleted") === "1"}
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

    const limited = await enforceDurableRateLimit(ctx.req, {
      scope: "developer-app-registration",
      capacity: 12,
      refillMs: 60_000,
    });
    if (limited) return limited;
    const large = rejectLargeRequest(ctx.req, MAX_DEVELOPER_APP_FORM_BYTES);
    if (large) return large;

    let form: FormData | null;
    try {
      form = await readFormDataRequestWithLimit(
        ctx.req,
        MAX_DEVELOPER_APP_FORM_BYTES,
      );
    } catch (error) {
      return new Response(
        error instanceof RequestBodyTooLargeError
          ? "request body too large"
          : "invalid login environment form",
        { status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
      );
    }
    if (formText(form, "action") === "delete-orphan") {
      const clientId = formText(form, "client_id");
      const confirmedClientId = formText(form, "confirm_client_id");
      if (!clientId || confirmedClientId !== clientId) {
        return recoveryActionError(
          "Reload this login environment before deleting it.",
          409,
        );
      }
      let removed: boolean;
      try {
        removed = await deleteLoginAppForOwner(user.did, clientId);
      } catch {
        return appviewUnavailable();
      }
      if (!removed) {
        return recoveryActionError("Login environment not found.", 404);
      }
      return new Response(null, {
        status: 303,
        headers: {
          location:
            "/account/developer/apps?deleted=1#unlinked-login-environments",
        },
      });
    }

    const accessResponse = await developerAccessResponse(
      ctx,
      user.handle,
    ).catch(() => appviewUnavailable());
    if (accessResponse) return accessResponse;

    let profile: LoginAppProfile | null;
    try {
      profile = await getLoginAppProfileForOwner(user.did);
    } catch (error) {
      return error instanceof LoginRequestError
        ? await developerAccessResponse(ctx, user.handle, error).catch(() =>
          appviewUnavailable()
        ) ?? appviewUnavailable()
        : appviewUnavailable();
    }
    if (!profile) return appviewUnavailable();

    const values = valuesFromForm(form);
    try {
      await registerLoginAppForOwner(user.did, {
        clientId: values.clientId,
        allowedReturnUris: splitAllowedReturnUris(values.allowedReturnUris),
        preferredAccountHost: values.preferredAccountHost,
      });
      return new Response(null, {
        status: 303,
        headers: {
          location: "/account/developer/apps?saved=1#login-environments",
        },
      });
    } catch (error) {
      let apps: LoginApp[];
      try {
        apps = await listLoginAppsForOwner(user.did);
      } catch {
        return appviewUnavailable();
      }
      let preferredHosts: AccountHost[];
      try {
        preferredHosts = await loadPreferredHostChoices(user.did);
      } catch {
        return appviewUnavailable();
      }
      const status = error instanceof LoginRequestError ? error.status : 400;
      return ctx.render(
        <DeveloperAppsPage
          account={buildAccountMenuProps(ctx.state)}
          handle={user.handle}
          profile={profile}
          apps={apps}
          preferredHosts={preferredHosts}
          values={values}
          error={safeRegistrationError(error)}
          saved={false}
        />,
        { status },
      );
    }
  },
});

function appviewUnavailable(): Response {
  console.error("[appview] developer settings unavailable");
  return new Response("Developer settings are temporarily unavailable.", {
    status: 503,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
    },
  });
}

export function DeveloperAppsPage(
  {
    account,
    handle,
    profile,
    apps,
    preferredHosts,
    values,
    error,
    saved,
    deleted = false,
  }: DeveloperAppsPageProps,
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
              href="/account/apps-hosts#managed-apps"
              class="account-dashboard-text-link"
            >
              <span aria-hidden="true">←</span> Back
            </a>

            <header class="glass account-dashboard-hero account-developer-hero">
              <AppProfileMark profile={profile} large />
              <div>
                <p class="text-eyebrow">Developer settings</p>
                <h1 class="text-section">Login with Atmosphere</h1>
                <p class="text-body mt-2">
                  Configure client IDs and exact return URLs for{" "}
                  {profile.name}. Its public identity comes from the app
                  profile.
                </p>
              </div>
            </header>

            <div class="account-developer-grid">
              <form
                method="post"
                class="glass account-developer-form"
                data-submit-once="true"
              >
                <div class="account-dashboard-section-head account-developer-form-head">
                  <div>
                    <p class="text-eyebrow">Add environment</p>
                    <h2>New login environment</h2>
                    <p>
                      Add a client ID for web, staging, or a native app using
                      verified HTTPS app links.
                    </p>
                  </div>
                </div>

                {saved && (
                  <p class="profile-form-status profile-form-status--ok">
                    Login environment added.
                  </p>
                )}
                {error && (
                  <p class="profile-form-status profile-form-status--error">
                    {error}
                  </p>
                )}

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
                    Use HTTPS in production. Loopback HTTP is accepted only for
                    local development; custom app schemes are not accepted.
                  </span>
                </label>

                <label class="profile-form-field">
                  <span class="profile-form-label">Exact return URLs</span>
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
                    One per line. Scheme, host, port, path, and query must match
                    exactly.
                  </span>
                </label>

                <PreferredHostField
                  hosts={preferredHosts}
                  value={values.preferredAccountHost}
                />

                <div class="account-developer-form-actions">
                  <button
                    type="submit"
                    class="profile-form-button-primary"
                    data-pending-label="Adding environment…"
                  >
                    <span data-submit-once-label>Add environment</span>
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
                <AppProfileIdentity profile={profile} handle={handle} />
              </aside>
            </div>

            <section id="login-environments" class="account-developer-list">
              <div class="account-dashboard-section-head">
                <div>
                  <p class="text-eyebrow">{profile.name}</p>
                  <h2>Login environments</h2>
                  <p>
                    Each client ID has its own exact return URL allow-list and
                    review status.
                  </p>
                </div>
                <span class="account-home-pill">
                  {countLabel(apps.length, "environment")}
                </span>
              </div>
              {deleted && (
                <p class="profile-form-status profile-form-status--ok">
                  Login environment deleted.
                </p>
              )}
              {apps.length === 0
                ? (
                  <div class="glass account-dashboard-empty">
                    <h3>No login environments yet</h3>
                    <p>
                      Add one when this app is ready to use the shared login
                      picker.
                    </p>
                  </div>
                )
                : (
                  <div class="account-developer-app-grid">
                    {apps.map((app) => (
                      <LoginEnvironmentCard key={app.clientId} app={app} />
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

export function DeveloperAccessRecovery(
  {
    account,
    handle,
    reason = "no_app",
    orphanApps = [],
    deleted = false,
  }: DeveloperAccessRecoveryProps,
) {
  const ambiguous = reason === "ambiguous";
  const heading = ambiguous
    ? "Developer settings need one app"
    : "These login environments are unlinked";
  const message = reason === "host_only"
    ? "This account manages a host but not an app. These older login environments cannot be used here; remove the ones you no longer need, or switch to the app account they belong to."
    : ambiguous
    ? "This account has multiple legacy app profiles, so Developer settings cannot safely choose one. Resolve those profiles, or switch to the app account that owns these environments."
    : "This account does not have an app profile. These older login environments cannot be used here; remove the ones you no longer need, or switch to the app account they belong to.";
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
              href={reason === "no_app" ? "/account" : "/account/apps-hosts"}
              class="account-dashboard-text-link"
            >
              <span aria-hidden="true">←</span> Back
            </a>
            <div class="glass account-dashboard-empty account-dashboard-empty--visual account-developer-recovery">
              <div class="account-dashboard-hero-mark" aria-hidden="true">
                <img src="/union.svg" alt="" width="36" height="36" />
              </div>
              <div>
                <p class="text-eyebrow">Developer settings</p>
                <h1 class="text-section">{heading}</h1>
                <p>{message}</p>
                <p class="profile-form-hint">
                  Signed in as <AtmosphereHandle handle={handle} />
                </p>
              </div>
              <div class="account-dashboard-empty-actions">
                <a
                  href={ambiguous ? "/account/apps-hosts" : "/apps"}
                  class="profile-form-button-primary"
                >
                  {ambiguous ? "Manage listings" : "Back to Apps"}
                </a>
                <form method="post" action="/oauth/add-account">
                  <input
                    type="hidden"
                    name="next"
                    value="/account/developer/apps"
                  />
                  <input type="hidden" name="action" value="developer" />
                  <input type="hidden" name="capability" value="identity" />
                  <button
                    type="submit"
                    class="profile-form-button-secondary profile-form-button-secondary--lg"
                  >
                    Use another account
                  </button>
                </form>
              </div>
            </div>
            {(orphanApps.length > 0 || deleted) && (
              <section
                id="unlinked-login-environments"
                class="glass account-developer-orphan-list"
              >
                <div class="account-dashboard-section-head">
                  <div>
                    <p class="text-eyebrow">Cleanup</p>
                    <h2>Unlinked login environments</h2>
                    <p>
                      These client IDs cannot be used until this account has one
                      unambiguous app profile. Resolve the app profile to relink
                      them automatically, or remove environments you no longer
                      need.
                    </p>
                  </div>
                  <span class="account-home-pill">
                    {countLabel(orphanApps.length, "environment")}
                  </span>
                </div>
                {deleted && (
                  <p class="profile-form-status profile-form-status--ok">
                    Login environment deleted.
                  </p>
                )}
                {orphanApps.length > 0 && (
                  <div class="account-developer-app-grid">
                    {orphanApps.map((app) => (
                      <article
                        key={app.clientId}
                        class="account-developer-app-card account-developer-orphan-card"
                      >
                        <div class="account-developer-app-top">
                          <span
                            class="account-developer-environment-mark"
                            aria-hidden="true"
                          >
                            {"</>"}
                          </span>
                          <div>
                            <p class="text-eyebrow">Environment</p>
                            <h3>{loginEnvironmentLabel(app.clientId)}</h3>
                          </div>
                          <span class="login-picker-status is-blocked">
                            Unavailable
                          </span>
                        </div>
                        <dl class="account-developer-app-details">
                          <div>
                            <dt>Client ID</dt>
                            <dd>{app.clientId}</dd>
                          </div>
                        </dl>
                        <ConfirmedActionForm
                          action="/account/developer/apps"
                          fields={{
                            action: "delete-orphan",
                            client_id: app.clientId,
                            confirm_client_id: app.clientId,
                          }}
                          label="Delete environment"
                          confirmation={`Delete ${
                            loginEnvironmentLabel(app.clientId)
                          }? This client ID will stop working with the Login with Atmosphere picker.`}
                          buttonClass="profile-form-button-danger"
                        />
                      </article>
                    ))}
                  </div>
                )}
              </section>
            )}
          </div>
        </section>
        <Footer variant="compact" />
      </div>
    </div>
  );
}

function AppProfileIdentity(
  { profile, handle }: { profile: LoginAppProfile; handle: string },
) {
  return (
    <section class="glass account-developer-state-card">
      <p class="text-eyebrow">App profile</p>
      <div class="account-developer-profile-identity">
        <AppProfileMark profile={profile} />
        <div>
          <h2>{profile.name}</h2>
          <p>{displayUrl(profile.homepage)}</p>
        </div>
      </div>
      <p class="account-developer-review-copy">
        The picker uses this name, homepage, and logo for every environment.
        Edit them once in the app profile.
      </p>
      <dl class="account-developer-app-details">
        <div>
          <dt>Managing account</dt>
          <dd>
            <AtmosphereHandle handle={handle} />
          </dd>
        </div>
      </dl>
      <div class="account-developer-card-actions">
        <a
          href={`/apps/manage?app=${encodeURIComponent(profile.listingId)}`}
          class="account-dashboard-text-link"
        >
          Edit app profile
        </a>
        <a
          href={`/apps/${encodeURIComponent(profile.slug)}`}
          class="account-dashboard-text-link"
        >
          View profile
        </a>
      </div>
    </section>
  );
}

function AppProfileMark(
  { profile, large = false }: { profile: LoginAppProfile; large?: boolean },
) {
  return (
    <span
      class={`login-picker-app-mark${
        large ? " account-developer-hero-app-mark" : ""
      }`}
      aria-hidden="true"
    >
      {profile.logoUri
        ? <img src={profile.logoUri} alt="" loading="lazy" decoding="async" />
        : <span>{profile.name.slice(0, 1).toUpperCase()}</span>}
    </span>
  );
}

export function PreferredHostField(
  { hosts, value }: { hosts: AccountHost[]; value: string },
) {
  if (hosts.length === 0 && !value) return null;
  const valueUnavailable = Boolean(
    value && !hosts.some((host) => host.host === value),
  );
  return (
    <label class="profile-form-field">
      <span class="profile-form-label">Preferred account host</span>
      <select
        class="profile-form-input"
        name="preferred_account_host"
        value={value}
      >
        <option value="">No preferred host</option>
        {valueUnavailable && (
          <option value={value}>{value} (no longer available)</option>
        )}
        {hosts.map((host) => (
          <option value={host.host} key={host.host}>
            {host.displayName} ({host.host})
          </option>
        ))}
      </select>
      <span class="profile-form-hint">
        Optional. Recommend a verified, joinable host owned by this app account
        or connected to this app. People can still choose another host.
      </span>
    </label>
  );
}

function LoginEnvironmentCard({ app }: { app: LoginApp }) {
  return (
    <article class="glass account-developer-app-card">
      <div class="account-developer-app-top">
        <span class="account-developer-environment-mark" aria-hidden="true">
          {"</>"}
        </span>
        <div>
          <p class="text-eyebrow">Environment</p>
          <h3>{loginEnvironmentLabel(app.clientId)}</h3>
        </div>
        <span class={`login-picker-status is-${app.status}`}>
          {loginEnvironmentStatusLabel(app.status)}
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
          <dt>Exact return URLs</dt>
          <dd>
            <ul>
              {app.allowedReturnUris.map((uri) => <li key={uri}>{uri}</li>)}
            </ul>
          </dd>
        </div>
        {app.preferredAccountHost && (
          <div>
            <dt>Preferred account host</dt>
            <dd>{app.preferredAccountHost}</dd>
          </div>
        )}
      </dl>
      <a
        href={loginAppDetailPath(app.clientId)}
        class="account-dashboard-text-link"
      >
        Manage environment
      </a>
    </article>
  );
}

async function developerAccessResponse(
  ctx: FreshContext<State>,
  handle: string,
  error?: unknown,
): Promise<Response | null> {
  const redirect = await developerAppAccessRedirect(
    ctx.state.user?.did ?? "",
  );
  if (!redirect) return null;
  const orphanApps = await listRecoverableLoginAppsForOwner(
    ctx.state.user?.did ?? "",
  );
  // Ordinary people and host-only managers never enter developer settings.
  // The sole exception is a narrow owner-only cleanup surface for legacy
  // environments that would otherwise become impossible to remove.
  if (orphanApps.length === 0) return redirect;
  const reason = await resolveDeveloperAccessRecoveryReason(
    ctx.state.user?.did ?? "",
    error,
  );
  const status = reason === "ambiguous" ? 409 : 403;
  return ctx.render(
    <DeveloperAccessRecovery
      account={buildAccountMenuProps(ctx.state)}
      handle={handle}
      reason={reason}
      orphanApps={orphanApps}
      deleted={ctx.url.searchParams.get("deleted") === "1"}
    />,
    { status },
  );
}

export async function resolveDeveloperAccessRecoveryReason(
  ownerDid: string,
  error?: unknown,
): Promise<DeveloperAccessRecoveryReason> {
  if (error instanceof LoginRequestError && error.status === 409) {
    return "ambiguous";
  }
  const hosts = await listManagedAccountHosts(ownerDid);
  return hosts.length > 0 ? "host_only" : "no_app";
}

function redirectToSignin(url: URL): Response {
  return new Response(null, {
    status: 303,
    headers: { location: developerAuthorizationHref(url) },
  });
}

function recoveryActionError(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
    },
  });
}

function emptyValues(): DeveloperAppFormValues {
  return {
    clientId: "",
    allowedReturnUris: "",
    preferredAccountHost: "",
  };
}

function valuesFromForm(form: FormData | null): DeveloperAppFormValues {
  return {
    clientId: formText(form, "client_id"),
    allowedReturnUris: formText(form, "allowed_return_uris"),
    preferredAccountHost: formText(form, "preferred_account_host"),
  };
}

async function loadPreferredHostChoices(
  ownerDid: string,
  profile?: LoginAppProfile,
): Promise<AccountHost[]> {
  return await listLoginPreferredHostChoicesForApp(ownerDid, profile);
}

function safeRegistrationError(error: unknown): string {
  return error instanceof LoginRequestError
    ? error.message
    : "The login environment could not be saved. Please try again.";
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

function countLabel(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
