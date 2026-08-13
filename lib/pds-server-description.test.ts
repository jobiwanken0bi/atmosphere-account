import {
  fetchPdsServerDescription,
  parsePdsServerDescription,
  pdsServerDescriptionForAccountHost,
} from "./pds-server-description.ts";
import { assertRejects } from "jsr:@std/assert@1";

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

Deno.test("parsePdsServerDescription rejects unsafe policy links and control text", () => {
  const parsed = parsePdsServerDescription({
    availableUserDomains: Array.from(
      { length: 105 },
      (_, index) => `host${index}.social`,
    ),
    links: {
      privacyPolicy: "http://127.0.0.1/private",
      termsOfService: "https://user:pass@host.social/terms",
    },
    contact: { email: "support@host.social\nBcc: attacker@evil.com" },
  }, 123);

  assertEquals(parsed?.availableUserDomains.length, 100);
  assertEquals(parsed?.privacyPolicyUrl, null);
  assertEquals(parsed?.termsOfServiceUrl, null);
  assertEquals(parsed?.contactEmail, null);
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
  let redirect: RequestRedirect | undefined;
  const result = await fetchPdsServerDescription("https://pds.example/", {
    checkedAt: 789,
    cacheTtlMs: 0,
    fetchImpl: ((input: URL | Request | string, init?: RequestInit) => {
      seen.push(String(input));
      redirect = init?.redirect;
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
  assertEquals(redirect, "manual");
});

Deno.test("fetchPdsServerDescription obeys an overall abort signal", async () => {
  const controller = new AbortController();
  controller.abort(new DOMException("inventory deadline", "TimeoutError"));
  let fetches = 0;
  await assertRejects(
    () =>
      fetchPdsServerDescription("https://pds.example", {
        signal: controller.signal,
        cacheTtlMs: 0,
        fetchImpl: (() => {
          fetches++;
          return Promise.resolve(new Response("{}"));
        }) as typeof fetch,
      }),
    DOMException,
    "inventory deadline",
  );
  assertEquals(fetches, 0);
});

Deno.test("a zero cache TTL forces a live describeServer security check", async () => {
  let email = "old@example.social";
  const fetchImpl =
    ((_input: URL | Request | string, _init?: RequestInit) =>
      Promise.resolve(
        new Response(JSON.stringify({ contact: { email } }), {
          headers: { "content-type": "application/json" },
        }),
      )) as typeof fetch;

  const first = await fetchPdsServerDescription(
    "https://live-check.example",
    { fetchImpl, checkedAt: 1_000, cacheTtlMs: 60_000 },
  );
  email = "new@example.social";
  const live = await fetchPdsServerDescription(
    "https://live-check.example",
    { fetchImpl, checkedAt: 1_001, cacheTtlMs: 0 },
  );

  assertEquals(first?.contactEmail, "old@example.social");
  assertEquals(live?.contactEmail, "new@example.social");
});

Deno.test("fetchPdsServerDescription refuses redirects, non-JSON, and oversized bodies", async () => {
  const responses = [
    new Response(null, {
      status: 302,
      headers: { location: "http://127.0.0.1/private" },
    }),
    new Response('{"availableUserDomains":[]}', {
      headers: { "content-type": "text/html" },
    }),
    new Response("x".repeat(32_001), {
      headers: { "content-type": "application/json" },
    }),
  ];
  for (const [index, response] of responses.entries()) {
    const result = await fetchPdsServerDescription(
      `https://unsafe${index}.com/path/ignored`,
      {
        cacheTtlMs: 0,
        fetchImpl: (() => Promise.resolve(response)) as typeof fetch,
      },
    );
    assertEquals(result, null);
  }
});
