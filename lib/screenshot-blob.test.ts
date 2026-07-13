import { fetchScreenshotBlobWithPdsFallback } from "./screenshot-blob.ts";

Deno.test("screenshot blob fetch re-resolves a DID after the stored PDS fails", async () => {
  const endpoints: string[] = [];
  const result = await fetchScreenshotBlobWithPdsFallback({
    storedPdsUrl: "https://old-pds.example",
    did: "did:plc:example",
    cid: "bafyblob",
    resolvePds: () => Promise.resolve("https://new-pds.example"),
    fetchBlob: (endpoint) => {
      endpoints.push(endpoint);
      return Promise.resolve(
        new Response(null, {
          status: endpoint.includes("old-") ? 404 : 200,
        }),
      );
    },
  });
  if (
    !result.response?.ok || !result.usedResolvedPds ||
    JSON.stringify(endpoints) !== JSON.stringify([
        "https://old-pds.example",
        "https://new-pds.example",
      ])
  ) {
    throw new Error(
      `unexpected screenshot fallback ${JSON.stringify(endpoints)}`,
    );
  }
});

Deno.test("screenshot blob fetch avoids duplicate calls when DID still resolves to stored PDS", async () => {
  let calls = 0;
  const result = await fetchScreenshotBlobWithPdsFallback({
    storedPdsUrl: "https://same-pds.example/",
    did: "did:plc:example",
    cid: "bafyblob",
    resolvePds: () => Promise.resolve("https://same-pds.example"),
    fetchBlob: () => {
      calls++;
      return Promise.resolve(new Response(null, { status: 404 }));
    },
  });
  if (calls !== 1 || result.usedResolvedPds) {
    throw new Error("unchanged PDS should not be fetched twice");
  }
});
