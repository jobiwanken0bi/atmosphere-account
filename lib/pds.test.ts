import {
  fetchBlobPublic,
  isPdsScopeMissingError,
  PdsRecordWriteError,
  putRecordInputForTest,
  readPdsErrorBodyForTest,
  readPdsJsonForTest,
} from "./pds.ts";

function assertEquals(actual: unknown, expected: unknown): void {
  if (actual !== expected) {
    throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
  }
}

Deno.test("PDS scope failures are distinguishable from other write errors", () => {
  const scopeErrorBody = JSON.stringify({
    error: "ScopeMissingError",
    message:
      'Missing required scope "repo:fyi.atstore.listing.favorite?action=create"',
  });
  assertEquals(
    isPdsScopeMissingError(
      new PdsRecordWriteError(
        "createRecord",
        403,
        scopeErrorBody,
      ),
    ),
    true,
  );
  assertEquals(
    isPdsScopeMissingError(
      new PdsRecordWriteError("putRecord", 403, scopeErrorBody),
    ),
    true,
  );
  assertEquals(
    isPdsScopeMissingError(
      new PdsRecordWriteError("putRecord", 500, "upstream failure"),
    ),
    false,
  );
});

Deno.test("PDS putRecord includes explicit record compare-and-swap values", () => {
  const create = putRecordInputForTest(
    "did:plc:test",
    "example.collection",
    "self",
    { value: "new" },
    { swapRecord: null },
  );
  assertEquals(Object.hasOwn(create, "swapRecord"), true);
  assertEquals(create.swapRecord, null);

  const update = putRecordInputForTest(
    "did:plc:test",
    "example.collection",
    "self",
    { value: "updated" },
    { swapRecord: "bafyreicurrent" },
  );
  assertEquals(update.swapRecord, "bafyreicurrent");

  const unconditional = putRecordInputForTest(
    "did:plc:test",
    "example.collection",
    "self",
    { value: "legacy" },
  );
  assertEquals(Object.hasOwn(unconditional, "swapRecord"), false);
});

Deno.test("PDS error bodies are bounded before custom errors retain them", async () => {
  const oversized = await readPdsErrorBodyForTest(
    new Response("x".repeat(9 * 1024)),
  );
  assertEquals(oversized, "response too large");
});

Deno.test("PDS success JSON is content-typed and byte-bounded", async () => {
  let rejectedType = false;
  try {
    await readPdsJsonForTest(new Response("{}"), 16);
  } catch {
    rejectedType = true;
  }
  assertEquals(rejectedType, true);

  let rejectedSize = false;
  try {
    await readPdsJsonForTest(
      Response.json({ padding: "x".repeat(32) }),
      16,
    );
  } catch {
    rejectedSize = true;
  }
  assertEquals(rejectedSize, true);
});

Deno.test("public PDS blob fetches refuse redirects and use a timeout", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = "";
  let requestedInit: RequestInit | undefined;
  try {
    globalThis.fetch = ((
      input: string | URL | Request,
      init?: RequestInit,
    ) => {
      requestedUrl = input instanceof Request ? input.url : String(input);
      requestedInit = init;
      return Promise.resolve(new Response(null, { status: 302 }));
    }) as typeof fetch;
    const response = await fetchBlobPublic(
      "https://pds.example",
      "did:plc:test",
      "bafkreiaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
    assertEquals(response.status, 302);
    assertEquals(
      requestedUrl.startsWith(
        "https://pds.example/xrpc/com.atproto.sync.getBlob?",
      ),
      true,
    );
    assertEquals(requestedInit?.redirect, "manual");
    assertEquals(requestedInit?.signal instanceof AbortSignal, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
