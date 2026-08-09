import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildAccountMenuProps } from "../lib/account-menu-props.ts";
import { appsHostsMenuHref } from "./AccountMenu.tsx";

Deno.test("apps and hosts account destination is operator-only", () => {
  assertEquals(appsHostsMenuHref(false), null);
  assertEquals(appsHostsMenuHref(true), "/account/apps-hosts");
});

Deno.test("account navigation preserves separate app and host ownership", () => {
  const props = buildAccountMenuProps({
    user: {
      did: "did:plc:host-only",
      handle: "host.example",
      hasManagedAppProfile: false,
      hasManagedHostProfiles: true,
    },
    accountType: null,
    accountHost: null,
    rememberedAccounts: [],
  });
  assertEquals(props.hasManagedAppProfile, false);
  assertEquals(props.hasManagedHostProfiles, true);
  assertEquals(props.hasManagedProfiles, true);
});
