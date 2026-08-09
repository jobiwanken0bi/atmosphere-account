import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { oauthCancellationRedirect } from "./callback.ts";

Deno.test("cancelled account creation returns to the canonical create page", () => {
  const href = oauthCancellationRedirect({
    returnTo: "/apps/tangled?review=compose",
    intent: "user",
    prompt: "create",
    capabilities: ["review"],
    action: "review",
    targetName: "Tangled",
  });
  const url = new URL(href, "https://atmosphereaccount.com");
  assertEquals(url.pathname, "/signin");
  assertEquals(url.searchParams.get("mode"), "create");
  assertEquals(url.searchParams.get("create_error"), "authorization_cancelled");
  assertEquals(url.searchParams.get("next"), "/apps/tangled?review=compose");
  assertEquals(url.searchParams.get("action"), "review");
  assertEquals(url.searchParams.get("intent"), "user");
  assertEquals(url.searchParams.get("name"), "Tangled");
  assertEquals(url.searchParams.getAll("capability"), ["review"]);
});

Deno.test("cancelled picker login returns with a visible safe error", () => {
  const href = oauthCancellationRedirect({
    returnTo:
      "/login/select?client_id=https%3A%2F%2Fapp.example%2Fclient.json&return_uri=https%3A%2F%2Fapp.example%2Fcallback&state=opaque#resume",
    continuation: "login_selection",
    capabilities: ["identity"],
    action: "account",
    handle: "alice.example",
  });
  const url = new URL(href, "https://login.atmosphereaccount.com");
  assertEquals(url.pathname, "/login/select");
  assertEquals(
    url.searchParams.get("client_id"),
    "https://app.example/client.json",
  );
  assertEquals(url.searchParams.get("state"), "opaque");
  assertEquals(url.searchParams.get("login_error"), "authorization_cancelled");
  assertEquals(url.hash, "#resume");
});

Deno.test("ordinary cancellation preserves action context on sign-in retry", () => {
  const href = oauthCancellationRedirect({
    returnTo: "/hosts/example.com/claim",
    intent: "project",
    capabilities: ["host", "media"],
    action: "host_claim",
    targetName: "Example Host",
    handle: "operator.example",
  });
  const url = new URL(href, "https://atmosphereaccount.com");
  assertEquals(url.pathname, "/signin");
  assertEquals(url.searchParams.get("permission"), "denied");
  assertEquals(url.searchParams.get("next"), "/hosts/example.com/claim");
  assertEquals(url.searchParams.get("action"), "host_claim");
  assertEquals(url.searchParams.get("intent"), "project");
  assertEquals(url.searchParams.get("name"), "Example Host");
  assertEquals(url.searchParams.get("handle"), "operator.example");
  assertEquals(url.searchParams.getAll("capability"), ["host", "media"]);
});

Deno.test("OAuth callback failures do not disclose raw exception details", async () => {
  const source = await Deno.readTextFile(
    new URL("./callback.ts", import.meta.url),
  );
  assertEquals(source.includes("callback failed: ${message}"), false);
  assertEquals(source.includes('proxy failed:", err'), false);
});
