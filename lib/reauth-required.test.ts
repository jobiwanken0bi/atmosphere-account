import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { reauthUrlFromApiPayload } from "./reauth-required.ts";

Deno.test("reauthUrlFromApiPayload accepts only same-site paths", () => {
  assertEquals(
    reauthUrlFromApiPayload({
      error: "reauth_required",
      reauthUrl: "/signin?action=app",
    }),
    "/signin?action=app",
  );
  assertEquals(
    reauthUrlFromApiPayload({ reauthUrl: "https://evil.example/signin" }),
    null,
  );
  assertEquals(
    reauthUrlFromApiPayload({ reauthUrl: "//evil.example/signin" }),
    null,
  );
  assertEquals(
    reauthUrlFromApiPayload({ reauthUrl: "/\\evil.example/signin" }),
    null,
  );
  assertEquals(
    reauthUrlFromApiPayload({ reauthUrl: "/signin\naction=app" }),
    null,
  );
  assertEquals(
    reauthUrlFromApiPayload({ reauthUrl: "/signin?action=app\n" }),
    null,
  );
  assertEquals(
    reauthUrlFromApiPayload({ reauthUrl: "/signin\u0000?action=app" }),
    null,
  );
  assertEquals(
    reauthUrlFromApiPayload({ reauthUrl: "/signin\u007f?action=app" }),
    null,
  );
  assertEquals(reauthUrlFromApiPayload({ error: "forbidden" }), null);
});
