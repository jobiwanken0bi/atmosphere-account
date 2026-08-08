import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  canForgetOAuthSession,
  destroyActiveAppSessionForForget,
  oauthGrantForForget,
  revokeOAuthSessionForForget,
} from "./forget.ts";

Deno.test("forget OAuth session requires active or signed remembered ownership", () => {
  const remembered = [{ did: "did:plc:remembered" }];

  assertEquals(
    canForgetOAuthSession("did:plc:active", { did: "did:plc:active" }, []),
    true,
  );
  assertEquals(
    canForgetOAuthSession("did:plc:remembered", null, remembered),
    true,
  );
  assertEquals(
    canForgetOAuthSession(
      "did:plc:remembered",
      { did: "did:plc:other" },
      remembered,
    ),
    true,
  );
  assertEquals(
    canForgetOAuthSession(
      "did:plc:victim",
      { did: "did:plc:active" },
      remembered,
    ),
    false,
  );
  assertEquals(canForgetOAuthSession("did:plc:victim", null, []), false);
});

Deno.test("forget does not hide a failed durable OAuth revocation", async () => {
  assertEquals(
    await revokeOAuthSessionForForget(
      "did:plc:alice",
      "grant-alice",
      () => Promise.resolve(),
    ),
    true,
  );
  assertEquals(
    await revokeOAuthSessionForForget(
      "did:plc:alice",
      "grant-alice",
      () => Promise.reject(new Error("database unavailable")),
    ),
    false,
  );
});

Deno.test("forget selects only the browser-owned grant", () => {
  assertEquals(
    oauthGrantForForget(
      "did:plc:alice",
      { did: "did:plc:alice", oauthGrantId: "active-grant" },
      [{ did: "did:plc:alice", grantId: "remembered-grant" }],
    ),
    "active-grant",
  );
  assertEquals(
    oauthGrantForForget(
      "did:plc:alice",
      null,
      [{ did: "did:plc:alice", grantId: "remembered-grant" }],
    ),
    "remembered-grant",
  );
  assertEquals(
    oauthGrantForForget("did:plc:alice", null, [{ did: "did:plc:alice" }]),
    null,
  );
});

Deno.test("forget does not hide a failed active app-session revocation", async () => {
  const req = new Request("https://atmosphereaccount.com/oauth/forget");
  assertEquals(
    await destroyActiveAppSessionForForget(req, () => Promise.resolve()),
    true,
  );
  assertEquals(
    await destroyActiveAppSessionForForget(
      req,
      () => Promise.reject(new Error("database unavailable")),
    ),
    false,
  );
});
