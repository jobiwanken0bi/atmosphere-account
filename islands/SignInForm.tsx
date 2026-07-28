import AtmosphereHandle from "../components/AtmosphereHandle.tsx";
import { useT } from "../i18n/mod.ts";
import { useEffect, useRef, useState } from "preact/hooks";
import type { CreateAccountHostOption } from "../lib/create-account-hosts.ts";

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
  createAccountHosts?: CreateAccountHostOption[];
  createAccountHostsEndpoint?: string;
}
export type { CreateAccountHostOption } from "../lib/create-account-hosts.ts";

export default function SignInForm(
  {
    returnTo,
    intent,
    rememberedAccounts = [],
    rich = false,
    initialHandle,
    createAccountHosts = [],
    createAccountHostsEndpoint,
  }: Props,
) {
  const t = useT();
  const hasRememberedAccounts = rememberedAccounts.length > 0;
  const manualInitiallyVisible = !hasRememberedAccounts || !!initialHandle;
  const enhanceFlow = rich || hasRememberedAccounts;
  const initialSigninView = manualInitiallyVisible ? "manual" : "saved";

  return (
    <div
      class={`signin-flow ${rich ? "signin-flow--rich" : ""}`}
      data-signin-flow={enhanceFlow ? "true" : undefined}
      data-initial-mode="signin"
      data-initial-signin-view={initialSigninView}
      data-remembered-count={String(rememberedAccounts.length)}
    >
      {rich && (
        <div class="signin-tabs" role="tablist" aria-label="Sign in options">
          <button
            type="button"
            class="signin-tab is-active"
            role="tab"
            aria-selected="true"
            data-signin-tab="signin"
          >
            Sign in
          </button>
          <button
            type="button"
            class="signin-tab"
            role="tab"
            aria-selected="false"
            data-signin-tab="create"
          >
            Create account
          </button>
        </div>
      )}

      <section data-signin-panel="signin">
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
              {rememberedAccounts.map((account) => (
                <form
                  key={account.did}
                  method="POST"
                  action="/oauth/switch"
                  class="signin-account-switch-form"
                >
                  <input type="hidden" name="did" value={account.did} />
                  {returnTo && (
                    <input type="hidden" name="next" value={returnTo} />
                  )}
                  <button type="submit" class="signin-account-row">
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
              <button
                type="button"
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
                  <strong>Other account</strong>
                  <span>Add a different Atmosphere account</span>
                </span>
                <span class="signin-account-status">Add account</span>
              </button>
            </div>
          </div>
        )}

        <div
          class="signin-subview signin-manual-view"
          data-signin-manual-view="true"
          hidden={!manualInitiallyVisible}
        >
          {hasRememberedAccounts && (
            <button
              type="button"
              class="signin-manual-back"
              data-signin-show-saved="true"
            >
              <span aria-hidden="true">←</span> Saved accounts
            </button>
          )}
          {rich && (
            <div class="signin-rich-header">
              <h2>
                {hasRememberedAccounts
                  ? "Sign in with another account"
                  : "Connect your Atmosphere account"}
              </h2>
              <p>
                Enter the handle you use with Bluesky, Blacksky, Tangled, or any
                other account host.
              </p>
            </div>
          )}
          <form
            method="POST"
            action="/oauth/login"
            class="signin-form"
            data-signin-preview="true"
            data-preview-loading={t.explore.create.previewLoading}
            data-preview-not-found={t.explore.create.previewNotFound}
            data-submit-label={rich ? "Continue" : t.explore.create.signIn}
            data-submitting-label="Redirecting…"
          >
            {returnTo && <input type="hidden" name="next" value={returnTo} />}
            {intent && <input type="hidden" name="intent" value={intent} />}
            <div class="signin-form-preview-wrap">
              <label class="signin-form-label" for="signin-handle">
                {rich ? "Atmosphere handle" : t.explore.create.signInLabel}
              </label>
              <div class="signin-form-row">
                <div class="signin-handle-field">
                  <span class="signin-handle-prefix" aria-hidden="true">
                    <img src="/union.svg" alt="" />
                  </span>
                  <input
                    id="signin-handle"
                    name="handle"
                    type="text"
                    inputMode="email"
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellcheck={false}
                    autoComplete="off"
                    required
                    value={initialHandle ?? ""}
                    placeholder={rich
                      ? "your-handle.example"
                      : t.explore.create.handlePlaceholder}
                    class="signin-form-input"
                    aria-autocomplete="list"
                    aria-expanded="false"
                    aria-controls="signin-handle-preview"
                    data-signin-preview-input="true"
                  />
                  <div
                    class="signin-selected"
                    data-signin-selected="true"
                    hidden
                  />
                </div>
                <button type="submit" class="signin-form-submit">
                  {rich ? "Continue" : t.explore.create.signIn}
                </button>
              </div>
            </div>
          </form>

          {rich && (
            <p class="signin-info-line">
              New to the Atmosphere? Create with a supported host and continue
              straight back here.
            </p>
          )}
        </div>
      </section>

      {rich && (
        <section data-signin-panel="create" hidden>
          <div class="signin-rich-header">
            <h2>Create an Atmosphere account</h2>
            <p>
              Choose a host with direct account creation. You’ll return to the
              app automatically when your account is ready.
            </p>
          </div>
          <CreateAccountHostChooser
            initialHosts={createAccountHosts}
            endpoint={createAccountHostsEndpoint}
            returnTo={returnTo}
            intent={intent}
          />
        </section>
      )}
    </div>
  );
}

function CreateAccountHostChooser(
  { initialHosts, endpoint, returnTo, intent }: {
    initialHosts: CreateAccountHostOption[];
    endpoint?: string;
    returnTo?: string;
    intent?: "user" | "project";
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
          ? "Showing saved hosts; live search is temporarily unavailable."
          : `${hosts.length} ${hosts.length === 1 ? "host" : "hosts"}`}
      </div>
      <div class="signin-host-list" aria-busy={loading ? "true" : "false"}>
        {!loading && !error && hosts.length === 0 && (
          <div class="signin-host-empty">
            No account hosts match those filters.
          </div>
        )}
        {hosts.map((host) => {
          const href = createAccountHostHref(host, returnTo, intent);
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
        Only hosts that enable direct OAuth account creation appear here.
        Atmosphere never receives passwords or invite codes.
      </p>
    </div>
  );
}

export function createAccountHostHref(
  host: CreateAccountHostOption,
  returnTo?: string,
  intent?: "user" | "project",
): string {
  if (!host.oauthAccountCreation) return host.href;
  const params = new URLSearchParams({ host: host.host });
  if (returnTo) params.set("next", returnTo);
  if (intent) params.set("intent", intent);
  return `/oauth/create?${params.toString()}`;
}
