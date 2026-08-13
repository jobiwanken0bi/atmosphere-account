import { createClient } from "@libsql/client";
import {
  detectPdsPublicIntent,
  enrichObservedAccountHostPublicIntentForClient,
  fetchPdsPublicSignupPage,
} from "./account-host-public-intent.ts";
import type { DbClient } from "./db.ts";
import type { PdsServerDescription } from "./pds-server-description.ts";
import { assertRejects } from "jsr:@std/assert@1";

function assertEquals(actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`Expected ${e}, got ${a}`);
}

function description(
  overrides: Partial<PdsServerDescription> = {},
): PdsServerDescription {
  return {
    did: "did:web:host.example",
    availableUserDomains: ["host.example"],
    inviteCodeRequired: false,
    phoneVerificationRequired: false,
    privacyPolicyUrl: null,
    termsOfServiceUrl: null,
    contactEmail: null,
    checkedAt: 100,
    ...overrides,
  };
}

Deno.test("PDS public intent distinguishes open providers from personal and unmanaged invite PDSes", () => {
  assertEquals(
    detectPdsPublicIntent(description(), 2)?.signupStatus,
    "open",
  );
  assertEquals(detectPdsPublicIntent(description(), 1), null);
  assertEquals(
    detectPdsPublicIntent(
      description({ availableUserDomains: [] }),
      20,
    ),
    null,
  );
  assertEquals(
    detectPdsPublicIntent(
      description({ inviteCodeRequired: true }),
      20,
    ),
    null,
  );
  assertEquals(
    detectPdsPublicIntent(
      description({
        inviteCodeRequired: true,
        contactEmail: "support@host.example",
        termsOfServiceUrl: "https://host.example/terms",
      }),
      20,
    )?.signupStatus,
    "invite_required",
  );
  assertEquals(
    detectPdsPublicIntent(
      description({ inviteCodeRequired: true }),
      20,
      {
        signupUrl: "https://host.example/app/register",
        label: "Join This Server",
      },
    )?.signupStatus,
    "invite_required",
  );
});

Deno.test("PDS public intent accepts explicit same-origin signup CTAs", async () => {
  let redirect: RequestRedirect | undefined;
  const result = await fetchPdsPublicSignupPage("https://host.social", {
    fetchImpl: ((_input, init) => {
      redirect = init?.redirect;
      return Promise.resolve(
        new Response(
          `<a href="https://elsewhere.social/register">Register</a>
           <a class="primary" href="/app/register"><span>Join This Server</span></a>`,
          { headers: { "content-type": "text/html; charset=utf-8" } },
        ),
      );
    }) as typeof fetch,
  });

  assertEquals(result, {
    signupUrl: "https://host.social/app/register",
    label: "Join This Server",
  });
  assertEquals(redirect, "manual");
});

Deno.test("PDS public signup probes obey the inventory abort signal", async () => {
  const controller = new AbortController();
  controller.abort(new DOMException("inventory deadline", "TimeoutError"));
  let fetches = 0;
  await assertRejects(
    () =>
      fetchPdsPublicSignupPage("https://host.social", {
        signal: controller.signal,
        fetchImpl: (() => {
          fetches++;
          return Promise.resolve(new Response(""));
        }) as typeof fetch,
      }),
    DOMException,
    "inventory deadline",
  );
  assertEquals(fetches, 0);
});

Deno.test("PDS public signup probes refuse redirects and oversized pages", async () => {
  for (
    const response of [
      new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1/private" },
      }),
      new Response("x".repeat(96_001), {
        headers: { "content-type": "text/html" },
      }),
      new Response('<a href="/register">Register</a>', {
        headers: { "content-type": "application/json" },
      }),
    ]
  ) {
    const result = await fetchPdsPublicSignupPage("https://host.social", {
      fetchImpl: (() =>
        Promise.resolve(
          response,
        )) as typeof fetch,
    });
    assertEquals(result, null);
  }
});

