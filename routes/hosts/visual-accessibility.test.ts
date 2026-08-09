import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.test("host detail puts the operator action before Advanced", async () => {
  const [source, directorySource] = await Promise.all([
    Deno.readTextFile(new URL("./[host].tsx", import.meta.url)),
    Deno.readTextFile(new URL("../hosts.tsx", import.meta.url)),
  ]);
  const operatorAction = source.indexOf(
    'class="glass host-detail-claim-row"',
  );
  const advanced = source.indexOf(
    'class="glass account-home-details host-detail-details"',
  );

  assert(operatorAction >= 0);
  assert(advanced > operatorAction);
  assertStringIncludes(source, 'id="main-content"');
  assertStringIncludes(source, 'title="Login with Atmosphere"');
  assertStringIncludes(directorySource, 'title="Login with Atmosphere"');
  assertEquals(
    directorySource.includes("Sign in with Atmosphere account"),
    false,
  );
});

Deno.test("host management uses site-specific copy and labelled controls", async () => {
  const [manageSource, relationshipsSource] = await Promise.all([
    Deno.readTextFile(new URL("./[host]/manage.tsx", import.meta.url)),
    Deno.readTextFile(
      new URL("./[host]/manage/apps.tsx", import.meta.url),
    ),
  ]);

  assertStringIncludes(manageSource, 'id="main-content"');
  assertStringIncludes(relationshipsSource, 'id="main-content"');
  assertStringIncludes(manageSource, "Show this host in the directory");
  assertStringIncludes(manageSource, "Where people manage their accounts");
  assertStringIncludes(
    manageSource,
    'aria-label="Show Bluesky profile button on the public host page"',
  );
  assertEquals(manageSource.includes("Atmosphere is a router"), false);
  assertEquals(manageSource.includes("Atmosphere sends your users"), false);
});

Deno.test("host claim puts the current state before relay details", async () => {
  const source = await Deno.readTextFile(
    new URL("./[host]/claim.tsx", import.meta.url),
  );
  const currentState = source.indexOf("<ClaimBody");
  const relayDetails = source.indexOf("<DetectedHostSummary");
  assert(currentState >= 0);
  assert(relayDetails > currentState);
  assertStringIncludes(
    source,
    "This host already has a verified managing account.",
  );
  assertStringIncludes(source, "Manage host");
});

Deno.test("host and owner controls retain phone-sized targets and padding", async () => {
  const styles = await Deno.readTextFile(
    new URL("../../static/styles.css", import.meta.url),
  );

  for (
    const fragment of [
      ".host-detail-claim-row {",
      "grid-template-columns: minmax(0, 1fr) auto;",
      ".host-manage-advanced-summary {",
      "min-height: 2.75rem;",
      ".host-manage-card .host-claim-title,",
      "overflow-wrap: anywhere;",
      "@media (max-width: 420px)",
      ".host-manage-card {",
      "padding: 1.25rem;",
      ".host-claim-form > .host-claim-panel {",
    ]
  ) {
    assertStringIncludes(styles, fragment);
  }
});
