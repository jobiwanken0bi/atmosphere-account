import { define } from "../../../utils.ts";
import { singleSearchValue } from "../../../lib/oauth-request-input.ts";

const MAX_EXAMPLE_CALLBACK_QUERY_BYTES = 16_384;
import { asset } from "fresh/runtime";
import Nav from "../../../components/Nav.tsx";
import Footer from "../../../components/Footer.tsx";
import AtmosphereHandle from "../../../components/AtmosphereHandle.tsx";
import { buildAccountMenuProps } from "../../../lib/account-menu-props.ts";
import {
  decodeSelectionTokenUnsafe,
  verifyLoginSelectionToken,
  verifyLoginSelectionTokenDetailed,
} from "../../../lib/atmosphere-login.ts";
import { loginPickerOriginForRequest } from "../../../lib/atmosphere-origins.ts";
import {
  buildExampleOAuthStartPath,
  clearExampleLoginStateCookie,
  exampleAtmosphereLoginVerifiedReturnUri,
  exampleSelectionReplayStore,
  isExampleAtmosphereLoginPopupCallback,
  isExampleAtmosphereLoginPopupHandoff,
  readExampleLoginState,
} from "../../../lib/example-atproto-oauth.ts";

interface Check {
  label: string;
  ok: boolean;
  detail: string;
}

interface CallbackProps {
  account: ReturnType<typeof buildAccountMenuProps>;
  token: string | null;
  decoded: unknown;
  verified: Awaited<ReturnType<typeof verifyLoginSelectionToken>>;
  checks: Check[];
  expectedReturnUri: string;
  clientId: string | null;
  state: string | null;
  continueHref: string | null;
}

interface PopupCompletionProps {
  clientId: string;
  sdkSrc: string;
  handle: string | null;
}

export const handler = define.handlers({
  async GET(ctx) {
    if (ctx.url.search.length > MAX_EXAMPLE_CALLBACK_QUERY_BYTES) {
      return new Response("callback URL is too large", {
        status: 414,
        headers: { "cache-control": "no-store" },
      });
    }
    let token: string | null;
    let clientId: string | null;
    let state: string | null;
    try {
      token = singleSearchValue(ctx.url.searchParams, "selection_token")
        ?.trim() || null;
      clientId = singleSearchValue(ctx.url.searchParams, "client_id")?.trim() ||
        null;
      state = singleSearchValue(ctx.url.searchParams, "state")?.trim() || null;
    } catch {
      return new Response("invalid callback parameters", {
        status: 400,
        headers: { "cache-control": "no-store" },
      });
    }
    const expectedState = state
      ? await readExampleLoginState(ctx.req, state).catch(() => null)
      : null;
    const expectedReturnUri = exampleAtmosphereLoginVerifiedReturnUri(ctx.url);
    const verified = token ? await verifyLoginSelectionToken(token) : null;
    const decoded = token ? decodeSelectionTokenUnsafe(token) : null;
    const checks = buildChecks({
      verified,
      clientId,
      state,
      expectedState,
      expectedReturnUri,
    });
    const allPassed = checks.length > 0 && checks.every((check) => check.ok);
    const inspect = ctx.url.searchParams.get("inspect") === "1";
    const isPopup = isExampleAtmosphereLoginPopupCallback(ctx.url);
    const isPopupHandoff = isExampleAtmosphereLoginPopupHandoff(ctx.url);
    const pickerOrigin = loginPickerOriginForRequest(ctx.url);
    if (token && allPassed && verified && expectedState && !inspect) {
      if (isPopup && !isPopupHandoff) {
        return clearExampleStateResponse(
          await ctx.render(
            <PopupCompletionPage
              clientId={clientId ?? verified.aud}
              sdkSrc={new URL("/atmosphere-login.js", pickerOrigin).toString()}
              handle={verified.handle}
            />,
          ),
          expectedState,
        );
      }
      const consumed = await verifyLoginSelectionTokenDetailed(token, {
        expectedAudience: clientId ?? undefined,
        expectedState,
        expectedReturnUri,
        replayStore: exampleSelectionReplayStore,
      });
      if (!consumed.ok) {
        return clearExampleStateResponse(
          await ctx.render(
            <CallbackPage
              account={buildAccountMenuProps(ctx.state)}
              token={token}
              decoded={decoded}
              verified={verified}
              checks={[
                ...checks.filter((check) => check.label !== "Replay key"),
                {
                  label: "Replay key",
                  ok: false,
                  detail: consumed.error === "replayed token"
                    ? "This selection was already used. Restart the picker flow."
                    : consumed.error,
                },
              ]}
              expectedReturnUri={expectedReturnUri}
              clientId={clientId}
              state={state}
              continueHref={null}
            />,
          ),
          expectedState,
        );
      }
      return clearExampleStateResponse(
        new Response(null, {
          status: 303,
          headers: {
            location: buildExampleOAuthStartPath({
              handle: consumed.claims.handle,
              did: consumed.claims.sub,
            }),
          },
        }),
        expectedState,
      );
    }
    ctx.state.pageMeta = {
      title: "Login with Atmosphere Reference Callback",
      description:
        "Reference callback for verifying a Login with Atmosphere selection token.",
      canonicalUrl: expectedReturnUri,
    };
    return ctx.render(
      <CallbackPage
        account={buildAccountMenuProps(ctx.state)}
        token={token}
        decoded={decoded}
        verified={verified}
        checks={checks}
        expectedReturnUri={expectedReturnUri}
        clientId={clientId}
        state={state}
        continueHref={token && allPassed ? callbackHandoffHref(ctx.url) : null}
      />,
    );
  },
});

