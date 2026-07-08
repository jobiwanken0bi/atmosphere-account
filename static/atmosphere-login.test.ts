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
  continueWithAtmosphere(options: {
    clientId: string;
    returnUri: string;
    state?: string;
    scope?: string;
    atmosphereOrigin?: string;
    popup?: boolean;
  }): { state: string; url: string };
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
  storage: Map<string, string>;
  replacedUrl: () => string | null;
  cleanup: () => void;
}> {
  const globalKeys = [
    "document",
    "location",
    "sessionStorage",
    "history",
    "AtmosphereLogin",
  ] as const;
  const previous = new Map<PropertyKey, PropertyDescriptor | undefined>(
    globalKeys.map((
      key,
    ) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  const setGlobal = (key: typeof globalKeys[number], value: unknown) => {
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    });
  };
  const restore = () => {
    for (const key of globalKeys) {
      const descriptor = previous.get(key);
      if (descriptor) {
        Object.defineProperty(globalThis, key, descriptor);
      } else {
        Reflect.deleteProperty(globalThis, key);
      }
    }
  };
  let replacement: string | null = null;
  const storage = new Map<string, string>();
  const clientId = "https://app.example/client.json";
  storage.set(
    `atmosphere_login_state:${clientId}`,
    JSON.stringify({ state: "state-123", createdAt: Date.now() }),
  );
  setGlobal("document", {
    currentScript: {
      src: "https://login.atmosphereaccount.com/atmosphere-login.js",
    },
    readyState: "complete",
    querySelectorAll: () => [],
  });
  setGlobal("location", { href: inputUrl });
  setGlobal(
    "sessionStorage",
    {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    } satisfies MockStorage,
  );
  setGlobal("history", {
    state: { app: "state" },
    replaceState: (_state: unknown, _title: string, url: string) => {
      replacement = url;
    },
  });

  try {
    const source = await Deno.readTextFile(
      new URL("./atmosphere-login.js", import.meta.url),
    );
    Function(source)();
    return {
      login: (globalThis as typeof globalThis & {
        AtmosphereLogin: AtmosphereLoginGlobal;
      }).AtmosphereLogin,
      storage,
      replacedUrl: () => replacement,
      cleanup: restore,
    };
  } catch (err) {
    restore();
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

Deno.test("browser SDK stores exact state keys for parallel attempts", async () => {
  const clientId = "https://app.example/client.json";
  const sdk = await loadBrowserSdk("https://app.example/start");
  try {
    sdk.login.continueWithAtmosphere({
      clientId,
      returnUri: "https://app.example/callback",
      state: "state-first",
    });
    sdk.login.continueWithAtmosphere({
      clientId,
      returnUri: "https://app.example/callback",
      state: "state-second",
    });

    assertEquals(
      sdk.storage.has(`atmosphere_login_state:${clientId}:state-first`),
      true,
    );
    assertEquals(
      sdk.storage.has(`atmosphere_login_state:${clientId}:state-second`),
      true,
    );
    assertEquals(
      JSON.parse(sdk.storage.get(`atmosphere_login_state:${clientId}`) || "{}")
        .state,
      "state-second",
    );
  } finally {
    sdk.cleanup();
  }
});

Deno.test("browser SDK consumeSelection prefers exact state over overwritten legacy state", async () => {
  const clientId = "https://app.example/client.json";
  const sdk = await loadBrowserSdk(
    `https://app.example/callback?selection_token=token-123&client_id=${
      encodeURIComponent(clientId)
    }&state=state-first`,
  );
  try {
    sdk.storage.set(
      `atmosphere_login_state:${clientId}:state-first`,
      JSON.stringify({ state: "state-first", createdAt: Date.now() - 2000 }),
    );
    sdk.storage.set(
      `atmosphere_login_state:${clientId}`,
      JSON.stringify({ state: "state-second", createdAt: Date.now() - 1000 }),
    );

    const selection = sdk.login.consumeSelection({ clientId });

    assertEquals(selection?.state, "state-first");
    assertEquals(
      sdk.storage.has(`atmosphere_login_state:${clientId}:state-first`),
      false,
    );
    assertEquals(
      sdk.storage.has(`atmosphere_login_state:${clientId}`),
      false,
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
