function assertEquals(actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
  }
}

interface MockStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

type AtmosphereLoginGlobal = {
  consumeSelection(options?: {
    clientId?: string;
    clearUrl?: boolean;
    expectedState?: string;
  }): {
    token: string;
    state: string;
    clientId: string;
    did: string | null;
    handle: string | null;
    issuer: string | null;
  } | null;
};

async function loadBrowserSdk(inputUrl: string): Promise<{
  login: AtmosphereLoginGlobal;
  replacedUrl: () => string | null;
  cleanup: () => void;
}> {
  const previous = {
    document: (globalThis as Record<string, unknown>).document,
    location: (globalThis as Record<string, unknown>).location,
    sessionStorage: (globalThis as Record<string, unknown>).sessionStorage,
    history: (globalThis as Record<string, unknown>).history,
    AtmosphereLogin: (globalThis as Record<string, unknown>).AtmosphereLogin,
  };
  let replacement: string | null = null;
  const storage = new Map<string, string>();
  const clientId = "https://app.example/client.json";
  storage.set(
    `atmosphere_login_state:${clientId}`,
    JSON.stringify({ state: "state-123", createdAt: Date.now() }),
  );
  (globalThis as Record<string, unknown>).document = {
    currentScript: {
      src: "https://login.atmosphereaccount.com/atmosphere-login.js",
    },
    readyState: "complete",
    querySelectorAll: () => [],
  };
  (globalThis as Record<string, unknown>).location = { href: inputUrl };
  (globalThis as Record<string, unknown>).sessionStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  } satisfies MockStorage;
  (globalThis as Record<string, unknown>).history = {
    state: { app: "state" },
    replaceState: (_state: unknown, _title: string, url: string) => {
      replacement = url;
    },
  };

  try {
    const source = await Deno.readTextFile(
      new URL("./atmosphere-login.js", import.meta.url),
    );
    Function(source)();
    return {
      login: (globalThis as typeof globalThis & {
        AtmosphereLogin: AtmosphereLoginGlobal;
      }).AtmosphereLogin,
      replacedUrl: () => replacement,
      cleanup: () => {
        Object.assign(globalThis as Record<string, unknown>, previous);
      },
    };
  } catch (err) {
    Object.assign(globalThis as Record<string, unknown>, previous);
    throw err;
  }
}

Deno.test("browser SDK consumeSelection clears token-bearing URL params by default", async () => {
  const clientId = "https://app.example/client.json";
  const sdk = await loadBrowserSdk(
    `https://app.example/callback?existing=1&selection_token=token-123&client_id=${
      encodeURIComponent(clientId)
    }&state=state-123&did=did%3Aplc%3Aexample&handle=alice.example&iss=https%3A%2F%2Flogin.atmosphereaccount.com#done`,
  );
  try {
    const selection = sdk.login.consumeSelection({ clientId });
    assertEquals(selection?.token, "token-123");
    assertEquals(selection?.handle, "alice.example");
    assertEquals(sdk.replacedUrl(), "/callback?existing=1#done");
  } finally {
    sdk.cleanup();
  }
});

Deno.test("browser SDK consumeSelection can preserve callback URL for custom routers", async () => {
  const clientId = "https://app.example/client.json";
  const sdk = await loadBrowserSdk(
    `https://app.example/callback?selection_token=token-123&client_id=${
      encodeURIComponent(clientId)
    }&state=state-123`,
  );
  try {
    const selection = sdk.login.consumeSelection({
      clientId,
      clearUrl: false,
    });
    assertEquals(selection?.token, "token-123");
    assertEquals(sdk.replacedUrl(), null);
  } finally {
    sdk.cleanup();
  }
});

Deno.test("browser SDK consumeSelection rejects callback client_id mismatch", async () => {
  const clientId = "https://app.example/client.json";
  const wrongClientId = "https://other.example/client.json";
  const sdk = await loadBrowserSdk(
    `https://app.example/callback?selection_token=token-123&client_id=${
      encodeURIComponent(wrongClientId)
    }&state=state-123`,
  );
  try {
    assertThrows(
      () => sdk.login.consumeSelection({ clientId }),
      "Atmosphere Login client_id mismatch",
    );
  } finally {
    sdk.cleanup();
  }
});

Deno.test("browser SDK consumeSelection can bind an expected state", async () => {
  const clientId = "https://app.example/client.json";
  const sdk = await loadBrowserSdk(
    `https://app.example/callback?selection_token=token-123&client_id=${
      encodeURIComponent(clientId)
    }&state=state-123`,
  );
  try {
    assertThrows(
      () =>
        sdk.login.consumeSelection({
          clientId,
          expectedState: "state-from-app-session",
        }),
      "Atmosphere Login state mismatch",
    );
  } finally {
    sdk.cleanup();
  }
});

function assertThrows(fn: () => unknown, expectedMessage: string): void {
  try {
    fn();
  } catch (error) {
    assertEquals(
      error instanceof Error ? error.message : String(error),
      expectedMessage,
    );
    return;
  }
  throw new Error(`Expected ${expectedMessage} to throw`);
}
