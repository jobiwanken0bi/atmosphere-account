import type { BlobRef } from "./lexicons.ts";
import {
  buildHostProfileRecord,
  buildHostServiceRecord,
  HOST_CAPABILITY_DASHBOARD,
  HOST_CAPABILITY_EXTERNAL,
  HOST_CAPABILITY_OAUTH_GRANTS,
  HOST_CAPABILITY_PLANNED,
  HOST_IMAGE_PURPOSE_AVATAR,
  HOST_LINK_ROLE_HOMEPAGE,
  HOST_LINK_ROLE_SUPPORT,
  HOST_SIGNUP_VALUES,
  HostProfileServiceRefsLimitError,
  type HostRecordInput,
  hostServiceRkey,
  mergeHostProfileRecordForTest,
  publishHostProfileRecordWithIoForTest,
} from "./host-records.ts";
import { PdsRecordWriteError, type PutRecordOptions } from "./pds.ts";

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

const OWNER_DID = "did:plc:hostoperator";

function recordInput(
  host: string,
  displayName = host,
): HostRecordInput {
  return {
    host,
    displayName,
    serviceEndpoint: `https://pds.${host}`,
    signupStatus: "open",
    createdAt: "2026-06-26T00:00:00.000Z",
    updatedAt: "2026-06-26T01:00:00.000Z",
  };
}

function serviceUri(host: string, did = OWNER_DID): string {
  return `at://${did}/account.atmosphere.host.service/${host}`;
}

Deno.test("hostServiceRkey normalizes host domains", () => {
  assertEquals(hostServiceRkey(" Pckt.Cafe "), "pckt.cafe");
});

