import { define } from "../utils.ts";
import Nav from "../components/Nav.tsx";
import Footer from "../components/Footer.tsx";
import SignInForm, {
  type CreateAccountHostOption,
} from "../islands/SignInForm.tsx";
import { buildAccountMenuProps } from "../lib/account-menu-props.ts";
import { listCreateAccountHostOptions } from "../lib/create-account-hosts.ts";
import {
  type LoginApp,
  readLoginRequest,
  resolveLoginAppForRequest,
} from "../lib/atmosphere-login.ts";
import { getSessionForCapabilities, isOAuthConfigured } from "../lib/oauth.ts";
import { refreshRememberedAccountCookies } from "../lib/remembered-accounts.ts";
import { isSafeRelativePath } from "../lib/security.ts";
import {
  normalizeOAuthCapabilities,
  type OAuthCapability,
} from "../lib/oauth-scopes.ts";
import AtmosphereHandle from "../components/AtmosphereHandle.tsx";
import {
  accountCreationErrorMessage,
  isAccountCreationAction,
  isAccountCreationError,
  isOAuthAction,
  isOAuthActionCapabilityRequest,
  type OAuthAction,
  safeOAuthTargetName,
} from "../lib/oauth-action.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const next = safeNext(ctx.url.searchParams.get("next"));
    const rawMode = ctx.url.searchParams.get("mode");
    if (rawMode !== null && rawMode !== "signin" && rawMode !== "create") {
      return new Response("invalid sign-in mode", { status: 400 });
    }
    const mode = rawMode === "create" ? "create" : "signin";
    const initialHandle = safeHandle(ctx.url.searchParams.get("handle"));
    const rawIntent = ctx.url.searchParams.get("intent");
    const intent = rawIntent === "project" || rawIntent === "user"
      ? rawIntent
      : undefined;
    const capabilities = normalizeOAuthCapabilities(
      ctx.url.searchParams.getAll("capability"),
    );
    if (!capabilities) {
      return new Response("invalid capability", { status: 400 });
    }
    const rawAction = ctx.url.searchParams.get("action");
    if (rawAction !== null && !isOAuthAction(rawAction)) {
      return new Response("invalid action", { status: 400 });
    }
    const action = safeAuthAction(rawAction);
    if (!isOAuthActionCapabilityRequest(action, capabilities)) {
      return new Response("invalid action capability combination", {
        status: 400,
      });
    }
    if (mode === "create" && !isAccountCreationAction(action)) {
      return new Response("account creation is not available for this action", {
        status: 400,
      });
    }
    const targetName = safeTargetName(ctx.url.searchParams.get("name"));
    const permissionState = ctx.url.searchParams.get("permission");
    if (ctx.state.user && mode === "signin") {
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
        permissionState !== "denied" && permissionState !== "required"
      ) {
        return new Response(null, {
          status: 303,
          headers: { location: next ?? "/account" },
        });
      }
    }
    const account = buildAccountMenuProps(ctx.state);
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
    const rawCreateError = ctx.url.searchParams.get("create_error");
    const createAccountError = isAccountCreationError(rawCreateError)
      ? accountCreationErrorMessage(rawCreateError)
      : null;
    const response = await ctx.render(
      (
        <SignInPageContent
          account={account}
          mode={mode}
          next={next ?? "/account"}
          intent={intent}
          capabilities={capabilities}
          action={action}
          targetName={targetName}
          permissionState={permissionState}
          initialHandle={initialHandle}
          createAccountHosts={createAccountHosts.hosts}
          createAccountHostsUnavailable={createAccountHosts.unavailable}
          createAccountHostsEndpoint={createAccountHostsEndpoint}
          createAccountError={createAccountError}
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

function safeNext(raw: string | null): string | null {
  return isSafeRelativePath(raw) ? raw : null;
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

function SignInPageContent(
  {
    account,
    mode,
    next,
    intent,
    capabilities,
    action,
    targetName,
    permissionState,
    initialHandle,
    createAccountHosts,
    createAccountHostsUnavailable,
    createAccountHostsEndpoint,
    createAccountError,
  }: {
    account: ReturnType<typeof buildAccountMenuProps>;
    mode: "signin" | "create";
    next: string;
    intent?: "user" | "project";
    capabilities: OAuthCapability[];
    action: OAuthAction;
    targetName: string | null;
    permissionState: string | null;
    initialHandle?: string;
    createAccountHosts: CreateAccountHostOption[];
    createAccountHostsUnavailable: boolean;
    createAccountHostsEndpoint: string;
    createAccountError: string | null;
  },
) {
  const copy = authActionCopy(action, targetName);
  const signedInUser = account.user;
  const createMode = mode === "create";
  const oauthConfigured = isOAuthConfigured();
  return (
    <div id="page-top">
      <div class="content-layer">
        <Nav account={account} disableScrollEffects />
        <main id="main-content" class="signin-page-section">
          <div class="container signin-page-container">
            <p class="text-eyebrow">
              {createMode ? "One account, every app" : copy.eyebrow}
            </p>
            <h1 class="text-section signin-page-brand-title">
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
              {!createMode && (permissionState === "partial" ||
                permissionState === "concurrent" ||
                permissionState === "denied") &&
                (
                  <p class="profile-form-status profile-form-status--error">
                    {permissionState === "denied"
                      ? "Authorization was cancelled. Nothing was changed. You can try again or return to the page you came from."
                      : permissionState === "concurrent"
                      ? "Your account gained another permission while this request was open. Continue once more so the new permissions can be combined safely."
                      : "The account host did not grant every permission required for this action. You can try again or choose another account."}
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
                    returnTo={next}
                    capabilities={capabilities}
                    action={action}
                    targetName={targetName}
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
                    rich
                  />
                )}
            </div>
          </div>
        </main>
        <Footer variant="compact" />
      </div>
    </div>
  );
}

function PermissionUpgradeForm(
  {
    user,
    returnTo,
    capabilities,
    action,
    targetName,
  }: {
    user: { did: string; handle: string };
    returnTo: string;
    capabilities: readonly OAuthCapability[];
    action: OAuthAction;
    targetName: string | null;
  },
) {
  return (
    <div class="signin-upgrade-panel">
      <p class="signin-account-list-label">Currently signed in</p>
      <p class="account-home-handle">
        <AtmosphereHandle handle={user.handle} />
      </p>
      <form method="POST" action="/oauth/login" class="signin-form">
        <input type="hidden" name="handle" value={user.handle} />
        <input type="hidden" name="next" value={returnTo} />
        <input type="hidden" name="action" value={action} />
        {targetName && <input type="hidden" name="name" value={targetName} />}
        {capabilities.map((capability) => (
          <input type="hidden" name="capability" value={capability} />
        ))}
        <button type="submit" class="signin-form-submit">
          Add permission and continue
        </button>
      </form>
      <form method="POST" action="/oauth/add-account" class="signin-form">
        <input type="hidden" name="next" value={returnTo} />
        <input type="hidden" name="action" value={action} />
        {targetName && <input type="hidden" name="name" value={targetName} />}
        {capabilities.map((capability) => (
          <input type="hidden" name="capability" value={capability} />
        ))}
        <button type="submit" class="profile-form-button-link">
          Use another Atmosphere account
        </button>
      </form>
    </div>
  );
}

export function authActionCopy(
  action: OAuthAction,
  targetName: string | null,
): {
  eyebrow: string;
  signInBody: string;
  upgradeBody: (handle: string) => string;
} {
  const name = targetName || "this listing";
  switch (action) {
    case "review":
      return {
        eyebrow: "Publish a review",
        signInBody:
          "Choose the Atmosphere account that will own your review. We’ll only request permission to create the AT Store records required to publish it.",
        upgradeBody: (handle) =>
          `You’re signed in as @${handle}. Add review-publishing permission to continue. Your existing permissions will remain in place.`,
      };
    case "review_manage":
      return {
        eyebrow: "Manage your review",
        signInBody:
          "Choose the Atmosphere account that owns this review. We’ll only request permission to update or delete its review record.",
        upgradeBody: (handle) =>
          `You’re signed in as @${handle}. Add review-management permission to continue. Your existing permissions will remain in place.`,
      };
    case "legacy_review":
      return {
        eyebrow: "Publish a review",
        signInBody:
          "Choose the Atmosphere account that will own your review on this legacy listing. We’ll only request permission for its legacy review record.",
        upgradeBody: (handle) =>
          `You’re signed in as @${handle}. Add legacy review-publishing permission to continue. Your existing permissions will remain in place.`,
      };
    case "legacy_review_manage":
      return {
        eyebrow: "Manage your review",
        signInBody:
          "Choose the Atmosphere account that owns your review on this legacy listing. We’ll only request permission to update or delete its legacy review record.",
        upgradeBody: (handle) =>
          `You’re signed in as @${handle}. Add legacy review-management permission to continue. Your existing permissions will remain in place.`,
      };
    case "favorite":
      return {
        eyebrow: "Save an app",
        signInBody:
          "Choose the Atmosphere account that will save this app. We’ll only request permission to create or remove its AT Store favorite record.",
        upgradeBody: (handle) =>
          `You’re signed in as @${handle}. Add app-saving permission to continue. Your existing permissions will remain in place.`,
      };
    case "app":
      return {
        eyebrow: "Manage an app",
        signInBody:
          `Sign in with the Atmosphere account that represents ${name}. You’ll be asked for permission to publish and manage its app records and images.`,
        upgradeBody: (handle) =>
          `You’re signed in as @${handle}. Add complete app-management permission, including images, to continue. Your existing permissions will remain in place.`,
      };
    case "host_claim":
      return {
        eyebrow: "Claim an account host",
        signInBody:
          `Choose the Atmosphere account that will claim and manage ${name}, including its public profile and images. Granting access does not claim the host: DNS verification separately proves control of its domain.`,
        upgradeBody: (handle) =>
          `You’re signed in as @${handle}. Add complete host-management permission, including images, to continue. DNS verification will separately prove control of the host.`,
      };
    case "host_manage":
      return {
        eyebrow: "Manage an account host",
        signInBody:
          `Sign in with the Atmosphere account that manages ${name}. You’ll be asked for permission to publish and manage its host records and images.`,
        upgradeBody: (handle) =>
          `You’re signed in as @${handle}. Add complete host-management permission, including images, to continue. Your existing permissions will remain in place.`,
      };
    case "host_transfer":
      return {
        eyebrow: "Choose a new managing account",
        signInBody:
          `Choose the Atmosphere account that will take over management of ${name}, including its public profile and images. DNS verification separately proves that the new manager still controls the host domain.`,
        upgradeBody: (handle) =>
          `You’re signed in as @${handle}. Add complete host-management permission, including images, to continue. DNS verification will complete the transfer.`,
      };
    case "app_host":
      return {
        eyebrow: "Manage app and host profiles",
        signInBody:
          `${name} is both an app and an account host. Sign in with the Atmosphere account that represents it to manage both profiles, records, and images.`,
        upgradeBody: (handle) =>
          `You’re signed in as @${handle}. Add the missing app and host permissions to continue. Your existing permissions will remain in place.`,
      };
    case "developer":
      return {
        eyebrow: "Manage app developer settings",
        signInBody:
          "Sign in with the Atmosphere account that represents the app whose developer settings you want to manage. No repository access is required.",
        upgradeBody: (handle) =>
          `You’re signed in as @${handle}. Confirm this identity to continue.`,
      };
    case "account":
      return {
        eyebrow: "Atmosphere Account",
        signInBody:
          "Choose an Atmosphere account to manage this site’s account-specific settings. Identity authentication does not grant repository access.",
        upgradeBody: (handle) =>
          `You’re signed in as @${handle}. Confirm this identity to continue.`,
      };
  }
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
