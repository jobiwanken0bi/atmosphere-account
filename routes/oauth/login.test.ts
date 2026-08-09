import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
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
