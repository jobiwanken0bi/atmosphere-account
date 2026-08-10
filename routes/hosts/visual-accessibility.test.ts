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

Deno.test("host detail orders primary actions before related profiles", async () => {
  const [hostSource, appSource, styles] = await Promise.all([
    Deno.readTextFile(new URL("./[host].tsx", import.meta.url)),
    Deno.readTextFile(new URL("../apps/[handle].tsx", import.meta.url)),
    Deno.readTextFile(new URL("../../static/styles.css", import.meta.url)),
  ]);

  const signup = hostSource.indexOf("{canOfferSignup && (");
  const explore = hostSource.indexOf("{host.homepageUrl && (");
  const relatedApp = hostSource.indexOf("{linkedApps.map((app) => (");
  assert(signup >= 0);
  assert(explore > signup);
  assert(relatedApp > explore);
  assertStringIncludes(hostSource, "primary\n                  />");
  assertStringIncludes(
    styles,
    ".host-detail-hero .profile-hero-action--primary",
  );
  assertStringIncludes(
    hostSource,
    'label={linkedApps.length > 1 ? `${app.name} app` : "App"}',
  );

  const destinations = appSource.indexOf(
    "{destinationLinks.map(renderAppAction)}",
  );
  const relatedHost = appSource.indexOf("{hostHref && (");
  assert(destinations >= 0);
  assert(relatedHost > destinations);
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
  assertStringIncludes(source, "← {detectedLookup && linkContext");
  assertStringIncludes(source, '? "Back to host"');
});

Deno.test("a success notice does not replace an available host backlink", async () => {
  const source = await Deno.readTextFile(
    new URL("./[host]/manage.tsx", import.meta.url),
  );
  assertStringIncludes(
    source,
    "const publicHostPageIsReady = !!host && isAccountHostPubliclyListable(host);",
  );
  assertEquals(source.includes("!!host && !notice"), false);
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

Deno.test("host summary cards contain long domains", async () => {
  const styles = await Deno.readTextFile(
    new URL("../../static/styles.css", import.meta.url),
  );
  const contentRule = styles.match(
    /\.host-detail-choice-card > div\s*\{([^}]+)\}/,
  )?.[1] ?? "";
  const headingRule = styles.match(
    /\.host-detail-choice-card h2\s*\{([^}]+)\}/,
  )?.[1] ?? "";
  const bodyRule = styles.match(
    /\.host-detail-choice-card p:not\(\.text-eyebrow\)\s*\{([^}]+)\}/,
  )?.[1] ?? "";

  assertStringIncludes(contentRule, "min-width: 0");
  assertStringIncludes(headingRule, "overflow-wrap: anywhere");
  assertStringIncludes(bodyRule, "overflow-wrap: anywhere");
});
