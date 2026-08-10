import {
  appDetailBackNavigation,
  hostDetailHref,
  normalizeHostDirectoryReturnTo,
  relatedAppHrefFromHost,
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

Deno.test("related app links preserve an exact host-detail backlink", () => {
  const href = relatedAppHrefFromHost(
    "field-notes",
    "pds.example.com",
    "/hosts?q=example&page=2",
  );
  assertEquals(
    href,
    "/apps/field-notes?from=%2Fhosts%2Fpds.example.com%3Ffrom%3D%252Fhosts%253Fq%253Dexample%2526page%253D2",
  );
  assertEquals(
    appDetailBackNavigation(
      new URL(href, RETURN_BASE_FOR_TEST).searchParams.get("from"),
    ),
    {
      href: "/hosts/pds.example.com?from=%2Fhosts%3Fq%3Dexample%26page%3D2",
      label: "Back to host",
    },
  );
});

Deno.test("app backlinks reject non-host and privileged host routes", () => {
  for (
    const unsafe of [
      "https://evil.example/hosts/pds.example.com",
      "//evil.example/hosts/pds.example.com",
      "/hosts/pds.example.com/claim",
      "/hosts/pds.example.com/manage",
      "/hosts",
      "/apps/example",
      "/hosts/not-a-host",
    ]
  ) {
    assertEquals(appDetailBackNavigation(unsafe), {
      href: "/apps",
      label: "Back to apps",
    });
  }
});

const RETURN_BASE_FOR_TEST = "https://atmosphere.invalid";
