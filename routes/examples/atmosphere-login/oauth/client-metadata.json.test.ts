import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handler } from "./client-metadata.json.ts";

Deno.test("reference OAuth metadata uses canonical legal pages", async () => {
  const url = new URL(
    "https://preview.example/examples/atmosphere-login/oauth/client-metadata.json",
  );
  const get = handler.GET!;
  const response = await get(
    { req: new Request(url), url } as unknown as Parameters<typeof get>[0],
  );
  const body = await response.json() as {
    client_uri: string;
    tos_uri: string;
    policy_uri: string;
  };

  assertEquals(
    body.client_uri,
    "https://preview.example/examples/atmosphere-login/app",
  );
  assertEquals(body.tos_uri, "https://atmosphereaccount.com/terms");
  assertEquals(body.policy_uri, "https://atmosphereaccount.com/privacy");
});
