import type { BlobRef } from "./lexicons.ts";
import {
  buildHostProfileRecord,
  buildHostServiceRecord,
  HOST_CAPABILITY_DASHBOARD,
  HOST_CAPABILITY_EXTERNAL,
  HOST_IMAGE_PURPOSE_AVATAR,
  HOST_LINK_ROLE_HOMEPAGE,
  HOST_LINK_ROLE_SUPPORT,
  HOST_SIGNUP_VALUES,
  hostServiceRkey,
} from "./host-records.ts";

function assert(condition: unknown, message = "Assertion failed"): void {
  if (!condition) throw new Error(message);
}

function assertEquals(actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`Expected ${e}, got ${a}`);
}

const avatar: BlobRef = {
  $type: "blob",
  ref: { $link: "bafkreihostavatar" },
  mimeType: "image/png",
  size: 1234,
};

Deno.test("hostServiceRkey normalizes host domains", () => {
  assertEquals(hostServiceRkey(" Pckt.Cafe "), "pckt.cafe");
});

Deno.test("buildHostServiceRecord creates account.atmosphere.host.service shape", () => {
  const record = buildHostServiceRecord({
    host: "Pckt.Cafe",
    displayName: "Pckt",
    description: "A cozy host.",
    homepageUrl: "https://pckt.cafe",
    serviceEndpoint: "https://pds.pckt.cafe",
    supportUrl: "https://pckt.cafe/support",
    signupStatus: "open",
    createdAt: "2026-06-26T00:00:00.000Z",
  });

  assertEquals(record.host, "pckt.cafe");
  assertEquals(record.accountManagementUrl, "https://pds.pckt.cafe/account");
  assertEquals(
    (record.signup as Record<string, unknown>).status,
    HOST_SIGNUP_VALUES.open,
  );
  assertEquals(record.hostPatterns, ["pckt.cafe"]);
  assert(
    (record.links as Array<Record<string, string>>).some((link) =>
      link.role === HOST_LINK_ROLE_HOMEPAGE &&
      link.url === "https://pckt.cafe"
    ),
  );
  assert(
    (record.links as Array<Record<string, string>>).some((link) =>
      link.role === HOST_LINK_ROLE_SUPPORT &&
      link.url === "https://pckt.cafe/support"
    ),
  );
  assert(
    (record.capabilities as Array<Record<string, string>>).some((capability) =>
      capability.id === HOST_CAPABILITY_DASHBOARD &&
      capability.status === HOST_CAPABILITY_EXTERNAL &&
      capability.url === "https://pds.pckt.cafe/account"
    ),
  );
});

Deno.test("buildHostProfileRecord references service record and avatar blob", () => {
  const record = buildHostProfileRecord({
    host: "pckt.cafe",
    displayName: "Pckt",
    description: "A cozy host.",
    homepageUrl: "https://pckt.cafe",
    serviceEndpoint: "https://pds.pckt.cafe",
    signupStatus: "open",
    avatar,
    createdAt: "2026-06-26T00:00:00.000Z",
    updatedAt: "2026-06-26T01:00:00.000Z",
  }, "at://did:plc:host/account.atmosphere.host.service/pckt.cafe");

  assertEquals(record.name, "Pckt");
  assertEquals(record.updatedAt, "2026-06-26T01:00:00.000Z");
  assertEquals(
    record.serviceRefs,
    [{
      uri: "at://did:plc:host/account.atmosphere.host.service/pckt.cafe",
      host: "pckt.cafe",
    }],
  );
  const images = record.images as Array<Record<string, unknown>>;
  assertEquals(images[0].purpose, HOST_IMAGE_PURPOSE_AVATAR);
  assertEquals(images[0].image, avatar);
});
