import AtmosphereHandle from "../../components/AtmosphereHandle.tsx";
import PasskeyManager from "../../islands/PasskeyManager.tsx";
import { isLoginRequestOrigin } from "../../lib/atmosphere-origins.ts";
import { IS_DEV, loginOrigin } from "../../lib/env.ts";
import { define, type State } from "../../utils.ts";

interface PasskeyPageProps {
  user: State["user"];
  initialHandle?: string;
  returnTo: string;
}

export const handler = define.handlers({
  GET(ctx) {
    if (!IS_DEV && !isLoginRequestOrigin(ctx.url, ctx.req.headers)) {
      const target = new URL(ctx.url.pathname + ctx.url.search, loginOrigin());
      return new Response(null, {
        status: 307,
        headers: {
          "cache-control": "no-store",
          location: target.toString(),
        },
      });
    }
    ctx.state.pageMeta = {
      title: "Passkeys — Atmosphere Account",
      description:
        "Manage passkeys for faster, user-verified Atmosphere universal sign in.",
    };
    const initialHandle = safeHandle(ctx.url.searchParams.get("handle"));
    const returnTo = passkeyReturnPath(initialHandle ?? ctx.state.user?.handle);
    return ctx.render(
      <PasskeyPage
        user={ctx.state.user}
        initialHandle={initialHandle}
        returnTo={returnTo}
      />,
      { headers: { "cache-control": "no-store" } },
    );
  },
});

function PasskeyPage(
  { user, initialHandle, returnTo }: PasskeyPageProps,
) {
  return (
    <div id="page-top" class="login-picker-page passkey-page">
      <section class="signin-page-section login-picker-section passkey-section">
        <div class="container login-picker-container passkey-container">
          <a class="passkey-brand" href="/" aria-label="Atmosphere home">
            <img src="/union.svg" alt="" width="36" height="36" />
            <span>Atmosphere</span>
          </a>
          <p class="text-eyebrow">Account security</p>
          <h1 class="text-section passkey-title">Passkeys</h1>
          <p class="text-body passkey-lede">
            Confirm your Atmosphere account with Face ID, Touch ID, a device
            passcode, or a security key during universal sign in.
          </p>

          <div class="glass signin-page-card passkey-card">
            {user
              ? (
                <>
                  <header class="passkey-account">
                    <span class="passkey-account-avatar" aria-hidden="true">
                      <span>{initialFor(user.handle)}</span>
                      <img
                        src={`/api/registry/avatar/${
                          encodeURIComponent(user.did)
                        }`}
                        alt=""
                        width="52"
                        height="52"
                        loading="lazy"
                        decoding="async"
                      />
                    </span>
                    <div>
                      <p class="text-eyebrow">Managing passkeys for</p>
                      <strong>
                        <AtmosphereHandle handle={user.handle} />
                      </strong>
                    </div>
                  </header>
                  <PasskeyManager account={user} returnTo={returnTo} />
                </>
              )
              : (
                <SignedOutPasskeyState
                  initialHandle={initialHandle}
                  returnTo={returnTo}
                />
              )}
          </div>
          <p class="passkey-page-footnote">
            Passkeys are scoped to Atmosphere Login. Your account remains hosted
            by your chosen ATProto provider.
          </p>
        </div>
      </section>
    </div>
  );
}

function SignedOutPasskeyState(
  { initialHandle, returnTo }: {
    initialHandle?: string;
    returnTo: string;
  },
) {
  return (
    <div class="passkey-signed-out">
      <span class="passkey-signed-out-icon" aria-hidden="true">
        <ShieldKeyIcon />
      </span>
      <div>
        <h2>Verify your Atmosphere account</h2>
        <p>
          Before you can view or change passkeys, your account host needs to
          confirm which Atmosphere account you control.
        </p>
      </div>
      <form method="post" action="/oauth/login" class="passkey-relink-form">
        <input type="hidden" name="next" value={returnTo} />
        <label for="passkey-account-handle">Atmosphere handle</label>
        <input
          id="passkey-account-handle"
          name="handle"
          type="text"
          inputMode="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellcheck={false}
          autoComplete="username"
          required
          value={initialHandle ?? ""}
          placeholder="your-handle.example"
        />
        <button type="submit" class="passkey-primary-button">
          Verify with account host
        </button>
      </form>
    </div>
  );
}

function safeHandle(raw: string | null): string | undefined {
  const handle = raw?.trim().replace(/^@/, "").toLowerCase();
  if (
    !handle || handle.length > 253 ||
    !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/
      .test(handle)
  ) {
    return undefined;
  }
  return handle;
}

function passkeyReturnPath(handle?: string): string {
  const params = new URLSearchParams();
  if (handle) params.set("handle", handle);
  const query = params.toString();
  return `/passkeys${query ? `?${query}` : ""}`;
}

function initialFor(value: string): string {
  return value.replace(/^@/, "").trim().slice(0, 1).toUpperCase() || "A";
}

function ShieldKeyIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3 5.5 5.7v5.7c0 4.1 2.4 7.7 6.5 9.6 4.1-1.9 6.5-5.5 6.5-9.6V5.7z" />
      <circle cx="10" cy="11.5" r="2" />
      <path d="M12 11.5h3.5" />
      <path d="M14.5 11.5v1.8" />
    </svg>
  );
}
