import {
  hasPreboundHostAuthority,
  hostHandleMatchesDomain,
  hostServiceRecordMatchesUser,
  wellKnownHostClaimMatchesUser,
} from "./host-claim-proof.ts";
import { HOST_SERVICE_NSID } from "./lexicons.ts";

function assert(condition: unknown, message = "Assertion failed"): void {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`Expected ${e}, got ${a}`);
}

Deno.test("hostHandleMatchesDomain requires the account handle to be the host domain", () => {
  assert(hostHandleMatchesDomain("pds.example.com", "pds.example.com"));
  assert(hostHandleMatchesDomain("pds.example.com.", "@pds.example.com"));
  assertEquals(
    hostHandleMatchesDomain("pds.example.com", "example.com"),
    false,
  );
});

Deno.test("hostServiceRecordMatchesUser requires a record from the signed-in DID for the host rkey", () => {
  const user = { did: "did:plc:hostowner", handle: "pds.example.com" };
  assert(hostServiceRecordMatchesUser(
    "pds.example.com",
    `at://${user.did}/${HOST_SERVICE_NSID}/pds.example.com`,
    "bafyrecord",
    user,
  ));
  assertEquals(
    hostServiceRecordMatchesUser(
      "pds.example.com",
      `at://${user.did}/${HOST_SERVICE_NSID}/other.example.com`,
      "bafyrecord",
      user,
    ),
    false,
  );
  assertEquals(
    hostServiceRecordMatchesUser(
      "pds.example.com",
      `at://did:plc:other/${HOST_SERVICE_NSID}/pds.example.com`,
      "bafyrecord",
      user,
    ),
    false,
  );
});

Deno.test("wellKnownHostClaimMatchesUser accepts DID or handle authority", () => {
  const user = { did: "did:plc:hostowner", handle: "brand.example" };
  assert(wellKnownHostClaimMatchesUser(
    {
      host: "pds.brand.example",
      owner: { did: user.did },
    },
    "pds.brand.example",
    user,
  ));
  assert(wellKnownHostClaimMatchesUser(
    {
      host: "pds.brand.example",
      claim: { handle: "brand.example" },
    },
    "pds.brand.example",
    user,
  ));
  assertEquals(
    wellKnownHostClaimMatchesUser(
      {
        host: "other.brand.example",
        owner: { did: user.did },
      },
      "pds.brand.example",
      user,
    ),
    false,
  );
});

Deno.test("hasPreboundHostAuthority only trusts seeded host mappings", () => {
  assert(hasPreboundHostAuthority({
    host: "pckt.cafe",
    source: "seeded",
    claimHandle: "pckt.blog",
  }));
  assertEquals(
    hasPreboundHostAuthority({
      host: "pckt.cafe",
      source: "manual",
      claimHandle: "pckt.blog",
    }),
    false,
  );
});
