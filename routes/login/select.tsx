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
import {
  browserHandoffDocument,
  browserHandoffError,
  browserHandoffResponse,
  wantsBrowserHandoffJson,
} from "../../lib/browser-handoff.ts";
import { checkDurableRateLimit } from "../../lib/rate-limit.ts";
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
const PICKER_SELECTION_RATE_LIMIT = {
  scope: "login-picker-selection",
  capacity: 30,
  refillMs: 60_000,
} as const;

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

    const wantsJson = wantsBrowserHandoffJson(ctx.req);
    let request: LoginRequest;
    try {
      const limited = await checkDurableRateLimit(
        ctx.req,
        PICKER_SELECTION_RATE_LIMIT,
      );
      if (!limited.ok) {
        return browserHandoffError(
          "Too many account picker attempts. Try again soon.",
          429,
          wantsJson,
          { "retry-after": String(limited.retryAfter) },
        );
      }
      const large = rejectLargeRequest(ctx.req, MAX_PICKER_FORM_BYTES);
      if (large) return large;
      if (ctx.url.search.length > MAX_PICKER_FORM_BYTES) {
        return browserHandoffError("request URL too large", 414, wantsJson);
      }
      const form = await optionalFormData(ctx.req);
      const browserDocument = inputValue(ctx.url, form, "handoff") ===
          "browser" && !wantsJson;
      request = readLoginRequestFromInput(ctx.url, form);
      const { app, returnUri } = await resolveLoginAppForRequest(request);
      const pickerAccounts = getPickerAccounts(ctx.state);
      const issuer = loginPickerOriginForRequest(ctx.url, ctx.req.headers);
      const did = inputValue(ctx.url, form, "did").trim();
      const selected = pickerAccounts.find((account) => account.did === did);
      if (!selected) {
        return browserHandoffError(
          "account not available in this browser",
          403,
          wantsJson,
        );
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
      const redirectUrl = appendSelectionToReturnUri({
        returnUri,
        clientId: app.clientId,
        did: selected.did,
        handle: selected.handle,
        issuer,
        state: request.state,
        token,
      });
      return browserDocument
        ? browserHandoffDocument(redirectUrl)
        : browserHandoffResponse(redirectUrl, { json: wantsJson });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status = err instanceof LoginRequestError ? err.status : 400;
      return browserHandoffError(message, status, wantsJson);
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

async function optionalFormData(req: Request): Promise<FormData> {
  const contentType = req.headers.get("content-type") ?? "";
  return contentType
    ? await req.formData().catch(() => new FormData())
    : new FormData();
}

function inputValue(sourceUrl: URL, form: FormData, key: string): string {
  const formValue = form.get(key);
  return typeof formValue === "string"
    ? formValue
    : sourceUrl.searchParams.get(key) ?? "";
}

function readLoginRequestFromInput(
  sourceUrl: URL,
  form: FormData,
): LoginRequest {
  const requestUrl = new URL("https://local.invalid/login/select");
  for (const key of ["client_id", "return_uri", "state", "scope"]) {
    const value = inputValue(sourceUrl, form, key);
    if (value) requestUrl.searchParams.set(key, value);
  }
  return readLoginRequest(requestUrl);
}

export function readLoginRequestFromInputForTest(
  sourceUrl: URL,
  form = new FormData(),
): LoginRequest {
  return readLoginRequestFromInput(sourceUrl, form);
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

export function pickerAccountsForStateForTest(state: State): PickerAccount[] {
  return getPickerAccounts(state);
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
                  <input type="hidden" name="handoff" value="browser" />
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
