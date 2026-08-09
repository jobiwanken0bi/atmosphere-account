import {
  assertEquals,
  assertFalse,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { relationshipDescription } from "./confirm.tsx";

Deno.test("relationship confirmation uses service and operator language", () => {
  const appService = relationshipDescription(
    "same_product",
    "host.example",
    "Example App",
  );
  const sharedOperator = relationshipDescription(
    "same_operator",
    "host.example",
    "Example App",
  );

  assertEquals(
    appService,
    "host.example provides account services for Example App.",
  );
  assertEquals(
    sharedOperator,
    "host.example and Example App are run by the same operator.",
  );
  assertFalse(`${appService} ${sharedOperator}`.includes("product"));
  assertFalse(`${appService} ${sharedOperator}`.includes("organization"));
});
