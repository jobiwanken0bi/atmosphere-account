import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { appProfileWriteCapabilities } from "./profile-write-capabilities.ts";

Deno.test("app profile writes always use the complete app and image job", () => {
  assertEquals(appProfileWriteCapabilities({}), ["app", "media"]);
  assertEquals(
    appProfileWriteCapabilities({
      avatarUpload: { dataBase64: "" },
      screenshotUploads: [],
    }),
    ["app", "media"],
  );
  assertEquals(
    appProfileWriteCapabilities({
      bannerUpload: { dataBase64: "aGVsbG8=" },
    }),
    ["app", "media"],
  );
  assertEquals(
    appProfileWriteCapabilities({
      screenshotUploads: [{ dataBase64: "aGVsbG8=" }],
    }),
    ["app", "media"],
  );
  assertEquals(
    appProfileWriteCapabilities({
      screenshotUploads: {} as never,
    }),
    ["app", "media"],
  );
});
