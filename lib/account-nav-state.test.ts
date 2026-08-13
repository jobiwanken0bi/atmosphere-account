import {
  ACCOUNT_NAV_STATE_VERSION,
  accountNavStatePayload,
  accountNavStateResponse,
} from "./account-nav-state.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

const anonymousState = {
  user: null,
  accountType: null,
  accountHost: null,
  rememberedAccounts: [],
};

Deno.test("account nav state keeps a stable anonymous hydration contract", () => {
  assertEquals(accountNavStatePayload(anonymousState), {
    version: ACCOUNT_NAV_STATE_VERSION,
    account: null,
  });
});

Deno.test("account nav state exposes only the menu's same-origin display data", () => {
  const payload = accountNavStatePayload({
    user: {
      did: "did:plc:alice",
      handle: "alice.example",
      hasManagedProfiles: true,
    },
    accountType: "project",
    accountHost: {
      host: "pds.example",
      displayName: "Example PDS",
      endpoint: "https://pds.example",
      verificationStatus: "verified",
    },
    rememberedAccounts: [{
      did: "did:plc:alice",
      handle: "alice.example",
      pdsUrl: "https://pds.example",
    }],
  });
  assertEquals(payload, {
    version: ACCOUNT_NAV_STATE_VERSION,
    account: {
      user: { did: "did:plc:alice", handle: "alice.example" },
      hasManagedProfiles: true,
      avatarUrl: "/api/me/avatar?v=did%3Aplc%3Aalice",
      publicProfileHandle: null,
      accountHost: {
        displayName: "Example PDS",
        endpoint: "https://pds.example",
      },
      rememberedAccounts: [{
        did: "did:plc:alice",
        handle: "alice.example",
      }],
    },
  });
});

Deno.test("account nav endpoint is same-origin and uncacheable", async () => {
  const response = accountNavStateResponse(
    new Request("https://atmosphereaccount.com/api/account/nav-state", {
      headers: { "sec-fetch-site": "same-origin" },
    }),
    anonymousState,
  );
  assertEquals(response.status, 200);
  assertEquals(response.headers.get("cache-control"), "private, no-store");
  assertEquals(
    response.headers.get("deno-cdn-cache-control"),
    "private, no-store",
  );
  assertEquals(
    response.headers.get("cross-origin-resource-policy"),
    "same-origin",
  );
  assertEquals(response.headers.get("vary"), "Cookie");
  assertEquals(await response.json(), {
    version: ACCOUNT_NAV_STATE_VERSION,
    account: null,
  });

  const rejected = accountNavStateResponse(
    new Request("https://atmosphereaccount.com/api/account/nav-state", {
      headers: { "sec-fetch-site": "cross-site" },
    }),
    anonymousState,
  );
  assertEquals(rejected.status, 403);
  assertEquals(rejected.headers.get("cache-control"), "private, no-store");
});
