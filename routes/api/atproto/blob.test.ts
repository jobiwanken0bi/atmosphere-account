import { assertEquals } from "jsr:@std/assert@1";
import { handler } from "./blob.ts";

Deno.test("blob proxy rejects malformed CIDs before doing outbound work", async () => {
  const url = new URL(
    "https://atmosphereaccount.com/api/atproto/blob?did=did:plc:test&cid=not-a-cid",
  );
  const response = await (handler.GET as unknown as (ctx: {
    url: URL;
    req: Request;
  }) => Promise<Response>)({
    url,
    req: new Request(url),
  });

  assertEquals(response.status, 400);
  assertEquals(response.headers.get("cache-control"), "no-store");
});
