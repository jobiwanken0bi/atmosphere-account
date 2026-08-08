import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  appReviewRkeyForWrite,
  createAppReviewRkey,
  isAppReviewRkey,
} from "./app-review-write.ts";

Deno.test("new app review retries retain one valid client TID", () => {
  const requestedRkey = createAppReviewRkey(1_800_000_000_000);

  assert(isAppReviewRkey(requestedRkey));
  assertEquals(appReviewRkeyForWrite(null, requestedRkey), requestedRkey);
  assertEquals(appReviewRkeyForWrite(null, requestedRkey), requestedRkey);
});

Deno.test("new app review keys fail closed at the API boundary", () => {
  assertEquals(appReviewRkeyForWrite(null, undefined), null);
  assertEquals(appReviewRkeyForWrite(null, null), null);
  assertEquals(appReviewRkeyForWrite(null, "listing-123"), null);
  assertEquals(
    appReviewRkeyForWrite(null, "f4fd3460-18f8-4f4c-b43c-0169f0c2facb"),
    null,
  );
});

Deno.test("existing app reviews keep their remote repository key", () => {
  const unusedCandidate = createAppReviewRkey(1_800_000_000_001);

  assertEquals(
    appReviewRkeyForWrite("existing-review", undefined),
    "existing-review",
  );
  assertEquals(
    appReviewRkeyForWrite("existing-review", unusedCandidate),
    "existing-review",
  );
  assertEquals(appReviewRkeyForWrite("existing-review", "invalid"), null);
});
