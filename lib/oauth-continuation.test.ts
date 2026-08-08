import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  hasValidLoginSelectionContinuationBinding,
  isLoginSelectionReturnPath,
} from "./oauth-continuation.ts";

const PICKER_RETURN =
  "/login/select?client_id=https%3A%2F%2Fapp.example&return_uri=https%3A%2F%2Fapp.example%2Fcallback&state=opaque";

Deno.test("login picker returns and nonpersistent continuation are inseparable", () => {
  assertEquals(isLoginSelectionReturnPath(PICKER_RETURN), true);
  assertEquals(
    hasValidLoginSelectionContinuationBinding(
      PICKER_RETURN,
      "login_selection",
      null,
      "account",
      ["identity"],
    ),
    true,
  );
  assertEquals(
    hasValidLoginSelectionContinuationBinding(
      PICKER_RETURN,
      null,
      null,
      "account",
      ["identity"],
    ),
    false,
  );
  assertEquals(
    hasValidLoginSelectionContinuationBinding(
      "/account",
      "login_selection",
      null,
      "account",
      ["identity"],
    ),
    false,
  );
  assertEquals(
    hasValidLoginSelectionContinuationBinding(
      PICKER_RETURN,
      "login_selection",
      null,
      "app",
      ["app"],
    ),
    false,
  );
});

Deno.test("ordinary local returns remain persistent-capable", () => {
  assertEquals(
    hasValidLoginSelectionContinuationBinding(
      "/apps/example",
      null,
      null,
      "review",
      ["review"],
    ),
    true,
  );
});
