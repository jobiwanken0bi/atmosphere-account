import AtmosphereHandle from "../components/AtmosphereHandle.tsx";
import BskyIcon from "../components/icons/BskyIcon.tsx";
import { useT } from "../i18n/mod.ts";
import { useEffect, useId, useRef, useState } from "preact/hooks";
import type { CreateAccountHostOption } from "../lib/create-account-hosts.ts";
import type { OAuthCapability } from "../lib/oauth-scopes.ts";
import {
  isAccountCreationAction,
  isOAuthActionCapabilityRequest,
  type OAuthAction,
} from "../lib/oauth-action.ts";
import { isPlainLinkActivation } from "../lib/link-activation.ts";

export type SignInMode = "signin" | "create";

interface Props {
  /** Optional path to redirect to after successful login (defaults to
   *  `/account` for users and `/apps/manage` for projects). */
  returnTo?: string;
  /**
   * Account-type hint carried through OAuth. When `"project"` is set
   * (typically via a "Register an app" CTA), a freshly-signed-in
   * DID is auto-classified as a project account. Defaults to user.
   */
  intent?: "user" | "project";
  rememberedAccounts?: Array<{ did: string; handle: string }>;
  rich?: boolean;
  mode?: SignInMode;
  initialHandle?: string;
  /** Stable identifier used when a DID-owned action must stay on its owner.
   * Handles can change and remain display-only. */
  initialDid?: string;
  createAccountHosts?: CreateAccountHostOption[];
  createAccountHostsEndpoint?: string;
  createAccountError?: string | null;
  createAccountHostsUnavailable?: boolean;
  createAccountStartUnavailable?: boolean;
  /** Product capabilities required by the action that opened this form. */
  capabilities?: readonly OAuthCapability[];
  /** Human-readable action context retained through OAuth error/retry paths. */
  action?: OAuthAction;
  targetName?: string;
  continuation?: "login_selection";
  chooseAnotherAccount?: boolean;
  allowAccountCreation?: boolean;
  submitLabel?: string;
  forceReauthorization?: boolean;
  lockInitialHandle?: boolean;
  onAuthorizationStart?: () => void;
}
export type { CreateAccountHostOption } from "../lib/create-account-hosts.ts";

