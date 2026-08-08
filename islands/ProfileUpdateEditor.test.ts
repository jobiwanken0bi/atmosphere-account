import { oauthReauthorizationUrl } from "../lib/oauth-action.ts";
import { profileUpdateReauthorization } from "./ProfileUpdateEditor.tsx";

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

Deno.test("profile updates open validated contextual reauthorization", () => {
  const reauthUrl = oauthReauthorizationUrl({
    next: "/apps/manage?app=grain.social",
    action: "app",
    capabilities: ["app"],
    name: "Grain",
  });
  const authorization = profileUpdateReauthorization(
    { error: "reauth_required", reauthUrl },
    "grain.social",
  );
  assertEquals(authorization?.fallbackHref, reauthUrl);
  assertEquals(authorization?.returnTo, "/apps/manage?app=grain.social");
  assertEquals(authorization?.action, "app");
  assertEquals(authorization?.capabilities, ["app"]);
});

Deno.test("expired profile update sessions get a safe local modal fallback", () => {
  const authorization = profileUpdateReauthorization(
    { error: "not_authenticated" },
    "grain.social",
  );
  assertEquals(authorization?.returnTo, "/apps/manage");
  assertEquals(authorization?.targetName, "grain.social");
  assertEquals(authorization?.capabilities, ["app"]);
});

Deno.test("profile updates reject untrusted reauthorization payloads", () => {
  assertEquals(
    profileUpdateReauthorization(
      {
        error: "reauth_required",
        reauthUrl:
          "https://evil.example/signin?next=/apps/manage&permission=required&action=app&capability=app",
      },
      "grain.social",
    ),
    null,
  );
  assertEquals(
    profileUpdateReauthorization({ error: "project_required" }, "grain.social"),
    null,
  );
});