function CallbackPage(props: CallbackProps) {
  const {
    account,
    token,
    decoded,
    verified,
    checks,
    expectedReturnUri,
    clientId,
    state,
    continueHref,
  } = props;
  const allPassed = checks.length > 0 && checks.every((check) => check.ok);
  const handle = verified?.handle ?? readString(decoded, "handle");
  const did = verified?.sub ?? readString(decoded, "sub");
  return (
    <div id="page-top">
      <div class="content-layer">
        <Nav account={account} disableScrollEffects />
        <main
          id="main-content"
          class="signin-page-section login-example-section"
        >
          <div class="container signin-page-container">
            <a href="/docs/atmosphere-login" class="text-link-button">
              Back to Login with Atmosphere docs
            </a>
            <div class="glass signin-page-card login-example-card">
              <p class="text-eyebrow">Reference callback</p>
              <h1 class="host-claim-title">
                {token ? "Selection received" : "No selection token yet"}
              </h1>
              <p class="text-body host-claim-copy">
                A real app should run these checks server-side, reject replayed
                token IDs, then immediately start its own AT Protocol OAuth flow
                using the selected DID or handle as a login hint.
              </p>

              {token
                ? (
                  <>
                    <div
                      class={`login-example-result ${
                        allPassed
                          ? "login-example-result--ok"
                          : "login-example-result--error"
                      }`}
                    >
                      <strong>
                        {allPassed
                          ? "Selection token checks passed"
                          : "Selection token needs attention"}
                      </strong>
                      <p>
                        {allPassed
                          ? `Selected account: @${handle}`
                          : "Use the checklist below to see which binding failed."}
                      </p>
                    </div>
                    <div class="login-example-checks">
                      {checks.map((check) => (
                        <article
                          class={`login-example-check ${
                            check.ok
                              ? "login-example-check--ok"
                              : "login-example-check--error"
                          }`}
                          key={check.label}
                        >
                          <span>{check.ok ? "Pass" : "Fail"}</span>
                          <strong>{check.label}</strong>
                          <p>{check.detail}</p>
                        </article>
                      ))}
                    </div>
                    {allPassed && handle && (
                      <a
                        class="explore-cta-primary login-example-oauth"
                        href={continueHref ??
                          buildExampleOAuthStartPath({ handle, did })}
                      >
                        Start app OAuth with{" "}
                        <AtmosphereHandle handle={handle} />
                      </a>
                    )}
                  </>
                )
                : (
                  <div class="login-example-result">
                    <strong>Open the picker from the example app</strong>
                    <p>
                      The example app or docs console will send you back here
                      with `selection_token`, `client_id`, and `state` query
                      parameters.
                    </p>
                  </div>
                )}

              <details class="account-home-details login-example-details">
                <summary>Callback details</summary>
                <dl>
                  <Fact label="Expected return URI" value={expectedReturnUri} />
                  <Fact label="Client ID" value={clientId ?? "Missing"} />
                  <Fact label="State" value={state ?? "Missing"} />
                </dl>
              </details>

              {decoded && (
                <figure class="docs-code login-example-json">
                  <figcaption>Decoded token payload</figcaption>
                  <pre><code>{JSON.stringify(decoded, null, 2)}</code></pre>
                </figure>
              )}
            </div>
          </div>
        </main>
        <Footer variant="compact" />
      </div>
    </div>
  );
}

