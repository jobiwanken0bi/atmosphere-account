import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  disconnectAppConfirmation,
  forgetAccountConfirmation,
} from "./ConfirmedActionForm.tsx";

Deno.test("saved-account removal warns when it will sign out the current account", () => {
  assertEquals(
    forgetAccountConfirmation("alice.example", true),
    "Remove @alice.example from saved accounts? This will also sign you out.",
  );
  assertEquals(
    forgetAccountConfirmation("bob.example", false),
    "Remove @bob.example from saved accounts? You’ll need to sign in with its host to use it again.",
  );
});

Deno.test("connected-app removal names the affected app", () => {
  assertEquals(
    disconnectAppConfirmation("Grain"),
    "Remove Grain from connected apps? You can connect it again later.",
  );
});
