import { assertEquals } from "jsr:@std/assert@1";
import {
  appHostRelationshipDescription,
  appHostRelationshipLabel,
  appHostRelationshipOption,
} from "./app-host-relationship-copy.ts";

Deno.test("app/host relationship copy describes services and shared operators", () => {
  assertEquals(appHostRelationshipLabel("same_product"), "App service");
  assertEquals(
    appHostRelationshipDescription("same_product"),
    "This host provides account services for the app.",
  );
  assertEquals(
    appHostRelationshipOption("same_operator"),
    "Shared operator — The app and host are run by the same operator.",
  );
  assertEquals(appHostRelationshipLabel("host_only"), "Host-only override");
});
