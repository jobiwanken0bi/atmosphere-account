import {
  collectionFallbackLabel,
  isCollectionNsid,
  parseCollectionRoles,
} from "./collection-catalog.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  const left = JSON.stringify(actual);
  const right = JSON.stringify(expected);
  if (left !== right) throw new Error(`Expected ${right}, got ${left}`);
}

Deno.test("collection catalog parses and trims declared read/write roles", () => {
  assertEquals(
    parseCollectionRoles(JSON.stringify({
      produces: ["com.example.notes.entry", "  ", 42],
      consumes: ["app.bsky.feed.post", " app.bsky.actor.profile "],
    })),
    {
      produces: ["com.example.notes.entry"],
      consumes: ["app.bsky.feed.post", "app.bsky.actor.profile"],
    },
  );
});

Deno.test("collection catalog tolerates malformed declarations", () => {
  assertEquals(parseCollectionRoles("not-json"), {
    produces: [],
    consumes: [],
  });
});

Deno.test("collection catalog accepts official camelCase collection NSIDs", () => {
  assertEquals(isCollectionNsid("com.example.fooBar"), true);
  assertEquals(
    isCollectionNsid("community.lexicon.calendar.eventParticipation"),
    true,
  );
  assertEquals(isCollectionNsid("a.b.c"), true);
});

Deno.test("collection catalog rejects non-collection NSIDs and globs", () => {
  assertEquals(isCollectionNsid("com.example"), false);
  assertEquals(isCollectionNsid("com.example.3thing"), false);
  assertEquals(isCollectionNsid("com.example.foo-bar"), false);
  assertEquals(isCollectionNsid("com.example.*"), false);
  assertEquals(isCollectionNsid(`com.example.${"a".repeat(257)}`), false);
});

Deno.test("collection catalog makes camelCase labels readable", () => {
  assertEquals(
    collectionFallbackLabel("com.example.eventParticipation"),
    "Event Participation",
  );
});
