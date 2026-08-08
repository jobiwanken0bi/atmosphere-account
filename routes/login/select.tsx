import { define, type State } from "../../utils.ts";
import AtmosphereHandle from "../../components/AtmosphereHandle.tsx";
import SignInForm from "../../islands/SignInForm.tsx";
import PasskeyLogin from "../../islands/PasskeyLogin.tsx";
import type { CreateAccountHostOption } from "../../lib/create-account-hosts.ts";
import { listCreateAccountHostOptions } from "../../lib/create-account-hosts.ts";
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
import {
  checkDurableRateLimit,
  checkProxyAwareRateLimit,
} from "../../lib/rate-limit.ts";
import {
  readFormDataRequestWithLimit,
  rejectLargeRequest,
  RequestBodyTooLargeError,
} from "../../lib/security.ts";
import {
  createLoginSelectionIntent,
  readLoginSelectionIntent,
} from "../../lib/login-selection-intent.ts";

interface PickerAccount {
  did: string;
  handle: string;
  pdsUrl?: string | null;
  selectionPath?: string;
}

interface PickerPageProps {
  app: LoginApp | null;
  request: LoginRequest | null;
  selectPath: string | null;
  pickerAccounts: PickerAccount[];
  createAccountHosts: CreateAccountHostOption[];
  error: string | null;
  status: number;
}

const MAX_PICKER_FORM_BYTES = 16_384;
const PICKER_SELECTION_PARAM = "selection";
const PICKER_SELECTION_RATE_LIMIT = {
  scope: "login-picker-selection",
  capacity: 30,
  refillMs: 60_000,
} as const;

export const handler = define.handlers({
  async GET(ctx) {
    const proxied = await proxyAppviewPageResponse(ctx.url, ctx.req).catch(
      () => appviewUnavailable(),
    );
    if (proxied) return proxied;

    if (ctx.url.search.length > MAX_PICKER_FORM_BYTES) {
      return browserHandoffError("request URL too large", 414, false);
    }

    const opened = await checkProxyAwareRateLimit(ctx.req, {
      scope: "login-picker-open",
      capacity: 60,
      refillMs: 60_000,
    });
    if (!opened.ok) {
      return browserHandoffError(
        "Too many account picker attempts. Try again soon.",
        429,
        false,
        { "retry-after": String(opened.retryAfter) },
      );
    }

    const intent = ctx.url.searchParams.get(PICKER_SELECTION_PARAM);
    if (intent) return await handleIntentSelection(ctx, intent);

    const props = await buildPickerPageProps(ctx);
    return ctx.render(<LoginPickerPage {...props} />, {
      status: props.status,
      headers: { "cache-control": "no-store" },
    });
  },

  async POST(ctx) {
    const proxied = await proxyAppviewApiResponse(ctx.url, ctx.req).catch(
      () => appviewUnavailable(),
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
      await recordLoginSelectionBestEffort({
        clientId: app.clientId,
        did: selected.did,
        handle: selected.handle,
      });
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
      return browserHandoffError(
        publicLoginPickerMessage(err, true),
        loginPickerFailureStatus(err, true),
        wantsJson,
      );
    }
  },
});

function appviewUnavailable(): Response {
  // The proxy error can include the full request URL, including OAuth state.
  console.error("[appview] login picker proxy failed");
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
  if (!contentType || !req.body) return new FormData();
  const form = await readFormDataRequestWithLimit(req, MAX_PICKER_FORM_BYTES);
  if (!form) throw new LoginRequestError("invalid picker form");
  return form;
}

