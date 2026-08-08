import AtmosphereHandle from "../components/AtmosphereHandle.tsx";
import { useT } from "../i18n/mod.ts";
import { useEffect, useId, useRef, useState } from "preact/hooks";
import type { CreateAccountHostOption } from "../lib/create-account-hosts.ts";
import type { OAuthCapability } from "../lib/oauth-scopes.ts";
import {
  isOAuthActionCapabilityRequest,
  type OAuthAction,
} from "../lib/oauth-action.ts";
import { isPlainLinkActivation } from "../lib/link-activation.ts";

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
  initialHandle?: string;
  /** Stable account identifier used when the visible handle is locked for a
   * DID-owned action. Handles are mutable and must remain display-only. */
  initialDid?: string;
  createAccountHosts?: CreateAccountHostOption[];
  createAccountHostsEndpoint?: string;
  /** Product capabilities required by the action that opened this form. */
  capabilities?: readonly OAuthCapability[];
  /** Human-readable action context retained through OAuth error/retry paths. */
  action?: OAuthAction;
  targetName?: string;
  /** Non-persistent external login-picker handoff. */
  continuation?: "login_selection";
  /** Keep recovery in the account chooser when this form was opened from
   * “Use another account”. */
  chooseAnotherAccount?: boolean;
  /** Which rich picker panel is visible before client enhancement runs. */
  initialMode?: "signin" | "create";
  /** Some actions require an existing account and cannot be completed by a
   * newly created one. */
  allowAccountCreation?: boolean;
  /** Override used by contextual permission prompts. */
  submitLabel?: string;
  /** Force remembered accounts through a fresh OAuth login instead of
   * accepting a refreshed token whose advertised scope may have just been
   * rejected by the PDS. */
  forceReauthorization?: boolean;
  /** Keep a DID-owned pending action on the account that created it. */
  lockInitialHandle?: boolean;
  /** Runs synchronously immediately before a chooser form or direct account
   * creation link leaves the page. Used to arm one-shot draft resumption only
   * after the user actually continues authorization. */
  onAuthorizationStart?: () => void;
}
export type { CreateAccountHostOption } from "../lib/create-account-hosts.ts";

