import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { reviewReportReturnTo } from "../components/explore/ProfileReviewList.tsx";
import ReportReviewButton, {
  parseOwnedReportReviewDraft,
  reportReviewDraftKey,
  reportReviewFailureMessage,
  reportReviewReauthorization,
} from "./ReportReviewButton.tsx";

const copy = {
  button: "Report review",
  modalTitle: "Report this review",
  modalBody: "Send a report to the Atmosphere admins.",
  reasonLabel: "What’s wrong?",
  detailsLabel: "Add details (optional)",
  detailsPlaceholder: "Anything we should know?",
  submit: "Send report",
  submitting: "Sending…",
  cancel: "Cancel",
  done: "Close",
  sentTitle: "Report sent",
  sentBody: "Thanks. An admin will review it shortly.",
  error: "Couldn’t send the report. Please try again.",
  reasons: {
    harmful: "Harmful or hateful content",
    spam: "Spam",
    off_topic: "Off-topic or not useful",
    other: "Other",
  },
};

Deno.test("signed-out review report control retains a contextual no-JS fallback", () => {
  const loginHref =
    "/signin?next=%2Fapps%2Fexample.test%3Freport%3D42&action=report_review&name=Example&capability=identity";
  const html = renderToString(h(ReportReviewButton, {
    reviewId: 42,
    signedIn: false,
    loginHref,
    returnTo: "/apps/example.test?report=42",
    targetName: "Example",
    rememberedAccounts: [{
      did: "did:plc:alice",
      handle: "alice.example",
    }],
    copy,
  }));

  assertStringIncludes(html, `href="${loginHref.replaceAll("&", "&amp;")}"`);
  assertStringIncludes(html, ">Report review</a>");
  assertEquals(html.includes("disabled"), false);
});

Deno.test("report drafts are isolated by account and review", () => {
  assertEquals(
    reportReviewDraftKey(42, "did:plc:alice"),
    "atmosphere:review-report-draft:did%3Aplc%3Aalice:42",
  );
  const value = JSON.stringify({
    ownerDid: "did:plc:alice",
    reason: "spam",
    details: "Private context",
  });
  assertEquals(parseOwnedReportReviewDraft(value, "did:plc:alice"), {
    reason: "spam",
    details: "Private context",
  });
  assertEquals(parseOwnedReportReviewDraft(value, "did:plc:bob"), null);
});

Deno.test("review report return marker preserves the originating page state", () => {
  assertEquals(
    reviewReportReturnTo("/apps/example.test?reviews=newest#reviews", 42),
    "/apps/example.test?reviews=newest&report=42#reviews",
  );
});

Deno.test("signed-in review report control opens the report dialog directly", () => {
  const html = renderToString(h(ReportReviewButton, {
    reviewId: 42,
    signedIn: true,
    loginHref: "/signin",
    returnTo: "/apps/example.test",
    targetName: "Example",
    copy,
  }));

  assertStringIncludes(html, 'type="button"');
  assertStringIncludes(html, ">Report review</button>");
  assertEquals(html.includes('href="/signin"'), false);
});

Deno.test("review reports never surface technical server errors", () => {
  assertEquals(
    reportReviewFailureMessage(
      copy.error,
      "SQLITE_CONSTRAINT: internal review id 42",
    ),
    "Couldn’t send the report. Please try again.",
  );
});

Deno.test("an expired site session reopens contextual report authorization", () => {
  const authorization = reportReviewReauthorization(
    401,
    { error: "not_authenticated" },
    "/apps/example.test?report=42",
    "Example",
  );
  assertEquals(authorization?.action, "report_review");
  assertEquals(authorization?.capabilities, ["identity"]);
  assertEquals(authorization?.returnTo, "/apps/example.test?report=42");
  assertEquals(
    reportReviewReauthorization(
      500,
      { error: "database_unavailable" },
      "/apps/example.test?report=42",
      "Example",
    ),
    null,
  );
});
