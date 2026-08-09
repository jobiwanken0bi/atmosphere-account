import { assertEquals } from "jsr:@std/assert@1";
import { readAdminFormRequest, readAdminJsonRequest } from "./admin-request.ts";

Deno.test("admin JSON mutations require JSON and enforce streamed byte limits", async () => {
  const wrongType = await readAdminJsonRequest(
    new Request("https://example.com/api/admin/action", {
      method: "POST",
      body: "action=remove",
    }),
  );
  assertEquals(wrongType.ok, false);
  if (!wrongType.ok) assertEquals(wrongType.response.status, 415);

  const oversized = await readAdminJsonRequest(
    new Request("https://example.com/api/admin/action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"notes":"'));
          controller.enqueue(new TextEncoder().encode("too large"));
          controller.enqueue(new TextEncoder().encode('"}'));
          controller.close();
        },
      }),
    }),
    8,
  );
  assertEquals(oversized.ok, false);
  if (!oversized.ok) assertEquals(oversized.response.status, 413);
});

Deno.test("admin form mutations enforce streamed byte limits", async () => {
  const oversized = await readAdminFormRequest(
    new Request("https://example.com/admin/action", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "action=an-unreasonably-long-action",
    }),
    8,
  );
  assertEquals(oversized.ok, false);
  if (!oversized.ok) assertEquals(oversized.response.status, 413);
});
