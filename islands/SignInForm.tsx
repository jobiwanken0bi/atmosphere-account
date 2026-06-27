import AtmosphereHandle from "../components/AtmosphereHandle.tsx";
import { useT } from "../i18n/mod.ts";

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
}

const HOST_OPTIONS = [
  {
    name: "Bluesky",
    href: "https://bsky.app",
    tag: "Popular",
    description: "The first Atmosphere app and the easiest place to start.",
  },
  {
    name: "Blacksky",
    href: "https://blacksky.community/",
    tag: "Community",
    description: "A community-run path into the Atmosphere.",
  },
  {
    name: "selfhosted.social",
    href: "https://selfhosted.social",
    tag: "Independent",
    description: "A community-run host with open signup.",
  },
  {
    name: "Tangled",
    href: "https://tangled.org/signup",
    tag: "Developer-friendly",
    description: "Create an account with Tangled's host.",
  },
] as const;

export default function SignInForm(
  {
    returnTo,
    intent,
    rememberedAccounts = [],
    rich = false,
    initialHandle,
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
          data-submitting-label="Redirecting..."
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
                    ? "search by handle..."
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
          <div class="signin-host-list">
            {HOST_OPTIONS.map((host) => (
              <a
                key={host.name}
                class="signin-host-row"
                href={host.href}
                target="_blank"
                rel="noopener noreferrer"
              >
                <span class="signin-host-mark" aria-hidden="true">
                  {host.name.slice(0, 1)}
                </span>
                <span class="signin-host-copy">
                  <strong>
                    {host.name}
                    <span>{host.tag}</span>
                  </strong>
                  <em>{host.description}</em>
                </span>
                <span class="signin-account-status">Open</span>
              </a>
            ))}
            <a class="signin-host-row signin-host-row--all" href="/hosts">
              <span class="signin-host-mark" aria-hidden="true">+</span>
              <span class="signin-host-copy">
                <strong>Explore all hosts</strong>
                <em>Compare more account hosts before choosing.</em>
              </span>
              <span class="signin-account-status">Hosts</span>
            </a>
          </div>
        </section>
      )}
    </div>
  );
}