Deno.test("public-host enrichment persists unclaimed provider evidence without listing one-user PDSes", async () => {
  const db = createClient({ url: "file::memory:" });
  try {
    await db.execute(`CREATE TABLE account_host (
      host TEXT PRIMARY KEY,
      service_endpoint TEXT,
      signup_url TEXT,
      service_record_uri TEXT,
      signup_status TEXT NOT NULL DEFAULT 'unknown',
      verification_status TEXT NOT NULL DEFAULT 'observed',
      source TEXT NOT NULL DEFAULT 'observed',
      public_intent_status TEXT NOT NULL DEFAULT 'unknown',
      public_intent_source TEXT,
      public_intent_checked_at INTEGER,
      public_intent_attempted_at INTEGER,
      public_intent_evidence_json TEXT,
      observed_account_count INTEGER NOT NULL DEFAULT 0,
      observed_active_account_count INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT 0
    )`);
    for (
      const [host, count, verification] of [
        ["open.social", 10, "observed"],
        ["managed-invites.social", 8, "observed"],
        ["private-invites.social", 5, "observed"],
        ["tranquil.social", 13, "observed"],
        ["personal.social", 1, "observed"],
        ["claimed.social", 10, "claimed"],
      ] as const
    ) {
      await db.execute({
        sql: `INSERT INTO account_host (
          host, service_endpoint, verification_status,
          observed_account_count, observed_active_account_count
        ) VALUES (?, ?, ?, ?, ?)`,
        args: [host, `https://${host}`, verification, count, count],
      });
    }
    await db.execute({
      sql: `INSERT INTO account_host (
          host, service_endpoint, service_record_uri, source,
          observed_account_count, observed_active_account_count
        ) VALUES (?, ?, ?, 'manual', ?, ?)`,
      args: [
        "published.social",
        "https://published.social",
        "at://did:plc:publisher/account.atmosphere.host.service/published.social",
        7,
        7,
      ],
    });

    const summary = await enrichObservedAccountHostPublicIntentForClient(
      db as unknown as DbClient,
      {
        checkedAt: 1_000_000,
        fetchImpl: ((input: URL | Request | string) => {
          const url = new URL(String(input));
          const host = url.hostname;
          if (url.pathname === "/") {
            const html = host === "tranquil.social"
              ? `<a href="/app/register">Join This Server</a>`
              : `<a href="/app/login">Log in</a>`;
            return Promise.resolve(
              new Response(html, {
                headers: { "content-type": "text/html; charset=utf-8" },
              }),
            );
          }
          const managed = host === "managed-invites.social";
          const privateInvites = host === "private-invites.social";
          const tranquil = host === "tranquil.social";
          return Promise.resolve(
            new Response(
              JSON.stringify({
                did: `did:web:${host}`,
                availableUserDomains: [host],
                inviteCodeRequired: managed || privateInvites || tranquil,
                links: managed
                  ? { termsOfService: `https://${host}/terms` }
                  : {},
                contact: managed ? { email: `support@${host}` } : {},
              }),
              { headers: { "content-type": "application/json" } },
            ),
          );
        }) as typeof fetch,
      },
    );

    assertEquals(summary, {
      candidates: 5,
      checked: 5,
      detected: 4,
      notDetected: 1,
      unavailable: 0,
    });
    const result = await db.execute(
      `SELECT host, signup_status, public_intent_status,
          public_intent_source, public_intent_checked_at
        FROM account_host ORDER BY host`,
    );
    assertEquals(result.rows, [
      {
        host: "claimed.social",
        signup_status: "unknown",
        public_intent_status: "unknown",
        public_intent_source: null,
        public_intent_checked_at: null,
      },
      {
        host: "managed-invites.social",
        signup_status: "invite_required",
        public_intent_status: "detected",
        public_intent_source: "pds_managed_invites",
        public_intent_checked_at: 1_000_000,
      },
      {
        host: "open.social",
        signup_status: "open",
        public_intent_status: "detected",
        public_intent_source: "pds_open_signup",
        public_intent_checked_at: 1_000_000,
      },
      {
        host: "personal.social",
        signup_status: "unknown",
        public_intent_status: "unknown",
        public_intent_source: null,
        public_intent_checked_at: null,
      },
      {
        host: "private-invites.social",
        signup_status: "unknown",
        public_intent_status: "not_detected",
        public_intent_source: null,
        public_intent_checked_at: 1_000_000,
      },
      {
        host: "published.social",
        signup_status: "open",
        public_intent_status: "detected",
        public_intent_source: "pds_open_signup",
        public_intent_checked_at: 1_000_000,
      },
      {
        host: "tranquil.social",
        signup_status: "invite_required",
        public_intent_status: "detected",
        public_intent_source: "pds_managed_invites",
        public_intent_checked_at: 1_000_000,
      },
    ]);
  } finally {
    db.close();
  }
});