export default function SignInForm(
  {
    returnTo,
    intent,
    rememberedAccounts = [],
    rich = false,
    mode = "signin",
    initialHandle,
    initialDid,
    createAccountHosts = [],
    createAccountHostsEndpoint,
    createAccountError = null,
    createAccountHostsUnavailable = false,
    createAccountStartUnavailable = false,
    capabilities = ["identity"],
    action,
    targetName,
    continuation,
    chooseAnotherAccount = false,
    allowAccountCreation = true,
    submitLabel,
    forceReauthorization = false,
    lockInitialHandle = false,
    onAuthorizationStart,
  }: Props,
) {
  const t = useT();
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const handleId = `signin-handle-${id}`;
  const previewId = `signin-handle-preview-${id}`;
  const hasRememberedAccounts = !lockInitialHandle &&
    rememberedAccounts.length > 0;
  const manualInitiallyVisible = !hasRememberedAccounts || !!initialHandle ||
    chooseAnotherAccount;
  const enhanceFlow = mode === "signin" && (rich || hasRememberedAccounts);
  const initialSigninView = manualInitiallyVisible ? "manual" : "saved";
  const continueLabel = submitLabel ?? "Login with Atmosphere";
  const normalizedAction = action ?? "account";
  const canCreateAccount = allowAccountCreation &&
    isAccountCreationAction(normalizedAction) &&
    isOAuthActionCapabilityRequest(normalizedAction, capabilities);
  const loginSelectionContinuation = continuation ??
    (isLoginSelectionReturnTo(returnTo) ? "login_selection" : undefined);
  const loginHref = signinFallbackHref({
    returnTo,
    intent,
    capabilities,
    action,
    targetName,
    continuation: loginSelectionContinuation,
  });
  const createAccountHref = canCreateAccount
    ? accountCreationFallbackHref(loginHref)
    : null;
  const savedAccountsHref = signinFallbackHref({
    returnTo,
    intent,
    capabilities,
    action,
    targetName,
    continuation: loginSelectionContinuation,
  });
  const anotherAccountHref = signinFallbackHref({
    returnTo,
    intent,
    capabilities,
    action,
    targetName,
    continuation: loginSelectionContinuation,
    chooseAnotherAccount: true,
  });

  if (mode === "create") {
    return (
      <div class={`signin-flow signin-flow--rich signin-flow--create`}>
        {createAccountError && (
          <p
            class="profile-form-status profile-form-status--error signin-inline-error"
            role="alert"
          >
            {createAccountError}
          </p>
        )}
        <div
          class="signin-create-explainer"
          role="group"
          aria-label="About your account"
        >
          <article class="signin-create-explainer-card">
            <span class="signin-create-explainer-icon" aria-hidden="true">
              ⌂
            </span>
            <h2>Your host</h2>
            <p>
              Your host is where your account lives. Create an account with a
              host and you’ll return here when it’s ready. You can use the same
              account with any <a href="/apps">app</a> in the Atmosphere.
            </p>
          </article>
          <article class="signin-create-explainer-card">
            <span class="signin-create-explainer-icon" aria-hidden="true">
              ↗
            </span>
            <h2>Your account</h2>
            <p>
              Your account is yours: you can move it to another host later, and
              if you own a domain, you can use it as your handle - for example,
              {" "}
              <strong>you.com</strong>.
            </p>
          </article>
        </div>
        <div class="signin-rich-header signin-create-host-heading">
          <h2>Choose an account host</h2>
          <p>
            These hosts let you start signup here. You’ll enter any password or
            invite code with the host.
          </p>
        </div>
        <CreateAccountHostChooser
          initialHosts={createAccountHosts}
          initialError={createAccountHostsUnavailable}
          disabled={createAccountStartUnavailable}
          endpoint={createAccountHostsEndpoint}
          returnTo={returnTo}
          intent={intent}
          capabilities={capabilities}
          action={action}
          targetName={targetName}
          continuation={loginSelectionContinuation}
          onAuthorizationStart={onAuthorizationStart}
        />
        <p class="signin-existing-account-link">
          Already have an account? <a href={loginHref}>Login with Atmosphere</a>
        </p>
      </div>
    );
  }

  return (
    <div
      class={`signin-flow ${rich ? "signin-flow--rich" : ""}`}
      data-signin-flow={enhanceFlow ? "true" : undefined}
      data-initial-mode="signin"
      data-initial-signin-view={initialSigninView}
      data-remembered-count={String(
        hasRememberedAccounts ? rememberedAccounts.length : 0,
      )}
    >
      <section>
        {hasRememberedAccounts && (
          <div
            class="signin-subview signin-saved-view"
            data-signin-saved-view="true"
            hidden={manualInitiallyVisible}
          >
            {rich && (
              <div class="signin-rich-header">
                <h2>Connect your Atmosphere account</h2>
                <p>
                  Choose an account saved on this device, or add another
                  Atmosphere account.
                </p>
              </div>
            )}
            <div class="signin-account-list" aria-label="Saved accounts">
              <p class="signin-account-list-label">Saved accounts</p>
              {rememberedAccounts.map((account, index) => (
                <form
                  key={account.did}
                  method="POST"
                  action={forceReauthorization || loginSelectionContinuation
                    ? "/oauth/login"
                    : "/oauth/switch"}
                  class="signin-account-switch-form"
                  onSubmit={onAuthorizationStart}
                >
                  <input
                    type="hidden"
                    name={forceReauthorization || loginSelectionContinuation
                      ? "handle"
                      : "did"}
                    value={account.did}
                  />
                  {returnTo && (
                    <input type="hidden" name="next" value={returnTo} />
                  )}
                  {intent && (
                    <input type="hidden" name="intent" value={intent} />
                  )}
                  {action && (
                    <input type="hidden" name="action" value={action} />
                  )}
                  {chooseAnotherAccount && (
                    <input type="hidden" name="choose" value="another" />
                  )}
                  {loginSelectionContinuation && (
                    <input
                      type="hidden"
                      name="continuation"
                      value={loginSelectionContinuation}
                    />
                  )}
                  {targetName && (
                    <input type="hidden" name="name" value={targetName} />
                  )}
                  {capabilities.map((capability) => (
                    <input
                      type="hidden"
                      name="capability"
                      value={capability}
                    />
                  ))}
                  <button
                    type="submit"
                    class="signin-account-row"
                    data-dialog-initial-focus={index === 0 ? "true" : undefined}
                  >
                    <span class="signin-account-avatar" aria-hidden="true">
                      <span class="signin-account-avatar-fallback">
                        {account.handle.slice(0, 1).toUpperCase()}
                      </span>
                      <img
                        src={`/api/registry/avatar/${
                          encodeURIComponent(account.did)
                        }`}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        onError={(event) => {
                          event.currentTarget.remove();
                        }}
                      />
                    </span>
                    <span class="signin-account-copy">
                      <strong>
                        <AtmosphereHandle handle={account.handle} />
                      </strong>
                      <span>Saved on this device</span>
                    </span>
                    <span class="signin-account-status">Continue</span>
                  </button>
                </form>
              ))}
              <a
                href={anotherAccountHref}
                class="signin-account-row signin-account-row--other"
                data-signin-show-manual="true"
              >
                <span
                  class="signin-account-avatar signin-account-avatar--plus"
                  aria-hidden="true"
                >
                  +
                </span>
                <span class="signin-account-copy">
                  <strong>Use another account</strong>
                  <span>Enter its Atmosphere handle</span>
                </span>
                <span class="signin-account-status">Continue</span>
              </a>
            </div>
          </div>
        )}

        <div
          class="signin-subview signin-manual-view"
          data-signin-manual-view="true"
          hidden={!manualInitiallyVisible}
        >
          {hasRememberedAccounts && (
            <a
              href={savedAccountsHref}
              class="signin-manual-back"
              data-signin-show-saved="true"
            >
              <span aria-hidden="true">←</span> Saved accounts
            </a>
          )}
          {rich && (
            <div class="signin-rich-header">
              <h2>
                {hasRememberedAccounts
                  ? "Choose another account"
                  : "Enter your account handle"}
              </h2>
              <p>
                Enter your Atmosphere handle — the same one you use with Bluesky
                or other apps in the Atmosphere.
              </p>
            </div>
          )}
          <div class="signin-bluesky-note">
            <span class="signin-bluesky-note-icon" aria-hidden="true">
              <BskyIcon />
            </span>
            <p>
              <strong>Already use Bluesky?</strong>{" "}
              You already have an Atmosphere account. Enter your Bluesky handle
              below.
            </p>
          </div>
          <form
            method="POST"
            action="/oauth/login"
            class="signin-form"
            onSubmit={onAuthorizationStart}
            data-signin-preview={lockInitialHandle ? undefined : "true"}
            data-preview-loading={t.explore.create.previewLoading}
            data-preview-not-found={t.explore.create.previewNotFound}
            data-submit-label={continueLabel}
            data-submitting-label="Redirecting…"
            data-error-label="Login with Atmosphere could not be started. Check the handle or try again shortly."
          >
            {lockInitialHandle && initialDid && (
              <input type="hidden" name="handle" value={initialDid} />
            )}
            {returnTo && <input type="hidden" name="next" value={returnTo} />}
            {loginSelectionContinuation && (
              <input
                type="hidden"
                name="continuation"
                value={loginSelectionContinuation}
              />
            )}
            {chooseAnotherAccount && (
              <input type="hidden" name="choose" value="another" />
            )}
            {intent && <input type="hidden" name="intent" value={intent} />}
            {action && <input type="hidden" name="action" value={action} />}
            {targetName && (
              <input type="hidden" name="name" value={targetName} />
            )}
            {capabilities.map((capability) => (
              <input type="hidden" name="capability" value={capability} />
            ))}
            <div class="signin-form-preview-wrap">
              <label class="signin-form-label" for={handleId}>
                {rich ? "Atmosphere handle" : t.explore.create.signInLabel}
              </label>
              <div class="signin-form-row">
                <div class="signin-handle-field">
                  <span class="signin-handle-prefix" aria-hidden="true">
                    <img src="/union.svg" alt="" />
                  </span>
                  <input
                    id={handleId}
                    name={lockInitialHandle && initialDid
                      ? undefined
                      : "handle"}
                    type="text"
                    inputMode="email"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellcheck={false}
                    autoComplete="off"
                    required
                    value={initialHandle ?? ""}
                    readOnly={lockInitialHandle}
                    placeholder={rich
                      ? "your-handle.example"
                      : t.explore.create.handlePlaceholder}
                    class="signin-form-input"
                    data-signin-preview-id={lockInitialHandle
                      ? undefined
                      : previewId}
                    data-signin-preview-input={lockInitialHandle
                      ? undefined
                      : "true"}
                    data-dialog-initial-focus={manualInitiallyVisible
                      ? "true"
                      : undefined}
                  />
                  <div
                    class="signin-selected"
                    data-signin-selected="true"
                    hidden
                  />
                </div>
                <button type="submit" class="signin-form-submit">
                  {continueLabel}
                </button>
              </div>
            </div>
          </form>

          {createAccountHref && (
            <a
              class="signin-create-account-link"
              href={createAccountHref}
              onClick={(event) => {
                if (isPlainLinkActivation(event)) onAuthorizationStart?.();
              }}
            >
              <span>
                <strong>Create an Atmosphere account</strong>
                <small>Choose a host and return to this exact action.</small>
              </span>
              <span aria-hidden="true">→</span>
            </a>
          )}
        </div>
      </section>
    </div>
  );
}

