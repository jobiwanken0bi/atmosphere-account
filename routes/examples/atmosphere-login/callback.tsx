import { define } from "../../../utils.ts";
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
  exampleAtmosphereLoginVerifiedReturnUri,
  exampleSelectionReplayStore,
  isExampleAtmosphereLoginPopupCallback,
  isExampleAtmosphereLoginPopupHandoff,
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
}

interface PopupCompletionProps {
  clientId: string;
  sdkSrc: string;
  handle: string | null;
}

export const handler = define.handlers({
  async GET(ctx) {
    const token = ctx.url.searchParams.get("selection_token")?.trim() || null;
    const clientId = ctx.url.searchParams.get("client_id")?.trim() || null;
    const state = ctx.url.searchParams.get("state")?.trim() || null;
    const expectedReturnUri = exampleAtmosphereLoginVerifiedReturnUri(ctx.url);
    const verified = token ? await verifyLoginSelectionToken(token) : null;
    const decoded = token ? decodeSelectionTokenUnsafe(token) : null;
    const checks = buildChecks({
      verified,
      clientId,
      state,
      expectedReturnUri,
    });
    const allPassed = checks.length > 0 && checks.every((check) => check.ok);
    const inspect = ctx.url.searchParams.get("inspect") === "1";
    const isPopup = isExampleAtmosphereLoginPopupCallback(ctx.url);
    const isPopupHandoff = isExampleAtmosphereLoginPopupHandoff(ctx.url);
    const pickerOrigin = loginPickerOriginForRequest(ctx.url);
    if (token && allPassed && verified && !inspect) {
      if (isPopup && !isPopupHandoff) {
        return ctx.render(
          <PopupCompletionPage
            clientId={clientId ?? verified.aud}
            sdkSrc={new URL("/atmosphere-login.js", pickerOrigin).toString()}
            handle={verified.handle}
          />,
        );
      }
      const consumed = await verifyLoginSelectionTokenDetailed(token, {
        expectedAudience: clientId ?? undefined,
        expectedState: state ?? undefined,
        expectedReturnUri,
        replayStore: exampleSelectionReplayStore,
      });
      if (!consumed.ok) {
        return ctx.render(
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
          />,
        );
      }
      return new Response(null, {
        status: 303,
        headers: {
          location: buildExampleOAuthStartPath({
            handle: consumed.claims.handle,
            did: consumed.claims.sub,
          }),
        },
      });
    }
    ctx.state.pageMeta = {
      title: "Atmosphere Login Reference Callback",
      description:
        "Reference callback for verifying an Atmosphere Login selection token.",
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
  } = props;
  const allPassed = checks.length > 0 && checks.every((check) => check.ok);
  const handle = verified?.handle ?? readString(decoded, "handle");
  const did = verified?.sub ?? readString(decoded, "sub");
  return (
    <div id="page-top">
      <div class="content-layer">
        <Nav account={account} disableScrollEffects />
        <section class="signin-page-section login-example-section">
          <div class="container signin-page-container">
            <a href="/docs/atmosphere-login" class="text-link-button">
              Back to Atmosphere Login docs
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
                        href={buildExampleOAuthStartPath({ handle, did })}
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
        </section>
        <Footer variant="compact" />
      </div>
    </div>
  );
}

function PopupCompletionPage(
  { clientId, sdkSrc, handle }: PopupCompletionProps,
) {
  return (
    <div
      class="login-popup-callback-shell"
      data-example-popup-callback
      data-client-id={clientId}
    >
      <div class="login-popup-callback-card">
        <img
          src="/union.svg"
          alt=""
          width="34"
          height="34"
          class="login-popup-callback-icon"
        />
        <p class="text-eyebrow">Continue with Atmosphere</p>
        <h1>Account selected</h1>
        <p data-example-popup-callback-status>
          Sending{" "}
          {handle ? <AtmosphereHandle handle={handle} /> : "the account"}{" "}
          back to the example app.
        </p>
      </div>
      <script src={sdkSrc} defer></script>
      <script src="/example-atmosphere-login-popup-callback.js" defer>
      </script>
    </div>
  );
}

function buildChecks(input: {
  verified: Awaited<ReturnType<typeof verifyLoginSelectionToken>>;
  clientId: string | null;
  state: string | null;
  expectedReturnUri: string;
}): Check[] {
  const { verified, clientId, state, expectedReturnUri } = input;
  if (!verified) {
    return [{
      label: "Signature and expiry",
      ok: false,
      detail:
        "The token could not be verified with this deployment's Atmosphere Login JWKS.",
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
      ok: Boolean(state && verified.state === state),
      detail: `Expected ${
        state ?? "missing state"
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
      } and reject repeat use.`,
    },
  ];
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
