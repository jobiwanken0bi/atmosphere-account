import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { renderToString } from "preact-render-to-string";
import type { AccountHost } from "../../../lib/account-hosts.ts";
import {
  buildLoginAppIdentityChecks,
  buildLoginAppReadiness,
  type LoginApp,
} from "../../../lib/atmosphere-login.ts";
import {
  loginEnvironmentLabel,
  loginEnvironmentStatusLabel,
} from "../../../lib/login-environment-display.ts";
import {
  DeveloperAccessRecovery,
  DeveloperAppsPage,
  PreferredHostField,
} from "./apps.tsx";
import {
  deleteLoginEnvironmentAction,
  DeveloperAppDetailPage,
} from "./apps/[...clientId].tsx";

const ACCOUNT = {
  user: { did: "did:plc:app", handle: "app.example" },
  hasManagedAppProfile: true,
  hasManagedHostProfiles: false,
  hasManagedProfiles: true,
  accountType: "project" as const,
  avatarUrl: null,
  publicProfileHandle: null,
  accountHost: null,
  rememberedAccounts: [],
};

Deno.test("developer layout reserves a separate column for app identity", async () => {
  const styles = await Deno.readTextFile(
    new URL("../../../static/styles.css", import.meta.url),
  );
  assertStringIncludes(
    styles,
    `.account-developer-hero {
  grid-template-columns: auto minmax(0, 1fr);`,
  );
  assertStringIncludes(
    styles,
    `.account-dashboard-text-link {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;`,
  );
});

const PROFILE = {
  did: "did:plc:app",
  listingId: "at://did:plc:app/app.profile/main",
  profileUri: "at://did:plc:app/app.profile/main",
  slug: "example-app",
  name: "Example App",
  homepage: "https://example.app",
  logoUri: "https://example.app/icon.png",
  updatedAt: 1_700_000_000_000,
  loginAvailability: "available" as const,
  identityFingerprint: "test-profile-fingerprint",
};

const ENVIRONMENT = {
  clientId: "https://staging.example.app/oauth/client-metadata.json",
  appName: PROFILE.name,
  appUri: PROFILE.homepage,
  logoUri: PROFILE.logoUri,
  appDid: PROFILE.did,
  appProfileUri: PROFILE.profileUri,
  appProfileSlug: PROFILE.slug,
  linkStatus: "linked",
  identityAvailable: true,
  loginAvailability: "available",
  allowedReturnUris: ["https://staging.example.app/auth/selected"],
  allowedOrigins: [],
  status: "unverified",
  reviewStatus: "none",
  reviewRequestedAt: null,
  reviewNotes: null,
  reviewDecisionAt: null,
  reviewDecisionBy: null,
  reviewDecisionReason: null,
  reviewRevision: null,
  environmentRevision: "environment-1",
  contactDid: PROFILE.did,
  preferredAccountHost: null,
  registered: true,
} satisfies LoginApp;

Deno.test("developer settings derive app identity and treat client IDs as environments", () => {
  const html = renderToString(
    <DeveloperAppsPage
      account={ACCOUNT}
      handle="app.example"
      profile={PROFILE}
      apps={[ENVIRONMENT]}
      preferredHosts={[]}
      values={{
        clientId: "",
        allowedReturnUris: "",
        preferredAccountHost: "",
      }}
      error={null}
      saved={false}
      deleted
    />,
  );

  assertStringIncludes(html, "Login environments");
  assertStringIncludes(html, 'id="main-content"');
  assertStringIncludes(html, "New login environment");
  assertStringIncludes(html, "staging.example.app");
  assertStringIncludes(html, "Its public identity comes from the app profile");
  assertStringIncludes(html, "Login environment deleted.");
  assertStringIncludes(html, 'name="client_id"');
  assertStringIncludes(html, 'name="allowed_return_uris"');
  assertStringIncludes(html, 'data-submit-once="true"');
  assertStringIncludes(html, 'data-pending-label="Adding environment…"');
  assertEquals(html.includes('name="preferred_account_host"'), false);
  assertEquals(html.includes('name="app_name"'), false);
  assertEquals(html.includes('name="app_uri"'), false);
  assertEquals(html.includes('name="logo_uri"'), false);
  assertEquals(html.includes("Register apps"), false);
  assertEquals(html.includes("Registered apps"), false);
});

