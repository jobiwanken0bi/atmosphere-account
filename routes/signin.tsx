import { define } from "../utils.ts";
import Nav from "../components/Nav.tsx";
import Footer from "../components/Footer.tsx";
import SignInForm, {
  type CreateAccountHostOption,
} from "../islands/SignInForm.tsx";
import { buildAccountMenuProps } from "../lib/account-menu-props.ts";
import { getAppUser } from "../lib/account-types.ts";
import { listCreateAccountHostOptions } from "../lib/create-account-hosts.ts";
import {
  type LoginApp,
  readLoginRequest,
  resolveLoginAppForRequest,
} from "../lib/atmosphere-login.ts";
import { getSessionForCapabilities, isOAuthConfigured } from "../lib/oauth.ts";
import { refreshRememberedAccountCookies } from "../lib/remembered-accounts.ts";
import {
  normalizeOAuthCapabilities,
  type OAuthCapability,
} from "../lib/oauth-scopes.ts";
import AtmosphereHandle from "../components/AtmosphereHandle.tsx";
import {
  accountCreationErrorMessage,
  isAccountCreationError,
  isOAuthAction,
  isOAuthActionCapabilityRequest,
  type OAuthAction,
  safeOAuthTargetName,
} from "../lib/oauth-action.ts";
import {
  authActionCopy,
  oauthActionAllowsAccountCreation,
} from "../lib/oauth-action-copy.ts";
import { oauthAuthorizationExitHref } from "../lib/oauth-cancellation.ts";
import { hasValidLoginSelectionContinuationBinding } from "../lib/oauth-continuation.ts";
import { devPickerAccountForDid } from "../lib/dev-picker-demo.ts";
import { IS_DEV } from "../lib/env.ts";
import { appDetailBackNavigation } from "../lib/host-directory-navigation.ts";
import { isSafeRelativePath } from "../lib/security.ts";
import {
  InvalidOAuthRequestInputError,
  optionalEnum,
  optionalSafeRelativePath,
  repeatedSearchValues,
  singleSearchValue,
} from "../lib/oauth-request-input.ts";

export { authActionCopy } from "../lib/oauth-action-copy.ts";

const MAX_SIGNIN_QUERY_BYTES = 16_384;

export const handler = define.handlers({
  async GET(ctx) {
    let request;
    try {
      request = readSignInAuthorizationRequest(ctx.url);
    } catch {
      return new Response(
        "This sign-in link is invalid. Return to the previous page and try again.",
        { status: 400, headers: { "cache-control": "no-store" } },
      );
    }
    const {
      next,
      initialHandle,
      intent,
      requestedMode: mode,
      choosingAnotherAccount,
      manualAccountEntry,
      continuation,
      capabilities,
      action,
      targetName,
      permissionState,
      createError,
    } = request;
    const allowAccountCreation = oauthActionAllowsAccountCreation(action);
    if (mode === "create" && !allowAccountCreation) {
      return new Response(
        "This account-creation link is invalid. Return to the previous page and try again.",
        { status: 400, headers: { "cache-control": "no-store" } },
      );
    }
    if (
      ctx.state.user && shouldUseExistingAccount(
        mode,
        choosingAnotherAccount,
      )
    ) {
      // Validate and refresh the token before auto-continuing. Trusting only
      // the stored scope can bounce a revoked/expired session endlessly
      // between this route and the protected destination.
      const oauthSession = await getSessionForCapabilities(
        ctx.state.user.did,
        capabilities,
        { quiet: true },
      );
      if (
        oauthSession &&
        permissionState !== "partial" && permissionState !== "concurrent" &&
        permissionState !== "denied" && permissionState !== "required" &&
        permissionState !== "failed"
      ) {
        return new Response(null, {
          status: 303,
          headers: { location: next ?? "/account" },
        });
      }
    }
    const account = buildAccountMenuProps(ctx.state);
    const cachedIdentity = account.user
      ? await getAppUser(account.user.did).catch(() => null)
      : null;
    const devIdentity = account.user && IS_DEV
      ? devPickerAccountForDid(account.user.did)
      : null;
    const currentAccountIdentity = account.user
      ? {
        displayName: cachedIdentity?.displayName ??
          devIdentity?.displayName ?? null,
        avatarUrl: `/api/registry/avatar/${
          encodeURIComponent(account.user.did)
        }`,
      }
      : null;
    const createAccountApp = mode === "create"
      ? await createAccountAppForNext(next)
      : null;
    const createAccountHosts = mode === "create"
      ? await loadCreateAccountHosts(createAccountApp)
      : { hosts: [], unavailable: false };
    const createAccountHostsEndpoint = createAccountHostsEndpointForNext(
      next,
      createAccountApp,
    );
    const createAccountError = createError
      ? accountCreationErrorMessage(createError)
      : null;
    const response = await ctx.render(
      (
        <SignInPageContent
          account={account}
          currentAccountIdentity={currentAccountIdentity}
          mode={mode}
          next={next ?? "/account"}
          intent={intent}
          capabilities={capabilities}
          action={action}
          targetName={targetName}
          permissionState={permissionState}
          choosingAnotherAccount={choosingAnotherAccount}
          manualAccountEntry={manualAccountEntry}
          continuation={continuation ?? undefined}
          allowAccountCreation={allowAccountCreation}
          initialHandle={initialHandle}
          createAccountHosts={createAccountHosts.hosts}
          createAccountHostsUnavailable={createAccountHosts.unavailable}
          createAccountHostsEndpoint={createAccountHostsEndpoint}
          createAccountError={createAccountError}
          oauthConfigured={isOAuthConfigured()}
        />
      ),
      { headers: { "cache-control": "no-store" } },
    );
    if (account.rememberedAccounts.length > 0) {
      const cookies = await refreshRememberedAccountCookies(
        account.rememberedAccounts,
      );
      for (const cookie of cookies) {
        response.headers.append("set-cookie", cookie);
      }
    }
    return response;
  },
});

