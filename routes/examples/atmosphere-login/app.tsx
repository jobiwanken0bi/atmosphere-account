import Nav from "../../../components/Nav.tsx";
import Footer from "../../../components/Footer.tsx";
import AtmosphereHandle from "../../../components/AtmosphereHandle.tsx";
import { buildAccountMenuProps } from "../../../lib/account-menu-props.ts";
import {
  type ExampleAppSession,
  exampleAtprotoOAuthCallbackUri,
  exampleAtprotoOAuthClientId,
  readExampleAppSession,
} from "../../../lib/example-atproto-oauth.ts";
import { define } from "../../../utils.ts";

interface ExampleAppProps {
  account: ReturnType<typeof buildAccountMenuProps>;
  clientId: string;
  returnUri: string;
  sdkSrc: string;
  appHomepage: string;
  oauthClientId: string;
  oauthCallbackUri: string;
  exampleSession: ExampleAppSession | null;
}

export const handler = define.handlers({
  async GET(ctx) {
    const clientId = new URL(
      "/examples/atmosphere-login/client-metadata.json",
      ctx.url.origin,
    ).toString();
    const returnUri = new URL(
      "/examples/atmosphere-login/callback",
      ctx.url.origin,
    ).toString();
    const appHomepage = new URL(
      "/examples/atmosphere-login/app",
      ctx.url.origin,
    ).toString();
    ctx.state.pageMeta = {
      title: "Atmosphere Login Example App",
      description:
        "A working relying-app example for Continue with Atmosphere.",
      canonicalUrl: new URL("/examples/atmosphere-login/app", ctx.url.origin)
        .toString(),
    };
    return ctx.render(
      <ExampleApp
        account={buildAccountMenuProps(ctx.state)}
        clientId={clientId}
        returnUri={returnUri}
        sdkSrc={new URL("/atmosphere-login.js", ctx.url.origin).toString()}
        appHomepage={appHomepage}
        oauthClientId={exampleAtprotoOAuthClientId(ctx.url.origin)}
        oauthCallbackUri={exampleAtprotoOAuthCallbackUri(ctx.url.origin)}
        exampleSession={await readExampleAppSession(ctx.req).catch(() => null)}
      />,
    );
  },
});