function isLoginSelectionReturnTo(returnTo?: string): boolean {
  if (!returnTo) return false;
  try {
    return new URL(returnTo, "https://local.invalid").pathname ===
      "/login/select";
  } catch {
    return false;
  }
}

function CreateAccountHostChooser(
  {
    initialHosts,
    initialError,
    disabled,
    endpoint,
    returnTo,
    intent,
    capabilities,
    action,
    targetName,
    continuation,
    onAuthorizationStart,
  }: {
    initialHosts: CreateAccountHostOption[];
    initialError?: boolean;
    disabled?: boolean;
    endpoint?: string;
    returnTo?: string;
    intent?: "user" | "project";
    capabilities: readonly OAuthCapability[];
    action?: OAuthAction;
    targetName?: string;
    continuation?: "login_selection";
    onAuthorizationStart?: () => void;
  },
) {
  type SignupFilter = "all" | "open" | "invite_required";

  const [query, setQuery] = useState("");
  const [signupFilter, setSignupFilter] = useState<SignupFilter>("all");
  const [draftSignupFilter, setDraftSignupFilter] = useState<SignupFilter>(
    "all",
  );
  const [hosts, setHosts] = useState(initialHosts);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(!!initialError);
  const [retryKey, setRetryKey] = useState(0);
  const firstHostSearch = useRef(true);
  const filterMenuRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const menu = filterMenuRef.current;
    if (!menu) return;
    const closeOnPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !menu.contains(event.target)) {
        menu.open = false;
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") menu.open = false;
    };
    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  useEffect(() => {
    if (firstHostSearch.current) {
      firstHostSearch.current = false;
      return;
    }
    if (!endpoint) {
      const needle = query.trim().toLowerCase();
      setHosts(initialHosts.filter((host) => {
        if (
          signupFilter !== "all" && host.signupStatus !== signupFilter
        ) {
          return false;
        }
        return !needle || [
          host.name,
          host.host,
          host.description,
          host.location ?? "",
        ].some((value) => value.toLowerCase().includes(needle));
      }));
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(false);
      try {
        const url = new URL(endpoint, globalThis.location?.origin);
        if (query.trim()) url.searchParams.set("q", query.trim());
        url.searchParams.set(
          "open",
          signupFilter === "all" || signupFilter === "open" ? "1" : "0",
        );
        url.searchParams.set(
          "invite",
          signupFilter === "all" || signupFilter === "invite_required"
            ? "1"
            : "0",
        );
        const response = await fetch(url, {
          headers: { accept: "application/json" },
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`Host search HTTP ${response.status}`);
        }
        const payload = await response.json() as {
          hosts?: CreateAccountHostOption[];
        };
        setHosts(Array.isArray(payload.hosts) ? payload.hosts : []);
      } catch (err) {
        if (!(err instanceof DOMException && err.name === "AbortError")) {
          setError(true);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 220);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [endpoint, query, signupFilter, initialHosts, retryKey]);

  return (
    <div class="signin-host-chooser">
      <div class="signin-host-toolbar">
        <label class="signin-host-search">
          <span class="sr-only">Search account hosts</span>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="m21 21-4.35-4.35m2.35-5.15A7.5 7.5 0 1 1 4 11.5a7.5 7.5 0 0 1 15 0Z" />
          </svg>
          <input
            type="search"
            value={query}
            onInput={(event) => setQuery(event.currentTarget.value)}
            placeholder="Search name, domain, description, or location…"
            autocomplete="off"
          />
        </label>
        <details
          class="hosts-filter-menu signin-host-filter-menu"
          ref={filterMenuRef}
          onToggle={(event) => {
            if (event.currentTarget.open) {
              setDraftSignupFilter(signupFilter);
            }
          }}
        >
          <summary
            class="hosts-filter-trigger"
            aria-label={signupFilter === "all" ? "Filters" : "1 active filter"}
            title="Filters"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              width="18"
              height="18"
            >
              <path
                d="M4 7h10M18 7h2M4 17h2M10 17h10M14 4v6M10 14v6"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
              />
            </svg>
            {signupFilter !== "all" && (
              <span class="hosts-filter-count" aria-label="1 active filter">
                1
              </span>
            )}
          </summary>
          <div class="hosts-filter-popover signin-host-filter-popover">
            <label class="hosts-filter-field">
              <span>Signup</span>
              <select
                value={draftSignupFilter}
                onChange={(event) =>
                  setDraftSignupFilter(
                    event.currentTarget.value as SignupFilter,
                  )}
              >
                <option value="all">All signup options</option>
                <option value="open">Open signup</option>
                <option value="invite_required">Invite required</option>
              </select>
            </label>
            <button
              type="button"
              class="hosts-filter-apply"
              onClick={() => {
                setSignupFilter(draftSignupFilter);
                filterMenuRef.current?.removeAttribute("open");
              }}
            >
              Apply
            </button>
          </div>
        </details>
      </div>
      <div class="signin-host-results-status" aria-live="polite">
        {loading
          ? "Searching hosts…"
          : error
          ? hosts.length > 0
            ? "Showing saved hosts; live search is temporarily unavailable."
            : "The host directory is temporarily unavailable."
          : `${hosts.length} ${hosts.length === 1 ? "host" : "hosts"}`}
      </div>
      {error && (
        <button
          type="button"
          class="signin-host-retry"
          onClick={() => setRetryKey((value) => value + 1)}
        >
          Try loading hosts again
        </button>
      )}
      <div class="signin-host-list" aria-busy={loading ? "true" : "false"}>
        {!loading && !error && hosts.length === 0 && (
          <div class="signin-host-empty">
            No account hosts match those filters.
          </div>
        )}
        {hosts.map((host) => {
          const href = createAccountHostHref(
            host,
            returnTo,
            intent,
            capabilities,
            action,
            targetName,
            continuation,
          );
          const className = `signin-host-row${
            host.recommended ? " is-recommended" : ""
          }${host.oauthAccountCreation ? " is-direct" : ""}`;
          const content = (
            <>
              <span class="signin-host-mark" aria-hidden="true">
                {host.name.slice(0, 1)}
                {host.avatarUrl && (
                  <img
                    src={host.avatarUrl}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    referrerpolicy="no-referrer"
                    onError={(event) => event.currentTarget.remove()}
                  />
                )}
              </span>
              <span class="signin-host-copy">
                <strong>
                  <span class="signin-host-name">{host.name}</span>
                  <span class="signin-host-domain">{host.host}</span>
                </strong>
                {host.recommendationLabel && (
                  <span class="signin-host-recommendation">
                    {host.recommendationLabel}
                  </span>
                )}
                <em>
                  {host.description}
                  {host.location ? ` · ${host.location}` : ""}
                </em>
              </span>
              <span class="signin-account-status">
                {host.signupStatus === "invite_required"
                  ? "Invite required"
                  : "Open signup"}
              </span>
            </>
          );
          return disabled
            ? (
              <div
                key={host.host}
                class={`${className} is-disabled`}
                role="link"
                aria-disabled="true"
              >
                {content}
              </div>
            )
            : (
              <a
                key={host.host}
                class={className}
                href={href}
                target={host.oauthAccountCreation ? undefined : "_blank"}
                rel={host.oauthAccountCreation
                  ? "nofollow"
                  : "noopener noreferrer"}
                onClick={(event) => {
                  if (
                    host.oauthAccountCreation &&
                    isPlainLinkActivation(event)
                  ) onAuthorizationStart?.();
                }}
              >
                {content}
              </a>
            );
        })}
      </div>
      <p class="signin-host-privacy-note">
        Passwords and invite codes stay with the account host you choose.
      </p>
    </div>
  );
}

export function createAccountHostHref(
  host: CreateAccountHostOption,
  returnTo?: string,
  intent?: "user" | "project",
  capabilities: readonly OAuthCapability[] = ["identity"],
  action?: OAuthAction,
  targetName?: string,
  continuation?: "login_selection",
): string {
  if (!host.oauthAccountCreation) return host.href;
  const normalizedAction = action ?? "account";
  if (!isAccountCreationAction(normalizedAction)) {
    throw new TypeError(
      `Account creation is not available for OAuth action "${normalizedAction}"`,
    );
  }
  if (!isOAuthActionCapabilityRequest(normalizedAction, capabilities)) {
    throw new TypeError(
      `Invalid capability bundle for OAuth action "${normalizedAction}"`,
    );
  }
  const params = new URLSearchParams({ host: host.host });
  if (returnTo) params.set("next", returnTo);
  if (intent) params.set("intent", intent);
  for (const capability of capabilities) {
    params.append("capability", capability);
  }
  params.set("action", normalizedAction);
  if (targetName?.trim()) params.set("name", targetName.trim().slice(0, 120));
  if (continuation) params.set("continuation", continuation);
  return `/oauth/create?${params.toString()}`;
}

export function accountCreationFallbackHref(fallbackHref: string): string {
  if (!isSafeSigninFallback(fallbackHref)) return "/signin?mode=create";
  const url = new URL(fallbackHref, "https://atmosphere.invalid");
  if (url.pathname !== "/signin") return "/signin?mode=create";
  url.searchParams.set("mode", "create");
  return `${url.pathname}?${url.searchParams.toString()}${url.hash}`;
}

export function signinFallbackHref(
  {
    returnTo,
    intent,
    capabilities = ["identity"],
    action,
    targetName,
    continuation,
    chooseAnotherAccount = false,
  }: {
    returnTo?: string;
    intent?: "user" | "project";
    capabilities?: readonly OAuthCapability[];
    action?: OAuthAction;
    targetName?: string;
    continuation?: "login_selection";
    chooseAnotherAccount?: boolean;
  },
): string {
  const params = new URLSearchParams();
  if (returnTo) params.set("next", returnTo);
  if (intent) params.set("intent", intent);
  if (action) params.set("action", action);
  if (targetName?.trim()) params.set("name", targetName.trim().slice(0, 120));
  if (continuation) params.set("continuation", continuation);
  for (const capability of capabilities) {
    params.append("capability", capability);
  }
  if (chooseAnotherAccount) params.set("choose", "another");
  const query = params.toString();
  return `/signin${query ? `?${query}` : ""}`;
}

function isSafeSigninFallback(value: string): boolean {
  if (
    !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")
  ) return false;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return false;
  }
  return true;
}
