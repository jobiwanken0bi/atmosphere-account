import { assertEquals } from "jsr:@std/assert@1";
import { microblogAccountIdentity } from "./microblog-account-identity.ts";

Deno.test("missing microblog profile clears cached identity fields", () => {
  assertEquals(microblogAccountIdentity(null), {
    displayName: null,
    bio: null,
    avatarCid: null,
    avatarMime: null,
  });
});

Deno.test("microblog profile supplies the account identity", () => {
  assertEquals(
    microblogAccountIdentity({
      displayName: "  Alice  ",
      description: "  Reviewer  ",
      avatar: {
        $type: "blob",
        ref: { $link: "bafy-avatar" },
        mimeType: "image/png",
        size: 128,
      },
    }),
    {
      displayName: "Alice",
      bio: "Reviewer",
      avatarCid: "bafy-avatar",
      avatarMime: "image/png",
    },
  );
});
