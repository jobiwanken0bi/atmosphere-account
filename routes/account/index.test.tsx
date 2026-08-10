import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { renderToString } from "preact-render-to-string";
import type { LoginConnection } from "../../lib/atmosphere-login.ts";
import {
  accountManagementNavigationFlags,
  accountManagesProfiles,
  ApplicationsPanel,
  managedProfilesDashboardCopy,
  RememberedAccountsPanel,
} from "./index.tsx";
import {
  disconnectAppConfirmation,
  forgetAccountConfirmation,
} from "../../islands/ConfirmedActionForm.tsx";

const CONNECTION: LoginConnection = {
  clientId: "https://example.com/client-metadata.json",
  appName: "Example App",
  appUri: "https://example.com",
  logoUri: null,
  status: "trusted",
  handle: "alice.example",
  selectedCount: 1,
  firstSelectedAt: 1_700_000_000_000,
  lastSelectedAt: 1_700_000_000_000,
};

Deno.test("account management section follows verified loaded profiles", () => {
  assertEquals(accountManagesProfiles(0, 0), false);
  assertEquals(accountManagesProfiles(1, 0), true);
  assertEquals(accountManagesProfiles(0, 1), true);
});

Deno.test("account navigation overrides session hints with verified profiles", () => {
  assertEquals(accountManagementNavigationFlags(0, 0), {
    hasManagedAppProfile: false,
    hasManagedHostProfiles: false,
    hasManagedProfiles: false,
  });
  assertEquals(accountManagementNavigationFlags(0, 1), {
    hasManagedAppProfile: false,
    hasManagedHostProfiles: true,
    hasManagedProfiles: true,
  });
});

Deno.test("connected apps stays universal and excludes developer registration", () => {
  for (const connections of [[], [CONNECTION]]) {
    const html = renderToString(
      <ApplicationsPanel connections={connections} />,
    );
    assertEquals(html.includes("/account/developer/apps"), false);
    assertEquals(html.includes("Register an app"), false);
    if (connections.length === 0) {
      assertStringIncludes(html, "Login with Atmosphere");
    }
  }
});

Deno.test("connected-app copy names Login with Atmosphere, not the ecosystem", async () => {
  const source = await Deno.readTextFile(
    new URL("./index.tsx", import.meta.url),
  );
  assertStringIncludes(source, "Connected through Login with Atmosphere");
  assertEquals(source.includes("Connected with Atmosphere"), false);
  assertEquals(source.includes("continued into with Atmosphere"), false);
});

Deno.test("removing connected apps is confirmed and visually destructive", () => {
  const html = renderToString(<ApplicationsPanel connections={[CONNECTION]} />);
  assertStringIncludes(html, 'action="/account/apps/disconnect"');
  assertStringIncludes(html, 'name="client_id"');
  assertStringIncludes(html, "account-dashboard-mini-button--danger");
  assertStringIncludes(html, 'data-submit-once="true"');
  assertStringIncludes(html, 'data-pending-label="Removing…"');
  assertEquals(
    disconnectAppConfirmation(CONNECTION.appName),
    "Remove Example App from connected apps? You can connect it again later.",
  );
});

Deno.test("app-host connection removals require confirmation and look destructive", async () => {
  for (
    const path of [
      "../apps/manage/host.tsx",
      "../hosts/[host]/manage/apps.tsx",
    ]
  ) {
    const source = await Deno.readTextFile(new URL(path, import.meta.url));
    assertStringIncludes(source, "<ConfirmedActionForm");
    assertStringIncludes(
      source,
      'buttonClass="account-dashboard-mini-button account-dashboard-mini-button--danger"',
    );
    assertStringIncludes(source, "You can connect them again later.");
  }
});

Deno.test("saved-account removal warns when it also signs out", () => {
  const html = renderToString(
    <RememberedAccountsPanel
      accounts={[{ did: "did:plc:alice", handle: "alice.example" }]}
      currentDid="did:plc:alice"
      currentDisplayName="Alice"
    />,
  );
  assertStringIncludes(html, 'action="/oauth/logout"');
  assertStringIncludes(html, 'action="/oauth/forget"');
  assertStringIncludes(html, "account-dashboard-mini-button--danger");
  assertEquals(
    forgetAccountConfirmation("alice.example", true),
    "Remove @alice.example from saved accounts? This will also sign you out.",
  );
});

Deno.test("account home management copy does not invent an absent profile type", () => {
  assertEquals(managedProfilesDashboardCopy(0, 1), {
    description: "Manage the host profiles operated by this account.",
    calloutTitle: "Each host has its own public profile.",
    calloutBody:
      "Edit host details, images, managing-account settings, and app connections.",
  });
  assertEquals(managedProfilesDashboardCopy(1, 0), {
    description: "Manage the app profile represented by this account.",
    calloutTitle: "Your app has its own public profile.",
    calloutBody:
      "Edit its details, images, host connections, and developer settings.",
  });
});

Deno.test("account home owns one main landmark and uses the selected microblog viewer", async () => {
  const source = await Deno.readTextFile(
    new URL("./index.tsx", import.meta.url),
  );
  assertEquals(source.match(/<main\b/g)?.length, 2);
  assertEquals(source.match(/<\/main>/g)?.length, 2);
  assertStringIncludes(source, "<MicroblogProfileLink");
  assertStringIncludes(
    source,
    "selectedClientId={appUser?.bskyClientId ?? null}",
  );
  assertStringIncludes(source, "handle={user.handle}");
  assertStringIncludes(source, "<span>Advanced</span>");
  assertStringIncludes(source, "account-dashboard-details-chevron");
});

Deno.test("account controls keep visible danger treatment and 44px targets", async () => {
  const styles = await Deno.readTextFile(
    new URL("../../static/styles.css", import.meta.url),
  );
  assertStringIncludes(styles, ".account-dashboard-mini-button--danger {");
  assertStringIncludes(
    styles,
    `.account-dashboard-mini-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 2.75rem;`,
  );
  assertStringIncludes(
    styles,
    `.account-dashboard-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.46rem;
  min-height: 2.75rem;`,
  );
  assertStringIncludes(
    styles,
    `.account-dashboard-button--primary:hover,
.account-dashboard-button--primary:focus-visible {
  background: #0f326d;
  color: #fff;`,
  );
  assertStringIncludes(
    styles,
    `.dark-phase .account-dashboard-button--primary:hover,
.dark-phase .account-dashboard-button--primary:focus-visible {
  background: #f0f4ff;
  color: #0e1428;`,
  );
});

Deno.test("account identity avatar aligns with the full identity summary", async () => {
  const source = await Deno.readTextFile(
    new URL("./index.tsx", import.meta.url),
  );
  const styles = await Deno.readTextFile(
    new URL("../../static/styles.css", import.meta.url),
  );

  assertStringIncludes(source, 'class="account-dashboard-identity-summary"');
  assertStringIncludes(
    styles,
    `.account-dashboard-identity-summary {
  display: grid;
  align-content: space-between;
  gap: 0.12rem;
  min-height: 5.15rem;`,
  );
  assertStringIncludes(
    styles,
    `.account-home-avatar.account-dashboard-avatar {
  width: 5.15rem;
  height: 5.15rem;
  margin-top: 1.1rem;`,
  );
});