export default function SignInForm(
  {
    returnTo,
    intent,
    rememberedAccounts = [],
    rich = false,
    initialHandle,
    initialDid,
    createAccountHosts = [],
    createAccountHostsEndpoint,
    capabilities = ["identity"],
    action,
    targetName,
    continuation,
    chooseAnotherAccount = false,
    initialMode = "signin",
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
  const signInTabId = `signin-tab-${id}`;
  const createTabId = `signin-create-tab-${id}`;
  const signInPanelId = `signin-panel-${id}`;
  const createPanelId = `signin-create-panel-${id}`;
  const hasRememberedAccounts = !lockInitialHandle &&
    rememberedAccounts.length > 0;
  const manualInitiallyVisible = !hasRememberedAccounts || !!initialHandle ||
    chooseAnotherAccount;
  const enhanceFlow = rich || hasRememberedAccounts;
  const initialSigninView = manualInitiallyVisible ? "manual" : "saved";
  const resolvedMode = allowAccountCreation ? initialMode : "signin";
  const continueLabel = submitLabel ??
    (rich ? "Continue" : t.explore.create.signIn);
  const hasModeTabs = rich && allowAccountCreation;
  const modeHref = (mode: "signin" | "create") =>
    signinModeFallbackHref({
      mode,
      returnTo,
      intent,
      capabilities,
      action,
      targetName,
      continuation,
      chooseAnotherAccount,
      initialHandle,
    });
  const savedAccountsHref = signinModeFallbackHref({
    mode: "signin",
    returnTo,
    intent,
    capabilities,
    action,
    targetName,
    continuation,
  });
  const anotherAccountHref = signinModeFallbackHref({
    mode: "signin",
    returnTo,
    intent,
    capabilities,
    action,
    targetName,
    continuation,
    chooseAnotherAccount: true,
  });

  return (
    <div
      class={`signin-flow ${rich ? "signin-flow--rich" : ""}`}
      data-signin-flow={enhanceFlow ? "true" : undefined}
      data-initial-mode={resolvedMode}
      data-initial-signin-view={initialSigninView}
      data-remembered-count={String(
        hasRememberedAccounts ? rememberedAccounts.length : 0,
      )}
    >
      {hasModeTabs && (
        <div class="signin-tabs" role="tablist" aria-label="Sign in options">
          <a
            href={modeHref("signin")}
            class={`signin-tab${resolvedMode === "signin" ? " is-active" : ""}`}
            role="tab"
            aria-selected={resolvedMode === "signin" ? "true" : "false"}
            aria-controls={signInPanelId}
            id={signInTabId}
            tabIndex={resolvedMode === "signin" ? 0 : -1}
            data-signin-tab="signin"
          >
            Sign in
          </a>
          <a
            href={modeHref("create")}
            class={`signin-tab${resolvedMode === "create" ? " is-active" : ""}`}
            role="tab"
            aria-selected={resolvedMode === "create" ? "true" : "false"}
            aria-controls={createPanelId}
            id={createTabId}
            tabIndex={resolvedMode === "create" ? 0 : -1}
            data-signin-tab="create"
          >
            Create account
          </a>
        </div>
      )}

      <section
        data-signin-panel="signin"
        id={hasModeTabs ? signInPanelId : undefined}
        role={hasModeTabs ? "tabpanel" : undefined}
        aria-labelledby={hasModeTabs ? signInTabId : undefined}
        hidden={rich && resolvedMode === "create"}
      >
        {hasRememberedAccounts && (
          <div
            class="signin-subview signin-saved-view"
            data-signin-saved-view="true"
            hidden={manualInitiallyVisible}
          >
            {rich && (
              <div class="signin-rich-header">
                <h2>Choose an account</h2>
              </div>
            )}
            <div class="signin-account-list" aria-label="Saved accounts">
              <p class="signin-account-list-label">Saved accounts</p>
              {rememberedAccounts.map((account, index) => (
                <form
                  key={account.did}
                  method="POST"
                  action={forceReauthorization || continuation
                    ? "/oauth/login"
                    : "/oauth/switch"}
                  class="signin-account-switch-form"
                  onSubmit={onAuthorizationStart}
                >
                  <input
                    type="hidden"
                    name={forceReauthorization || continuation
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
                  {continuation && (
                    <input
                      type="hidden"
                      name="continuation"
                      value={continuation}
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
                  ? "Use another account"
                  : "Enter your handle"}
              </h2>
            </div>
          )}
          <form
            method="POST"
            action="/oauth/login"
            class="signin-form"
            onSubmit={onAuthorizationStart}
            data-signin-preview={lockInitialHandle ? undefined : "true"}
            data-preview-loading={t.explore.create.previewLoading}
            data-preview-not-found={t.explore.create.previewNotFound}
            data-submit-label={continueLabel}
            data-submitting-label="Opening sign-in…"
            data-error-label="Couldn’t start sign-in. Check the handle and try again."
          >
            {lockInitialHandle && initialDid && (
              <input type="hidden" name="handle" value={initialDid} />
            )}
            {returnTo && <input type="hidden" name="next" value={returnTo} />}
            {intent && <input type="hidden" name="intent" value={intent} />}
            {action && <input type="hidden" name="action" value={action} />}
            {chooseAnotherAccount && (
              <input type="hidden" name="choose" value="another" />
            )}
            {continuation && (
              <input
                type="hidden"
                name="continuation"
                value={continuation}
              />
            )}
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
                    role="status"
                    aria-live="polite"
                    hidden
                  />
                </div>
                <button type="submit" class="signin-form-submit">
                  {continueLabel}
                </button>
              </div>
            </div>
          </form>
        </div>
      </section>

      {hasModeTabs && (
        <section
          data-signin-panel="create"
          id={createPanelId}
          role="tabpanel"
          aria-labelledby={createTabId}
          hidden={resolvedMode !== "create"}
        >
          <div class="signin-rich-header">
            <h2>Choose an account host</h2>
            <p>
              Your host creates your account and keeps it online. You’ll return
              here when it’s ready.
            </p>
          </div>
          <CreateAccountHostChooser
            initialHosts={createAccountHosts}
            endpoint={createAccountHostsEndpoint}
            returnTo={returnTo}
            intent={intent}
            capabilities={capabilities}
            action={action}
            targetName={targetName}
            continuation={continuation}
            onAuthorizationStart={onAuthorizationStart}
          />
        </section>
      )}
    </div>
  );
}

function CreateAccountHostChooser(
  {
    initialHosts,
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
  const [error, setError] = useState(false);
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
  }, [endpoint, query, signupFilter, initialHosts]);

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
            placeholder="Search hosts…"
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
          ? "Couldn’t refresh the list. Showing the hosts already loaded."
          : `${hosts.length} ${hosts.length === 1 ? "host" : "hosts"}`}
      </div>
      <div class="signin-host-list" aria-busy={loading ? "true" : "false"}>
        {!loading && !error && hosts.length === 0 && (
          <div class="signin-host-empty">
            {query.trim() || signupFilter !== "all"
              ? "No account hosts match your search or filters."
              : "No account hosts are available right now."}
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
          return (
            <a
              key={host.host}
              class={`signin-host-row${
                host.recommended ? " is-recommended" : ""
              }${host.oauthAccountCreation ? " is-direct" : ""}`}
              href={href}
              target={host.oauthAccountCreation ? undefined : "_blank"}
              rel={host.oauthAccountCreation
                ? "nofollow"
                : "noopener noreferrer"}
              onClick={(event) => {
                if (
                  !host.oauthAccountCreation ||
                  !isPlainLinkActivation(event)
                ) return;
                onAuthorizationStart?.();
              }}
            >
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
              <span class="signin-account-status">{host.statusLabel}</span>
            </a>
          );
        })}
      </div>
      <p class="signin-host-privacy-note">
        Only hosts that can create an account here are shown. Atmosphere never
        sees your password or invite code.
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
  if (!isOAuthActionCapabilityRequest(action, capabilities)) {
    throw new TypeError(
      `Invalid capability bundle for OAuth action "${action ?? "account"}"`,
    );
  }
  const params = new URLSearchParams({ host: host.host });
  if (returnTo) params.set("next", returnTo);
  if (intent) params.set("intent", intent);
  for (const capability of capabilities) {
    params.append("capability", capability);
  }
  if (action) params.set("action", action);
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

export function signinModeFallbackHref(
  {
    mode,
    returnTo,
    intent,
    capabilities = ["identity"],
    action,
    targetName,
    continuation,
    chooseAnotherAccount = false,
    initialHandle,
  }: {
    mode: "signin" | "create";
    returnTo?: string;
    intent?: "user" | "project";
    capabilities?: readonly OAuthCapability[];
    action?: OAuthAction;
    targetName?: string;
    continuation?: "login_selection";
    chooseAnotherAccount?: boolean;
    initialHandle?: string;
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
  if (initialHandle?.trim()) params.set("handle", initialHandle.trim());
  if (mode === "create") params.set("mode", "create");
  const query = params.toString();
  return `/signin${query ? `?${query}` : ""}`;
}

function isSafeSigninFallback(value: string): boolean {
  if (
    !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")
  ) {
    return false;
  }
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return false;
  }
  return true;
}
