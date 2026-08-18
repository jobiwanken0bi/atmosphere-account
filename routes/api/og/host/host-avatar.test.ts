import { resolveAvatarFetchUrlForTest } from "./[host].ts";

function assertEquals(actual: string, expected: string): void {
  if (actual !== expected) {
    throw new Error(`Expected ${expected}, received ${actual}`);
  }
}

Deno.test("host cards fetch AT Protocol avatars directly from appview", () => {
  const source =
    "/api/atproto/blob?did=did%3Aplc%3Aexample&cid=bafyexample&w=320";
  assertEquals(
    resolveAvatarFetchUrlForTest(
      source,
      "https://atmosphereaccount.com",
      "https://web-production.example",
    ),
    `https://web-production.example${source}`,
  );
});

Deno.test("host cards preserve external avatar URLs", () => {
  const source = "https://cdn.bsky.app/img/avatar/plain/did/cid";
  assertEquals(
    resolveAvatarFetchUrlForTest(
      source,
      "https://atmosphereaccount.com",
      "https://web-production.example",
    ),
    source,
  );
});
