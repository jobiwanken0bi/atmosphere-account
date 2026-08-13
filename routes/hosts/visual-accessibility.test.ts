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

Deno.test("host preview cards always show compact account counts", async () => {
  const [source, styles] = await Promise.all([
    Deno.readTextFile(new URL("../hosts.tsx", import.meta.url)),
    Deno.readTextFile(new URL("../../static/styles.css", import.meta.url)),
  ]);

  assertStringIncludes(source, "{compactAccountCount}");
  assertStringIncludes(source, "title={compactAccountCount}");
  assertEquals(source.includes("host-card-account-count-full"), false);
  assertEquals(source.includes("host-card-account-count-compact"), false);
  assertEquals(styles.includes("host-card-account-count-full"), false);
  assertEquals(styles.includes("host-card-account-count-compact"), false);
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
  const [manageSource, relationshipsSource, profileSaveSource, styles] =
    await Promise.all([
      Deno.readTextFile(new URL("./[host]/manage.tsx", import.meta.url)),
      Deno.readTextFile(
        new URL("./[host]/manage/apps.tsx", import.meta.url),
      ),
      Deno.readTextFile(
        new URL("../../islands/HostProfileSaveButton.tsx", import.meta.url),
      ),
      Deno.readTextFile(new URL("../../static/styles.css", import.meta.url)),
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
  assertEquals(
    manageSource.match(/profile-form-status--error/g)?.length,
    manageSource.match(/role="alert"/g)?.length,
  );
  assertStringIncludes(manageSource, 'role="status"');
  assertStringIncludes(
    manageSource,
    'data-pending-label="Preparing account change…"',
  );
  assertStringIncludes(
    manageSource,
    'data-pending-label="Saving visibility…"',
  );
  assertStringIncludes(
    manageSource,
    'data-pending-label="Saving sign-up…"',
  );
  assertStringIncludes(manageSource, 'aria-label="Host management sections"');
  assertStringIncludes(manageSource, 'value="save_signup"');
  assertStringIncludes(manageSource, 'value="save_account"');
  assertEquals(
    manageSource.match(/<span data-submit-once-label>Save changes<\/span>/g)
      ?.length,
    4,
  );
  assertStringIncludes(manageSource, "managedHostSaveLocation(");
  assertStringIncludes(manageSource, "HostManageSavedStatus");
  assertStringIncludes(profileSaveSource, '"Save changes"');
  assertStringIncludes(profileSaveSource, "saved.value = true;");
  const overview = manageSource.indexOf('class="host-manage-overview"');
  const publicPresence = manageSource.indexOf('id="public-presence"');
  const profile = manageSource.indexOf('id="public-profile"');
  const directory = manageSource.indexOf('id="directory-visibility"');
  const journeys = manageSource.indexOf('id="account-journeys"');
  const signup = manageSource.indexOf('id="signup"');
  const accountLinks = manageSource.indexOf('id="account-links"');
  const connections = manageSource.indexOf('id="connections-ownership"');
  const apps = manageSource.indexOf('id="app-connections"');
  const ownership = manageSource.indexOf('id="managing-account"');
  const advanced = manageSource.indexOf('id="advanced-settings"');
  assert(
    overview < publicPresence && publicPresence < profile &&
      profile < directory && directory < journeys && journeys < signup &&
      signup < accountLinks && accountLinks < connections &&
      connections < apps && apps < ownership && ownership < advanced,
  );
  assertStringIncludes(
    manageSource,
    'class="host-manage-group host-manage-advanced-group"',
  );
  assertStringIncludes(
    manageSource,
    '<h2 id="connections-ownership-title">',
  );
  assertStringIncludes(manageSource, "Connections &amp; ownership");
  assertEquals(manageSource.includes("Who this host belongs to"), false);
  assertStringIncludes(styles, ".host-manage-summary-chevron::before");
  assertEquals(manageSource.includes(">⌄</span>"), false);
  assertStringIncludes(manageSource, "host-manage-profile-identity");
  assertStringIncludes(manageSource, "host-manage-profile-fields");
  assertStringIncludes(manageSource, "host-manage-avatar-optional");
  assertStringIncludes(
    styles,
    ".host-manage-profile-avatar .host-card-mark",
  );
  assertStringIncludes(
    styles,
    "grid-template-columns: 8rem minmax(0, 1fr)",
  );
  assertStringIncludes(
    manageSource,
    'open={Boolean(validation) || savedSection === "advanced"}',
  );
  assertStringIncludes(
    styles,
    ".host-manage-owner-transfer {\n  white-space: nowrap;\n}",
  );
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
  assertStringIncludes(source, "then verify it");
  assertStringIncludes(source, 'ariaLabel="Copy DNS record name"');
  assertStringIncludes(source, 'ariaLabel="Copy DNS record value"');
  assertStringIncludes(source, '<fieldset class="host-claim-methods">');
  assertStringIncludes(source, "Choose how to verify that you operate");
  assertStringIncludes(source, ">Show DNS record</span>");
  assertStringIncludes(source, ">Send verification email</span>");
  assertStringIncludes(source, 'value="request_contact_email"');
  assertStringIncludes(source, 'value="confirm_contact_email"');
  assertStringIncludes(source, 'value="finalize_recovery"');
  assertStringIncludes(source, "Generate fresh DNS record");
  assertStringIncludes(source, "Verify DNS and finish recovery");
  assertStringIncludes(source, "Verify DNS and start recovery");
  assertStringIncludes(source, "Verify DNS to strengthen ownership");
  assertStringIncludes(source, 'dnsFailure === "record_not_found"');
  assertStringIncludes(source, 'dnsFailure === "dns_unavailable"');
  assertStringIncludes(
    source,
    'dnsFailure === "account_mismatch" ? dnsToken : null',
  );
  assertStringIncludes(source, 'role="status"');
  assertEquals(
    source.match(/profile-form-status--error/g)?.length,
    source.match(/role="alert"/g)?.length,
  );
  assertStringIncludes(source, "This PDS doesn’t publish a contact email");
  assertStringIncludes(source, "Strengthen ownership with DNS");
  assertStringIncludes(source, 'data-pending-label="Connecting…"');
  const dnsFields = source.slice(
    source.indexOf('<dl class="host-claim-detected-summary">'),
    source.indexOf(
      "</dl>",
      source.indexOf('<dl class="host-claim-detected-summary">'),
    ),
  );
  assert(
    dnsFields.indexOf("<dt>Type</dt>") < dnsFields.indexOf("<dt>Name</dt>"),
  );
  assert(
    dnsFields.indexOf("<dt>Name</dt>") < dnsFields.indexOf("<dt>Value</dt>"),
  );
});

Deno.test("email claim links are scanner-safe and require explicit confirmation", async () => {
  const source = await Deno.readTextFile(
    new URL("./[host]/claim.tsx", import.meta.url),
  );

  for (
    const fragment of [
      'url.searchParams.has("email_token")',
      'clean.searchParams.delete("email_token")',
      '"HttpOnly"',
      '"SameSite=Lax"',
      '"referrer-policy": "no-referrer"',
      '"x-robots-tag": "noindex, nofollow"',
      'name="action" value="confirm_contact_email"',
      'data-pending-label="Verifying email…"',
      "Verify and claim host",
    ]
  ) {
    assertStringIncludes(source, fragment);
  }
});

Deno.test("DNS recovery reserves one notification sender before delivery", async () => {
  const source = await Deno.readTextFile(
    new URL("./[host]/claim.tsx", import.meta.url),
  );
  const branch = source.slice(
    source.indexOf('result.reason === "recovery_pending"'),
  );
  const reserve = branch.indexOf(
    "reserveAccountHostClaimRecoveryNotification(",
  );
  const send = branch.indexOf("notifyHostContactEmailOfDnsRecovery(");
  assert(reserve >= 0);
  assert(send > reserve);
  assertStringIncludes(branch, "if (notificationReservation)");
  assertStringIncludes(
    branch,
    "notificationReservation.expectedEmailFingerprint",
  );
  assertStringIncludes(branch, 'reason: "contact_changed"');
  assertStringIncludes(branch, "attemptedAt: notificationAttemptedAt");
});

Deno.test("email-derived managers see pending DNS recovery", async () => {
  const source = await Deno.readTextFile(
    new URL("./[host]/manage.tsx", import.meta.url),
  );

  for (
    const fragment of [
      "getPendingAccountHostClaimRecovery(host.host)",
      'claim?.method === "pds_contact_email"',
      "DNS recovery in progress",
      "DNS is authoritative",
      "48-hour review",
      'href="mailto:contact@atmosphereaccount.com"',
      "supersedes",
      "pending recovery",
      "Strengthen ownership with DNS",
    ]
  ) {
    assertStringIncludes(source, fragment);
  }
});

Deno.test("host claim methods and recovery keep dark-phase contrast", async () => {
  const styles = await Deno.readTextFile(
    new URL("../../static/styles.css", import.meta.url),
  );
  for (
    const selector of [
      ".dark-phase .host-claim-method {",
      ".dark-phase .host-claim-method--recommended {",
      ".dark-phase .host-claim-method-title,",
      ".dark-phase .host-claim-recovery-warning {",
      ".dark-phase .host-detail-claim-copy p:not(.text-eyebrow) {",
    ]
  ) {
    assertStringIncludes(styles, selector);
  }
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
      ".host-claim-dns-field {",
      ".host-claim-copy-button {",
      ".host-claim-heading .host-card-mark {",
      "grid-template-columns: minmax(0, 1fr);",
      ".host-claim-title {",
      "overflow-wrap: anywhere;",
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
