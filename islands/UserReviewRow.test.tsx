import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import UserReviewRow from "./UserReviewRow.tsx";

Deno.test("UserReviewRow keeps View app with the app identity", () => {
  const html = renderToString(h(UserReviewRow, {
    reviewId: 7,
    targetHandle: "field-notes.test",
    targetName: "Field Notes",
    rating: 4,
    body: "A useful app.",
    updatedAt: Date.UTC(2026, 7, 11),
    currentDid: "did:plc:reviewer",
    currentHandle: "reviewer.test",
    copy: {
      viewProject: "View app",
      delete: "Delete review",
      confirmDelete: "Delete this review?",
      deleting: "Deleting…",
      deleted: "Review deleted.",
      error: "Couldn’t update the review",
    },
  }));

  const identityStart = html.indexOf('class="user-review-row-app"');
  const identityEnd = html.indexOf('class="profile-review-stars"');
  const actionsStart = html.indexOf('class="user-review-row-actions"');
  const actionsEnd = html.indexOf("</article>");

  assertStringIncludes(
    html.slice(identityStart, identityEnd),
    ">View app</a>",
  );
  assertStringIncludes(
    html.slice(identityStart, identityEnd),
    "@field-notes.test",
  );
  assertEquals(
    html.slice(actionsStart, actionsEnd).includes(">View app</a>"),
    false,
  );
  assertStringIncludes(
    html.slice(actionsStart, actionsEnd),
    ">Delete review</button>",
  );
});
