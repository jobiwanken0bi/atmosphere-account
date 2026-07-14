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

  return (
    <div
      class={`signin-flow ${rich ? "signin-flow--rich" : ""}`}
      data-signin-flow={enhanceFlow ? "true" : undefined}
      data-initial-mode="signin"
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
        {rich && (
          <div class="signin-rich-header">
            <h2>Connect your Atmosphere account</h2>
            <p>
              Use the handle you already have from Bluesky, Blacksky, Tangled,
              or any other account host.
            </p>
          </div>
        )}

        {hasRememberedAccounts && (
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
                <span>Use a different Atmosphere account</span>
              </span>
              <span class="signin-account-status">Type handle</span>
            </button>
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
          hidden={rich && !manualInitiallyVisible}
        >
          {returnTo && <input type="hidden" name="next" value={returnTo} />}
          {intent && <input type="hidden" name="intent" value={intent} />}
          <div class="signin-form-preview-wrap">
            <label class="signin-form-label" for="signin-handle">
              {rich
                ? "Sign in with another account"
                : t.explore.create.signInLabel}
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
                    ? "search by handle…"
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
            New to the Atmosphere? Create an account with a host, then come back
            and sign in with your handle.
          </p>
        )}
      </section>

      {rich && (
        <section data-signin-panel="create" hidden>
          <div class="signin-rich-header">
            <h2>Create an Atmosphere account</h2>
            <p>
              Choose a host for your account. You can use that same account
              across Atmosphere apps.
            </p>
          </div>
          <CreateAccountHostChooser
            initialHosts={createAccountHosts}
            endpoint={createAccountHostsEndpoint}
          />
        </section>
      )}
    </div>
  );
}

function CreateAccountHostChooser(
  { initialHosts, endpoint }: {
    initialHosts: CreateAccountHostOption[];
    endpoint?: string;
  },
) {
  const [query, setQuery] = useState("");
  const [includeOpen, setIncludeOpen] = useState(true);
  const [includeInvite, setIncludeInvite] = useState(true);
  const [hosts, setHosts] = useState(initialHosts);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const firstHostSearch = useRef(true);

  useEffect(() => {
    if (firstHostSearch.current) {
      firstHostSearch.current = false;
      return;
    }
    if (!endpoint) {
      const needle = query.trim().toLowerCase();
      setHosts(initialHosts.filter((host) => {
        if (host.signupStatus === "open" && !includeOpen) return false;
        if (host.signupStatus === "invite_required" && !includeInvite) {
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
        url.searchParams.set("open", includeOpen ? "1" : "0");
        url.searchParams.set("invite", includeInvite ? "1" : "0");
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
  }, [endpoint, query, includeOpen, includeInvite, initialHosts]);

  return (
    <div class="signin-host-chooser">
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
      <div class="signin-host-filters" aria-label="Signup options">
        <label>
          <input
            type="checkbox"
            checked={includeOpen}
            onChange={(event) => setIncludeOpen(event.currentTarget.checked)}
          />
          <span>Open signup</span>
        </label>
        <label>
          <input
            type="checkbox"
            checked={includeInvite}
            onChange={(event) => setIncludeInvite(event.currentTarget.checked)}
          />
          <span>Invite accepted</span>
        </label>
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
        {hosts.map((host) => (
          <a
            key={host.host}
            class={`signin-host-row${
              host.recommended ? " is-recommended" : ""
            }`}
            href={host.href}
            target="_blank"
            rel="noopener noreferrer"
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
        ))}
        <a
          class="signin-host-row signin-host-row--all"
          href="/hosts"
          target="_blank"
          rel="noopener noreferrer"
        >
          <span class="signin-host-mark" aria-hidden="true">+</span>
          <span class="signin-host-copy">
            <strong>Explore all hosts</strong>
            <em>Compare the complete account-host directory.</em>
          </span>
          <span class="signin-account-status">Hosts</span>
        </a>
      </div>
      <p class="signin-host-privacy-note">
        Signup opens on the host’s site. Atmosphere never receives invite codes.
        Return here and sign in with your new handle.
      </p>
    </div>
  );
}
