import {
  type DeveloperAppTestApp,
  loginButtonSnippet,
} from "./DeveloperAppTestConsole.tsx";

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

function assertStringIncludes(actual: string, expected: string): void {
  if (!actual.includes(expected)) {
    throw new Error(`Expected string to include ${expected}, got ${actual}`);
  }
}

function assertStringExcludes(actual: string, unexpected: string): void {
  if (actual.includes(unexpected)) {
    throw new Error(
      `Expected string not to include ${unexpected}, got ${actual}`,
    );
  }
}

const baseApp: DeveloperAppTestApp = {
  clientId: "https://app.example/client-metadata.json",
  appName: "Example App",
  appUri: null,
  logoUri: null,
  allowedReturnUris: ["https://app.example/callback"],
  status: "development",
};

Deno.test("developer app console emits explicit redirect button metadata", () => {
  const snippet = loginButtonSnippet(
    baseApp,
    "https://app.example/callback",
    "redirect",
  );

  assert(snippet.startsWith("<button\n"), "Expected button snippet");
  assertStringIncludes(snippet, "data-atmosphere-login");
  assertStringIncludes(
    snippet,
    'data-client-id="https://app.example/client-metadata.json"',
  );
  assertStringIncludes(snippet, 'data-mode="redirect"');
  assertStringIncludes(snippet, 'data-app-name="Example App"');
  assertStringExcludes(snippet, "data-app-logo");
  assertStringExcludes(snippet, "data-app-homepage");
});

Deno.test("developer app console emits popup button metadata", () => {
  const snippet = loginButtonSnippet(
    {
      ...baseApp,
      appName: 'Quoted "App" & <Friends>',
      appUri: "https://app.example/?a=1&b=2",
      logoUri: 'https://cdn.example/logo.svg?label="app"',
    },
    "https://app.example/callback?mode=popup",
    "popup",
  );

  assertStringIncludes(snippet, 'data-mode="popup"');
  assertStringIncludes(
    snippet,
    'data-app-name="Quoted &quot;App&quot; &amp; &lt;Friends&gt;"',
  );
  assertStringIncludes(
    snippet,
    'data-app-logo="https://cdn.example/logo.svg?label=&quot;app&quot;"',
  );
  assertStringIncludes(
    snippet,
    'data-app-homepage="https://app.example/?a=1&amp;b=2"',
  );
});
