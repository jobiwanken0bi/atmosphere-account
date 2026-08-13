import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  captureHostClaimEmailToken,
  completedHostContactEmailClaimResponse,
  submitHostContactEmailClaim,
} from "./[host]/claim.tsx";
import { listSeededAccountHostFallback } from "../../lib/account-hosts.ts";

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
    source.match(/devHostClaimEmailOptions\((?:input\.)?host\.host\)/g)?.length,
    5,
  );
});

Deno.test("recovery warnings retry transient delivery failures but not unavailable evidence", async () => {
  const source = await Deno.readTextFile(
    new URL("./[host]/claim.tsx", import.meta.url),
  );
  const branch = source.slice(
    source.indexOf('result.reason === "recovery_pending"'),
    source.indexOf(
      "const dnsFailure",
      source.indexOf(
        'result.reason === "recovery_pending"',
      ),
    ),
  );
  assertStringIncludes(
    branch,
    'result.recovery.notificationStatus === "pending"',
  );
  assertStringIncludes(
    branch,
    'result.recovery.notificationStatus === "failed"',
  );
  assertEquals(
    branch.includes('result.recovery.notificationStatus === "unavailable"'),
    false,
  );
  assertStringIncludes(
    branch,
    "reserveAccountHostClaimRecoveryNotification(",
  );
});

Deno.test("a lost email-confirmation response replays to the same success redirect", async () => {
  const host = {
    ...listSeededAccountHostFallback()[0],
    host: "pds.example",
    displayName: "Example PDS",
    serviceEndpoint: "https://pds.example",
  };
  const user = { did: "did:plc:operator", handle: "operator.example" };
  const token = "t".repeat(43);
  const proof = {
    ok: true as const,
    tokenHash: "T".repeat(43),
    host: host.host,
    claimantDid: user.did,
    endpointOrigin: host.serviceEndpoint,
    pdsDid: "did:web:pds.example",
    emailFingerprint: "E".repeat(43),
    methodBinding: `pds-contact-email-v2.${"B".repeat(43)}`,
    requestedAt: 1,
    expiresAt: 10,
    deliveryId: null,
  };
  const completed = {
    ok: true as const,
    host,
    claim: {
      host: host.host,
      claimantDid: user.did,
      claimantHandle: user.handle,
      method: "pds_contact_email" as const,
      claimedAt: 2,
      verifiedAt: 2,
      updatedAt: 2,
    },
  };
  let preparationCount = 0;
  const claimInputs: unknown[] = [];
  const dependencies = {
    prepare: () =>
      Promise.resolve(
        preparationCount++ === 0
          ? proof
          : { ok: false as const, reason: "already_used" as const },
      ),
    claim: (
      _host: string,
      _user: { did: string; handle: string },
      proofOrToken: unknown,
    ) => {
      claimInputs.push(proofOrToken);
      return Promise.resolve(completed);
    },
  };

  const first = await submitHostContactEmailClaim(
    { host, user, emailToken: token, operatorListingOptIn: true },
    dependencies,
  );
  const replay = await submitHostContactEmailClaim(
    { host, user, emailToken: token, operatorListingOptIn: true },
    dependencies,
  );
  assert(first.ok);
  assert(replay.ok);
  assertEquals(claimInputs, [proof, token]);

  const firstResponse = completedHostContactEmailClaimResponse(
    first.host.host,
    false,
  );
  const replayResponse = completedHostContactEmailClaimResponse(
    replay.host.host,
    false,
  );
  assertEquals(firstResponse.status, 303);
  assertEquals(replayResponse.status, 303);
  assertEquals(
    replayResponse.headers.get("location"),
    firstResponse.headers.get("location"),
  );
  assertEquals(
    replayResponse.headers.get("location"),
    "/hosts/pds.example/manage?claimed=1",
  );
});
