import {
  addRememberedAccountCookie,
  readRememberedAccountsFromHeader,
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
