import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  APP_PROFILE_DELETED_RETURN_TO,
  appProfileCreateRkeyForPayload,
  appProfileCreationRkeyForSession,
  appProfileCreationRkeyFromStored,
  appProfileCreationRkeyStorageKey,
  armAppProfileResume,
  cancelAppProfileReauthorization,
  clearAppProfileCreationRkey,
  resetDeletedAppProfileState,
  shouldHandleProfileEditorSubmit,
} from "./CreateProfileForm.tsx";
import {
  armHostProfileResume,
  cancelHostProfileReauthorization,
  hostProfileResponseNeedsAuthorization,
} from "./HostProfileSaveButton.tsx";

function memorySessionStorage() {
  const values = new Map<string, string>();
  return {
    values,
    storage: {
      getItem(key: string) {
        return values.get(key) ?? null;
      },
      setItem(key: string, value: string) {
        values.set(key, value);
      },
      removeItem(key: string) {
        values.delete(key);
      },
    },
  };
}

Deno.test("first app publication always carries a client-stable record key", () => {
  assertEquals(
    appProfileCreateRkeyForPayload({
      createNewListing: false,
      published: false,
      atstoreListingUri: null,
      rkey: "3mzzzzzzzzzzz",
    }),
    "3mzzzzzzzzzzz",
  );
  assertEquals(
    appProfileCreateRkeyForPayload({
      createNewListing: false,
      published: true,
      atstoreListingUri:
        "at://did:plc:app/fyi.atstore.listing.detail/3mzzzzzzzzzzz",
      rkey: "3mzzzzzzzzzza",
    }),
    undefined,
  );
});

Deno.test("unfinished app record keys stay in one DID, context, and tab", () => {
  const ownerDid = "did:plc:owner";
  const registrationContext = "/apps/manage?new=1&from=directory";
  const firstTab = memorySessionStorage();
  const firstRkey = appProfileCreationRkeyForSession(
    ownerDid,
    registrationContext,
    "3mzzzzzzzzzzz",
    firstTab.storage,
  );

  // A reload in this tab and registration flow keeps the reserved target.
  assertEquals(
    appProfileCreationRkeyForSession(
      ownerDid,
      registrationContext,
      "3mzzzzzzzzzza",
      firstTab.storage,
    ),
    firstRkey,
  );

  // Invalid persisted input is replaced before it can reach the PDS.
  const firstKey = appProfileCreationRkeyStorageKey(
    ownerDid,
    registrationContext,
  );
  firstTab.values.set(firstKey, "not-a-tid");
  assertEquals(
    appProfileCreationRkeyForSession(
      ownerDid,
      registrationContext,
      "3mzzzzzzzzzza",
      firstTab.storage,
    ),
    "3mzzzzzzzzzza",
  );

  // Another DID and another exact entry point receive independent targets.
  assertEquals(
    appProfileCreationRkeyForSession(
      "did:plc:other",
      registrationContext,
      "3mzzzzzzzzzzy",
      firstTab.storage,
    ),
    "3mzzzzzzzzzzy",
  );
  assertEquals(
    appProfileCreationRkeyForSession(
      ownerDid,
      "/apps/manage?new=1&from=account",
      "3mzzzzzzzzzzx",
      firstTab.storage,
    ),
    "3mzzzzzzzzzzx",
  );

  // sessionStorage is tab-local; a separate tab starts with its own TID.
  const secondTab = memorySessionStorage();
  assertEquals(
    appProfileCreationRkeyForSession(
      ownerDid,
      registrationContext,
      "3mzzzzzzzzzzw",
      secondTab.storage,
    ),
    "3mzzzzzzzzzzw",
  );

  clearAppProfileCreationRkey(
    ownerDid,
    registrationContext,
    firstTab.storage,
  );
  assertEquals(firstTab.storage.getItem(firstKey), null);
  assertEquals(
    firstTab.storage.getItem(
      appProfileCreationRkeyStorageKey("did:plc:other", registrationContext),
    ),
    "3mzzzzzzzzzzy",
  );
});

