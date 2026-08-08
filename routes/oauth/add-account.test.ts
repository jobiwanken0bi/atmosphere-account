import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  addAccountSigninLocation,
  handleAddAccountRequest,
} from "./add-account.ts";

Deno.test("add-account keeps complete project authorization context", () => {
  assertEquals(
    addAccountSigninLocation({
      next: "/apps/manage?new=1&source=directory#profile",
      intent: "project",
      action: "app",
      targetName: "Example App",
      capabilities: ["app", "media"],
    }),
    "/signin?next=%2Fapps%2Fmanage%3Fnew%3D1%26source%3Ddirectory%23profile&intent=project&action=app&name=Example+App&capability=app&capability=media",
  );
});

Deno.test("add-account defaults remain explicit identity authorization", () => {
  assertEquals(
    addAccountSigninLocation({
      next: null,
      intent: null,
      action: null,
      targetName: null,
      capabilities: ["identity"],
    }),
    "/signin?capability=identity",
  );
});

Deno.test("add-account preserves nonpersistent picker continuation", () => {
  const next =
    "/login/select?client_id=https%3A%2F%2Fapp.example&return_uri=https%3A%2F%2Fapp.example%2Fcallback&state=opaque";
  const location = addAccountSigninLocation({
    next,
    intent: null,
    action: "account",
    targetName: null,
    capabilities: ["identity"],
    continuation: "login_selection",
  });
  const url = new URL(location, "https://atmosphereaccount.com");
  assertEquals(url.searchParams.get("next"), next);
  assertEquals(url.searchParams.get("continuation"), "login_selection");
});

Deno.test("add-account location rejects a mismatched action bundle", () => {
  assertThrows(
    () =>
      addAccountSigninLocation({
        next: "/apps/manage",
        intent: null,
        action: "review",
        targetName: null,
        capabilities: ["app"],
      }),
    TypeError,
    "invalid action capability combination",
  );
});

Deno.test("GET add-account is a side-effect-free contextual confirmation", async () => {
  const url = new URL(
    "https://atmosphereaccount.com/oauth/add-account?next=%2Frelationships%2Fconfirm%3Fhost%3Dpds.example%26app%3Done&action=relationship_confirm&name=Example+and+pds.example&capability=identity",
  );
  const response = await handleAddAccountRequest({
    req: new Request(url),
    url,
  });

  assertEquals(response.status, 303);
  const location = new URL(
    response.headers.get("location") ?? "",
    url.origin,
  );
  assertEquals(location.pathname, "/signin");
  assertEquals(location.searchParams.get("permission"), "required");
  assertEquals(location.searchParams.get("choose"), "another");
  assertEquals(location.searchParams.get("action"), "relationship_confirm");
  assertEquals(location.searchParams.get("name"), "Example and pds.example");
  assertEquals(location.searchParams.getAll("capability"), ["identity"]);
  assertEquals(response.headers.get("set-cookie"), null);
});

Deno.test("POST add-account keeps the current session until OAuth succeeds", async () => {
  const url = new URL("https://atmosphereaccount.com/oauth/add-account");
  const body = new URLSearchParams({
    next: "/account",
    action: "account",
    capability: "identity",
  });
  const response = await handleAddAccountRequest({
    req: new Request(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    }),
    url,
  });

  assertEquals(response.status, 303);
  const location = new URL(
    response.headers.get("location") ?? "",
    url.origin,
  );
  assertEquals(location.pathname, "/signin");
  assertEquals(location.searchParams.get("permission"), "required");
  assertEquals(location.searchParams.get("choose"), "another");
  assertEquals(response.headers.get("set-cookie"), null);
});

Deno.test("add-account fails closed on duplicate or malformed auth context", async () => {
  for (
    const query of [
      "action=account&action=admin&capability=identity",
      "intent=typo&capability=identity",
      "next=https%3A%2F%2Fevil.example&capability=identity",
      "capability=",
    ]
  ) {
    const url = new URL(
      `https://atmosphereaccount.com/oauth/add-account?${query}`,
    );
    const response = await handleAddAccountRequest({
      req: new Request(url),
      url,
    });
    assertEquals(response.status, 400);
  }

  const url = new URL("https://atmosphereaccount.com/oauth/add-account");
  const response = await handleAddAccountRequest({
    req: new Request(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "action=account&action=admin&capability=identity",
    }),
    url,
  });
  assertEquals(response.status, 400);

  const mixedUrl = new URL(
    "https://atmosphereaccount.com/oauth/add-account?action=account&capability=identity",
  );
  const mixedResponse = await handleAddAccountRequest({
    req: new Request(mixedUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "action=admin",
    }),
    url: mixedUrl,
  });
  assertEquals(mixedResponse.status, 400);
});
