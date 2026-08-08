import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  adminAuthorizationHref,
  developerAuthorizationHref,
  relationshipConfirmationAuthorizationHref,
} from "./oauth-entry-context.ts";

Deno.test("developer authorization keeps the complete safe return path", () => {
  assertEquals(
    developerAuthorizationHref(
      new URL("https://atmosphereaccount.com/account/developer/apps?new=1"),
    ),
    "/signin?next=%2Faccount%2Fdeveloper%2Fapps%3Fnew%3D1&action=developer&capability=identity",
  );
});

Deno.test("relationship confirmation uses resolved names instead of its opaque app id", () => {
  const href = relationshipConfirmationAuthorizationHref(
    new URL(
      "https://atmosphereaccount.com/relationships/confirm?host=pds.example&app=418ac793-3448-41c4-a28a-d42a8e202ac9",
    ),
    { appName: "Example App", hostName: "Example Host" },
  );
  const url = new URL(href, "https://atmosphereaccount.com");
  assertEquals(url.pathname, "/signin");
  assertEquals(
    url.searchParams.get("next"),
    "/relationships/confirm?host=pds.example&app=418ac793-3448-41c4-a28a-d42a8e202ac9",
  );
  assertEquals(url.searchParams.get("action"), "relationship_confirm");
  assertEquals(url.searchParams.get("name"), "Example App and Example Host");
  assertEquals(url.searchParams.getAll("capability"), ["identity"]);
});

Deno.test("admin authorization uses the contextual identity picker", () => {
  assertEquals(
    adminAuthorizationHref(
      new URL("https://atmosphereaccount.com/admin/reviews?status=open"),
    ),
    "/signin?next=%2Fadmin%2Freviews%3Fstatus%3Dopen&action=admin&capability=identity",
  );
});
