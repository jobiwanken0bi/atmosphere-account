import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { authActionCopy } from "../../lib/oauth-action-copy.ts";
import {
  RelationshipAddAccountForm,
  RelationshipAuthorizationFields,
  RelationshipSwitchForm,
} from "./confirm.tsx";

Deno.test("relationship account changes retain identity-only action context", () => {
  const html = renderToString(h(RelationshipAuthorizationFields, {
    targetName: "Example App and Example Host",
  }));

  assertStringIncludes(
    html,
    'name="action" value="relationship_confirm"',
  );
  assertStringIncludes(
    html,
    'name="name" value="Example App and Example Host"',
  );
  assertStringIncludes(html, 'name="capability" value="identity"');
});

Deno.test("relationship saved switch and add-account actions are contextual POSTs", () => {
  const next = "/relationships/confirm?host=pds.example&app=one";
  const targetName = "Example App and Example Host";
  const switchHtml = renderToString(h(RelationshipSwitchForm, {
    did: "did:plc:host-owner",
    handle: "owner.example",
    next,
    targetName,
  }));
  const addHtml = renderToString(h(RelationshipAddAccountForm, {
    next,
    targetName,
  }));

  assertStringIncludes(switchHtml, 'method="POST" action="/oauth/switch"');
  assertStringIncludes(switchHtml, 'name="did" value="did:plc:host-owner"');
  assertStringIncludes(addHtml, 'method="POST" action="/oauth/add-account"');
  assertEquals(addHtml.includes('href="/oauth/add-account'), false);
  for (const html of [switchHtml, addHtml]) {
    assertStringIncludes(
      html,
      'name="next" value="/relationships/confirm?host=pds.example&amp;app=one"',
    );
    assertStringIncludes(
      html,
      'name="action" value="relationship_confirm"',
    );
    assertStringIncludes(html, 'name="capability" value="identity"');
    assertStringIncludes(
      html,
      'name="name" value="Example App and Example Host"',
    );
  }
});

Deno.test("relationship chooser correctly describes either-side approval", () => {
  const copy = authActionCopy(
    "relationship_confirm",
    "Example App and Example Host",
  );
  assertStringIncludes(copy.signInBody, "app or account host");
  assertEquals(copy.signInBody.includes("controls both"), false);
  assertStringIncludes(
    copy.upgradeBody("owner.example"),
    "connect Example App and Example Host",
  );
});
