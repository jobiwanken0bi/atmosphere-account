import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  currentOAuthGrantContext,
  withOAuthGrantContext,
} from "./oauth-grant-context.ts";
import { requestedGrantIdForTest } from "./oauth.ts";

Deno.test("OAuth grant context remains isolated across concurrent requests", async () => {
  const seen = await Promise.all([
    withOAuthGrantContext(
      { appSessionId: "session-a", grantId: "grant-a" },
      async () => {
        await Promise.resolve();
        return [
          currentOAuthGrantContext()?.appSessionId,
          requestedGrantIdForTest(),
        ];
      },
    ),
    withOAuthGrantContext(
      { appSessionId: "session-b", grantId: "grant-b" },
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
        return [
          currentOAuthGrantContext()?.appSessionId,
          requestedGrantIdForTest(),
        ];
      },
    ),
  ]);
  assertEquals(seen, [
    ["session-a", "grant-a"],
    ["session-b", "grant-b"],
  ]);
  assertEquals(currentOAuthGrantContext(), null);
});

Deno.test("an explicit trusted grant overrides the active request grant", () => {
  withOAuthGrantContext(
    { appSessionId: "session-a", grantId: "grant-a" },
    () =>
      assertEquals(requestedGrantIdForTest({ grantId: "grant-b" }), "grant-b"),
  );
});
