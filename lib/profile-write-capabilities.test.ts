import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  appProfileWriteCapabilities,
  userProfileWriteCapabilities,
} from "./profile-write-capabilities.ts";

Deno.test("app profile writes always use the complete app capability", () => {
  assertEquals(appProfileWriteCapabilities({}), ["app"]);
  assertEquals(
    appProfileWriteCapabilities({
      avatarUpload: { dataBase64: "" },
      screenshotUploads: [],
    }),
    ["app"],
  );
  assertEquals(
    appProfileWriteCapabilities({
      bannerUpload: { dataBase64: "aGVsbG8=" },
    }),
    ["app"],
  );
  assertEquals(
    appProfileWriteCapabilities({
      screenshotUploads: [{ dataBase64: "aGVsbG8=" }],
    }),
    ["app"],
  );
  assertEquals(
    appProfileWriteCapabilities({
      screenshotUploads: {} as never,
    }),
    ["app"],
  );
});

Deno.test("user profile avatar uploads add media permission", () => {
  assertEquals(userProfileWriteCapabilities(false), ["profile"]);
  assertEquals(userProfileWriteCapabilities(true), ["profile", "media"]);
});