function ExampleApp(
  {
    account,
    clientId,
    returnUri,
    sdkSrc,
    appHomepage,
    oauthClientId,
    oauthCallbackUri,
    exampleSession,
  }: ExampleAppProps,
) {
  const buttonSnippet = `<button
  data-atmosphere-login
  data-client-id="${clientId}"
  data-return-uri="${returnUri}"
  data-scope="atproto"
  data-app-name="Atmosphere Login reference app"
  data-app-homepage="${appHomepage}"
></button>
<script src="${sdkSrc}" defer></script>`;
  const callbackSnippet = `const selection = AtmosphereLogin.consumeSelection({
  clientId: "${clientId}",
});

if (!selection) return showSignedOut();

const verified = await verifyAtmosphereLoginCallback({
  url: request.url,
  publicJwk,
  expectedIssuer: "${new URL(sdkSrc).origin}",
  expectedClientId: "${clientId}",
  expectedReturnUri: "${returnUri}",
  expectedState: selection.state,
  replayStore,
});

if (!verified.ok) throw new Error(verified.error);

return redirect("/examples/atmosphere-login/oauth/start?" + new URLSearchParams({
  handle: verified.claims.handle,
  did: verified.claims.sub,
}));`;
  const oauthSnippet = `// /examples/atmosphere-login/oauth/start
await startAtprotoOAuth({
  clientId: "${oauthClientId}",
  redirectUri: "${oauthCallbackUri}",
  scope: "atproto",
  loginHint: verified.claims.handle || verified.claims.sub,
});

// /examples/atmosphere-login/oauth/callback
const account = await completeAtprotoOAuthCallback(request.url);
return createAppSession(account);`;

  return (
    <div id="page-top">
      <div class="content-layer">
        <Nav account={account} />
        <section class="signin-page-section login-example-section">
          <div class="container signin-page-container">
            <a href="/docs/atmosphere-login" class="text-link-button">
              Back to docs
            </a>

            <div class="glass signin-page-card login-example-card login-example-app-card">
              <div>
                <p class="text-eyebrow">Example relying app</p>
                <h1 class="host-claim-title">Continue with Atmosphere</h1>
                <p class="text-body host-claim-copy">
                  This is the canonical copy-paste reference: the app asks
                  Atmosphere to choose an account, verifies the signed selection
                  on callback, starts its own AT Protocol OAuth flow, then
                  creates an app-owned signed-in session.
                </p>
              </div>

              {exampleSession && (
                <div
                  class={`login-example-result ${
                    exampleSession.oauthMode === "dev_simulated"
                      ? "login-example-result--dev"
                      : "login-example-result--ok"
                  }`}
                >
                  <strong>
                    {exampleSession.oauthMode === "dev_simulated"
                      ? "Local dev account selected"
                      : "Signed in to the example app as"}{" "}
                    <AtmosphereHandle handle={exampleSession.handle} />
                  </strong>
                  {exampleSession.oauthMode === "dev_simulated"
                    ? (
                      <p>
                        This fake `.test` account cannot complete real ATProto
                        OAuth because its handle is not resolvable. The example
                        app created a local simulated session so you can inspect
                        the final UI state.
                      </p>
                    )
                    : (
                      <p>
                        This is a separate demo app session. Atmosphere Account
                        chose the account; the example app completed its own
                        ATProto OAuth flow.
                      </p>
                    )}
                </div>
              )}

              <div class="login-example-app-grid">
                <div class="login-example-demo-panel">
                  <div class="login-example-demo-app">
                    <img src="/union.svg" alt="" width="42" height="42" />
                    <div>
                      <strong>Reference app</strong>
                      <span>Local example using this deployment</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    data-atmosphere-login
                    data-client-id={clientId}
                    data-return-uri={returnUri}
                    data-scope="atproto"
                    data-app-name="Atmosphere Login reference app"
                    data-app-homepage={appHomepage}
                  />
                  <p>
                    The picker returns to the reference callback. When the token
                    checks pass, the callback redirects into the app's ATProto
                    OAuth start route.
                  </p>
                </div>

                <div class="login-example-next-panel">
                  <p class="text-eyebrow">After callback</p>
                  <h2>Complete app-owned ATProto OAuth</h2>
                  <p>
                    The example uses the selected `handle` or `sub` DID as the
                    login hint, exchanges the OAuth code on its own callback,
                    and then shows the final signed-in app state.
                  </p>
                  <a
                    class="profile-form-button-secondary profile-form-button-secondary--lg"
                    href="/examples/atmosphere-login/callback?inspect=1"
                  >
                    View verifier page
                  </a>
                  <a
                    class="profile-form-button-secondary profile-form-button-secondary--lg"
                    href="/examples/atmosphere-login/oauth/client-metadata.json"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    OAuth metadata
                  </a>
                </div>
              </div>

              <div class="login-console-snippets">
                <Snippet label="Button" text={buttonSnippet} />
                <Snippet label="Selection callback" text={callbackSnippet} />
                <Snippet label="ATProto OAuth handoff" text={oauthSnippet} />
              </div>
            </div>
          </div>
        </section>
        <Footer variant="compact" />
        <script src={sdkSrc} defer></script>
      </div>
    </div>
  );
}

function Snippet({ label, text }: { label: string; text: string }) {
  return (
    <div class="api-playground-snippet">
      <div class="api-playground-snippet-header">
        <span class="api-playground-label">{label}</span>
      </div>
      <pre class="api-playground-pre"><code>{text}</code></pre>
    </div>
  );
}
