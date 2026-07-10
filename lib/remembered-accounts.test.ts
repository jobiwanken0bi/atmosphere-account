import {
  addRememberedAccountCookie,
  legacyHostOnlyRememberedAccountsClearCookieForTest,
  readRememberedAccountsFromHeader,
  refreshRememberedAccountCookies,
  rememberedAccountsCookieDomainForTest,
  rememberedAccountsCookieFlagsForTest,
} from "./remembered-accounts.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`Expected ${e}, got ${a}`);
}

Deno.test("remembered accounts cookie domain spans the site and login subdomain in production", () => {
  assertEquals(
    rememberedAccountsCookieDomainForTest(
      "https://atmosphereaccount.com",
      "https://login.atmosphereaccount.com",
      false,
    ),
    "atmosphereaccount.com",
  );
  assertEquals(
    rememberedAccountsCookieFlagsForTest(3600, {
      site: "https://atmosphereaccount.com",
      login: "https://login.atmosphereaccount.com",
      dev: false,
    }),
    [
      "Path=/",
      "Max-Age=3600",
      "HttpOnly",
      "SameSite=Lax",
      "Domain=atmosphereaccount.com",
      "Secure",
    ],
  );
});

Deno.test("remembered accounts clear legacy host-only cookie when sharing domain cookie", () => {
  const legacyClear = legacyHostOnlyRememberedAccountsClearCookieForTest({
    site: "https://atmosphereaccount.com",
    login: "https://login.atmosphereaccount.com",
    dev: false,
  });

  assertEquals(
    legacyClear,
    "atmo_accounts=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax; Secure",
  );
});

Deno.test("remembered accounts cookie stays host-only for dev and unrelated domains", () => {
  assertEquals(
    rememberedAccountsCookieDomainForTest(
      "http://127.0.0.1:5173",
      "http://127.0.0.1:5173",
      true,
    ),
    null,
  );
  assertEquals(
    rememberedAccountsCookieDomainForTest(
      "https://atmosphereaccount.com",
      "https://login.example.net",
      false,
    ),
    null,
  );
});

Deno.test("remembered account cookies roundtrip signed account hints", async () => {
  const cookie = await addRememberedAccountCookie([], {
    did: "did:plc:account",
    handle: "account.example.com",
    pdsUrl: "https://pds.example.com",
  });
  const accounts = await readRememberedAccountsFromHeader(cookie);

  assertEquals(accounts, [
    {
      did: "did:plc:account",
      handle: "account.example.com",
      pdsUrl: "https://pds.example.com",
    },
  ]);
});

Deno.test("remembered account reader merges duplicate scoped cookies", async () => {
  const first = await addRememberedAccountCookie([], {
    did: "did:plc:one",
    handle: "one.example.com",
    pdsUrl: "https://pds.one.example.com",
  });
  const second = await addRememberedAccountCookie([], {
    did: "did:plc:two",
    handle: "two.example.com",
    pdsUrl: "https://pds.two.example.com",
  });

  const accounts = await readRememberedAccountsFromHeader(
    `${cookiePair(first)}; ${cookiePair(second)}`,
  );

  assertEquals(accounts, [
    {
      did: "did:plc:one",
      handle: "one.example.com",
      pdsUrl: "https://pds.one.example.com",
    },
    {
      did: "did:plc:two",
      handle: "two.example.com",
      pdsUrl: "https://pds.two.example.com",
    },
  ]);
});

Deno.test("remembered account refresh preserves accounts while upgrading cookie scope", async () => {
  const accounts = [
    {
      did: "did:plc:one",
      handle: "one.example.com",
      pdsUrl: "https://pds.one.example.com",
    },
    {
      did: "did:plc:two",
      handle: "two.example.com",
      pdsUrl: null,
    },
  ];
  const cookies = await refreshRememberedAccountCookies(accounts);

  assertEquals(cookies.length >= 1, true);
  assertEquals(
    await readRememberedAccountsFromHeader(cookiePair(cookies.at(-1)!)),
    accounts,
  );
});

function cookiePair(setCookie: string): string {
  return setCookie.split(";")[0];
}
