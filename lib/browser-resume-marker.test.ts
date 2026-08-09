import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  browserResumeMarkerValue,
  isFreshBrowserResumeMarker,
} from "./browser-resume-marker.ts";

Deno.test("browser resume marker stores freshness without account or resource data", () => {
  const now = 2_000_000;
  const marker = browserResumeMarkerValue(now);

  assertEquals(marker, JSON.stringify({ savedAt: now }));
  assertEquals(marker.includes("did:plc:alice"), false);
  assertEquals(marker.includes("host-profile"), false);
  assertEquals(isFreshBrowserResumeMarker(marker, now), true);
});

Deno.test("browser resume marker rejects expanded, malformed, future, and stale values", () => {
  const now = 2_000_000;

  assertEquals(isFreshBrowserResumeMarker(null, now), false);
  assertEquals(isFreshBrowserResumeMarker("not json", now), false);
  assertEquals(
    isFreshBrowserResumeMarker(
      JSON.stringify({ savedAt: now, ownerDid: "did:plc:alice" }),
      now,
    ),
    false,
  );
  assertEquals(
    isFreshBrowserResumeMarker(browserResumeMarkerValue(now + 1), now),
    false,
  );
  assertEquals(
    isFreshBrowserResumeMarker(
      browserResumeMarkerValue(now - 30 * 60 * 1_000 - 1),
      now,
    ),
    false,
  );
});
