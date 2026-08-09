import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildSwitchReauthLocation,
  readSwitchAuthorizationInputForTest,
  readSwitchInputForTest,
} from "./switch.ts";
import { RequestBodyTooLargeError } from "../../lib/security.ts";

Deno.test("saved-account switch fallback starts OAuth for the target handle", () => {
  assertEquals(
    buildSwitchReauthLocation("atmosphereaccount.com", "/account"),
    "/oauth/login?handle=atmosphereaccount.com&next=%2Faccount",
  );
  assertEquals(
    buildSwitchReauthLocation("sprk.so", null),
    "/oauth/login?handle=sprk.so",
  );
  assertEquals(
    buildSwitchReauthLocation(
      "project.example",
      "/apps/create?new=1",
      ["app", "media"],
      "project",
      "app",
    ),
    "/oauth/login?handle=project.example&next=%2Fapps%2Fcreate%3Fnew%3D1&intent=project&action=app&capability=app&capability=media",
  );
});

Deno.test("saved-account switch accepts a bodyless POST query handoff", async () => {
  const request = new Request(
    "https://atmosphereaccount.com/oauth/switch?did=did%3Aplc%3Atest&next=%2Faccount",
    { method: "POST" },
  );
  assertEquals(await readSwitchInputForTest(request), {
    did: "did:plc:test",
    next: "/account",
  });
});

Deno.test("saved-account switch preserves action capabilities and project intent", async () => {
  const request = new Request(
    "https://atmosphereaccount.com/oauth/switch",
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams([
        ["did", "did:plc:project"],
        ["next", "/apps/create?new=1"],
        ["intent", "project"],
        ["capability", "app"],
        ["capability", "media"],
        ["action", "app"],
        ["name", "Example App"],
      ]),
    },
  );
  assertEquals(await readSwitchAuthorizationInputForTest(request), {
    did: "did:plc:project",
    next: "/apps/create?new=1",
    intent: "project",
    capabilities: ["app", "media"],
    action: "app",
    targetName: "Example App",
  });
});

Deno.test("saved-account switch rejects an oversized streamed body", async () => {
  const request = new Request(
    "https://atmosphereaccount.com/oauth/switch",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"did":"did:plc:'));
          controller.enqueue(new Uint8Array(8_192));
          controller.enqueue(new TextEncoder().encode('"}'));
          controller.close();
        },
      }),
    },
  );
  let tooLarge = false;
  try {
    await readSwitchAuthorizationInputForTest(request);
  } catch (error) {
    tooLarge = error instanceof RequestBodyTooLargeError;
  }
  assertEquals(tooLarge, true);
});