Deno.test("stored app record keys reject an invalid fallback", () => {
  let threw = false;
  try {
    appProfileCreationRkeyFromStored("not-a-tid", "also-not-a-tid");
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});

Deno.test("successful app deletion cannot leave a stale listing target", () => {
  const state = {
    published: { value: true as boolean },
    publicPath: { value: "/apps/example" as string | null },
    currentAtstoreListingUri: {
      value: "at://did:plc:owner/fyi.atstore.listing.detail/3mzzzzzzzzzzz" as
        | string
        | null,
    },
    hostAppIdentifier: { value: "example" as string | null },
    createNewListingPending: { value: false as boolean },
  };

  resetDeletedAppProfileState(state);

  assertEquals(state.published.value, false);
  assertEquals(state.publicPath.value, null);
  assertEquals(state.currentAtstoreListingUri.value, null);
  assertEquals(state.hostAppIdentifier.value, null);
  assertEquals(state.createNewListingPending.value, true);
  assertEquals(APP_PROFILE_DELETED_RETURN_TO, "/account/products");
});

Deno.test("closing host-profile authorization clears its draft and resume marker", async () => {
  const cleared: string[] = [];
  const replaced: string[] = [];
  const removed: string[] = [];

  await cancelHostProfileReauthorization("host-profile:pending", {
    href:
      "https://atmosphereaccount.com/hosts/pds.example/manage?tab=profile&resume_host_profile=1#editor",
    replaceLocation: (location) => replaced.push(location),
    clearPending: (key) => {
      cleared.push(key);
      return Promise.resolve();
    },
    storage: {
      removeItem(key) {
        removed.push(key);
      },
    },
  });

  assertEquals(replaced, ["/hosts/pds.example/manage?tab=profile#editor"]);
  assertEquals(cleared, ["host-profile:pending"]);
  assertEquals(removed.length, 1);
});

Deno.test("app editor does not intercept a submitter with its own action", () => {
  assertEquals(shouldHandleProfileEditorSubmit(null), true);
  assertEquals(
    shouldHandleProfileEditorSubmit({
      hasAttribute(name: string) {
        return name === "formaction";
      },
    } as unknown as EventTarget),
    false,
  );
  assertEquals(
    shouldHandleProfileEditorSubmit({
      hasAttribute() {
        return false;
      },
    } as unknown as EventTarget),
    true,
  );
});

Deno.test("closing app-profile authorization clears its draft and DID resume marker", async () => {
  const cleared: string[] = [];
  const replaced: string[] = [];
  const removed: string[] = [];

  await cancelAppProfileReauthorization("app-profile:pending", {
    href:
      "https://atmosphereaccount.com/apps/manage?new=1&app-profile-resume=did%3Aplc%3Aowner#editor",
    replaceLocation: (location) => replaced.push(location),
    clearPending: (key) => {
      cleared.push(key);
      return Promise.resolve();
    },
    storage: {
      removeItem(key) {
        removed.push(key);
      },
    },
  });

  assertEquals(replaced, ["/apps/manage?new=1#editor"]);
  assertEquals(cleared, ["app-profile:pending"]);
  assertEquals(removed.length, 1);
});

Deno.test("closing a draft prompt without a current marker still clears the draft", async () => {
  const cleared: string[] = [];
  let replaced = false;

  await cancelAppProfileReauthorization("app-profile:pending", {
    href: "https://atmosphereaccount.com/apps/manage?new=1",
    replaceLocation: () => {
      replaced = true;
    },
    clearPending: (key) => {
      cleared.push(key);
      return Promise.resolve();
    },
  });

  assertEquals(replaced, false);
  assertEquals(cleared, ["app-profile:pending"]);
});

Deno.test("host profile treats expired-session redirects as authorization", () => {
  assertEquals(
    hostProfileResponseNeedsAuthorization({
      status: 0,
      type: "opaqueredirect",
      redirected: false,
      url: "",
    }),
    true,
  );
  assertEquals(
    hostProfileResponseNeedsAuthorization({
      status: 200,
      type: "basic",
      redirected: true,
      url: "https://atmosphereaccount.com/signin?next=%2Fhosts%2Fpds%2Fmanage",
    }),
    true,
  );
  assertEquals(
    hostProfileResponseNeedsAuthorization({
      status: 200,
      type: "basic",
      redirected: false,
      url: "https://atmosphereaccount.com/hosts/pds/manage",
    }),
    false,
  );
});

Deno.test("management resume proof is armed only when browser storage accepts it", () => {
  const values = new Map<string, string>();
  const storage = {
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
  assertEquals(
    armAppProfileResume(
      "app-proof",
      storage,
    ),
    true,
  );
  assertEquals(
    armHostProfileResume(
      "host-proof",
      storage,
    ),
    true,
  );
  assertEquals(values.has("app-proof"), true);
  assertEquals(values.has("host-proof"), true);

  const blocked = {
    setItem() {
      throw new Error("blocked");
    },
  };
  assertEquals(
    armAppProfileResume("app-proof", blocked),
    false,
  );
  assertEquals(
    armHostProfileResume("host-proof", blocked),
    false,
  );
});
