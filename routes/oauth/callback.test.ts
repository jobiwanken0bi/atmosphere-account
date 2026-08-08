import {
  assertEquals,
  assertThrows,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  oauthCompletedFailureLocation,
  oauthErrorPermission,
  oauthRetryLocation,
  readOAuthCallbackParameters,
} from "./callback.ts";

Deno.test("post-callback failures retain the validated action context", () => {
  const location = new URL(
    oauthCompletedFailureLocation({
      returnTo: "/apps/example?review=compose",
      capabilities: ["review"],
      action: "review",
      targetName: "Example",
      handle: "alice.example",
    }),
    "https://atmosphereaccount.com",
  );
  assertEquals(location.pathname, "/signin");
  assertEquals(
    location.searchParams.get("next"),
    "/apps/example?review=compose",
  );
  assertEquals(location.searchParams.get("permission"), "failed");
  assertEquals(location.searchParams.get("action"), "review");
  assertEquals(location.searchParams.getAll("capability"), ["review"]);
  assertEquals(location.searchParams.get("handle"), "alice.example");
  assertEquals(location.searchParams.get("choose"), "another");

  assertEquals(
    oauthCompletedFailureLocation({
      returnTo:
        "/login/select?client_id=https%3A%2F%2Fapp.example&return_uri=https%3A%2F%2Fapp.example%2Fcallback&state=opaque",
      continuation: "login_selection",
    }),
    "/login/select?client_id=https%3A%2F%2Fapp.example&return_uri=https%3A%2F%2Fapp.example%2Fcallback&state=opaque",
  );
});

Deno.test("denied OAuth retries preserve complete contextual intent", () => {
  const url = new URL(
    oauthRetryLocation({
      next: "/apps/manage?new=1#profile",
      permission: "denied",
      capabilities: ["app", "media"],
      intent: "project",
      action: "app",
      targetName: "Example App",
      handle: "app.example",
      mode: "create",
      chooseAnotherAccount: true,
    }),
    "https://atmosphereaccount.com",
  );
  assertEquals(url.pathname, "/signin");
  assertEquals(url.searchParams.get("next"), "/apps/manage?new=1#profile");
  assertEquals(url.searchParams.get("permission"), "denied");
  assertEquals(url.searchParams.get("intent"), "project");
  assertEquals(url.searchParams.get("action"), "app");
  assertEquals(url.searchParams.get("name"), "Example App");
  assertEquals(url.searchParams.get("handle"), "app.example");
  assertEquals(url.searchParams.get("mode"), "create");
  assertEquals(url.searchParams.get("choose"), "another");
  assertEquals(url.searchParams.getAll("capability"), ["app", "media"]);
});

Deno.test("OAuth provider errors use plain-language recovery states", () => {
  assertEquals(oauthErrorPermission("access_denied"), "denied");
  assertEquals(oauthErrorPermission("user_cancelled"), "denied");
  assertEquals(oauthErrorPermission("server_error"), "failed");
});

Deno.test("partial and concurrent retries preserve identity-only context", () => {
  for (const permission of ["partial", "concurrent"] as const) {
    const url = new URL(
      oauthRetryLocation({
        next: "/relationships/confirm?host=pds.example&app=one",
        permission,
        capabilities: ["identity"],
        action: "relationship_confirm",
        targetName: "one and pds.example",
        handle: "owner.example",
      }),
      "https://atmosphereaccount.com",
    );
    assertEquals(url.searchParams.get("permission"), permission);
    assertEquals(url.searchParams.get("action"), "relationship_confirm");
    assertEquals(url.searchParams.getAll("capability"), ["identity"]);
  }
});

Deno.test("partial and concurrent account creation recover in create mode", () => {
  for (const permission of ["partial", "concurrent"] as const) {
    const url = new URL(
      oauthRetryLocation({
        next: "/apps/manage?new=1",
        permission,
        capabilities: ["app"],
        intent: "project",
        mode: "create",
        action: "app",
        targetName: "Example App",
        handle: "new-app.example",
      }),
      "https://atmosphereaccount.com",
    );
    assertEquals(url.searchParams.get("permission"), permission);
    assertEquals(url.searchParams.get("mode"), "create");
    assertEquals(url.searchParams.get("handle"), "new-app.example");
    assertEquals(url.searchParams.get("action"), "app");
  }
});

Deno.test("OAuth callback rejects duplicate or contradictory protocol fields", () => {
  assertEquals(
    readOAuthCallbackParameters(
      new URL(
        "https://atmosphereaccount.com/oauth/callback?state=one&code=code&iss=https%3A%2F%2Fauth.example",
      ),
    ),
    {
      state: "one",
      code: "code",
      iss: "https://auth.example",
      error: null,
    },
  );
  for (
    const query of [
      "state=one&state=two&error=access_denied",
      "state=one&code=code&error=access_denied",
      "state=one&code=one&code=two&iss=https%3A%2F%2Fauth.example",
    ]
  ) {
    assertThrows(() =>
      readOAuthCallbackParameters(
        new URL(`https://atmosphereaccount.com/oauth/callback?${query}`),
      )
    );
  }
});
