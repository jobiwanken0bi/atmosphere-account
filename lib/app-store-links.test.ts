import {
  appStorePlatformForUrl,
  normalizeAppStoreLinks,
} from "./app-store-links.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`Expected ${e}, got ${a}`);
}

Deno.test("appStorePlatformForUrl recognizes official store destinations", () => {
  assertEquals(
    appStorePlatformForUrl("https://apps.apple.com/us/app/example/id123"),
    "ios",
  );
  assertEquals(
    appStorePlatformForUrl(
      "https://play.google.com/store/apps/details?id=example",
    ),
    "android",
  );
  assertEquals(appStorePlatformForUrl("https://example.com/download"), null);
});

Deno.test("normalizeAppStoreLinks corrects crossed official store URLs", () => {
  assertEquals(
    normalizeAppStoreLinks({
      iosLink: "https://play.google.com/store/apps/details?id=example",
      androidLink: "https://apps.apple.com/us/app/example/id123",
    }),
    {
      iosLink: "https://apps.apple.com/us/app/example/id123",
      androidLink: "https://play.google.com/store/apps/details?id=example",
    },
  );
});

Deno.test("normalizeAppStoreLinks preserves non-store destinations", () => {
  assertEquals(
    normalizeAppStoreLinks({
      iosLink: "https://example.com/iphone",
      androidLink: "https://example.com/android",
    }),
    {
      iosLink: "https://example.com/iphone",
      androidLink: "https://example.com/android",
    },
  );
});