function PopupCompletionPage(
  { clientId, sdkSrc, handle }: PopupCompletionProps,
) {
  return (
    <main
      id="main-content"
      class="login-popup-callback-shell"
      data-example-popup-callback
      data-client-id={clientId}
    >
      <div class="login-popup-callback-card">
        <img
          src="/app-icon.svg"
          alt=""
          width="34"
          height="34"
          class="login-popup-callback-icon"
        />
        <p class="text-eyebrow">Login with Atmosphere</p>
        <h1>Account selected</h1>
        <p data-example-popup-callback-status>
          Sending{" "}
          {handle ? <AtmosphereHandle handle={handle} /> : "the account"}{" "}
          back to the example app.
        </p>
      </div>
      <script src={sdkSrc} defer></script>
      <script
        src={asset("/example-atmosphere-login-popup-callback.js")}
        defer
      >
      </script>
    </main>
  );
}

function buildChecks(input: {
  verified: Awaited<ReturnType<typeof verifyLoginSelectionToken>>;
  clientId: string | null;
  state: string | null;
  expectedState: string | null;
  expectedReturnUri: string;
}): Check[] {
  const { verified, clientId, state, expectedState, expectedReturnUri } = input;
  if (!verified) {
    return [{
      label: "Signature and expiry",
      ok: false,
      detail:
        "The token could not be verified with this deployment's Login with Atmosphere JWKS.",
    }];
  }
  return [
    {
      label: "Signature and expiry",
      ok: true,
      detail: "The token signature is valid and the selection is active.",
    },
    {
      label: "Audience",
      ok: Boolean(clientId && verified.aud === clientId),
      detail: `Expected ${
        clientId ?? "missing client_id"
      }, token has ${verified.aud}.`,
    },
    {
      label: "State",
      ok: Boolean(
        expectedState && state === expectedState &&
          verified.state === expectedState,
      ),
      detail: `Expected ${
        expectedState ?? "state retained by this app"
      }, token has ${verified.state}.`,
    },
    {
      label: "Return URI",
      ok: verified.return_uri === expectedReturnUri,
      detail:
        `Expected ${expectedReturnUri}, token has ${verified.return_uri}.`,
    },
    {
      label: "Replay key",
      ok: Boolean(verified.jti),
      detail: `Store ${verified.jti} until ${
        new Date(verified.exp * 1000).toISOString()
      }. This reference app consumes it before starting app OAuth.`,
    },
  ];
}

function clearExampleStateResponse(
  response: Response,
  state: string,
): Response {
  const cookie = clearExampleLoginStateCookie(state);
  if (cookie) response.headers.append("set-cookie", cookie);
  return response;
}

function callbackHandoffHref(url: URL): string {
  const out = new URL(url);
  out.searchParams.delete("inspect");
  out.searchParams.set("handoff", "1");
  return `${out.pathname}${out.search}`;
}

function readString(value: unknown, key: string): string | null {
  return value && typeof value === "object" &&
      typeof (value as Record<string, unknown>)[key] === "string"
    ? String((value as Record<string, unknown>)[key])
    : null;
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
