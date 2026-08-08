import { assertEquals } from "jsr:@std/assert@1";
import {
  parsePreviewActorForTest,
  searchPreviewActorsForTest,
} from "./preview.ts";

Deno.test("identity preview drops malformed identities and unsafe avatar URLs", () => {
  assertEquals(
    parsePreviewActorForTest({
      did: "not-a-did",
      handle: "valid.example",
    }),
    null,
  );
  const actor = parsePreviewActorForTest({
    did: "did:plc:test",
    handle: "User.Example",
    displayName: "x".repeat(300),
    avatar: "http://127.0.0.1/private",
  });
  assertEquals(actor?.handle, "user.example");
  assertEquals(actor?.displayName?.length, 256);
  assertEquals(actor?.avatarUrl, undefined);
});

Deno.test("identity preview refuses redirects and oversized search responses", async () => {
  const originalFetch = globalThis.fetch;
  try {
    let redirectMode = true;
    globalThis.fetch =
      ((_input: string | URL | Request, init?: RequestInit) => {
        if (init?.redirect !== "manual") {
          throw new Error("search request followed redirects");
        }
        return Promise.resolve(
          redirectMode
            ? new Response(null, { status: 302 })
            : Response.json({ actors: [], padding: "x".repeat(300_000) }),
        );
      }) as typeof fetch;

    for (const mode of [true, false]) {
      redirectMode = mode;
      let rejected = false;
      try {
        await searchPreviewActorsForTest("example");
      } catch {
        rejected = true;
      }
      assertEquals(rejected, true);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});
