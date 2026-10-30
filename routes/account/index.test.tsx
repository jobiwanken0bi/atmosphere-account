import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { renderToString } from "preact-render-to-string";
import type { LoginConnection } from "../../lib/atmosphere-login.ts";
import {
  ApplicationsPanel,
  managedProfileRoleLabels,
  shouldAutoOpenAppRegistration,
} from "./index.tsx";

const CONNECTION: LoginConnection = {
  clientId: "https://app.example/client-metadata.json",
  appName: "Example App",
  appUri: "https://app.example",
  logoUri: null,
  status: "trusted",
  handle: "alice.example",
  selectedCount: 2,
  firstSelectedAt: 1_700_000_000_000,
  lastSelectedAt: 1_700_000_000_000,
};

Deno.test("connected-app panel does not mix in app-owner developer settings", () => {
  for (const connections of [[], [CONNECTION]]) {
    const html = renderToString(
      <ApplicationsPanel
        connections={connections}
      />,
    );

    assertEquals(html.includes('href="/account/developer/apps"'), false);
    assertEquals(html.includes("Developer settings"), false);
    assertEquals(html.includes(">Register an app<"), false);
  }
});

Deno.test("an existing app never reopens first-time registration", () => {
  assertEquals(shouldAutoOpenAppRegistration("app", false), true);
  assertEquals(shouldAutoOpenAppRegistration("app", true), false);
  assertEquals(shouldAutoOpenAppRegistration(null, false), false);
});

Deno.test("account roles only describe profiles the account actually manages", () => {
  assertEquals(managedProfileRoleLabels(0, 0), []);
  assertEquals(managedProfileRoleLabels(0, 1), ["Manages a host"]);
  assertEquals(managedProfileRoleLabels(1, 0), ["Manages an app"]);
  assertEquals(managedProfileRoleLabels(2, 3), [
    "Manages 2 apps",
    "Manages 3 hosts",
  ]);
});
