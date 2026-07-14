import {
  fetchPdsServerDescription,
  parsePdsServerDescription,
  pdsServerDescriptionForAccountHost,
} from "./pds-server-description.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

Deno.test("parsePdsServerDescription keeps useful signup and policy facts", () => {
  const parsed = parsePdsServerDescription({
    did: "did:web:pds.example",
    inviteCodeRequired: false,
    phoneVerificationRequired: true,
    availableUserDomains: ["example.social", ".Example.Social", "bad domain"],
    links: {
      privacyPolicy: "https://example.social/privacy#ignored",
      termsOfService: "https://example.social/terms",
    },
    contact: { email: "support@example.social" },
  }, 123);

  assertEquals(parsed, {
    did: "did:web:pds.example",
    availableUserDomains: ["example.social"],
    inviteCodeRequired: false,
    phoneVerificationRequired: true,
    privacyPolicyUrl: "https://example.social/privacy",
    termsOfServiceUrl: "https://example.social/terms",
    contactEmail: "support@example.social",
    checkedAt: 123,
  });
});

Deno.test("parsePdsServerDescription tolerates partial PDS responses", () => {
  const parsed = parsePdsServerDescription({
    availableUserDomains: [],
  }, 456);

  assertEquals(parsed, {
    did: null,
    availableUserDomains: [],
    inviteCodeRequired: null,
    phoneVerificationRequired: null,
    privacyPolicyUrl: null,
    termsOfServiceUrl: null,
    contactEmail: null,
    checkedAt: 456,
  });
});

Deno.test("Bluesky signup facts do not repeat its incorrect phone requirement", () => {
  const description = parsePdsServerDescription({
    did: "did:web:bsky.social",
    availableUserDomains: [".bsky.social"],
    inviteCodeRequired: false,
    phoneVerificationRequired: true,
  }, 456);

  assertEquals(
    pdsServerDescriptionForAccountHost("bsky.network", description)
      ?.phoneVerificationRequired,
    false,
  );
  assertEquals(
    pdsServerDescriptionForAccountHost("another.host", description)
      ?.phoneVerificationRequired,
    true,
  );
});

Deno.test("fetchPdsServerDescription reads describeServer from a normalized PDS endpoint", async () => {
  const seen: string[] = [];
  const result = await fetchPdsServerDescription("https://pds.example/", {
    checkedAt: 789,
    cacheTtlMs: 0,
    fetchImpl: ((input: URL | Request | string, _init?: RequestInit) => {
      seen.push(String(input));
      return Promise.resolve(
        new Response(
          JSON.stringify({
            did: "did:web:pds.example",
            availableUserDomains: ["pds.example"],
            inviteCodeRequired: true,
          }),
          {
            headers: { "content-type": "application/json" },
          },
        ),
      );
    }) as typeof fetch,
  });

  assertEquals(seen, [
    "https://pds.example/xrpc/com.atproto.server.describeServer",
  ]);
  assertEquals(result?.availableUserDomains, ["pds.example"]);
  assertEquals(result?.inviteCodeRequired, true);
});
