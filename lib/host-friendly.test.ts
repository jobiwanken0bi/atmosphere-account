import { assertEquals } from "jsr:@std/assert@1";
import { listSeededAccountHostFallback } from "./account-hosts.ts";
import { hostFriendlyProfile, hostPdsDomain } from "./host-friendly.ts";

const spark = listSeededAccountHostFallback().find((host) =>
  host.host === "sprk.so"
);

if (!spark) throw new Error("sprk.so seed fixture is missing");

Deno.test("hostPdsDomain uses the public service endpoint hostname", () => {
  assertEquals(
    hostPdsDomain({
      host: "bsky.network",
      serviceEndpoint: "https://BSKY.SOCIAL/xrpc",
    }),
    "bsky.social",
  );
});

Deno.test("hostPdsDomain falls back to the inventory host", () => {
  assertEquals(
    hostPdsDomain({ host: "example.host", serviceEndpoint: null }),
    "example.host",
  );
  assertEquals(
    hostPdsDomain({ host: "example.host", serviceEndpoint: "not a URL" }),
    "example.host",
  );
});

Deno.test("managed host description overrides curated host summary", () => {
  const managedDescription =
    "Account host for signing up in the Spark social app.";

  assertEquals(
    hostFriendlyProfile({
      ...spark,
      description: managedDescription,
    }).summary,
    managedDescription,
  );
});

Deno.test("curated host summary remains the fallback for an empty description", () => {
  assertEquals(
    hostFriendlyProfile({
      ...spark,
      description: "   ",
    }).summary,
    "A Spark account host listed while more host details are confirmed.",
  );
});
