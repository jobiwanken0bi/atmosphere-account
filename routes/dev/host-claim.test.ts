import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import {
  DEV_HOST_CLAIM_SCENARIOS,
  devHostClaimLabEnabled,
  isDevHostClaimScenarioId,
  scenarioAccount,
  scenarioDestination,
} from "./host-claim.tsx";

Deno.test("host claim lab stays behind both local and explicit dev gates", () => {
  assertEquals(devHostClaimLabEnabled({ isDev: true, enabled: "1" }), true);
  assertEquals(devHostClaimLabEnabled({ isDev: false, enabled: "1" }), false);
  assertEquals(devHostClaimLabEnabled({ isDev: true, enabled: "0" }), false);
  assertEquals(
    devHostClaimLabEnabled({ isDev: true, enabled: undefined }),
    false,
  );
});

Deno.test("host claim lab exposes the complete deterministic scenario set", () => {
  const ids = DEV_HOST_CLAIM_SCENARIOS.map((scenario) => scenario.id);
  assertEquals(new Set(ids).size, ids.length);
  for (
    const expected of [
      "new-account",
      "existing-app",
      "app-link",
      "already-owner",
      "claimed-other",
      "dns-preview",
      "transfer-preview",
      "signed-out-create",
    ]
  ) {
    assertEquals(isDevHostClaimScenarioId(expected), true);
  }
  assertEquals(isDevHostClaimScenarioId("unknown"), false);
  assertEquals(scenarioAccount("new-account"), "regular");
  assertEquals(scenarioAccount("existing-app"), "app");
  assertEquals(scenarioAccount("already-owner"), "host");
  assertEquals(scenarioAccount("claimed-other"), "regular");
});

Deno.test("host claim lab destinations enter real claim and manage routes", async () => {
  assertEquals(
    await scenarioDestination("new-account"),
    "/hosts/claim-lab.test/claim?publish=1",
  );
  assertEquals(
    await scenarioDestination("existing-app"),
    "/hosts/field-notes-pds.test/claim?publish=1",
  );
  assertEquals(
    await scenarioDestination("already-owner"),
    "/hosts/harbor-host.test/claim?publish=1",
  );
  assertEquals(
    await scenarioDestination("claimed-other"),
    "/hosts/harbor-host.test/claim?publish=1",
  );
  assertStringIncludes(
    await scenarioDestination("dns-preview"),
    "/hosts/claim?domain=dns-claim-preview.atmosphereaccount.com",
  );
  assertEquals(
    await scenarioDestination("transfer-preview"),
    "/hosts/transfer-lab.atmosphereaccount.com/manage",
  );
});

Deno.test("host claim lab back navigation includes a visible arrow", async () => {
  const source = await Deno.readTextFile(
    new URL("./host-claim.tsx", import.meta.url),
  );
  assertStringIncludes(source, "← Back to hosts");
});
