import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildSwitchReauthLocation,
  readSwitchAuthorizationInputForTest,
  readSwitchInputForTest,
} from "./switch.ts";

Deno.test("saved-account switch fallback can pin OAuth to the target DID", () => {
  assertEquals(
    buildSwitchReauthLocation("atmosphereaccount.com", "/account"),
    "/oauth/login?handle=atmosphereaccount.com&next=%2Faccount",
  );
  assertEquals(
    buildSwitchReauthLocation("sprk.so", null),
    "/oauth/login?handle=sprk.so",
  );
  assertEquals(
    buildSwitchReauthLocation("did:plc:expected", "/account"),
    "/oauth/login?handle=did%3Aplc%3Aexpected&next=%2Faccount",
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
    chooseAnotherAccount: false,
  });
});

Deno.test("relationship account switch preserves either-side approval context", async () => {
  const request = new Request(
    "https://atmosphereaccount.com/oauth/switch",
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams([
        ["did", "did:plc:host-owner"],
        ["next", "/relationships/confirm?host=pds.example&app=one"],
        ["capability", "identity"],
        ["action", "relationship_confirm"],
        ["name", "Example App and Example Host"],
      ]),
    },
  );

  assertEquals(await readSwitchAuthorizationInputForTest(request), {
    did: "did:plc:host-owner",
    next: "/relationships/confirm?host=pds.example&app=one",
    intent: null,
    capabilities: ["identity"],
    action: "relationship_confirm",
    targetName: "Example App and Example Host",
    chooseAnotherAccount: false,
  });
});

Deno.test("saved-account reauth retains alternate-account chooser intent", async () => {
  const request = new Request(
    "https://atmosphereaccount.com/oauth/switch",
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams([
        ["did", "did:plc:other"],
        ["next", "/account"],
        ["action", "account"],
        ["capability", "identity"],
        ["choose", "another"],
      ]),
    },
  );

  const input = await readSwitchAuthorizationInputForTest(request);
  assertEquals(input.chooseAnotherAccount, true);
  assertEquals(
    buildSwitchReauthLocation(
      "other.example",
      "/account",
      ["identity"],
      null,
      "account",
      null,
      true,
    ),
    "/oauth/login?handle=other.example&next=%2Faccount&action=account&choose=another&capability=identity",
  );
});

Deno.test("saved-account switch rejects ambiguous authorization context", async () => {
  for (
    const query of [
      "did=did%3Aplc%3Aone&did=did%3Aplc%3Atwo&capability=identity",
      "did=did%3Aplc%3Aone&action=typo&capability=identity",
      "did=did%3Aplc%3Aone&choose=typo&capability=identity",
      "did=did%3Aplc%3Aone&next=https%3A%2F%2Fevil.example&capability=identity",
    ]
  ) {
    await assertRejects(() =>
      readSwitchAuthorizationInputForTest(
        new Request(`https://atmosphereaccount.com/oauth/switch?${query}`, {
          method: "POST",
        }),
      )
    );
  }

  await assertRejects(() =>
    readSwitchAuthorizationInputForTest(
      new Request(
        "https://atmosphereaccount.com/oauth/switch?did=did%3Aplc%3Aone&action=account&capability=identity",
        {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: "action=admin",
        },
      ),
    )
  );
});
