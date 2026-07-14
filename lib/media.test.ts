import { appImageUrl } from "./media.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
  }
}

Deno.test("AT Protocol app images request resized immutable variants", () => {
  assertEquals(
    appImageUrl(
      "/api/atproto/blob?did=did%3Aplc%3Aapp&cid=bafyhero",
      "media",
      800,
    ),
    "/api/atproto/blob?did=did%3Aplc%3Aapp&cid=bafyhero&w=800",
  );
});

Deno.test("AT Protocol app images preserve a migrated-source fallback", () => {
  assertEquals(
    appImageUrl(
      "/api/atproto/blob?did=did%3Aplc%3Aapp&cid=bafycurrent",
      "media",
      1200,
      "/api/atproto/blob?did=did%3Aplc%3Astore&cid=bafyolder",
    ),
    "/api/atproto/blob?did=did%3Aplc%3Aapp&cid=bafycurrent&w=1200&fallbackDid=did%3Aplc%3Astore&fallbackCid=bafyolder",
  );
});
