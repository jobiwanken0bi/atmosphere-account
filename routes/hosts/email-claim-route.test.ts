import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { captureHostClaimEmailToken } from "./[host]/claim.tsx";

Deno.test("new email proof links are captured without inspecting or exposing the token", () => {
  const token = "a".repeat(43);
  const response = captureHostClaimEmailToken(
    new URL(
      `https://atmosphereaccount.com/hosts/pds.example/claim?publish=0&from=detected&email_token=${token}`,
    ),
    "pds.example",
  );

  assert(response);
  assertEquals(response.status, 303);
  assertEquals(
    response.headers.get("location"),
    "/hosts/pds.example/claim?publish=0&from=detected",
  );
  assertEquals(response.headers.get("cache-control"), "no-store");
  assertEquals(response.headers.get("referrer-policy"), "no-referrer");
  assertEquals(response.headers.get("x-robots-tag"), "noindex, nofollow");
  const cookie = response.headers.get("set-cookie") ?? "";
  assertStringIncludes(cookie, "atmo_host_claim_email_token=");
  assertStringIncludes(cookie, "Path=/hosts/pds.example/claim");
  assertStringIncludes(cookie, "HttpOnly");
  assertStringIncludes(cookie, "SameSite=Lax");
  assertEquals(cookie.includes(token), true);
  assertEquals((response.headers.get("location") ?? "").includes(token), false);
});

Deno.test("legacy generic tokens are never reinterpreted as v2 email proofs", () => {
  const url = new URL(
    `https://atmosphereaccount.com/hosts/pds.example/claim?token=${
      "a".repeat(43)
    }`,
  );
  assertEquals(captureHostClaimEmailToken(url, "pds.example"), null);
});

Deno.test("malformed email proof links are still stripped before rendering", () => {
  const response = captureHostClaimEmailToken(
    new URL(
      "https://atmosphereaccount.com/hosts/pds.example/claim?email_token=not-valid&publish=1",
    ),
    "pds.example",
  );
  assert(response);
  assertEquals(
    response.headers.get("location"),
    "/hosts/pds.example/claim?publish=1",
  );
  assertEquals(
    (response.headers.get("set-cookie") ?? "").includes("not-valid"),
    false,
  );
});

Deno.test("contact-email route operations use only the guarded dev fixture seam", async () => {
  const source = await Deno.readTextFile(
    new URL("./[host]/claim.tsx", import.meta.url),
  );
  for (
    const operation of [
      "getHostContactEmailAvailability",
      "requestHostContactEmailChallenge",
      "inspectHostContactEmailChallenge",
      "prepareHostContactEmailChallenge",
      "notifyHostContactEmailOfDnsRecovery",
    ]
  ) {
    assertStringIncludes(source, operation);
  }
  assertEquals(
    source.match(/devHostClaimEmailOptions\(host\.host\)/g)?.length,
    5,
  );
});