export function readSignInAuthorizationRequest(url: URL) {
  if (url.search.length > MAX_SIGNIN_QUERY_BYTES) {
    throw new InvalidOAuthRequestInputError();
  }
  const next = optionalSafeRelativePath(
    singleSearchValue(url.searchParams, "next"),
  );
  const rawHandle = singleSearchValue(url.searchParams, "handle");
  const initialHandle = rawHandle === null ? undefined : safeHandle(rawHandle);
  if (rawHandle !== null && !initialHandle) {
    throw new InvalidOAuthRequestInputError();
  }
  const intent = optionalEnum(
    singleSearchValue(url.searchParams, "intent"),
    ["project", "user"] as const,
  ) ?? undefined;
  const mode = optionalEnum(
    singleSearchValue(url.searchParams, "mode"),
    ["signin", "create"] as const,
  );
  const choose = optionalEnum(
    singleSearchValue(url.searchParams, "choose"),
    ["another"] as const,
  );
  const entry = optionalEnum(
    singleSearchValue(url.searchParams, "entry"),
    ["manual"] as const,
  );
  const continuation = optionalEnum(
    singleSearchValue(url.searchParams, "continuation"),
    ["login_selection"] as const,
  );
  const capabilities = normalizeOAuthCapabilities(
    repeatedSearchValues(url.searchParams, "capability"),
  );
  if (!capabilities) throw new InvalidOAuthRequestInputError();
  const rawAction = singleSearchValue(url.searchParams, "action");
  if (rawAction !== null && !isOAuthAction(rawAction)) {
    throw new InvalidOAuthRequestInputError();
  }
  const action = safeAuthAction(rawAction);
  if (!isOAuthActionCapabilityRequest(action, capabilities)) {
    throw new InvalidOAuthRequestInputError();
  }
  if (
    !hasValidLoginSelectionContinuationBinding(
      next,
      continuation,
      intent ?? null,
      action,
      capabilities,
    )
  ) throw new InvalidOAuthRequestInputError();
  const rawName = singleSearchValue(url.searchParams, "name");
  const targetName = safeTargetName(rawName);
  if (rawName !== null && !targetName) {
    throw new InvalidOAuthRequestInputError();
  }
  const permissionState = optionalEnum(
    singleSearchValue(url.searchParams, "permission"),
    ["denied", "failed", "partial", "concurrent", "required"] as const,
  );
  const createErrorRaw = singleSearchValue(url.searchParams, "create_error");
  if (createErrorRaw !== null && !isAccountCreationError(createErrorRaw)) {
    throw new InvalidOAuthRequestInputError();
  }
  return {
    next,
    initialHandle,
    intent,
    requestedMode: mode === "create" ? "create" as const : "signin" as const,
    choosingAnotherAccount: choose === "another",
    manualAccountEntry: entry === "manual",
    continuation,
    capabilities,
    action,
    targetName,
    permissionState,
    createError: isAccountCreationError(createErrorRaw) ? createErrorRaw : null,
  };
}

