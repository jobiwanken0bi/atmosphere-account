import type { State } from "../../utils.ts";
import {
  pickerAccountsForStateForTest,
  pickerCancelHrefForTest,
  pickerSelectionPathForTest,
  readLoginRequestFromInputForTest,
} from "./select.tsx";

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function state(input: Partial<State>): State {
  return {
    locale: "en",
    user: null,
    accountType: null,
    accountHost: null,
    rememberedAccounts: [],
    ...input,
  };
}

Deno.test("login picker can use remembered accounts without an active session", () => {
  const accounts = pickerAccountsForStateForTest(
    state({
      rememberedAccounts: [
        {
          did: "did:plc:one",
          handle: "one.example",
          pdsUrl: "https://pds.one.example",
        },
        {
          did: "did:plc:two",
          handle: "two.example",
          pdsUrl: "https://pds.two.example",
        },
      ],
    }),
  );

  assertEquals(accounts, [
    {
      did: "did:plc:one",
      handle: "one.example",
      pdsUrl: "https://pds.one.example",
    },
    {
      did: "did:plc:two",
      handle: "two.example",
      pdsUrl: "https://pds.two.example",
    },
  ]);
});

Deno.test("login picker merges active session with remembered PDS hint", () => {
  const accounts = pickerAccountsForStateForTest(
    state({
      user: { did: "did:plc:one", handle: "one.example" },
      rememberedAccounts: [
        {
          did: "did:plc:one",
          handle: "one.example",
          pdsUrl: "https://pds.one.example",
        },
        {
          did: "did:plc:two",
          handle: "two.example",
          pdsUrl: "https://pds.two.example",
        },
      ],
    }),
  );

  assertEquals(accounts, [
    {
      did: "did:plc:one",
      handle: "one.example",
      pdsUrl: "https://pds.one.example",
    },
    {
      did: "did:plc:two",
      handle: "two.example",
      pdsUrl: "https://pds.two.example",
    },
  ]);
});

Deno.test("login picker prefers hydrated account host endpoint for active session", () => {
  const accounts = pickerAccountsForStateForTest(
    state({
      user: { did: "did:plc:one", handle: "one.example" },
      accountHost: {
        host: "one.example",
        displayName: "One",
        endpoint: "https://pds.hydrated.example",
        verificationStatus: "observed",
      },
      rememberedAccounts: [
        {
          did: "did:plc:one",
          handle: "one.example",
          pdsUrl: "https://pds.remembered.example",
        },
      ],
    }),
  );

  assertEquals(accounts, [
    {
      did: "did:plc:one",
      handle: "one.example",
      pdsUrl: "https://pds.hydrated.example",
    },
  ]);
});

Deno.test("login picker accepts a bodyless POST query handoff", () => {
  const url = new URL("https://login.atmosphereaccount.com/login/select");
  url.searchParams.set("client_id", "https://app.example/client.json");
  url.searchParams.set("return_uri", "https://app.example/callback");
  url.searchParams.set("state", "state-value");

  assertEquals(readLoginRequestFromInputForTest(url), {
    clientId: "https://app.example/client.json",
    returnUri: "https://app.example/callback",
    state: "state-value",
    scope: null,
  });
});

Deno.test("login picker uses a browser-safe compact selection link", async () => {
  const path = await pickerSelectionPathForTest({
    clientId: "https://app.example/client.json",
    returnUri: "https://app.example/callback",
    state: "state-value",
    scope: null,
  }, "did:plc:one");
  const url = new URL(path, "https://login.atmosphereaccount.com");

  assertEquals(url.pathname, "/login/select");
  assertEquals(url.searchParams.has("selection"), true);
  assertEquals(url.searchParams.has("choice"), false);
  assertEquals([...url.searchParams.keys()], ["selection"]);
  assertEquals(url.searchParams.get("selection")?.length, 24);
  assertEquals(path.length < 80, true);
});

Deno.test("login picker cancel returns only to the verified app callback", () => {
  const href = pickerCancelHrefForTest({
    clientId: "https://app.example/client.json",
    returnUri: "https://app.example/callback?existing=1#done",
    state: "state-value",
    scope: null,
  }, {
    clientId: "https://app.example/client.json",
    returnUri: "https://app.example/callback?existing=1#done",
  });
  const url = new URL(href);
  assertEquals(url.origin, "https://app.example");
  assertEquals(url.pathname, "/callback");
  assertEquals(url.searchParams.get("existing"), "1");
  assertEquals(url.searchParams.get("error"), "access_denied");
  assertEquals(
    url.searchParams.get("client_id"),
    "https://app.example/client.json",
  );
  assertEquals(url.searchParams.get("state"), "state-value");
  assertEquals(url.hash, "#done");
});

Deno.test("login picker failures do not disclose raw exception details", async () => {
  const source = await Deno.readTextFile(
    new URL("./select.tsx", import.meta.url),
  );
  assertEquals(source.includes("String(err)"), false);
  assertEquals(source.includes('proxy failed:", err'), false);
});

Deno.test("login picker keeps its icon and product name in the branded title group", async () => {
  const source = await Deno.readTextFile(
    new URL("./select.tsx", import.meta.url),
  );
  assertEquals(source.includes('class="login-picker-title-brand"'), true);
  assertEquals(source.includes('aria-label="Login with Atmosphere"'), true);
});
