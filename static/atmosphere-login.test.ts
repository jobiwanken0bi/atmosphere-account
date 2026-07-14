function assertEquals(actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
  }
}

interface MockStorage {
  readonly length: number;
  getItem(key: string): string | null;
  key(index: number): string | null;
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
    closePopupOnComplete?: boolean;
  }): { state: string; url: string; cleanup?: (() => void) | null };
  consumeSelection(options?: {
    clientId?: string;
    clearUrl?: boolean;
    closePopup?: boolean;
    expectedState?: string;
    notifyOpener?: boolean;
    openerOrigin?: string;
  }): {
    token: string;
    state: string;
    clientId: string;
    did: string | null;
    handle: string | null;
    issuer: string | null;
  } | null;
};

async function loadBrowserSdk(
  inputUrl: string,
  overrides: Record<string, unknown> = {},
): Promise<{
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
  ];
  const extraKeys = Object.keys(overrides);
  const allGlobalKeys = Array.from(new Set([...globalKeys, ...extraKeys]));
  const previous = new Map<PropertyKey, PropertyDescriptor | undefined>(
    allGlobalKeys.map((
      key,
    ) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  const setGlobal = (key: string, value: unknown) => {
    Object.defineProperty(globalThis, key, {
      value,
      configurable: true,
      writable: true,
    });
  };
  const restore = () => {
    for (const key of allGlobalKeys) {
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
      get length() {
        return storage.size;
      },
      getItem: (key: string) => storage.get(key) ?? null,
      key: (index: number) => [...storage.keys()][index] ?? null,
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
  for (const [key, value] of Object.entries(overrides)) {
    setGlobal(key, value);
  }

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

Deno.test("browser SDK default button label has no loading ellipsis", async () => {
  const source = await Deno.readTextFile(
    new URL("./atmosphere-login.js", import.meta.url),
  );
  if (!source.includes('label.textContent = "Continue with Atmosphere";')) {
    throw new Error("Expected exact default Continue with Atmosphere label");
  }
  if (source.includes("Continue with Atmosphere...")) {
    throw new Error("Default button label must not include trailing dots");
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

Deno.test("browser SDK prunes stale Atmosphere state before storing a new attempt", async () => {
  const clientId = "https://app.example/client.json";
  const sdk = await loadBrowserSdk("https://app.example/start");
  try {
    sdk.storage.set(
      `atmosphere_login_state:${clientId}:stale`,
      JSON.stringify({
        state: "stale",
        createdAt: Date.now() - 16 * 60 * 1000,
      }),
    );
    sdk.storage.set(
      "unrelated_state",
      JSON.stringify({
        state: "leave-me-alone",
        createdAt: Date.now() - 16 * 60 * 1000,
      }),
    );

    sdk.login.continueWithAtmosphere({
      clientId,
      returnUri: "https://app.example/callback",
      state: "fresh",
    });

    assertEquals(
      sdk.storage.has(`atmosphere_login_state:${clientId}:stale`),
      false,
    );
    assertEquals(sdk.storage.has("unrelated_state"), true);
    assertEquals(
      sdk.storage.has(`atmosphere_login_state:${clientId}:fresh`),
      true,
    );
  } finally {
    sdk.cleanup();
  }
});

Deno.test("browser SDK caps stored Atmosphere state entries", async () => {
  const clientId = "https://app.example/client.json";
  const sdk = await loadBrowserSdk("https://app.example/start");
  try {
    const now = Date.now();
    sdk.storage.delete(`atmosphere_login_state:${clientId}`);
    for (let i = 0; i < 45; i++) {
      sdk.storage.set(
        `atmosphere_login_state:${clientId}:old-${i}`,
        JSON.stringify({
          state: `old-${i}`,
          createdAt: now - 45 + i,
        }),
      );
    }

    sdk.login.continueWithAtmosphere({
      clientId,
      returnUri: "https://app.example/callback",
      state: "fresh",
    });

    const atmosphereKeys = [...sdk.storage.keys()].filter((key) =>
      key.startsWith("atmosphere_login_state:")
    );
    assertEquals(atmosphereKeys.length, 40);
    assertEquals(
      sdk.storage.has(`atmosphere_login_state:${clientId}:fresh`),
      true,
    );
    assertEquals(
      sdk.storage.has(`atmosphere_login_state:${clientId}:old-0`),
      false,
    );
  } finally {
    sdk.cleanup();
  }
});

Deno.test("browser SDK consumeSelection posts popup selections to opener", async () => {
  const clientId = "https://app.example/client.json";
  const posted: Array<{ data: Record<string, unknown>; targetOrigin: string }> =
    [];
  let closed = false;
  const sdk = await loadBrowserSdk(
    `https://app.example/callback?selection_token=token-123&client_id=${
      encodeURIComponent(clientId)
    }&state=state-123&did=did%3Aplc%3Aexample&handle=alice.example`,
    {
      opener: {
        postMessage: (data: Record<string, unknown>, targetOrigin: string) => {
          posted.push({ data, targetOrigin });
        },
      },
      close: () => {
        closed = true;
      },
    },
  );
  try {
    const selection = sdk.login.consumeSelection({
      clientId,
      clearUrl: false,
      closePopup: true,
    });

    assertEquals(selection?.token, "token-123");
    assertEquals(posted[0]?.targetOrigin, "https://app.example");
    assertEquals(posted[0]?.data.type, "atmosphere-login:selection");
    assertEquals(
      (posted[0]?.data.selection as { state?: string })?.state,
      "state-123",
    );
    assertEquals(closed, true);
  } finally {
    sdk.cleanup();
  }
});

Deno.test("browser SDK popup listener accepts only matching origin client and state", async () => {
  const clientId = "https://app.example/client.json";
  type MessageHandler = (event: { origin: string; data: unknown }) => void;
  const messageHandlers: MessageHandler[] = [];
  let removed = false;
  let popupClosed = false;
  const dispatched: Event[] = [];
  let intervalCleared = false;
  const sdk = await loadBrowserSdk("https://app.example/start", {
    open: () => ({
      closed: false,
      close: () => {
        popupClosed = true;
      },
    }),
    addEventListener: (type: string, handler: MessageHandler) => {
      if (type === "message") messageHandlers.push(handler);
    },
    removeEventListener: (type: string, handler: MessageHandler) => {
      if (type === "message" && handler === messageHandlers[0]) {
        removed = true;
      }
    },
    dispatchEvent: (event: Event) => {
      dispatched.push(event);
      return true;
    },
    setInterval: () => 1,
    clearInterval: () => {
      intervalCleared = true;
    },
  });
  try {
    sdk.login.continueWithAtmosphere({
      clientId,
      returnUri: "https://app.example/callback",
      state: "state-123",
      popup: true,
    });

    const messageHandler = messageHandlers[0];
    if (!messageHandler) throw new Error("Expected popup message listener");
    messageHandler({
      origin: "https://evil.example",
      data: {
        type: "atmosphere-login:selection",
        version: 1,
        selection: { clientId, state: "state-123", token: "bad" },
      },
    });
    assertEquals(dispatched.length, 0);
    assertEquals(popupClosed, false);

    messageHandler({
      origin: "https://app.example",
      data: {
        type: "atmosphere-login:selection",
        version: 1,
        selection: { clientId, state: "wrong-state", token: "bad" },
      },
    });
    assertEquals(dispatched.length, 0);
    assertEquals(popupClosed, false);

    messageHandler({
      origin: "https://app.example",
      data: {
        type: "atmosphere-login:selection",
        version: 1,
        selection: { clientId, state: "state-123", token: "token-123" },
      },
    });

    assertEquals(dispatched[0]?.type, "atmosphere-login:complete");
    assertEquals(
      ((dispatched[0] as CustomEvent).detail.selection as { token?: string })
        .token,
      "token-123",
    );
    assertEquals(popupClosed, true);
    assertEquals(removed, true);
    assertEquals(intervalCleared, true);
  } finally {
    sdk.cleanup();
  }
});

Deno.test("browser SDK sizes and centers the popup for the available screen", async () => {
  const clientId = "https://app.example/client.json";
  let popupFeatures = "";
  const sdk = await loadBrowserSdk("https://app.example/start", {
    screen: {
      availLeft: 100,
      availTop: 40,
      availWidth: 1440,
      availHeight: 900,
    },
    open: (_url: string, _target: string, features: string) => {
      popupFeatures = features;
      return null;
    },
  });
  try {
    sdk.login.continueWithAtmosphere({
      clientId,
      returnUri: "https://app.example/callback",
      state: "state-123",
      popup: true,
    });

    assertEquals(
      popupFeatures,
      "popup,width=800,height=868,left=420,top=56",
    );
  } finally {
    sdk.cleanup();
  }
});

Deno.test("browser SDK keeps the popup inside a compact screen", async () => {
  let popupFeatures = "";
  const sdk = await loadBrowserSdk("https://app.example/start", {
    screen: {
      availLeft: 0,
      availTop: 0,
      availWidth: 390,
      availHeight: 844,
    },
    open: (_url: string, _target: string, features: string) => {
      popupFeatures = features;
      return null;
    },
  });
  try {
    sdk.login.continueWithAtmosphere({
      clientId: "https://app.example/client.json",
      returnUri: "https://app.example/callback",
      state: "state-123",
      popup: true,
    });

    assertEquals(
      popupFeatures,
      "popup,width=358,height=812,left=16,top=16",
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
