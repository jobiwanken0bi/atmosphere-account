import { assertEquals } from "jsr:@std/assert@1";
import {
  appProfileCreateRkeyForPayload,
  appProfileCreationRkeyForSession,
  appProfileCreationRkeyFromStored,
  appProfileCreationRkeyStorageKey,
} from "./CreateProfileForm.tsx";

const FIRST_RKEY = "3mzzzzzzzzzza";
const SECOND_RKEY = "3mzzzzzzzzzzb";

Deno.test("first app payload keeps one stable record key across retries", () => {
  const values = new Map<string, string>();
  const storage: Pick<Storage, "getItem" | "setItem"> = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const first = appProfileCreationRkeyForSession(
    "did:plc:owner",
    "/apps/manage?new=1",
    FIRST_RKEY,
    storage,
  );
  const retry = appProfileCreationRkeyForSession(
    "did:plc:owner",
    "/apps/manage?new=1",
    SECOND_RKEY,
    storage,
  );
  assertEquals(first, FIRST_RKEY);
  assertEquals(retry, FIRST_RKEY);
  assertEquals(
    appProfileCreateRkeyForPayload({
      createNewListing: true,
      published: false,
      atstoreListingUri: null,
      rkey: first,
    }),
    FIRST_RKEY,
  );
  assertEquals(
    appProfileCreateRkeyForPayload({
      createNewListing: false,
      published: true,
      atstoreListingUri:
        `at://did:plc:owner/fyi.atstore.listing.detail/${FIRST_RKEY}`,
      rkey: first,
    }),
    undefined,
  );
});

Deno.test("invalid stored creation keys cannot replace a valid fallback", () => {
  assertEquals(
    appProfileCreationRkeyFromStored("not-a-tid", FIRST_RKEY),
    FIRST_RKEY,
  );
  assertEquals(
    appProfileCreationRkeyStorageKey(
      "did:plc:owner",
      "/apps/manage?new=1",
    ),
    "app-profile:create-rkey:did%3Aplc%3Aowner:%2Fapps%2Fmanage%3Fnew%3D1",
  );
});
