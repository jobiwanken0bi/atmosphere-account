import {
  legacyHostClaimEdgeResponse,
  rejectLegacyHostClaimAction,
  stripLegacyHostClaimToken,
} from "./host-claim-legacy.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
  }
}

Deno.test("legacy email claim links are stripped before AppView proxying", async () => {
  const url = new URL(
    "https://atmosphereaccount.com/hosts/pds.example/claim?token=secret&publish=0",
  );
  const response = await legacyHostClaimEdgeResponse(url, new Request(url));
  assertEquals(response?.status, 303);
  assertEquals(
    response?.headers.get("location"),
    "/hosts/pds.example/claim?publish=0&legacy_email=1",
  );
  assertEquals(response?.headers.get("cache-control"), "no-store");
});

Deno.test("legacy email claim forms are rejected before AppView proxying", async () => {
  for (const action of ["request_email", "verify_email"]) {
    const url = new URL(
      "https://atmosphereaccount.com/hosts/pds.example/claim",
    );
    const response = await legacyHostClaimEdgeResponse(
      url,
      new Request(url, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ action }),
      }),
    );
    assertEquals(response?.status, 410);
    assertEquals(response?.headers.get("cache-control"), "no-store");
  }
});

Deno.test("current claim requests continue through the legacy edge gate", async () => {
  const url = new URL(
    "https://atmosphereaccount.com/hosts/pds.example/claim",
  );
  for (
    const action of [
      "request_dns",
      "verify_dns",
      "request_contact_email",
      "confirm_contact_email",
    ]
  ) {
    const response = await legacyHostClaimEdgeResponse(
      url,
      new Request(url, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ action }),
      }),
    );
    assertEquals(response, null);
    assertEquals(rejectLegacyHostClaimAction(action), null);
  }
  assertEquals(rejectLegacyHostClaimAction("verify_dns"), null);
  assertEquals(stripLegacyHostClaimToken(new URL(url)), null);
});
