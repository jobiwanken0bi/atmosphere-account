import { define, type State } from "../../utils.ts";
import AtmosphereHandle from "../../components/AtmosphereHandle.tsx";
import SignInForm from "../../islands/SignInForm.tsx";
import {
  appendSelectionToReturnUri,
  type LoginApp,
  loginAppStatusLabel,
  type LoginRequest,
  LoginRequestError,
  loginRequestToPath,
  readLoginRequest,
  recordLoginSelection,
  resolveLoginAppForRequest,
  signLoginSelection,
} from "../../lib/atmosphere-login.ts";
import {
  proxyAppviewApiResponse,
  proxyAppviewPageResponse,
} from "../../lib/appview-client.ts";
import { loginPickerOriginForRequest } from "../../lib/atmosphere-origins.ts";
import { isOAuthConfigured } from "../../lib/oauth.ts";
import { rejectLargeRequest } from "../../lib/security.ts";

interface PickerAccount {
  did: string;
  handle: string;
  pdsUrl?: string | null;
}

interface PickerPageProps {
  app: LoginApp | null;
  request: LoginRequest | null;
  selectPath: string | null;
  pickerAccounts: PickerAccount[];
  error: string | null;
  status: number;
}

const MAX_PICKER_FORM_BYTES = 16_384;

