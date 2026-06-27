import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  parseHostProfileRecord,
  parseHostServiceRecord,
} from "./host-record-indexing.ts";
import {
  HOST_IMAGE_PURPOSE_AVATAR,
  HOST_LINK_ROLE_HOMEPAGE,
  HOST_LINK_ROLE_SUPPORT,
} from "./host-records.ts";
import { HOST_PROFILE_NSID, HOST_SERVICE_NSID } from "./lexicons.ts";

Deno.test("parseHostServiceRecord normalizes host service records", () => {
  const parsed = parseHostServiceRecord({
    uri: "at://did:plc:host/account.atmosphere.host.service/example.com",
    cid: "bafyservice",
    collection: HOST_SERVICE_NSID,
    repoDid: "did:plc:host",
    rkey: "example.com",
    authorHandle: "host.example",
    value: {
      host: "Example.COM",
      displayName: "Example Host",
      description: "A friendly PDS host.",
      serviceEndpoint: "https://pds.example.com/",
      hostPatterns: ["example.com", "*.example.net"],
      signup: {
        status: "account.atmosphere.host.defs#signupInviteOnly",
        url: "https://example.com/signup",
      },
      links: [
        { role: HOST_LINK_ROLE_HOMEPAGE, url: "https://example.com/" },
        { role: HOST_LINK_ROLE_SUPPORT, url: "https://example.com/help" },
      ],
      dashboardManifestUrl:
        "https://example.com/.well-known/atmosphere-host-dashboard.json",
      createdAt: "2026-06-01T00:00:00.000Z",
    },
  });

  assertEquals(parsed?.kind, "service");
  assertEquals(parsed?.host, "example.com");
  assertEquals(parsed?.serviceEndpoint, "https://pds.example.com");
  assertEquals(parsed?.accountManagementUrl, "https://pds.example.com/account");
  assertEquals(parsed?.homepageUrl, "https://example.com/");
  assertEquals(parsed?.supportUrl, "https://example.com/help");
  assertEquals(parsed?.signupStatus, "invite_required");
  assertEquals(parsed?.matchPatterns, ["example.com", "*.example.net"]);
});

Deno.test("parseHostProfileRecord reads profile brand fields and PDS blobs", () => {
  const parsed = parseHostProfileRecord({
    uri: "at://did:plc:host/account.atmosphere.host.profile/self",
    cid: "bafyprofile",
    collection: HOST_PROFILE_NSID,
    repoDid: "did:plc:host",
    rkey: "self",
    authorHandle: "host.example",
    value: {
      name: "Example Host",
      description: "Community-run hosting.",
      links: [{ role: HOST_LINK_ROLE_HOMEPAGE, url: "https://example.com/" }],
      images: [{
        purpose: HOST_IMAGE_PURPOSE_AVATAR,
        image: {
          $type: "blob",
          ref: { $link: "bafyavatar" },
          mimeType: "image/png",
          size: 1234,
        },
      }],
      serviceRefs: [{
        uri: "at://did:plc:host/account.atmosphere.host.service/example.com",
        host: "example.com",
      }],
      contact: { url: "https://example.com/support" },
      createdAt: "2026-06-01T00:00:00.000Z",
    },
  });

  assertEquals(parsed?.kind, "profile");
  assertEquals(parsed?.name, "Example Host");
  assertEquals(parsed?.homepageUrl, "https://example.com/");
  assertEquals(parsed?.supportUrl, "https://example.com/support");
  assertEquals(
    parsed?.avatarUrl,
    "/api/atproto/blob?did=did%3Aplc%3Ahost&cid=bafyavatar",
  );
  assertEquals(parsed?.serviceRefs, [{
    uri: "at://did:plc:host/account.atmosphere.host.service/example.com",
    host: "example.com",
  }]);
});
