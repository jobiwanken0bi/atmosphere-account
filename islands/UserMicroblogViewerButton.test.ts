import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import UserMicroblogViewerButton, {
  microblogViewerPendingValue,
  microblogViewerReauthorization,
  parseMicroblogViewerPending,
} from "./UserMicroblogViewerButton.tsx";

Deno.test("microblog viewer trigger and dialog have unique linked accessible names", async () => {
  const props = {
    selectedClientId: "bluesky",
    visible: true,
    currentDid: "did:plc:alice",
    currentHandle: "alice.example",
  };
  const html = renderToString(
    h(
      "div",
      null,
      h(UserMicroblogViewerButton, props),
      h(UserMicroblogViewerButton, {
        ...props,
        currentDid: "did:plc:bob",
        currentHandle: "bob.example",
      }),
    ),
  );
  const controls = [...html.matchAll(/aria-controls="([^"]+)"/g)].map(
    (match) => match[1],
  );
  assertEquals(controls.length, 2);
  assertEquals(controls[0] === controls[1], false);
  assertEquals(html.split('aria-haspopup="dialog"').length - 1, 2);

  const source = await Deno.readTextFile(
    new URL("./UserMicroblogViewerButton.tsx", import.meta.url),
  );
  assertStringIncludes(source, "id={popoverId}");
  assertStringIncludes(source, "aria-labelledby={popoverTitleId}");
  assertStringIncludes(source, "<h3 id={popoverTitleId}>");
});

Deno.test("microblog viewer reopens account authorization after session expiry", () => {
  const authorization = microblogViewerReauthorization(
    401,
    null,
    "alice.example",
  );
  assertEquals(authorization?.action, "account");
  assertEquals(authorization?.capabilities, ["identity"]);
  assertEquals(authorization?.returnTo, "/account?resume_viewer=1");
  assertEquals(
    microblogViewerReauthorization(
      500,
      { error: "database_unavailable" },
      "alice.example",
    ),
    null,
  );
});

Deno.test("microblog viewer resume is fresh and account-bound", () => {
  const now = 50_000;
  const value = microblogViewerPendingValue(
    "did:plc:alice",
    "bluesky",
    true,
    now,
  );
  assertEquals(parseMicroblogViewerPending(value, "did:plc:alice", now), {
    clientId: "bluesky",
    visible: true,
  });
  assertEquals(parseMicroblogViewerPending(value, "did:plc:bob", now), null);
  assertEquals(
    parseMicroblogViewerPending(
      microblogViewerPendingValue(
        "did:plc:alice",
        "bluesky",
        true,
        now - 1_800_001,
      ),
      "did:plc:alice",
      now,
    ),
    null,
  );
  assertEquals(
    parseMicroblogViewerPending(
      microblogViewerPendingValue(
        "did:plc:alice",
        "deer.social",
        true,
        now,
      ),
      "did:plc:alice",
      now,
    ),
    null,
  );
});
