import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { readLoginInputForTest } from "./login.ts";

Deno.test("OAuth login defaults browser requests to identity-only", async () => {
  const input = await readLoginInputForTest(
    new Request(
      "https://atmosphereaccount.com/oauth/login?handle=alice.example&next=%2Faccount",
    ),
  );

  assertEquals(input, {
    handle: "alice.example",
    next: "/account",
    intent: null,
    continuation: null,
    chooseAnotherAccount: false,
    capabilities: ["identity"],
    action: null,
    targetName: null,
  });
});

Deno.test("OAuth login preserves repeated capability upgrades from forms", async () => {
  const input = await readLoginInputForTest(
    new Request("https://atmosphereaccount.com/oauth/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams([
        ["handle", " alice.example "],
        ["next", "/apps/create?new=1"],
        ["intent", "project"],
        ["capability", "app"],
        ["capability", "media"],
        ["action", "app"],
        ["name", "Example App"],
      ]),
    }),
  );

  assertEquals(input, {
    handle: "alice.example",
    next: "/apps/create?new=1",
    intent: "project",
    continuation: null,
    chooseAnotherAccount: false,
    capabilities: ["app", "media"],
    action: "app",
    targetName: "Example App",
  });
});

Deno.test("OAuth login accepts the explicit bodyless host-claim handoff", async () => {
  const url = "https://atmosphereaccount.com/oauth/login?" +
    "handle=did%3Aplc%3Acveom2iroj3mt747sd4qqnr2&" +
    "next=%2Fhosts%2Fsprk.so%2Fclaim&" +
    "action=host_claim&name=Spark&" +
    "capability=host&capability=media";
  const headers = {
    "x-atmosphere-login": "1",
    "x-atmosphere-login-bodyless": "1",
  };
  const expected: Awaited<ReturnType<typeof readLoginInputForTest>> = {
    handle: "did:plc:cveom2iroj3mt747sd4qqnr2",
    next: "/hosts/sprk.so/claim",
    intent: null,
    continuation: null,
    chooseAnotherAccount: false,
    capabilities: ["host", "media"],
    action: "host_claim",
    targetName: "Spark",
  };

  assertEquals(
    await readLoginInputForTest(
      new Request(url, { method: "POST", headers }),
    ),
    expected,
  );
  assertEquals(
    await readLoginInputForTest(
      // Some proxies represent an empty body as a non-null, empty stream.
      new Request(url, {
        method: "POST",
        headers: { ...headers, "content-length": "0" },
        body: new Uint8Array(),
      }),
    ),
    expected,
  );
});

Deno.test("OAuth login rejects unmarked or non-bodyless query POSTs", async () => {
  const url =
    "https://atmosphereaccount.com/oauth/login?handle=alice.example&" +
    "next=%2Faccount&action=account&capability=identity";

  await assertRejects(() =>
    readLoginInputForTest(new Request(url, { method: "POST" }))
  );
  await assertRejects(() =>
    readLoginInputForTest(
      new Request(url, {
        method: "POST",
        headers: {
          "x-atmosphere-login": "1",
          "x-atmosphere-login-bodyless": "1",
        },
        body: "unexpected",
      }),
    )
  );
});

Deno.test("OAuth login rejects raw scopes disguised as capabilities", async () => {
  const input = await readLoginInputForTest(
    new Request(
      "https://atmosphereaccount.com/oauth/login?handle=alice.example&capability=repo%3A%2A",
    ),
  );
  assertEquals(input.capabilities, null);
});

Deno.test("hosted picker continuation remains explicit in parsed login input", async () => {
  const input = await readLoginInputForTest(
    new Request(
      "https://atmosphereaccount.com/oauth/login?handle=alice.example&continuation=login_selection&capability=app",
    ),
  );
  assertEquals(input.continuation, "login_selection");
  assertEquals(input.capabilities, ["app"]);
});
