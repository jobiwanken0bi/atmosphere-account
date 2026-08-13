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
      resolveHandleAuthority(value) {
        identifier = value;
        return Promise.resolve("did:plc:operator");
      },
      resolveDidDocument() {
        return Promise.resolve({
          id: "did:plc:operator",
          alsoKnownAs: ["at://pds.example.com"],
          service: [{
            id: "#atproto_pds",
            type: "AtprotoPersonalDataServer",
            serviceEndpoint: "https://shared-pds.example.net",
          }],
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
    pdsUrl: "https://shared-pds.example.net",
  });
});

Deno.test("AT Protocol host proof fails closed on every partial match", async () => {
  const cases = [
    {
      resolvedDid: "did:plc:different",
      documentDid: "did:plc:different",
      documentHandle: "pds.example.com",
    },
    {
      resolvedDid: "did:plc:operator",
      documentDid: "did:plc:operator",
      documentHandle: "alice.pds.example.com",
    },
    {
      resolvedDid: "did:plc:operator",
      documentDid: "did:plc:different",
      documentHandle: "pds.example.com",
    },
  ];
  for (const identity of cases) {
    assertEquals(
      await verifyAtprotoHostClaimDomainProof(
        { host: "pds.example.com" },
        { did: "did:plc:operator", handle: "pds.example.com" },
        {
          resolveHandleAuthority() {
            return Promise.resolve(identity.resolvedDid);
          },
          resolveDidDocument() {
            return Promise.resolve({
              id: identity.documentDid,
              alsoKnownAs: [`at://${identity.documentHandle}`],
              service: [{
                id: "#atproto_pds",
                type: "AtprotoPersonalDataServer",
                serviceEndpoint: "https://shared-pds.example.net",
              }],
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
      {
        resolveHandleAuthority: () =>
          Promise.reject(new Error("resolver down")),
      },
    ),
    { ok: false, reason: "missing_domain_proof" },
  );

  let resolvedMismatchedHandle = false;
  assertEquals(
    await verifyAtprotoHostClaimDomainProof(
      { host: "pds.example.com" },
      { did: "did:plc:operator", handle: "social.example.com" },
      {
        resolveHandleAuthority() {
          resolvedMismatchedHandle = true;
          throw new Error("must not resolve");
        },
      },
    ),
    { ok: false, reason: "missing_domain_proof" },
  );
  assertEquals(resolvedMismatchedHandle, false);
});

Deno.test("AT Protocol host proof honors only the first valid DID handle", async () => {
  const verify = (alsoKnownAs: string[]) =>
    verifyAtprotoHostClaimDomainProof(
      { host: "pds.example.com" },
      { did: "did:plc:operator", handle: "pds.example.com" },
      {
        resolveHandleAuthority: () => Promise.resolve("did:plc:operator"),
        resolveDidDocument: () =>
          Promise.resolve({
            id: "did:plc:operator",
            alsoKnownAs,
            service: [{
              id: "#atproto_pds",
              type: "AtprotoPersonalDataServer",
              serviceEndpoint: "https://shared-pds.example.net",
            }],
          }),
      },
    );

  assertEquals(
    await verify(["at://other.example.com", "at://pds.example.com"]),
    { ok: false, reason: "missing_domain_proof" },
  );
  assertEquals(
    (await verify(["at://not a handle", "at://PDS.EXAMPLE.COM"])).ok,
    true,
  );
  for (
    const malformedTarget of [
      "at://pds.example.com/path",
      "at://pds.example.com?query=1",
      "at://pds.example.com.",
    ]
  ) {
    assertEquals(
      await verify([malformedTarget]),
      { ok: false, reason: "missing_domain_proof" },
    );
  }
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