function safeHandle(raw: string | null): string | undefined {
  const handle = raw?.trim().replace(/^@/, "").toLowerCase();
  if (
    !handle ||
    !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/
      .test(handle)
  ) {
    return undefined;
  }
  return handle;
}

function safeAuthAction(raw: string | null): OAuthAction {
  return isOAuthAction(raw) ? raw : "account";
}

function safeTargetName(raw: string | null): string | null {
  return safeOAuthTargetName(raw) ?? null;
}

export function SignInPageContent(
  {
    account,
    currentAccountIdentity,
    mode,
    next,
    intent,
    capabilities,
    action,
    targetName,
    permissionState,
    choosingAnotherAccount,
    manualAccountEntry,
    continuation,
    allowAccountCreation,
    initialHandle,
    createAccountHosts,
    createAccountHostsUnavailable,
    createAccountHostsEndpoint,
    createAccountError,
    oauthConfigured,
  }: {
    account: ReturnType<typeof buildAccountMenuProps>;
    currentAccountIdentity?: {
      displayName: string | null;
      avatarUrl: string;
    } | null;
    mode: "signin" | "create";
    next: string;
    intent?: "user" | "project";
    capabilities: OAuthCapability[];
    action: OAuthAction;
    targetName: string | null;
    permissionState: string | null;
    choosingAnotherAccount: boolean;
    manualAccountEntry?: boolean;
    continuation?: "login_selection";
    allowAccountCreation: boolean;
    initialHandle?: string;
    createAccountHosts: CreateAccountHostOption[];
    createAccountHostsUnavailable: boolean;
    createAccountHostsEndpoint: string;
    createAccountError: string | null;
    oauthConfigured: boolean;
  },
) {
  const copy = authActionCopy(action, targetName);
  const signedInUser = shouldUseExistingAccount(
      mode,
      choosingAnotherAccount,
    )
    ? account.user
    : null;
  const createMode = mode === "create";
  const backNavigation = contextualAuthorizationBackNavigation(
    next,
    action,
    choosingAnotherAccount,
  );
  const chooserAccounts = choosingAnotherAccount && account.user
    ? account.rememberedAccounts.filter(({ did }) => did !== account.user?.did)
    : account.rememberedAccounts;
  return (
    <div id="page-top">
      <div class="content-layer">
        <Nav account={account} disableScrollEffects />
        <main id="main-content" class="signin-page-section">
          <div
            class="container signin-page-container"
            data-signin-page-copy="true"
          >
            {backNavigation && (
              <a href={backNavigation.href} class="text-link-button">
                ← {backNavigation.label}
              </a>
            )}
            {!createMode && <p class="text-eyebrow">{copy.eyebrow}</p>}
            <h1
              class="text-section signin-page-brand-title"
              data-initial-mode={mode}
            >
              {!signedInUser || createMode
                ? <img src="/union.svg" alt="" width="40" height="40" />
                : null}
              <span>
                {createMode
                  ? "Create an Atmosphere account"
                  : signedInUser
                  ? "Additional permission required"
                  : "Login with Atmosphere"}
              </span>
            </h1>
            {!createMode && (
              <p class="text-body mt-2">
                {signedInUser
                  ? copy.upgradeBody(signedInUser.handle)
                  : copy.signInBody}
              </p>
            )}
            <div class="glass signin-page-card">
              {!createMode && permissionStatusCopy(permissionState) && (
                <p class="profile-form-status profile-form-status--error">
                  {permissionStatusCopy(permissionState)}
                </p>
              )}
              {createMode
                ? (
                  <SignInForm
                    mode="create"
                    returnTo={next}
                    intent={intent}
                    capabilities={capabilities}
                    action={action}
                    targetName={targetName ?? undefined}
                    continuation={continuation}
                    createAccountHosts={createAccountHosts}
                    createAccountHostsEndpoint={createAccountHostsEndpoint}
                    createAccountError={createAccountError ??
                      (!oauthConfigured
                        ? "Account creation is temporarily unavailable on this deployment. You can still review the available hosts and try again shortly."
                        : null)}
                    createAccountHostsUnavailable={createAccountHostsUnavailable}
                    createAccountStartUnavailable={!oauthConfigured}
                    rich
                  />
                )
                : !oauthConfigured
                ? (
                  <p class="text-body">
                    OAuth is not configured on this deployment yet. Try again
                    shortly.
                  </p>
                )
                : signedInUser
                ? (
                  <PermissionUpgradeForm
                    user={signedInUser}
                    displayName={currentAccountIdentity?.displayName ?? null}
                    avatarUrl={currentAccountIdentity?.avatarUrl ??
                      `/api/registry/avatar/${
                        encodeURIComponent(signedInUser.did)
                      }`}
                    returnTo={next}
                    intent={intent}
                    capabilities={capabilities}
                    action={action}
                    targetName={targetName}
                    continuation={continuation}
                  />
                )
                : (
                  <SignInForm
                    returnTo={next}
                    intent={intent}
                    capabilities={capabilities}
                    action={action}
                    targetName={targetName ?? undefined}
                    rememberedAccounts={chooserAccounts}
                    initialHandle={initialHandle}
                    continuation={continuation}
                    chooseAnotherAccount={choosingAnotherAccount}
                    manualAccountEntry={manualAccountEntry}
                    allowAccountCreation={allowAccountCreation}
                    rich
                  />
                )}
              <AuthorizationExitLink
                permissionState={permissionState}
                returnTo={next}
                action={action}
              />
            </div>
          </div>
        </main>
        <Footer variant="compact" />
      </div>
    </div>
  );
}

