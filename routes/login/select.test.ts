import type { State } from "../../utils.ts";
import { pickerAccountsForStateForTest } from "./select.tsx";

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
