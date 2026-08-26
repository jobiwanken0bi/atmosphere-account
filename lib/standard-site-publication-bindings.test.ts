import { assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { claimStandardSitePublicationBinding } from "./standard-site-publication-bindings.ts";
import {
  createStandardSiteRkey,
  standardSitePublicationUri,
} from "./standard-site-updates.ts";

Deno.test("publication bindings reject another repository before touching the database", async () => {
  const productDid = "did:plc:standardsiteproduct";
  const rkey = createStandardSiteRkey(1_900_000_000_006);
  await assertRejects(
    () =>
      claimStandardSitePublicationBinding({
        appListingId: "7a449f77-349c-4b26-98af-a01ec51edafd",
        productDid,
        publicationUrl: "https://atmosphereaccount.com/apps/product",
        publicationUri: standardSitePublicationUri("did:plc:victim", rkey),
      }),
    Error,
    "invalid Standard.site publication binding",
  );
});