export function contextualAuthorizationBackNavigation(
  returnTo: string,
  action: OAuthAction,
  returnToClaim = false,
): { href: string; label: string } | null {
  if (action !== "host_claim" && action !== "host_transfer") return null;
  if (!isSafeRelativePath(returnTo)) return null;
  try {
    const url = new URL(returnTo, "https://atmosphere.invalid");
    const match = /^\/hosts\/([^/]+)\/claim$/.exec(url.pathname);
    if (!match) return null;
    const hostNavigation = appDetailBackNavigation(`/hosts/${match[1]}`);
    if (hostNavigation.label !== "Back to host") return null;
    if (returnToClaim) {
      return {
        href: `${url.pathname}${url.search}${url.hash}`,
        label: action === "host_transfer"
          ? "Back to transfer"
          : "Back to claim",
      };
    }
    return action === "host_transfer"
      ? {
        href: `${hostNavigation.href}/manage`,
        label: "Back to host management",
      }
      : hostNavigation;
  } catch {
    return null;
  }
}

export function PermissionUpgradeForm(
  {
    user,
    displayName,
    avatarUrl,
    returnTo,
    intent,
    capabilities,
    action,
    targetName,
    continuation,
  }: {
    user: { did: string; handle: string };
    displayName?: string | null;
    avatarUrl?: string | null;
    returnTo: string;
    intent?: "user" | "project";
    capabilities: readonly OAuthCapability[];
    action: OAuthAction;
    targetName: string | null;
    continuation?: "login_selection";
  },
) {
  const addsRepositoryPermission = capabilities.some((capability) =>
    capability !== "identity"
  );
  return (
    <div class="signin-upgrade-panel">
      <div class="signin-account-list signin-upgrade-account-list">
        <p class="signin-account-list-label">Currently signed in</p>
        <div class="signin-account-row signin-account-row--current">
          <span class="signin-account-avatar" aria-hidden="true">
            <span class="signin-account-avatar-fallback">
              {user.handle.slice(0, 1).toUpperCase()}
            </span>
            {avatarUrl && (
              <img
                src={avatarUrl}
                alt=""
                loading="eager"
                decoding="async"
                width={38}
                height={38}
              />
            )}
          </span>
          <span class="signin-account-copy">
            <strong>{displayName || "Atmosphere account"}</strong>
            <span>
              <AtmosphereHandle handle={user.handle} />
            </span>
          </span>
          <span class="signin-account-status">Current</span>
        </div>
      </div>
      <form method="GET" action="/oauth/login" class="signin-form">
        <input type="hidden" name="handle" value={user.did} />
        <input type="hidden" name="next" value={returnTo} />
        {intent && <input type="hidden" name="intent" value={intent} />}
        <input type="hidden" name="action" value={action} />
        {continuation && (
          <input
            type="hidden"
            name="continuation"
            value={continuation}
          />
        )}
        {targetName && <input type="hidden" name="name" value={targetName} />}
        {capabilities.map((capability) => (
          <input type="hidden" name="capability" value={capability} />
        ))}
        <button type="submit" class="signin-form-submit">
          {addsRepositoryPermission
            ? "Approve and continue"
            : "Confirm and continue"}
        </button>
      </form>
      <form
        method="GET"
        action="/oauth/add-account"
        class="signin-account-list signin-account-switch-form signin-upgrade-other-account"
      >
        <input type="hidden" name="next" value={returnTo} />
        {intent && <input type="hidden" name="intent" value={intent} />}
        <input type="hidden" name="action" value={action} />
        {continuation && (
          <input
            type="hidden"
            name="continuation"
            value={continuation}
          />
        )}
        {targetName && <input type="hidden" name="name" value={targetName} />}
        {capabilities.map((capability) => (
          <input type="hidden" name="capability" value={capability} />
        ))}
        <button type="submit" class="signin-account-row">
          <span
            class="signin-account-avatar signin-account-avatar--plus"
            aria-hidden="true"
          >
            +
          </span>
          <span class="signin-account-copy">
            <strong>Use another account</strong>
            <span>Choose a saved account or enter another handle</span>
          </span>
          <span class="signin-account-status">Continue</span>
        </button>
      </form>
    </div>
  );
}

