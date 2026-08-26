import { oauthReauthorizationUrl } from "../lib/oauth-action.ts";
import {
  armProfileUpdateResume,
  profileUpdateReauthorization,
} from "./ProfileUpdateEditor.tsx";

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
    action: "app_updates",
    capabilities: ["app_updates"],
    name: "Grain",
  });
  const authorization = profileUpdateReauthorization(
    { error: "reauth_required", reauthUrl },
    "grain.social",
    "did:plc:grain",
    "grain.social",
    "save",
  );
  assertEquals(
    authorization?.returnTo,
    "/apps/manage?app=grain.social&profile-update-resume=did%3Aplc%3Agrain",
  );
  assertEquals(
    new URL(authorization?.fallbackHref ?? "", "https://example.test")
      .searchParams.get("next"),
    authorization?.returnTo,
  );
  assertEquals(authorization?.action, "app_updates");
  assertEquals(authorization?.capabilities, ["app_updates"]);
});

Deno.test("expired profile update sessions get a safe local modal fallback", () => {
  const authorization = profileUpdateReauthorization(
    { error: "not_authenticated" },
    "grain.social",
    "did:plc:grain",
    "grain.social",
    "delete",
  );
  assertEquals(
    authorization?.returnTo,
    "/apps/manage?app=grain.social&profile-update-delete-resume=did%3Aplc%3Agrain",
  );
  assertEquals(authorization?.targetName, "grain.social");
  assertEquals(authorization?.capabilities, ["app_updates"]);
});

Deno.test("profile updates reject untrusted reauthorization payloads", () => {
  assertEquals(
    profileUpdateReauthorization(
      {
        error: "reauth_required",
        reauthUrl:
          "https://evil.example/signin?next=/apps/manage&permission=required&action=app_updates&capability=app_updates",
      },
      "grain.social",
      "did:plc:grain",
      "grain.social",
      "save",
    ),
    null,
  );
  assertEquals(
    profileUpdateReauthorization(
      { error: "project_required" },
      "grain.social",
      "did:plc:grain",
      "grain.social",
      "save",
    ),
    null,
  );
});

Deno.test("profile update resume proof is armed only when authorization starts", () => {
  const values = new Map<string, string>();
  assertEquals(
    armProfileUpdateResume("profile-update-proof", {
      setItem(key, value) {
        values.set(key, value);
      },
    }),
    true,
  );
  assertEquals(values.has("profile-update-proof"), true);
  assertEquals(
    armProfileUpdateResume("blocked", {
      setItem() {
        throw new Error("blocked");
      },
    }),
    false,
  );
});