Deno.test("buildHostServiceRecord creates account.atmosphere.host.service shape", () => {
  const record = buildHostServiceRecord({
    host: "Pckt.Cafe",
    displayName: "Pckt",
    description: "A cozy host.",
    dataLocation: "Europe",
    homepageUrl: "https://pckt.cafe",
    signupUrl: "https://pckt.cafe/signup",
    serviceEndpoint: "https://pds.pckt.cafe",
    accountManagementUrl: "https://pds.pckt.cafe/account",
    supportUrl: "https://pckt.cafe/support",
    signupStatus: "open",
    createdAt: "2026-06-26T00:00:00.000Z",
  });

  assertEquals(record.host, "pckt.cafe");
  assertEquals(record.regions, ["Europe"]);
  assertEquals(record.accountManagementUrl, "https://pds.pckt.cafe/account");
  assertEquals(
    (record.signup as Record<string, unknown>).status,
    HOST_SIGNUP_VALUES.open,
  );
  assertEquals(
    (record.signup as Record<string, unknown>).url,
    "https://pckt.cafe/signup",
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
  assert(
    (record.capabilities as Array<Record<string, string>>).some((capability) =>
      capability.id === HOST_CAPABILITY_OAUTH_GRANTS &&
      capability.status === HOST_CAPABILITY_PLANNED &&
      !capability.url
    ),
  );
});

Deno.test("buildHostServiceRecord omits guessed account page when not provided", () => {
  const record = buildHostServiceRecord({
    host: "Pckt.Cafe",
    displayName: "Pckt",
    serviceEndpoint: "https://pds.pckt.cafe",
    signupStatus: "open",
    createdAt: "2026-06-26T00:00:00.000Z",
  });

  assertEquals(record.accountManagementUrl, undefined);
  assert(
    !(record.capabilities as Array<Record<string, string>>).some(
      (capability) => capability.url === "https://pds.pckt.cafe/account",
    ),
  );
});

Deno.test("buildHostServiceRecord omits unsafe public links", () => {
  const record = buildHostServiceRecord({
    host: "Pckt.Cafe",
    displayName: "Pckt",
    homepageUrl: "http://pckt.cafe",
    signupUrl: "http://pckt.cafe/signup",
    serviceEndpoint: "https://192.168.1.10",
    accountManagementUrl: "https://127.0.0.1/account",
    supportUrl: "https://user:pass@pckt.cafe/support",
    signupStatus: "open",
    createdAt: "2026-06-26T00:00:00.000Z",
  });

  assertEquals(record.serviceEndpoint, undefined);
  assertEquals(record.accountManagementUrl, undefined);
  assertEquals((record.signup as Record<string, unknown>).url, undefined);
  assertEquals(record.links, undefined);
  assert(
    !(record.capabilities as Array<Record<string, string>>).some(
      (capability) => capability.url,
    ),
  );
});

Deno.test("buildHostProfileRecord omits unsafe public links", () => {
  const record = buildHostProfileRecord({
    host: "pckt.cafe",
    displayName: "Pckt",
    homepageUrl: "http://pckt.cafe",
    supportUrl: "https://localhost/support",
    serviceEndpoint: "https://pds.pckt.cafe",
    signupStatus: "open",
  }, "at://did:plc:host/account.atmosphere.host.service/pckt.cafe");

  assertEquals(record.links, undefined);
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

Deno.test("host profile merge adds a second host without dropping the first", () => {
  const existing = {
    $type: "account.atmosphere.host.profile",
    name: "Operator",
    createdAt: "2026-06-01T00:00:00.000Z",
    operatorType: "account.atmosphere.host.defs#operatorCompany",
    futureCompatibleField: { version: 2 },
    serviceRefs: [{
      uri: serviceUri("one.example"),
      host: "one.example",
      futureRefField: "keep me",
    }],
  };

  const merged = mergeHostProfileRecordForTest(
    existing,
    OWNER_DID,
    recordInput("two.example", "Two"),
    serviceUri("two.example"),
  );

  assertEquals(merged.name, "Two");
  assertEquals(
    merged.operatorType,
    "account.atmosphere.host.defs#operatorCompany",
  );
  assertEquals(merged.futureCompatibleField, { version: 2 });
  assertEquals(merged.$type, undefined);
  assertEquals(merged.serviceRefs, [
    {
      uri: serviceUri("one.example"),
      host: "one.example",
      futureRefField: "keep me",
    },
    {
      uri: serviceUri("two.example"),
      host: "two.example",
    },
  ]);
});

Deno.test("host profile merge updates one host while retaining other hosts", () => {
  const merged = mergeHostProfileRecordForTest(
    {
      name: "Operator",
      createdAt: "2026-06-01T00:00:00.000Z",
      serviceRefs: [
        {
          uri: serviceUri("one.example"),
          host: "one.example",
          label: "first",
        },
        {
          uri: serviceUri("two.example"),
          host: "TWO.EXAMPLE",
          label: "second",
        },
      ],
    },
    OWNER_DID,
    recordInput("two.example", "Two updated"),
    serviceUri("two.example"),
  );

  assertEquals(merged.serviceRefs, [
    {
      uri: serviceUri("one.example"),
      host: "one.example",
      label: "first",
    },
    {
      uri: serviceUri("two.example"),
      host: "two.example",
      label: "second",
    },
  ]);
});

Deno.test("host profile merge rejects unowned refs and deduplicates valid refs", () => {
  const merged = mergeHostProfileRecordForTest(
    {
      serviceRefs: [
        { uri: serviceUri("one.example"), host: "one.example" },
        { uri: serviceUri("one.example"), host: "one.example" },
        {
          uri: serviceUri("attacker.example", "did:plc:attacker"),
          host: "attacker.example",
        },
        {
          uri: `at://${OWNER_DID}/account.atmosphere.host.profile/bad.example`,
          host: "bad.example",
        },
        "not a service ref",
      ],
    },
    OWNER_DID,
    recordInput("two.example"),
    serviceUri("two.example"),
  );

  assertEquals(merged.serviceRefs, [
    { uri: serviceUri("one.example"), host: "one.example" },
    { uri: serviceUri("two.example"), host: "two.example" },
  ]);
});

Deno.test("host profile merge fails safely at the serviceRefs limit", () => {
  const serviceRefs = Array.from({ length: 32 }, (_, index) => ({
    uri: serviceUri(`host-${index}.example`),
    host: `host-${index}.example`,
  }));
  let error: unknown;
  try {
    mergeHostProfileRecordForTest(
      { serviceRefs },
      OWNER_DID,
      recordInput("another.example"),
      serviceUri("another.example"),
    );
  } catch (value) {
    error = value;
  }
  assert(
    error instanceof HostProfileServiceRefsLimitError,
    "expected the merge to refuse to discard an existing host reference",
  );
});

Deno.test("host profile publishing retries CAS conflicts with the latest refs", async () => {
  let readCount = 0;
  const writes: Array<{
    record: Record<string, unknown>;
    options: PutRecordOptions | undefined;
  }> = [];

  const result = await publishHostProfileRecordWithIoForTest(
    { did: OWNER_DID },
    "https://pds.example",
    recordInput("two.example"),
    serviceUri("two.example"),
    {
      readRecord: () => {
        readCount++;
        return Promise.resolve({
          uri: `at://${OWNER_DID}/account.atmosphere.host.profile/self`,
          cid: readCount === 1 ? "cid-before" : "cid-after-conflict",
          value: {
            futureCompatibleField: readCount,
            serviceRefs: readCount === 1
              ? [{
                uri: serviceUri("one.example"),
                host: "one.example",
              }]
              : [
                {
                  uri: serviceUri("one.example"),
                  host: "one.example",
                },
                {
                  uri: serviceUri("three.example"),
                  host: "three.example",
                },
              ],
          },
        });
      },
      writeRecord: (
        _did,
        _pdsUrl,
        _collection,
        _rkey,
        record,
        options,
      ) => {
        writes.push({ record, options });
        if (writes.length === 1) {
          throw new PdsRecordWriteError(
            "putRecord",
            400,
            JSON.stringify({ error: "InvalidSwap" }),
          );
        }
        return Promise.resolve({
          uri: `at://${OWNER_DID}/account.atmosphere.host.profile/self`,
          cid: "cid-written",
        });
      },
    },
  );

  assertEquals(result.cid, "cid-written");
  assertEquals(readCount, 2);
  assertEquals(writes[0].options?.swapRecord, "cid-before");
  assertEquals(writes[1].options?.swapRecord, "cid-after-conflict");
  assertEquals(writes[1].record.futureCompatibleField, 2);
  assertEquals(writes[1].record.serviceRefs, [
    { uri: serviceUri("one.example"), host: "one.example" },
    { uri: serviceUri("three.example"), host: "three.example" },
    { uri: serviceUri("two.example"), host: "two.example" },
  ]);
});

Deno.test("new host profile publishing asserts that self does not exist", async () => {
  let swapRecord: string | null | undefined = "not-called";
  await publishHostProfileRecordWithIoForTest(
    { did: OWNER_DID },
    "https://pds.example",
    recordInput("one.example"),
    serviceUri("one.example"),
    {
      readRecord: () => Promise.resolve(null),
      writeRecord: (
        _did,
        _pdsUrl,
        _collection,
        _rkey,
        _record,
        options,
      ) => {
        swapRecord = options?.swapRecord;
        return Promise.resolve({
          uri: `at://${OWNER_DID}/account.atmosphere.host.profile/self`,
          cid: "cid-created",
        });
      },
    },
  );
  assertEquals(swapRecord, null);
});
