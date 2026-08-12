import {
  hostSelfServiceClaimPolicy,
  verifyAtprotoHostClaimDomainProof,
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

Deno.test("exact bidirectional handle and PDS identity can prove a host", async () => {
  let identifier = "";
  const result = await verifyAtprotoHostClaimDomainProof(
    { host: "pds.example.com" },
    { did: "did:plc:operator", handle: "pds.example.com" },
    {
      resolveIdentity(value) {
        identifier = value;
        return Promise.resolve({
          did: "did:plc:operator",
          handle: "pds.example.com",
          pdsUrl: "https://pds.example.com",
          doc: { id: "did:plc:operator" },
        });
      },
    },
  );
  assertEquals(identifier, "pds.example.com");
  assertEquals(result, {
    ok: true,
    method: "atproto_handle",
    did: "did:plc:operator",
    handle: "pds.example.com",
    pdsUrl: "https://pds.example.com",
  });
});

Deno.test("AT Protocol host proof fails closed on every partial match", async () => {
  const cases = [
    {
      did: "did:plc:different",
      handle: "pds.example.com",
      pdsUrl: "https://pds.example.com",
    },
    {
      did: "did:plc:operator",
      handle: "alice.pds.example.com",
      pdsUrl: "https://pds.example.com",
    },
    {
      did: "did:plc:operator",
      handle: "pds.example.com",
      pdsUrl: "https://unrelated.example.com",
    },
  ];
  for (const identity of cases) {
    assertEquals(
      await verifyAtprotoHostClaimDomainProof(
        { host: "pds.example.com" },
        { did: "did:plc:operator", handle: "pds.example.com" },
        {
          resolveIdentity() {
            return Promise.resolve({
              ...identity,
              doc: { id: identity.did },
            });
          },
        },
      ),
      { ok: false, reason: "missing_domain_proof" },
    );
  }
  assertEquals(
    await verifyAtprotoHostClaimDomainProof(
      { host: "pds.example.com" },
      { did: "did:plc:operator", handle: "pds.example.com" },
      { resolveIdentity: () => Promise.reject(new Error("resolver down")) },
    ),
    { ok: false, reason: "missing_domain_proof" },
  );

  let resolvedMismatchedHandle = false;
  assertEquals(
    await verifyAtprotoHostClaimDomainProof(
      { host: "pds.example.com" },
      { did: "did:plc:operator", handle: "social.example.com" },
      {
        resolveIdentity() {
          resolvedMismatchedHandle = true;
          throw new Error("must not resolve");
        },
      },
    ),
    { ok: false, reason: "missing_domain_proof" },
  );
  assertEquals(resolvedMismatchedHandle, false);
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
