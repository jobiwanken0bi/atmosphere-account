import {
  hostDetailHref,
  normalizeHostDirectoryReturnTo,
} from "./host-directory-navigation.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`Expected ${e}, got ${a}`);
}

Deno.test("host detail links preserve the current directory state", () => {
  assertEquals(
    hostDetailHref(
      "roomy.chat",
      "/hosts?q=roomy&sort=accounts&signup=open&page=3",
    ),
    "/hosts/roomy.chat?from=%2Fhosts%3Fq%3Droomy%26sort%3Daccounts%26signup%3Dopen%26page%3D3",
  );
  assertEquals(hostDetailHref("roomy.chat", "/hosts"), "/hosts/roomy.chat");
});

Deno.test("host directory return targets cannot leave the directory", () => {
  for (
    const unsafe of [
      "https://example.com/hosts?page=2",
      "//example.com/hosts?page=2",
      "/hosts/roomy.chat",
      "/apps?page=2",
      "not a URL",
    ]
  ) {
    assertEquals(normalizeHostDirectoryReturnTo(unsafe), "/hosts");
  }
  assertEquals(
    normalizeHostDirectoryReturnTo("/hosts?page=2#ignored"),
    "/hosts?page=2",
  );
});