export const handler = define.handlers({
  async GET(ctx) {
    const proxied = await proxyAppviewPageResponse(ctx.url, ctx.req).catch(
      (err) => appviewUnavailable("login picker page", err),
    );
    if (proxied) return proxied;

    const props = await buildPickerPageProps(ctx);
    return ctx.render(<LoginPickerPage {...props} />, {
      status: props.status,
      headers: { "cache-control": "no-store" },
    });
  },

  async POST(ctx) {
    const proxied = await proxyAppviewApiResponse(ctx.url, ctx.req).catch(
      (err) => appviewUnavailable("login picker selection", err),
    );
    if (proxied) return proxied;

    let request: LoginRequest;
    try {
      const large = rejectLargeRequest(ctx.req, MAX_PICKER_FORM_BYTES);
      if (large) return large;
      const form = await ctx.req.formData();
      request = readLoginRequestFromForm(form);
      const { app, returnUri } = await resolveLoginAppForRequest(request);
      const pickerAccounts = getPickerAccounts(ctx.state);
      const issuer = loginPickerOriginForRequest(ctx.url, ctx.req.headers);
      const did = String(form.get("did") ?? "").trim();
      const selected = pickerAccounts.find((account) => account.did === did);
      if (!selected) {
        return new Response("account not available in this browser", {
          status: 403,
        });
      }
      const { token } = await signLoginSelection({
        app,
        did: selected.did,
        handle: selected.handle,
        issuer,
        pdsUrl: selected.pdsUrl,
        returnUri: returnUri.toString(),
        state: request.state,
        scope: request.scope,
      });
      await recordLoginSelection({
        clientId: app.clientId,
        did: selected.did,
        handle: selected.handle,
      }).catch(() => {});
      return new Response(null, {
        status: 303,
        headers: {
          "cache-control": "no-store",
          location: appendSelectionToReturnUri({
            returnUri,
            clientId: app.clientId,
            did: selected.did,
            handle: selected.handle,
            issuer,
            state: request.state,
            token,
          }),
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = err instanceof LoginRequestError ? err.status : 400;
      return new Response(message, {
        status,
        headers: { "cache-control": "no-store" },
      });
    }
  },
});

function appviewUnavailable(scope: string, err: unknown): Response {
  console.error(`[appview] ${scope} proxy failed:`, err);
  return new Response("Atmosphere Login is temporarily unavailable.", {
    status: 503,
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
    },
  });
}

function readLoginRequestFromForm(form: FormData): LoginRequest {
  const url = new URL("https://local.invalid/login/select");
  for (const key of ["client_id", "return_uri", "state", "scope"]) {
    const value = form.get(key);
    if (typeof value === "string" && value) url.searchParams.set(key, value);
  }
  return readLoginRequest(url);
}

async function buildPickerPageProps(
  ctx: { state: State; url: URL },
): Promise<PickerPageProps> {
  try {
    const request = readLoginRequest(ctx.url);
    const { app } = await resolveLoginAppForRequest(request);
    return {
      app,
      request,
      selectPath: loginRequestToPath(request),
      pickerAccounts: getPickerAccounts(ctx.state),
      error: null,
      status: 200,
    };
  } catch (err) {
    return {
      app: null,
      request: null,
      selectPath: null,
      pickerAccounts: [],
      error: err instanceof Error ? err.message : String(err),
      status: err instanceof LoginRequestError ? err.status : 400,
    };
  }
}

function getPickerAccounts(
  state: State,
): PickerAccount[] {
  const out = new Map<string, PickerAccount>();
  if (state.user) {
    const remembered = (state.rememberedAccounts ?? []).find((account) =>
      account.did === state.user?.did
    );
    out.set(state.user.did, {
      ...state.user,
      pdsUrl: state.accountHost?.endpoint ?? remembered?.pdsUrl ?? null,
    });
  }
  for (const account of state.rememberedAccounts ?? []) {
    if (!out.has(account.did)) out.set(account.did, account);
  }
  return [...out.values()];
}

function LoginPickerPage(props: PickerPageProps) {
  const { app, request, selectPath, pickerAccounts, error } = props;
  return (
    <div id="page-top" class="login-picker-page">
      <section class="signin-page-section login-picker-section">
        <div class="container signin-page-container login-picker-container">
          <p class="text-eyebrow">Account picker</p>
          <h1 class="text-section login-picker-title">
            <img src="/union.svg" alt="" width="36" height="36" />
            <span>Continue with Atmosphere</span>
          </h1>
          <div class="glass signin-page-card login-picker-card">
            {error || !app || !request || !selectPath
              ? (
                <LoginPickerError
                  message={error ?? "Invalid login request."}
                />
              )
              : (
                <LoginPickerBody
                  app={app}
                  request={request}
                  selectPath={selectPath}
                  pickerAccounts={pickerAccounts}
                />
              )}
          </div>
        </div>
      </section>
    </div>
  );
}

function LoginPickerBody(
  { app, request, selectPath, pickerAccounts }: {
    app: LoginApp;
    request: LoginRequest;
    selectPath: string;
    pickerAccounts: PickerAccount[];
  },
) {
  return (
    <>
      <header class="login-picker-app">
        <AppMark app={app} />
        <div class="login-picker-app-copy">
          <p class="login-picker-label">Continue to</p>
          <h2>{app.appName}</h2>
        </div>
        <StatusPill app={app} />
      </header>
      <PickerTrustNotice app={app} />

      {pickerAccounts.length > 0
        ? (
          <>
            <div class="login-picker-account-list" aria-label="Saved accounts">
              {pickerAccounts.map((account) => (
                <form method="POST" action="/login/select" key={account.did}>
                  <LoginRequestInputs request={request} />
                  <input type="hidden" name="did" value={account.did} />
                  <button type="submit" class="login-picker-account-row">
                    <span class="login-picker-avatar" aria-hidden="true">
                      <span>{account.handle.slice(0, 1).toUpperCase()}</span>
                      <img
                        src={`/api/registry/avatar/${
                          encodeURIComponent(account.did)
                        }`}
                        alt=""
                        width="48"
                        height="48"
                        loading="lazy"
                        decoding="async"
                      />
                    </span>
                    <span class="login-picker-account-copy">
                      <strong>
                        <AtmosphereHandle handle={account.handle} />
                      </strong>
                      <span>Use this account with {app.appName}</span>
                    </span>
                    <span class="login-picker-account-action">Continue</span>
                  </button>
                </form>
              ))}
            </div>
            <form method="POST" action="/oauth/add-account">
              <input type="hidden" name="next" value={selectPath} />
              <button
                type="submit"
                class="profile-form-button-secondary login-picker-secondary"
              >
                Add another account
              </button>
            </form>
          </>
        )
        : (
          <div class="login-picker-empty">
            {isOAuthConfigured()
              ? (
                <SignInForm
                  returnTo={selectPath}
                  rememberedAccounts={[]}
                  rich
                />
              )
              : (
                <p class="text-body">
                  Atmosphere Login is not configured on this deployment yet.
                </p>
              )}
          </div>
        )}

      <p class="login-picker-footnote">
        Atmosphere shares only the account you choose. {app.appName}{" "}
        will ask your account host to finish signing you in.
      </p>
    </>
  );
}

function LoginRequestInputs({ request }: { request: LoginRequest }) {
  return (
    <>
      <input type="hidden" name="client_id" value={request.clientId} />
      <input type="hidden" name="return_uri" value={request.returnUri} />
      <input type="hidden" name="state" value={request.state} />
      {request.scope && (
        <input type="hidden" name="scope" value={request.scope} />
      )}
    </>
  );
}

function AppMark({ app }: { app: LoginApp }) {
  return (
    <span class="login-picker-app-mark" aria-hidden="true">
      {app.logoUri && shouldShowPickerLogo(app)
        ? (
          <img
            src={app.logoUri}
            alt=""
            width="64"
            height="64"
            loading="lazy"
            decoding="async"
            referrerpolicy="no-referrer"
          />
        )
        : <span>{app.appName.slice(0, 1).toUpperCase()}</span>}
    </span>
  );
}

function shouldShowPickerLogo(app: LoginApp): boolean {
  return app.status === "trusted" || app.status === "development";
}

function StatusPill({ app }: { app: LoginApp }) {
  return (
    <span class={`login-picker-status is-${app.status}`}>
      {loginAppStatusLabel(app.status)}
    </span>
  );
}

function PickerTrustNotice({ app }: { app: LoginApp }) {
  if (app.status === "trusted") {
    return (
      <div class="login-picker-notice login-picker-notice--trusted">
        <strong>Trusted app</strong>
        <span>
          Atmosphere has reviewed this app and checked that it sends you back to
          the right place after you choose an account.
        </span>
      </div>
    );
  }
  if (app.status === "development") {
    return (
      <div class="login-picker-notice login-picker-notice--development">
        <strong>Development app</strong>
        <span>
          This is a local test app. Only continue if you opened this flow
          yourself.
        </span>
      </div>
    );
  }
  return (
    <div class="login-picker-notice login-picker-notice--unverified">
      <strong>Unverified app</strong>
      <span>
        This app has not been reviewed by Atmosphere yet. Check that you
        recognize the app before continuing. App logos appear after trusted
        review.
      </span>
    </div>
  );
}

function LoginPickerError({ message }: { message: string }) {
  const blocked = message.toLowerCase().includes("blocked");
  return (
    <div class="login-picker-error">
      <h2>{blocked ? "App unavailable" : "Login request unavailable"}</h2>
      <p class="text-body">{message}</p>
      <p class="text-body-sm">
        {blocked
          ? "Atmosphere cannot continue this sign-in request. Return to the app or choose another app."
          : "This app did not send enough information to open the account picker. Return to the app and try again."}
      </p>
    </div>
  );
}
