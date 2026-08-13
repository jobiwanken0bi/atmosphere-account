import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  fetchIndexerRecordWithIdentityRefresh,
  indexerFailureLogFields,
  IndexerIdentityCache,
  IndexerSuccessBatch,
  jetstreamBacklogIsFull,
  jetstreamMaxPendingEvents,
} from "./indexer.ts";
import { PublicRecordFetchError } from "../lib/pds.ts";

Deno.test("indexer backlog limit is bounded and configurable", () => {
  assertEquals(jetstreamMaxPendingEvents(undefined), 1_000);
  assertEquals(jetstreamMaxPendingEvents("250"), 250);
  assertEquals(jetstreamMaxPendingEvents("0"), 1_000);
  assertEquals(jetstreamMaxPendingEvents("not-a-number"), 1_000);
  assertEquals(jetstreamMaxPendingEvents("50000"), 10_000);
});

Deno.test("indexer backlog limit rejects at the boundary", () => {
  assertEquals(jetstreamBacklogIsFull(999, 1_000), false);
  assertEquals(jetstreamBacklogIsFull(1_000, 1_000), true);
  assertEquals(jetstreamBacklogIsFull(1_001, 1_000), true);
});

Deno.test("indexer failure log fields omit upstream bodies and error messages", () => {
  const secret = "pds-response-secret-and-url";
  const pdsFields = indexerFailureLogFields(
    new PublicRecordFetchError(502, secret),
  );
  assertEquals(pdsFields, {
    kind: "public_record_fetch",
    httpStatus: 502,
  });
  assertEquals(JSON.stringify(pdsFields).includes(secret), false);
  assertEquals(indexerFailureLogFields(new Error(secret)), {
    kind: "unexpected_error",
    httpStatus: null,
  });
  assertEquals(indexerFailureLogFields(secret), {
    kind: "unexpected_value",
    httpStatus: null,
  });
  assertEquals(
    indexerFailureLogFields(new PublicRecordFetchError(999, secret)),
    { kind: "public_record_fetch", httpStatus: null },
  );
});

Deno.test("indexer batches routine successes without record identifiers", () => {
  let now = 1_000;
  const batch = new IndexerSuccessBatch(() => now);
  batch.record("profile_upsert");
  batch.record("profile_upsert");
  batch.record("host_delete");
  now = 61_000;

  assertEquals(batch.drain("interval"), {
    event: "indexer_success_batch",
    reason: "interval",
    intervalMs: 60_000,
    total: 3,
    counts: { host_delete: 1, profile_upsert: 2 },
  });
  assertEquals(batch.drain("interval"), null);
});

Deno.test("indexer identity cache reuses one DID resolution", async () => {
  let now = 1_000;
  let loads = 0;
  const cache = new IndexerIdentityCache({
    ttlMs: 100,
    maxEntries: 2,
    now: () => now,
  });
  const load = () => {
    loads++;
    return Promise.resolve({
      pdsUrl: "https://pds.example",
      handle: "alice.example",
    });
  };

  assertEquals(
    (await cache.get("did:plc:alice", load)).handle,
    "alice.example",
  );
  assertEquals(
    (await cache.get("did:plc:alice", load)).pdsUrl,
    "https://pds.example",
  );
  assertEquals(loads, 1);

  now += 101;
  await cache.get("did:plc:alice", load);
  assertEquals(loads, 2);
});

Deno.test("indexer identity cache coalesces an in-flight DID resolution", async () => {
  let loads = 0;
  let finish!: (value: { pdsUrl: string; handle: string | null }) => void;
  const cache = new IndexerIdentityCache({
    ttlMs: 100,
    maxEntries: 2,
  });
  const load = () => {
    loads++;
    return new Promise<{ pdsUrl: string; handle: string | null }>((resolve) => {
      finish = resolve;
    });
  };

  const first = cache.get("did:plc:alice", load);
  const second = cache.get("did:plc:alice", load);
  assertEquals(loads, 1);
  finish({ pdsUrl: "https://pds.example", handle: "alice.example" });
  assertEquals(await first, await second);
});

Deno.test("indexer identity cache evicts its least-recently-used value", async () => {
  let loads = 0;
  const cache = new IndexerIdentityCache({
    ttlMs: 100,
    maxEntries: 1,
  });
  const load = () =>
    Promise.resolve({
      pdsUrl: `https://pds-${++loads}.example`,
      handle: null,
    });

  await cache.get("did:plc:alice", load);
  await cache.get("did:plc:bob", load);
  await cache.get("did:plc:alice", load);
  assertEquals(loads, 3);
});

Deno.test("indexer identity cache never serves an expired DID after refresh failure", async () => {
  let now = 1_000;
  const cache = new IndexerIdentityCache({
    ttlMs: 100,
    maxEntries: 2,
    now: () => now,
  });
  await cache.get("did:plc:alice", () =>
    Promise.resolve({
      pdsUrl: "https://old-pds.example",
      handle: "alice.example",
    }));

  now += 101;
  await assertRejects(() =>
    cache.get("did:plc:alice", () => Promise.reject(new Error("PLC down")))
  );
  assertEquals(
    (await cache.get("did:plc:alice", () =>
      Promise.resolve({
        pdsUrl: "https://new-pds.example",
        handle: "alice.example",
      }))).pdsUrl,
    "https://new-pds.example",
  );
});

