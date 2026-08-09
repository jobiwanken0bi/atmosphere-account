import {
  hostSelfServiceClaimPolicy,
  verifyHostClaimDomainProof,
} from "./host-claim-proof.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`Expected ${e}, got ${a}`);
}

Deno.test("production claims reject handle-domain and curated-handle shortcuts", () => {
  const handleResult = verifyHostClaimDomainProof(
    { host: "pds.example.com" },
    { did: "did:plc:owner", handle: "pds.example.com" },
    { isDev: false },
  );
  assertEquals(
    handleResult,
    { ok: false, reason: "missing_domain_proof" },
  );
  assertEquals(
    verifyHostClaimDomainProof(
      { host: "pckt.cafe" },
      { did: "did:plc:pinned", handle: "pckt.blog" },
      { isDev: false },
    ),
    { ok: false, reason: "missing_domain_proof" },
  );
});

Deno.test("only explicit local .test fixtures bypass DNS claims", () => {
  assertEquals(
    hostSelfServiceClaimPolicy("fixture.test", { isDev: true }),
    "local-dev",
  );
  assertEquals(
    verifyHostClaimDomainProof(
      { host: "fixture.test" },
      { did: "did:plc:fixture", handle: "fixture.test" },
      { isDev: true },
    ),
    { ok: true, method: "local-dev" },
  );
  assertEquals(
    hostSelfServiceClaimPolicy("fixture.test", { isDev: false }),
    "dns",
  );
  assertEquals(
    hostSelfServiceClaimPolicy("pds.example.com", { isDev: true }),
    "dns",
  );
});