Deno.test("preferred host is only offered when the app has an eligible host", () => {
  assertEquals(
    renderToString(<PreferredHostField hosts={[]} value="" />),
    "",
  );
  const html = renderToString(
    <PreferredHostField
      hosts={[{
        host: "pds.example",
        displayName: "Example Host",
      } as AccountHost]}
      value="pds.example"
    />,
  );
  assertStringIncludes(html, 'name="preferred_account_host"');
  assertStringIncludes(html, "Example Host (pds.example)");
});

Deno.test("legacy no-app cleanup does not expose app registration", () => {
  const html = renderToString(
    <DeveloperAccessRecovery
      account={ACCOUNT}
      handle="app.example"
      reason="no_app"
    />,
  );

  assertStringIncludes(html, "These login environments are unlinked");
  assertStringIncludes(html, 'id="main-content"');
  assertStringIncludes(
    html,
    'href="/account" class="account-dashboard-text-link"',
  );
  assertStringIncludes(
    html,
    'href="/apps" class="profile-form-button-primary"',
  );
  assertStringIncludes(html, "Back to Apps");
  assertStringIncludes(html, 'method="post" action="/oauth/add-account"');
  assertStringIncludes(
    html,
    'name="next" value="/account/developer/apps"',
  );
  assertStringIncludes(html, 'name="action" value="developer"');
  assertStringIncludes(html, 'name="capability" value="identity"');
  assertEquals(html.includes('name="intent"'), false);
  assertStringIncludes(
    html,
    "profile-form-button-secondary profile-form-button-secondary--lg",
  );
  assertStringIncludes(html, "Use another account");
  assertEquals(html.includes('href="/apps/manage?new=1"'), false);
  assertEquals(html.includes('name="client_id"'), false);
});

Deno.test("host-only recovery explains that an app profile is still required", () => {
  const html = renderToString(
    <DeveloperAccessRecovery
      account={ACCOUNT}
      handle="host.example"
      reason="host_only"
    />,
  );

  assertStringIncludes(html, "This account manages a host");
  assertStringIncludes(html, "manages a host but not an app");
  assertStringIncludes(html, "older login environments cannot be used");
  assertStringIncludes(html, "switch to the app account");
  assertStringIncludes(
    html,
    'href="/account/apps-hosts" class="account-dashboard-text-link"',
  );
  assertEquals(html.includes("Register an app"), false);
});

Deno.test("ambiguous legacy recovery does not offer another app registration", () => {
  const html = renderToString(
    <DeveloperAccessRecovery
      account={ACCOUNT}
      handle="legacy.example"
      reason="ambiguous"
    />,
  );

  assertStringIncludes(html, "Developer settings need one app");
  assertStringIncludes(html, "multiple legacy app profiles");
  assertStringIncludes(html, "Manage apps and hosts");
  assertStringIncludes(html, "Use another account");
  assertEquals(html.includes('href="/apps/manage?new=1"'), false);
});

Deno.test("owners can remove an unavailable orphan environment from recovery", () => {
  const orphan = {
    ...ENVIRONMENT,
    appDid: null,
    appProfileUri: null,
    appProfileSlug: null,
    linkStatus: "relink_required" as const,
    identityAvailable: false,
    loginAvailability: "unlinked" as const,
  };
  const html = renderToString(
    <DeveloperAccessRecovery
      account={ACCOUNT}
      handle="app.example"
      reason="no_app"
      orphanApps={[orphan]}
    />,
  );

  assertStringIncludes(html, "Unlinked login environments");
  assertStringIncludes(html, orphan.clientId);
  assertStringIncludes(html, 'name="action" value="delete-orphan"');
  assertStringIncludes(html, 'name="confirm_client_id"');
  assertStringIncludes(html, "Delete environment");
  assertEquals(html.includes("Manage environment"), false);
});