export function shouldUseExistingAccount(
  mode: "signin" | "create",
  choosingAnotherAccount = false,
): boolean {
  return mode !== "create" && !choosingAnotherAccount;
}

export function AuthorizationExitLink(
  {
    permissionState,
    returnTo,
    action,
  }: {
    permissionState: string | null;
    returnTo: string;
    action: OAuthAction;
  },
) {
  if (
    permissionState !== "denied" && permissionState !== "partial" &&
    permissionState !== "concurrent" && permissionState !== "required" &&
    permissionState !== "failed"
  ) return null;
  return (
    <p class="text-body mt-2">
      <a
        href={oauthAuthorizationExitHref(returnTo, action)}
        class="profile-form-button-link"
      >
        Not now
      </a>
    </p>
  );
}

export function signedInAuthHeading(
  capabilities: readonly OAuthCapability[],
): string {
  return capabilities.some((capability) => capability !== "identity")
    ? "Approve access to continue"
    : "Confirm your account";
}

/** Retained for focused authorization-copy tests and image-editor prompts. */
export function authMediaContext(
  capabilities: readonly OAuthCapability[],
): string | null {
  return capabilities.includes("media")
    ? "This includes image uploads for the app or host profile."
    : null;
}

export function permissionStatusCopy(state: string | null): string | null {
  if (state === "denied") return "You canceled sign-in. Nothing changed.";
  if (state === "failed") {
    return "Sign-in could not be completed. Nothing changed. Try again.";
  }
  if (state === "concurrent") {
    return "Your account changed while this was open. Continue once more to finish safely.";
  }
  if (state === "partial") {
    return "Your account host did not approve everything needed. Try again or choose another account.";
  }
  return null;
}

async function loadCreateAccountHosts(
  app: LoginApp | null,
): Promise<{ hosts: CreateAccountHostOption[]; unavailable: boolean }> {
  return await listCreateAccountHostOptions({ app }).then((hosts) => ({
    hosts,
    unavailable: false,
  })).catch(() => {
    console.warn("[signin] account host discovery failed");
    return { hosts: [], unavailable: true };
  });
}

function pickerClientIdFromNext(next: string | null): string | null {
  if (!next) return null;
  try {
    const url = new URL(next, "https://local.invalid");
    if (url.pathname !== "/login/select") return null;
    const clientId = url.searchParams.get("client_id")?.trim() ?? "";
    return clientId && clientId.length <= 2048 ? clientId : null;
  } catch {
    return null;
  }
}

async function createAccountAppForNext(
  next: string | null,
): Promise<LoginApp | null> {
  const clientId = pickerClientIdFromNext(next);
  if (!clientId || !next) return null;
  try {
    const request = readLoginRequest(new URL(next, "https://local.invalid"));
    return (await resolveLoginAppForRequest(request)).app;
  } catch {
    return null;
  }
}

function createAccountHostsEndpointForNext(
  next: string | null,
  app: LoginApp | null,
): string {
  const clientId = pickerClientIdFromNext(next);
  return clientId && app?.clientId === clientId
    ? `/api/login/account-hosts?client_id=${encodeURIComponent(clientId)}`
    : "/api/login/account-hosts";
}

export function pickerClientIdFromNextForTest(next: string | null) {
  return pickerClientIdFromNext(next);
}
