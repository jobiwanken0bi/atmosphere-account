import { assertEquals } from "jsr:@std/assert@1";
import type { AppListing } from "./app-directory.ts";
import { selectManagedApp } from "./managed-products.ts";

function app(
  id: string,
  slug: string,
  atstoreListingUri: string,
): AppListing {
  return {
    id,
    slug,
    canonicalUri: atstoreListingUri,
    atstoreListingUri,
  } as AppListing;
}

Deno.test("managed app selection supports multiple ATStore listings", () => {
  const first = app(
    "listing-one",
    "one.example",
    "at://did:plc:owner/fyi.atstore.app/one",
  );
  const second = app(
    "listing-two",
    "two.example",
    "at://did:plc:owner/fyi.atstore.app/two",
  );
  const apps = [first, second];

  assertEquals(selectManagedApp(apps, null)?.id, first.id);
  assertEquals(selectManagedApp(apps, second.id)?.id, second.id);
  assertEquals(selectManagedApp(apps, second.slug)?.id, second.id);
  assertEquals(
    selectManagedApp(apps, second.atstoreListingUri)?.id,
    second.id,
  );
  assertEquals(selectManagedApp(apps, "missing"), null);
});
