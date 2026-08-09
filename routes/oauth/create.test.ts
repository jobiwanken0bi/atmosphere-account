import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { accountCreationProxyFailureRedirect } from "./create.ts";

Deno.test("account creation proxy outages return to the contextual chooser", () => {
  const redirect = accountCreationProxyFailureRedirect(
    new URL(
      "https://atmosphereaccount.com/oauth/create?host=host.example&next=%2Fapps%2Ftangled%3Freview%3Dcompose&action=review&capability=review&name=Tangled",
    ),
  );
  const url = new URL(redirect ?? "", "https://atmosphereaccount.com");
  assertEquals(url.pathname, "/signin");
  assertEquals(url.searchParams.get("mode"), "create");
  assertEquals(url.searchParams.get("create_error"), "creation_unavailable");
  assertEquals(url.searchParams.get("next"), "/apps/tangled?review=compose");
  assertEquals(url.searchParams.get("action"), "review");
  assertEquals(url.searchParams.getAll("capability"), ["review"]);
  assertEquals(url.searchParams.get("name"), "Tangled");
});

Deno.test("account creation proxy recovery rejects management-only contexts", () => {
  assertEquals(
    accountCreationProxyFailureRedirect(
      new URL(
        "https://atmosphereaccount.com/oauth/create?host=host.example&next=%2Fhosts%2Fhost.example%2Fmanage&action=host_manage&capability=host&capability=media",
      ),
    ),
    null,
  );
});

Deno.test("account creation failures never log raw exception details", async () => {
  const source = await Deno.readTextFile(
    new URL("./create.ts", import.meta.url),
  );
  assertEquals(source.includes('start failed:", err'), false);
  assertEquals(source.includes('proxy failed:", err'), false);
});
