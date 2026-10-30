import { define } from "../utils.ts";
import Nav from "../components/Nav.tsx";
import Footer from "../components/Footer.tsx";
import SignInForm, {
  type CreateAccountHostOption,
} from "../islands/SignInForm.tsx";
import { buildAccountMenuProps } from "../lib/account-menu-props.ts";
import { listCreateAccountHostOptions } from "../lib/create-account-hosts.ts";
import { getSessionForCapabilities, isOAuthConfigured } from "../lib/oauth.ts";
import { refreshRememberedAccountCookies } from "../lib/remembered-accounts.ts";
import {
  normalizeOAuthCapabilities,
  type OAuthCapability,
} from "../lib/oauth-scopes.ts";
import AtmosphereHandle from "../components/AtmosphereHandle.tsx";
import {
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
import {
  InvalidOAuthRequestInputError,
  optionalEnum,
  optionalSafeRelativePath,
  repeatedSearchValues,
  singleSearchValue,
} from "../lib/oauth-request-input.ts";

export { authActionCopy } from "../lib/oauth-action-copy.ts";

const MAX_SIGNIN_QUERY_BYTES = 16_384;

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
    [
      "project",
      "user",
    ] as const,
  ) ?? undefined;
  const mode = optionalEnum(
    singleSearchValue(url.searchParams, "mode"),
    [
      "create",
    ] as const,
  );
  const choose = optionalEnum(
    singleSearchValue(url.searchParams, "choose"),
    [
      "another",
    ] as const,
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
  ) {
    throw new InvalidOAuthRequestInputError();
  }
  const targetName = safeTargetName(
    singleSearchValue(url.searchParams, "name"),
  );
  const permissionState = optionalEnum(
    singleSearchValue(url.searchParams, "permission"),
    ["denied", "failed", "partial", "concurrent", "required"] as const,
  );
  return {
    next,
    initialHandle,
    intent,
    requestedMode: mode === "create" ? "create" as const : "signin" as const,
    choosingAnotherAccount: choose === "another",
    continuation,
    capabilities,
    action,
    targetName,
    permissionState,
  };
}