function inputValue(sourceUrl: URL, form: FormData, key: string): string {
  const formValues = form.getAll(key);
  const queryValues = sourceUrl.searchParams.getAll(key);
  if (formValues.length > 1 || queryValues.length > 1) {
    throw new LoginRequestError(`duplicate ${key}`);
  }
  const formValue = formValues[0];
  if (formValue !== undefined && typeof formValue !== "string") {
    throw new LoginRequestError(`invalid ${key}`);
  }
  if (formValue !== undefined && queryValues.length > 0) {
    throw new LoginRequestError(`duplicate ${key}`);
  }
  return formValue ?? queryValues[0] ?? "";
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

async function handleIntentSelection(
  ctx: { req: Request; state: State; url: URL },
  intent: string,
): Promise<Response> {
  try {
    const limited = await checkDurableRateLimit(
      ctx.req,
      PICKER_SELECTION_RATE_LIMIT,
    );
    if (!limited.ok) {
      return browserHandoffError(
        "Too many account picker attempts. Try again soon.",
        429,
        false,
        { "retry-after": String(limited.retryAfter) },
      );
    }
    if (ctx.url.search.length > MAX_PICKER_FORM_BYTES) {
      return browserHandoffError("request URL too large", 414, false);
    }
    const selection = await readLoginSelectionIntent(intent);
    if (!selection) {
      return browserHandoffError(
        "This account choice has expired. Return to the app and try again.",
        403,
        false,
      );
    }
    return await completePickerSelection(
      ctx,
      selection.request,
      selection.did,
      {
        json: false,
        browserDocument: false,
      },
    );
  } catch (err) {
    return browserHandoffError(
      publicLoginPickerMessage(err),
      loginPickerFailureStatus(err),
      false,
    );
  }
}

async function completePickerSelection(
  ctx: { req: Request; state: State; url: URL },
  request: LoginRequest,
  did: string,
  options: { json: boolean; browserDocument: boolean },
): Promise<Response> {
  const { app, returnUri } = await resolveLoginAppForRequest(request);
  const selected = getPickerAccounts(ctx.state).find((account) =>
    account.did === did
  );
  if (!selected) {
    return browserHandoffError(
      "account not available in this browser",
      403,
      options.json,
    );
  }
  const issuer = loginPickerOriginForRequest(ctx.url, ctx.req.headers);
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
  await recordLoginSelectionBestEffort({
    clientId: app.clientId,
    did: selected.did,
    handle: selected.handle,
  });
  const redirectUrl = appendSelectionToReturnUri({
    returnUri,
    clientId: app.clientId,
    did: selected.did,
    handle: selected.handle,
    issuer,
    state: request.state,
    token,
  });
  return options.browserDocument
    ? browserHandoffDocument(redirectUrl)
    : browserHandoffResponse(redirectUrl, { json: options.json });
}

async function recordLoginSelectionBestEffort(input: {
  clientId: string;
  did: string;
  handle: string;
}): Promise<void> {
  let timer = 0;
  try {
    await Promise.race([
      recordLoginSelection(input).catch(() => {}),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 750);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function readLoginRequestFromInputForTest(
  sourceUrl: URL,
  form = new FormData(),
): LoginRequest {
  return readLoginRequestFromInput(sourceUrl, form);
}

async function buildPickerPageProps(
  ctx: { req: Request; state: State; url: URL },
): Promise<PickerPageProps> {
  try {
    const request = readLoginRequest(ctx.url);
    const { app } = await resolveLoginAppForRequest(request);
    const pickerAccounts = await Promise.all(
      getPickerAccounts(ctx.state).map(async (account) => {
        return {
          ...account,
          selectionPath: await createPickerSelectionPath(
            request,
            account.did,
            ctx.url,
          ),
        };
      }),
    );
    const createAccountHosts = await listCreateAccountHostOptions({
      app,
      pageSize: 24,
    }).catch(() => {
      console.warn("[login] account host discovery failed");
      return [];
    });
    return {
      app,
      request,
      selectPath: loginRequestToPath(request),
      pickerAccounts,
      createAccountHosts,
      error: null,
      status: 200,
    };
  } catch (err) {
    return {
      app: null,
      request: null,
      selectPath: null,
      pickerAccounts: [],
      createAccountHosts: [],
      error: publicLoginPickerMessage(err),
      status: loginPickerFailureStatus(err),
    };
  }
}

const LOGIN_PICKER_FAILURE_MESSAGE =
  "Unable to continue. Return to the app and try again.";

function publicLoginPickerMessage(
  error: unknown,
  allowBodyTooLarge = false,
): string {
  return allowBodyTooLarge && error instanceof RequestBodyTooLargeError
    ? "request body too large"
    : LOGIN_PICKER_FAILURE_MESSAGE;
}

function loginPickerFailureStatus(
  error: unknown,
  allowBodyTooLarge = false,
): number {
  if (allowBodyTooLarge && error instanceof RequestBodyTooLargeError) {
    return 413;
  }
  return error instanceof LoginRequestError ? error.status : 400;
}

export function publicLoginPickerFailureForTest(error: unknown): {
  message: string;
  status: number;
} {
  return {
    message: publicLoginPickerMessage(error, true),
    status: loginPickerFailureStatus(error, true),
  };
}

async function createPickerSelectionPath(
  request: LoginRequest,
  did: string,
  baseUrl: URL,
): Promise<string> {
  const selectionUrl = new URL("/login/select", baseUrl);
  selectionUrl.searchParams.set(
    PICKER_SELECTION_PARAM,
    await createLoginSelectionIntent(request, did),
  );
  return `${selectionUrl.pathname}${selectionUrl.search}`;
}

export async function pickerSelectionPathForTest(
  request: LoginRequest,
  did: string,
  baseUrl = new URL("https://login.atmosphereaccount.com/login/select"),
): Promise<string> {
  return await createPickerSelectionPath(request, did, baseUrl);
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
  const {
    app,
    request,
    selectPath,
    pickerAccounts,
    createAccountHosts,
    error,
  } = props;
  return (
    <div id="page-top" class="login-picker-page">
      <section class="signin-page-section login-picker-section">
        <div class="container signin-page-container login-picker-container">
          <p class="text-eyebrow">Account picker</p>
          <h1 class="text-section login-picker-title">
            <span>Continue with</span>
            <span class="login-picker-title-brand">
              <img src="/union.svg" alt="" width="36" height="36" />
              <span>Atmosphere</span>
            </span>
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
                  createAccountHosts={createAccountHosts}
                />
              )}
          </div>
        </div>
      </section>
    </div>
  );
}

function LoginPickerBody(
  { app, request, selectPath, pickerAccounts, createAccountHosts }: {
    app: LoginApp;
    request: LoginRequest;
    selectPath: string;
    pickerAccounts: PickerAccount[];
    createAccountHosts: CreateAccountHostOption[];
  },
) {
  const hostEndpoint = `/api/login/account-hosts?client_id=${
    encodeURIComponent(app.clientId)
  }`;
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

      <PasskeyLogin
        clientId={request.clientId}
        returnUri={request.returnUri}
        state={request.state}
        scope={request.scope}
        appName={app.appName}
      />

      {pickerAccounts.length > 0
        ? (
          <>
            <div class="login-picker-account-list" aria-label="Saved accounts">
              {pickerAccounts.map((account) => (
                <a
                  href={account.selectionPath}
                  class="login-picker-account-row"
                  rel="nofollow"
                  key={account.did}
                >
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
                </a>
              ))}
            </div>
            <details class="login-picker-add-account">
              <summary class="profile-form-button-secondary login-picker-secondary">
                <span class="login-picker-secondary-symbol" aria-hidden="true">
                  +
                </span>
                Add another account
              </summary>
              <div class="login-picker-add-account-body">
                <SignInForm
                  returnTo={selectPath}
                  continuation="login_selection"
                  rememberedAccounts={[]}
                  createAccountHosts={createAccountHosts}
                  createAccountHostsEndpoint={hostEndpoint}
                  rich
                />
              </div>
            </details>
          </>
        )
        : (
          <div class="login-picker-empty">
            {isOAuthConfigured()
              ? (
                <SignInForm
                  returnTo={selectPath}
                  continuation="login_selection"
                  rememberedAccounts={[]}
                  createAccountHosts={createAccountHosts}
                  createAccountHostsEndpoint={hostEndpoint}
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
        {app.appName} will ask your account host to finish signing you in.
      </p>
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
  if (app.status !== "unverified") return null;
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
