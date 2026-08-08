import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  IndexerIdentityCache,
  jetstreamBacklogIsFull,
  jetstreamMaxPendingEvents,
} from "./indexer.ts";

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