export const handler = define.handlers({
  async GET(ctx) {
    let request;
    try {
      request = readSignInAuthorizationRequest(ctx.url);
    } catch {
      return new Response(
        "This Login with Atmosphere link is invalid. Return to the previous page and try again.",
        { status: 400, headers: { "cache-control": "no-store" } },
      );
    }
    const {
      next,
      initialHandle,
      intent,
      requestedMode,
      choosingAnotherAccount,
      continuation,
      capabilities,
      action,
      targetName,
      permissionState,
    } = request;
    const allowAccountCreation = oauthActionAllowsAccountCreation(action);
    if (requestedMode === "create" && !allowAccountCreation) {
      return new Response(
        "This Login with Atmosphere link is invalid. Return to the previous page and try again.",
        { status: 400, headers: { "cache-control": "no-store" } },
      );
    }
    const initialMode = requestedMode === "create" && allowAccountCreation
      ? "create"
      : "signin";
    if (
      ctx.state.user &&
      shouldUseExistingAccount(initialMode, choosingAnotherAccount)
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
        permissionState !== "denied" && permissionState !== "failed" &&
        permissionState !== "required"
      ) {
        return new Response(null, {
          status: 303,
          headers: { location: next ?? "/account" },
        });
      }
    }
    const account = buildAccountMenuProps(ctx.state);
    const createAccountHosts = await loadCreateAccountHosts();
    const response = await ctx.render(
      (
        <SignInPageContent
          account={account}
          next={next ?? "/account"}
          intent={intent}
          capabilities={capabilities}
          action={action}
          targetName={targetName}
          permissionState={permissionState}
          initialMode={initialMode}
          choosingAnotherAccount={choosingAnotherAccount}
          continuation={continuation ?? undefined}
          allowAccountCreation={allowAccountCreation}
          initialHandle={initialHandle}
          createAccountHosts={createAccountHosts}
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
    next,
    intent,
    capabilities,
    action,
    targetName,
    permissionState,
    initialMode,
    choosingAnotherAccount,
    continuation,
    allowAccountCreation,
    initialHandle,
    createAccountHosts,
    oauthConfigured,
  }: {
    account: ReturnType<typeof buildAccountMenuProps>;
    next: string;
    intent?: "user" | "project";
    capabilities: OAuthCapability[];
    action: OAuthAction;
    targetName: string | null;
    permissionState: string | null;
    initialMode: "signin" | "create";
    choosingAnotherAccount: boolean;
    continuation?: "login_selection";
    allowAccountCreation: boolean;
    initialHandle?: string;
    createAccountHosts: CreateAccountHostOption[];
    oauthConfigured: boolean;
  },
) {
  const copy = authActionCopy(action, targetName);
  const creatingAccount = initialMode === "create";
  const signedInUser = shouldUseExistingAccount(
      initialMode,
      choosingAnotherAccount,
    )
    ? account.user
    : null;
  const signInHeading = choosingAnotherAccount && action === "account"
    ? "Choose another account"
    : signedInUser
    ? signedInAuthHeading(capabilities)
    : copy.title;
  const signInBody = signedInUser
    ? copy.upgradeBody(signedInUser.handle)
    : copy.signInBody;
  return (
    <div id="page-top">
      <div class="content-layer">
        <Nav account={account} disableScrollEffects />
        <section class="signin-page-section">
          <div
            class="container signin-page-container"
            data-signin-page-copy="true"
          >
            {!creatingAccount && (
              <p
                class="text-eyebrow"
                data-signin-mode-copy="true"
                data-signin-copy-signin={copy.eyebrow}
                data-signin-copy-create=""
              >
                {copy.eyebrow}
              </p>
            )}
            <h1
              class="text-section"
              data-signin-mode-copy="true"
              data-signin-copy-signin={signInHeading}
              data-signin-copy-create="Create an Atmosphere account"
            >
              {creatingAccount ? "Create an Atmosphere account" : signInHeading}
            </h1>
            <p
              class="text-body mt-2"
              data-signin-mode-content="signin"
              hidden={creatingAccount}
            >
              {signInBody}
            </p>
            <div
              class="signin-create-intro mt-2"
              data-signin-mode-content="create"
              hidden={!creatingAccount}
            >
              <div class="signin-create-intro-card">
                <span class="signin-create-intro-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <path d="M4 10.5 12 4l8 6.5V20H4z" />
                    <path d="M9 20v-6h6v6" />
                  </svg>
                </span>
                <div class="signin-create-intro-copy">
                  <h2>Your host is where your account lives.</h2>
                  <p>
                    Create an account with a host and you’ll return here when
                    it’s ready. You can use the same account with any{" "}
                    <a href="/apps">app</a> in the Atmosphere.
                  </p>
                </div>
              </div>
              <div class="signin-create-intro-card">
                <span class="signin-create-intro-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <path d="M5 7h13" />
                    <path d="m15 4 3 3-3 3" />
                    <path d="M19 17H6" />
                    <path d="m9 14-3 3 3 3" />
                  </svg>
                </span>
                <div class="signin-create-intro-copy">
                  <h2>Your account is yours.</h2>
                  <p>
                    You can move it to another host later, and if you own a
                    domain, you can use it as your handle - for example,{" "}
                    <strong>you.com</strong>.
                  </p>
                </div>
              </div>
            </div>
            <div class="glass signin-page-card">
              {permissionStatusCopy(permissionState) && (
                <p class="profile-form-status profile-form-status--error">
                  {permissionStatusCopy(permissionState)}
                </p>
              )}
              {!oauthConfigured
                ? (
                  <p class="text-body">
                    Login with Atmosphere isn’t available here yet. Try again
                    shortly.
                  </p>
                )
                : signedInUser
                ? (
                  <PermissionUpgradeForm
                    user={signedInUser}
                    returnTo={next}
                    intent={intent}
                    capabilities={capabilities}
                    action={action}
                    targetName={targetName}
                    continuation={continuation ?? undefined}
                  />
                )
                : (
                  <SignInForm
                    returnTo={next}
                    intent={intent}
                    capabilities={capabilities}
                    action={action}
                    targetName={targetName ?? undefined}
                    rememberedAccounts={account.rememberedAccounts}
                    initialHandle={initialHandle}
                    createAccountHosts={createAccountHosts}
                    createAccountHostsEndpoint="/api/login/account-hosts"
                    initialMode={initialMode}
                    allowAccountCreation={allowAccountCreation}
                    chooseAnotherAccount={choosingAnotherAccount}
                    continuation={continuation}
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
        </section>
        <Footer variant="compact" />
      </div>
    </div>
  );
}

export function shouldUseExistingAccount(
  initialMode: "signin" | "create",
  choosingAnotherAccount = false,
): boolean {
  return initialMode !== "create" && !choosingAnotherAccount;
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
  ) {
    return null;
  }
  const href = oauthAuthorizationExitHref(returnTo, action);
  return (
    <p class="text-body mt-2">
      <a href={href} class="profile-form-button-link">Not now</a>
    </p>
  );
}

export function PermissionUpgradeForm(
  {
    user,
    returnTo,
    intent,
    capabilities,
    action,
    targetName,
    continuation,
  }: {
    user: { did: string; handle: string };
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
      <p class="signin-account-list-label">Currently signed in</p>
      <p class="account-home-handle">
        <AtmosphereHandle handle={user.handle} />
      </p>
      <form method="POST" action="/oauth/login" class="signin-form">
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
      <form method="POST" action="/oauth/add-account" class="signin-form">
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
        <button type="submit" class="profile-form-button-link">
          Use another account
        </button>
      </form>
    </div>
  );
}

export function signedInAuthHeading(
  capabilities: readonly OAuthCapability[],
): string {
  return capabilities.some((capability) => capability !== "identity")
    ? "Approve access to continue"
    : "Confirm your account";
}

export function permissionStatusCopy(state: string | null): string | null {
  if (state === "denied") {
    return "You canceled Login with Atmosphere. Nothing changed.";
  }
  if (state === "failed") {
    return "Login with Atmosphere could not be completed. Nothing changed. Try again.";
  }
  if (state === "concurrent") {
    return "Your account changed while this was open. Continue once more to finish safely.";
  }
  if (state === "partial") {
    return "Your account host did not approve everything needed. Try again or choose another account.";
  }
  return null;
}

async function loadCreateAccountHosts(): Promise<CreateAccountHostOption[]> {
  return await listCreateAccountHostOptions().catch(() => {
    console.warn("[signin] account host discovery failed");
    return [];
  });
}
