import { createClient } from "@libsql/client";
import {
  detectPdsPublicIntent,
  enrichObservedAccountHostPublicIntentForClient,
} from "./account-host-public-intent.ts";
import type { DbClient } from "./db.ts";
import type { PdsServerDescription } from "./pds-server-description.ts";

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
        ["open.example", 10, "observed"],
        ["managed-invites.example", 8, "observed"],
        ["private-invites.example", 5, "observed"],
        ["personal.example", 1, "observed"],
        ["claimed.example", 10, "claimed"],
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
        "published.example",
        "https://published.example",
        "at://did:plc:publisher/account.atmosphere.host.service/published.example",
        7,
        7,
      ],
    });

    const summary = await enrichObservedAccountHostPublicIntentForClient(
      db as unknown as DbClient,
      {
        checkedAt: 1_000_000,
        fetchImpl: ((input: URL | Request | string) => {
          const host = new URL(String(input)).hostname;
          const managed = host === "managed-invites.example";
          const privateInvites = host === "private-invites.example";
          return Promise.resolve(
            new Response(JSON.stringify({
              did: `did:web:${host}`,
              availableUserDomains: [host],
              inviteCodeRequired: managed || privateInvites,
              links: managed ? { termsOfService: `https://${host}/terms` } : {},
              contact: managed ? { email: `support@${host}` } : {},
            })),
          );
        }) as typeof fetch,
      },
    );

    assertEquals(summary, {
      candidates: 4,
      checked: 4,
      detected: 3,
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
        host: "claimed.example",
        signup_status: "unknown",
        public_intent_status: "unknown",
        public_intent_source: null,
        public_intent_checked_at: null,
      },
      {
        host: "managed-invites.example",
        signup_status: "invite_required",
        public_intent_status: "detected",
        public_intent_source: "pds_managed_invites",
        public_intent_checked_at: 1_000_000,
      },
      {
        host: "open.example",
        signup_status: "open",
        public_intent_status: "detected",
        public_intent_source: "pds_open_signup",
        public_intent_checked_at: 1_000_000,
      },
      {
        host: "personal.example",
        signup_status: "unknown",
        public_intent_status: "unknown",
        public_intent_source: null,
        public_intent_checked_at: null,
      },
      {
        host: "private-invites.example",
        signup_status: "unknown",
        public_intent_status: "not_detected",
        public_intent_source: null,
        public_intent_checked_at: 1_000_000,
      },
      {
        host: "published.example",
        signup_status: "open",
        public_intent_status: "detected",
        public_intent_source: "pds_open_signup",
        public_intent_checked_at: 1_000_000,
      },
    ]);
  } finally {
    db.close();
  }
});