Deno.test("environment detail keeps app identity read-only", () => {
  const html = renderToString(
    <DeveloperAppDetailPage
      account={ACCOUNT}
      profile={PROFILE}
      app={ENVIRONMENT}
      checks={[]}
      readiness={null}
      defaultOrigin="https://atmosphereaccount.com"
      values={{
        allowedReturnUris: ENVIRONMENT.allowedReturnUris.join("\n"),
        preferredAccountHost: "",
      }}
      claimedHosts={[]}
      reviewNotes=""
      error={null}
      message={null}
      status={200}
    />,
  );

  assertStringIncludes(html, "Edit login environment");
  assertStringIncludes(html, 'id="main-content"');
  assertStringIncludes(html, "Its name, homepage, and logo come");
  assertStringIncludes(html, "Edit profile");
  assertStringIncludes(html, 'name="allowed_return_uris"');
  assertStringIncludes(
    html,
    'name="expected_environment_revision" value="environment-1"',
  );
  assertStringIncludes(html, 'data-pending-label="Saving changes…"');
  assertStringIncludes(html, 'data-pending-label="Requesting review…"');
  assertStringIncludes(html, "Danger zone");
  assertStringIncludes(html, "Delete environment");
  assertStringIncludes(html, 'method="post"');
  assertStringIncludes(html, 'name="action" value="delete"');
  assertStringIncludes(html, 'name="confirm_client_id"');
  assertEquals(html.includes("?delete="), false);
  assertEquals(html.includes('name="app_name"'), false);
  assertEquals(html.includes('name="app_uri"'), false);
  assertEquals(html.includes('name="logo_uri"'), false);
});

Deno.test("delete environment action requires the rendered client ID and redirects", async () => {
  const calls: string[][] = [];
  const response = await deleteLoginEnvironmentAction(
    PROFILE.did,
    ENVIRONMENT.clientId,
    ENVIRONMENT.clientId,
    (ownerDid, clientId) => {
      calls.push([ownerDid, clientId]);
      return Promise.resolve(true);
    },
  );
  assertEquals(response.status, 303);
  assertEquals(
    response.headers.get("location"),
    "/account/developer/apps?deleted=1#login-environments",
  );
  assertEquals(calls, [[PROFILE.did, ENVIRONMENT.clientId]]);

  try {
    await deleteLoginEnvironmentAction(
      PROFILE.did,
      ENVIRONMENT.clientId,
      "https://other.example/client.json",
      () => {
        throw new Error("delete must not run");
      },
    );
    throw new Error("Expected stale delete confirmation to fail");
  } catch (error) {
    assertEquals(
      error instanceof Error ? error.message : String(error),
      "Reload this login environment before deleting it.",
    );
  }
});

Deno.test("moderated apps keep owner management while login is unavailable", () => {
  const profile = { ...PROFILE, loginAvailability: "moderated" as const };
  const environment = {
    ...ENVIRONMENT,
    loginAvailability: "moderated" as const,
    status: "trusted" as const,
    reviewStatus: "approved" as const,
  };
  const checks = buildLoginAppIdentityChecks(environment);
  const readiness = buildLoginAppReadiness(environment, checks);
  const html = renderToString(
    <DeveloperAppDetailPage
      account={ACCOUNT}
      profile={profile}
      app={environment}
      checks={checks}
      readiness={readiness}
      defaultOrigin="https://atmosphereaccount.com"
      values={{
        allowedReturnUris: environment.allowedReturnUris.join("\n"),
        preferredAccountHost: "",
      }}
      claimedHosts={[]}
      reviewNotes=""
      error={null}
      message={null}
      status={200}
    />,
  );

  assertStringIncludes(html, "Edit login environment");
  assertStringIncludes(html, 'name="allowed_return_uris"');
  assertStringIncludes(html, "Login unavailable");
  assertStringIncludes(html, "owner can still manage");
  assertEquals(readiness.state, "unavailable");
});

Deno.test("login environments use concise technical labels", () => {
  assertEquals(
    loginEnvironmentLabel("https://web.example.com/client.json"),
    "web.example.com",
  );
  assertEquals(
    loginEnvironmentLabel("http://localhost/client.json"),
    "Local development",
  );
  assertEquals(loginEnvironmentStatusLabel("unverified"), "Unverified");
});
