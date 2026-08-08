import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  armAppProfileResume,
  cancelAppProfileReauthorization,
  shouldHandleProfileEditorSubmit,
} from "./CreateProfileForm.tsx";
import {
  armHostProfileResume,
  cancelHostProfileReauthorization,
  hostProfileResponseNeedsAuthorization,
} from "./HostProfileSaveButton.tsx";

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
