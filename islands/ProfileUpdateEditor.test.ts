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
    action: "app",
    capabilities: ["app", "media"],
    name: "Grain",
  });
  const authorization = profileUpdateReauthorization(
    { error: "reauth_required", reauthUrl },
    "grain.social",
    "did:plc:grain",
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
  assertEquals(authorization?.action, "app");
  assertEquals(authorization?.capabilities, ["app", "media"]);
});

Deno.test("expired profile update sessions get a safe local modal fallback", () => {
  const authorization = profileUpdateReauthorization(
    { error: "not_authenticated" },
    "grain.social",
    "did:plc:grain",
    "delete",
  );
  assertEquals(
    authorization?.returnTo,
    "/apps/manage?profile-update-delete-resume=did%3Aplc%3Agrain",
  );
  assertEquals(authorization?.targetName, "grain.social");
  assertEquals(authorization?.capabilities, ["app", "media"]);
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
      "did:plc:grain",
      "save",
    ),
    null,
  );
  assertEquals(
    profileUpdateReauthorization(
      { error: "project_required" },
      "grain.social",
      "did:plc:grain",
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
