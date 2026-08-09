import { assert, assertEquals } from "jsr:@std/assert@1";
import { readOgBackfillBannerForTest } from "./og-jpeg-backfill.ts";

Deno.test("OG JPEG backfill rejects oversized chunked PDS banners", async () => {
  let canceled = false;
  const response = new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new Uint8Array([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10]),
        );
        controller.enqueue(new Uint8Array(3_000_000 - 8));
        controller.enqueue(new Uint8Array([0]));
      },
      cancel() {
        canceled = true;
      },
    }),
    { headers: { "content-type": "image/png" } },
  );

  assertEquals(
    await readOgBackfillBannerForTest(response, "image/png"),
    null,
  );
  assert(canceled, "oversized PDS response should be canceled");
});

Deno.test("OG JPEG backfill validates raster signatures", async () => {
  const disguisedHtml = new Response("<script>alert(1)</script>", {
    headers: { "content-type": "image/png" },
  });
  assertEquals(
    await readOgBackfillBannerForTest(disguisedHtml, "image/png"),
    null,
  );
});
