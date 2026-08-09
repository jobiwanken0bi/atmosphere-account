import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  legacyProductsRedirectLocation,
  legacyProductsRedirectResponse,
} from "./products.tsx";

Deno.test("legacy products route permanently redirects to Apps and hosts", () => {
  const response = legacyProductsRedirectResponse(
    new URL("https://atmosphereaccount.com/account/products"),
  );
  assertEquals(response.status, 308);
  assertEquals(response.headers.get("location"), "/account/apps-hosts");
});

Deno.test("legacy products redirect preserves query parameters", () => {
  assertEquals(
    legacyProductsRedirectLocation(
      new URL(
        "https://atmosphereaccount.com/account/products?from=menu&saved=1",
      ),
    ),
    "/account/apps-hosts?from=menu&saved=1",
  );
});
