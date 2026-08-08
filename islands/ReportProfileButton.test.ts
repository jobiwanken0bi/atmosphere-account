import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import ReportProfileButton, {
  reportProfileFailureMessage,
  reportProfileSubmissionResult,
} from "./ReportProfileButton.tsx";

const copy = {
  button: "Report profile",
  modalTitle: "Report this profile",
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
  duplicate: "You’ve already sent this report.",
  error: "Couldn’t send the report. Please try again.",
  reasons: {
    not_a_project: "Not a real project",
    harmful: "Harmful or hateful content",
    impersonation: "Impersonating someone",
    spam: "Spam",
    other: "Other",
  },
};

Deno.test("profile reports never surface technical server errors", () => {
  assertEquals(
    reportProfileFailureMessage(
      "Couldn’t send the report. Please try again.",
    ),
    "Couldn’t send the report. Please try again.",
  );
});

Deno.test("profile report deduplication uses its intended friendly state", () => {
  assertEquals(
    reportProfileSubmissionResult({ ok: true, deduped: true }),
    "duplicate",
  );
  assertEquals(reportProfileSubmissionResult({ ok: true }), "ok");
  assertEquals(reportProfileSubmissionResult("unexpected"), "error");
  assertEquals(reportProfileSubmissionResult({ deduped: true }), "error");
});

Deno.test("profile report trigger stays short and does not require sign-in", () => {
  const html = renderToString(h(ReportProfileButton, {
    targetId: "example.test",
    copy,
  }));

  assertStringIncludes(html, ">Report profile</button>");
  assertEquals(html.includes("/signin"), false);
});
