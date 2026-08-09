import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  developerAppAccessRedirect,
  developerAppAccessRedirectForCount,
} from "./developer-app-access.ts";

Deno.test("developer settings admit exactly one managed app", async () => {
  const response = await developerAppAccessRedirect(
    "did:plc:app",
    () => Promise.resolve([{}]),
  );
  assertEquals(response, null);
});

Deno.test("regular and host-only accounts return to the Apps directory", () => {
  const response = developerAppAccessRedirectForCount(0);
  assertEquals(response.status, 303);
  assertEquals(response.headers.get("location"), "/apps");
  assertEquals(response.headers.get("cache-control"), "no-store");
});

Deno.test("ambiguous legacy app portfolios return to Apps and hosts", () => {
  const response = developerAppAccessRedirectForCount(2);
  assertEquals(response.status, 303);
  assertEquals(response.headers.get("location"), "/account/apps-hosts");
  assertEquals(response.headers.get("cache-control"), "no-store");
});

Deno.test("developer access lookup fails closed instead of misrouting", async () => {
  await assertRejects(
    () =>
      developerAppAccessRedirect(
        "did:plc:app",
        () => Promise.reject(new Error("directory unavailable")),
      ),
    Error,
    "directory unavailable",
  );
});
