import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isValidLoginSelectionContinuation,
  oauthLoginFailureResponse,
  readLoginInputForTest,
} from "./login.ts";
import { hasValidLoginSelectionContinuationBinding } from "../../lib/oauth-continuation.ts";

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
      "https://atmosphereaccount.com/oauth/login?handle=alice.example&continuation=login_selection&capability=identity",
    ),
  );
  assertEquals(input.continuation, "login_selection");
  assertEquals(input.capabilities, ["identity"]);
});

Deno.test("OAuth login rejects duplicate and malformed security context", async () => {
  for (
    const query of [
      "action=account&action=admin&capability=identity",
      "intent=typo&capability=identity",
      "continuation=typo&capability=identity",
      "next=https%3A%2F%2Fevil.example&capability=identity",
      "capability=",
    ]
  ) {
    await assertRejects(() =>
      readLoginInputForTest(
        new Request(
          `https://atmosphereaccount.com/oauth/login?handle=alice.example&${query}`,
        ),
      )
    );
  }

  await assertRejects(() =>
    readLoginInputForTest(
      new Request("https://atmosphereaccount.com/oauth/login", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body:
          "handle=alice.example&action=account&action=admin&capability=identity",
      }),
    )
  );

  await assertRejects(() =>
    readLoginInputForTest(
      new Request(
        "https://atmosphereaccount.com/oauth/login?action=account&capability=identity",
        {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: "handle=alice.example&action=admin",
        },
      ),
    )
  );
});

Deno.test("non-persistent login selection requires a complete identity picker request", () => {
  const valid =
    "/login/select?client_id=https%3A%2F%2Fapp.example&return_uri=https%3A%2F%2Fapp.example%2Fcallback&state=opaque";
  assertEquals(
    isValidLoginSelectionContinuation(valid, null, null, ["identity"]),
    true,
  );
  assertEquals(
    isValidLoginSelectionContinuation("/login/select", null, null, [
      "identity",
    ]),
    false,
  );
  assertEquals(
    isValidLoginSelectionContinuation(valid, null, "app", ["app"]),
    false,
  );
  assertEquals(
    isValidLoginSelectionContinuation(valid, "project", null, ["identity"]),
    false,
  );
});

Deno.test("picker return paths cannot silently become persistent site grants", async () => {
  const picker =
    "%2Flogin%2Fselect%3Fclient_id%3Dhttps%253A%252F%252Fapp.example%26return_uri%3Dhttps%253A%252F%252Fapp.example%252Fcallback%26state%3Dopaque";
  await assertRejects(() =>
    readLoginInputForTest(
      new Request(
        `https://atmosphereaccount.com/oauth/login?handle=alice.example&next=${picker}&action=account&capability=identity`,
      ),
    ).then((input) => {
      if (
        hasValidLoginSelectionContinuationBinding(
          input.next,
          input.continuation,
          input.intent,
          input.action,
          input.capabilities ?? [],
        )
      ) return input;
      throw new Error("invalid continuation");
    })
  );
});

Deno.test("direct OAuth login failures never expose provider details", async () => {
  const plain = oauthLoginFailureResponse(false);
  assertEquals(plain.status, 400);
  assertEquals(
    await plain.text(),
    "Couldn’t start sign-in. Check the handle and try again.",
  );

  const json = oauthLoginFailureResponse(true);
  assertEquals(json.status, 400);
  assertEquals(await json.json(), {
    error: "Couldn’t start sign-in. Check the handle and try again.",
  });
});

Deno.test("alternate-account login retains chooser recovery intent", async () => {
  const input = await readLoginInputForTest(
    new Request("https://atmosphereaccount.com/oauth/login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        handle: "other.example",
        next: "/account",
        action: "account",
        capability: "identity",
        choose: "another",
      }),
    }),
  );

  assertEquals(input.chooseAnotherAccount, true);
});
