import { assertEquals, assertMatch } from "jsr:@std/assert@1";
import { readExampleLoginState } from "../../lib/example-atproto-oauth.ts";
import { buildDevPickerHandoffForTest } from "./login-picker.ts";

Deno.test("dev picker retains its callback state in a signed cookie", async () => {
  const origin = "http://127.0.0.1:5173";
  const handoff = await buildDevPickerHandoffForTest(
    new URL("/dev/login-picker?current=local-picker.test", origin),
  );
  const picker = new URL(handoff.location, origin);
  const state = picker.searchParams.get("state");

  assertMatch(state ?? "", /^[A-Za-z0-9_-]{32}$/);
  assertEquals(picker.pathname, "/login/select");
  assertEquals(
    picker.searchParams.get("return_uri"),
    `${origin}/examples/atmosphere-login/callback`,
  );

  const callbackRequest = new Request(
    `${origin}/examples/atmosphere-login/callback?state=${state}`,
    { headers: { cookie: handoff.stateCookie.split(";", 1)[0] } },
  );
  assertEquals(
    await readExampleLoginState(callbackRequest, state ?? ""),
    state,
  );
});
