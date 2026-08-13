import { Duplex } from "node:stream";
import {
  fetchPinnedPublicHttps,
  parsePinnedHttpResponseForTest,
} from "./pinned-public-https.ts";

function assert(
  condition: unknown,
  message = "Assertion failed",
): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

Deno.test("pinned public HTTPS connects to the classified IP with original SNI", async () => {
  let options: Record<string, unknown> | null = null;
  let request = "";
  const response = await fetchPinnedPublicHttps(
    "https://pds.example.com/xrpc/com.atproto.server.describeServer",
    { headers: { accept: "application/json" }, redirect: "manual" },
    {
      maxBodyBytes: 1024,
      resolve: (_host, type) =>
        Promise.resolve(type === "A" ? ["8.8.8.8"] : []),
      connect: (connectionOptions, callback) => {
        options = connectionOptions as Record<string, unknown>;
        const socket = new Duplex({
          read() {},
          write(chunk, _encoding, done) {
            request += String(chunk);
            done();
            queueMicrotask(() => {
              socket.push(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n" +
                  'Content-Length: 11\r\n\r\n{"ok":true}',
              );
              socket.push(null);
            });
          },
        });
        queueMicrotask(() => callback?.());
        return socket;
      },
    },
  );
  const connected = options as Record<string, unknown> | null;
  assert(connected);
  assertEquals(connected.host, "8.8.8.8");
  assertEquals(connected.servername, "pds.example.com");
  assertEquals(connected.rejectUnauthorized, true);
  assert(request.startsWith(
    "GET /xrpc/com.atproto.server.describeServer HTTP/1.1\r\n",
  ));
  assert(request.includes("host: pds.example.com\r\n"));
  assertEquals(await response.json(), { ok: true });
});

Deno.test("pinned public HTTPS rejects mixed private DNS answers before connect", async () => {
  let connects = 0;
  let rejected = false;
  try {
    await fetchPinnedPublicHttps("https://rebind.example.com/", {}, {
      maxBodyBytes: 1024,
      resolve: (_host, type) =>
        Promise.resolve(
          type === "A" ? ["8.8.8.8", "127.0.0.1"] : [],
        ),
      connect: () => {
        connects++;
        throw new Error("must not connect");
      },
    });
  } catch {
    rejected = true;
  }
  assert(rejected);
  assertEquals(connects, 0);
});

Deno.test("pinned public HTTPS bounds the whole address retry sequence", async () => {
  const started = Date.now();
  let connects = 0;
  let rejected = false;
  try {
    await fetchPinnedPublicHttps("https://many.example.com/", {}, {
      maxBodyBytes: 1024,
      timeoutMs: 500,
      resolve: (_host, type) =>
        Promise.resolve(
          type === "A"
            ? Array.from({ length: 32 }, (_, index) => `8.8.8.${index + 1}`)
            : [],
        ),
      connect: () => {
        connects++;
        return new Duplex({
          read() {},
          write(_chunk, _encoding, done) {
            done();
          },
        });
      },
    });
  } catch {
    rejected = true;
  }
  assert(rejected);
  assertEquals(connects, 1);
  assert(Date.now() - started < 1_500, "address retries exceeded deadline");
});

Deno.test("pinned HTTP parser bounds and unambiguously decodes framing", async () => {
  const encoded = new TextEncoder();
  const chunked = parsePinnedHttpResponseForTest(
    encoded.encode(
      "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\n" +
        "Transfer-Encoding: chunked\r\n\r\n5\r\nhello\r\n0\r\n\r\n",
    ),
    5,
    false,
  );
  assertEquals(await chunked.text(), "hello");
  for (
    const wire of [
      "HTTP/1.1 200 OK\r\nContent-Length: 5\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n",
      "HTTP/1.1 200 OK\r\nContent-Length: 6\r\n\r\nhello",
      "HTTP/1.1 200 OK\r\n\r\ntoolarge",
    ]
  ) {
    let rejected = false;
    try {
      parsePinnedHttpResponseForTest(encoded.encode(wire), 5, false);
    } catch {
      rejected = true;
    }
    assert(rejected, `accepted unsafe response: ${wire}`);
  }
});
