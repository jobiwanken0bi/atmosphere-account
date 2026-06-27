import { define, type State } from "../../utils.ts";
import Nav from "../../components/Nav.tsx";
import Footer from "../../components/Footer.tsx";
import AtmosphereHandle from "../../components/AtmosphereHandle.tsx";
import SignInForm from "../../islands/SignInForm.tsx";
import { buildAccountMenuProps } from "../../lib/account-menu-props.ts";
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
import { isOAuthConfigured } from "../../lib/oauth.ts";
import { rejectLargeRequest } from "../../lib/security.ts";

interface PickerAccount {
  did: string;
  handle: string;
  pdsUrl?: string | null;
}

interface PickerPageProps {
  account: ReturnType<typeof buildAccountMenuProps>;
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
    const props = await buildPickerPageProps(ctx);
    return ctx.render(<LoginPickerPage {...props} />, {
      status: props.status,
      headers: { "cache-control": "no-store" },
    });
  },

  async POST(ctx) {
    let request: LoginRequest;
    try {
      const large = rejectLargeRequest(ctx.req, MAX_PICKER_FORM_BYTES);
      if (large) return large;
      const form = await ctx.req.formData();
      request = readLoginRequestFromForm(form);
      const { app, returnUri } = await resolveLoginAppForRequest(request);
      const pickerAccounts = getPickerAccounts(ctx.state);
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
  const account = buildAccountMenuProps(ctx.state);
  try {
    const request = readLoginRequest(ctx.url);
    const { app } = await resolveLoginAppForRequest(request);
    return {
      account,
      app,
      request,
      selectPath: loginRequestToPath(request),
      pickerAccounts: getPickerAccounts(ctx.state),
      error: null,
      status: 200,
    };
  } catch (err) {
    return {
      account,
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
  const { account, app, request, selectPath, pickerAccounts, error } = props;
  return (
    <div id="page-top">
      <div class="content-layer">
        <Nav account={account} disableScrollEffects />
        <section class="signin-page-section login-picker-section">
          <div class="container signin-page-container login-picker-container">
            <p class="text-eyebrow">Atmosphere Login</p>
            <h1 class="text-section">Continue with Atmosphere</h1>
            <p class="text-body mt-2">
              Choose the account you want to use. The app will complete its own
              AT Protocol sign-in after this step.
            </p>
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
        <Footer variant="compact" />
      </div>
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
          <p>{app.appUri ? displayUrl(app.appUri) : "Registered app"}</p>
        </div>
        <StatusPill app={app} />
      </header>
      <PickerTrustNotice app={app} request={request} />
      <ReturnDestination request={request} />

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
        Atmosphere only shares the selected handle and DID. {app.appName}{" "}
        still needs to complete AT Protocol OAuth with your account host.
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

function PickerTrustNotice(
  { app, request }: { app: LoginApp; request: LoginRequest },
) {
  if (app.status === "trusted") {
    return (
      <div class="login-picker-notice login-picker-notice--trusted">
        <strong>Trusted app</strong>
        <span>
          Atmosphere has reviewed this app identity, verified its domain
          manifest, and checked this exact return destination:{" "}
          {displayReturnDestination(request.returnUri)}.
        </span>
      </div>
    );
  }
  if (app.status === "development") {
    return (
      <div class="login-picker-notice login-picker-notice--development">
        <strong>Development app</strong>
        <span>
          This looks like a local development app. Only continue if you opened
          this flow yourself.
        </span>
      </div>
    );
  }
  return (
    <div class="login-picker-notice login-picker-notice--unverified">
      <strong>Unverified app</strong>
      <span>
        This app has not been reviewed by Atmosphere yet. Check the app name,
        homepage, and return destination before continuing. Logos appear after
        trusted review.
      </span>
    </div>
  );
}

function ReturnDestination({ request }: { request: LoginRequest }) {
  return (
    <div class="login-picker-return-target">
      <span>Returns to</span>
      <code>{displayReturnDestination(request.returnUri)}</code>
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
          : "Apps must include a client ID, return URL, and state value when opening the Atmosphere account picker."}
      </p>
    </div>
  );
}

function displayUrl(value: string): string {
  try {
    const url = new URL(value);
    return url.hostname;
  } catch {
    return value;
  }
}

function displayReturnDestination(value: string): string {
  try {
    const url = new URL(value);
    return `${url.hostname}${url.pathname}`;
  } catch {
    return value;
  }
}