Deno.test("indexer record fetch refreshes a migrated PDS after a cached miss", async () => {
  const resolutions: boolean[] = [];
  const fetches: string[] = [];
  const result = await fetchIndexerRecordWithIdentityRefresh(
    (forceRefresh) => {
      resolutions.push(forceRefresh);
      return Promise.resolve({
        pdsUrl: forceRefresh
          ? "https://new-pds.example"
          : "https://old-pds.example",
        handle: "alice.example",
      });
    },
    (pdsUrl) => {
      fetches.push(pdsUrl);
      return Promise.resolve(
        pdsUrl === "https://new-pds.example" ? { cid: "new" } : null,
      );
    },
  );

  assertEquals(resolutions, [false, true]);
  assertEquals(fetches, [
    "https://old-pds.example",
    "https://new-pds.example",
  ]);
  assertEquals(result, {
    identity: {
      pdsUrl: "https://new-pds.example",
      handle: "alice.example",
    },
    record: { cid: "new" },
  });
});

Deno.test("indexer record fetch trusts current data from the freshly resolved migrated PDS", async () => {
  const resolutions: boolean[] = [];
  const fetches: string[] = [];
  const result = await fetchIndexerRecordWithIdentityRefresh(
    (forceRefresh) => {
      resolutions.push(forceRefresh);
      return Promise.resolve({
        pdsUrl: forceRefresh
          ? "https://new-pds.example"
          : "https://old-pds.example",
        handle: "alice.example",
      });
    },
    (pdsUrl) => {
      fetches.push(pdsUrl);
      return Promise.resolve({
        cid: pdsUrl === "https://new-pds.example"
          ? "newer-than-event"
          : "stale",
      });
    },
    (record) => record.cid === "event-cid",
  );

  assertEquals(resolutions, [false, true]);
  assertEquals(fetches, [
    "https://old-pds.example",
    "https://new-pds.example",
  ]);
  assertEquals(result?.record, { cid: "newer-than-event" });
});

Deno.test("indexer record fetch trusts current data after freshly confirming the same PDS", async () => {
  const resolutions: boolean[] = [];
  let fetches = 0;
  const result = await fetchIndexerRecordWithIdentityRefresh(
    (forceRefresh) => {
      resolutions.push(forceRefresh);
      return Promise.resolve({
        pdsUrl: "https://pds.example",
        handle: forceRefresh ? "alice.new.example" : "alice.old.example",
      });
    },
    () => {
      fetches++;
      return Promise.resolve({ cid: "newer-than-event" });
    },
    (record) => record.cid === "event-cid",
  );

  assertEquals(resolutions, [false, true]);
  assertEquals(fetches, 1);
  assertEquals(result?.identity.handle, "alice.new.example");
  assertEquals(result?.record, { cid: "newer-than-event" });
});

Deno.test("indexer record fetch refreshes a migrated PDS after a permanent HTTP miss", async () => {
  let resolutions = 0;
  const result = await fetchIndexerRecordWithIdentityRefresh(
    (forceRefresh) => {
      resolutions++;
      return Promise.resolve({
        pdsUrl: forceRefresh
          ? "https://new-pds.example"
          : "https://old-pds.example",
        handle: null,
      });
    },
    (pdsUrl) => {
      if (pdsUrl === "https://old-pds.example") {
        throw new PublicRecordFetchError(400, "repo not found");
      }
      return Promise.resolve({ cid: "new" });
    },
  );

  assertEquals(resolutions, 2);
  assertEquals(result?.record, { cid: "new" });
});

Deno.test("indexer record fetch does not retry transient PDS failures", async () => {
  const resolutions: boolean[] = [];
  await assertRejects(
    () =>
      fetchIndexerRecordWithIdentityRefresh(
        (forceRefresh) => {
          resolutions.push(forceRefresh);
          return Promise.resolve({
            pdsUrl: "https://pds.example",
            handle: null,
          });
        },
        () => {
          throw new PublicRecordFetchError(429, "rate limited");
        },
      ),
    PublicRecordFetchError,
  );
  assertEquals(resolutions, [false]);
});

Deno.test("indexer record fetch bounds refresh when the PDS is unchanged", async () => {
  const resolutions: boolean[] = [];
  let fetches = 0;
  await assertRejects(
    () =>
      fetchIndexerRecordWithIdentityRefresh(
        (forceRefresh) => {
          resolutions.push(forceRefresh);
          return Promise.resolve({
            pdsUrl: "https://pds.example",
            handle: null,
          });
        },
        () => {
          fetches++;
          throw new PublicRecordFetchError(404, "record not found");
        },
      ),
    PublicRecordFetchError,
  );
  assertEquals(resolutions, [false, true]);
  assertEquals(fetches, 1);
});
