/**
 * "Add another account" entry point for the AccountMenu switcher and
 * for contextual "use another account" actions.
 *
 * The active app session remains intact while the chooser is open. A
 * different account only becomes active after its OAuth callback succeeds,
 * so leaving the chooser does not sign the current account out.
 *
 * Optionally accepts an `intent` query/form param (`user` | `project`) plus
 * action context. Every value is forwarded to the contextual `/signin`
 * picker so replacing the active account cannot silently narrow the pending
 * authorization or lose its return destination.
 *
 * Both GET and POST are deliberately side-effect free. They only open the
 * chooser; a successful OAuth callback performs the eventual account switch.
 */
import { define } from "../../utils.ts";
import {
  readFormDataRequestWithLimit,
  rejectLargeRequest,
  RequestBodyTooLargeError,
} from "../../lib/security.ts";
import {
  normalizeOAuthCapabilities,
  type OAuthCapability,
} from "../../lib/oauth-scopes.ts";
import {
  isOAuthAction,
  isOAuthActionCapabilityRequest,
  type OAuthAction,
  safeOAuthTargetName,
} from "../../lib/oauth-action.ts";
import {
  InvalidOAuthRequestInputError,
  optionalEnum,
  optionalSafeRelativePath,
  rejectSearchFormOverlap,
  repeatedFormStrings,
  repeatedSearchValues,
  singleFormString,
  singleSearchValue,
} from "../../lib/oauth-request-input.ts";
import { hasValidLoginSelectionContinuationBinding } from "../../lib/oauth-continuation.ts";

const MAX_ADD_ACCOUNT_BODY_BYTES = 8_192;
const ADD_ACCOUNT_CONTEXT_FIELDS = [
  "intent",
  "next",
  "capability",
  "action",
  "name",
  "continuation",
] as const;

interface AddAccountAuthorizationContext {
  intent: "user" | "project" | null;
  next: string | null;
  capabilities: readonly OAuthCapability[];
  action: OAuthAction | null;
  targetName: string | null;
  continuation?: "login_selection" | null;
}

export function addAccountSigninLocation(
  context: AddAccountAuthorizationContext,
  options: { requireConfirmation?: boolean; chooseAnother?: boolean } = {},
): string {
  if (
    !isOAuthActionCapabilityRequest(context.action, context.capabilities)
  ) {
    throw new TypeError("invalid action capability combination");
  }
  if (
    !hasValidLoginSelectionContinuationBinding(
      context.next,
      context.continuation,
      context.intent,
      context.action,
      context.capabilities,
    )
  ) {
    throw new TypeError("invalid authorization continuation");
  }
  const params = new URLSearchParams();
  if (context.next) params.set("next", context.next);
  if (context.intent) params.set("intent", context.intent);
  if (context.action) params.set("action", context.action);
  if (context.targetName) params.set("name", context.targetName);
  if (context.continuation) {
    params.set("continuation", context.continuation);
  }
  if (options.requireConfirmation) params.set("permission", "required");
  if (options.chooseAnother) params.set("choose", "another");
  for (const capability of context.capabilities) {
    params.append("capability", capability);
  }
  const query = params.toString();
  return `/signin${query ? `?${query}` : ""}`;
}

export async function handleAddAccountRequest(
  ctx: { req: Request; url: URL },
): Promise<Response> {
  if (ctx.req.method !== "GET") {
    const large = rejectLargeRequest(ctx.req, MAX_ADD_ACCOUNT_BODY_BYTES);
    if (large) return large;
  }
  if (ctx.url.search.length > MAX_ADD_ACCOUNT_BODY_BYTES) {
    return new Response("request URL too large", { status: 414 });
  }
  let intent: "user" | "project" | null;
  let next: string | null;
  let capabilities: OAuthCapability[] | null;
  let action: OAuthAction | null;
  let targetName: string | null;
  let continuation: "login_selection" | null;
  try {
    intent = optionalEnum(
      singleSearchValue(ctx.url.searchParams, "intent"),
      ["user", "project"] as const,
    );
    next = optionalSafeRelativePath(
      singleSearchValue(ctx.url.searchParams, "next"),
    );
    capabilities = normalizeOAuthCapabilities(
      repeatedSearchValues(ctx.url.searchParams, "capability"),
    );
    const rawQueryAction = singleSearchValue(ctx.url.searchParams, "action");
    if (rawQueryAction !== null && !isOAuthAction(rawQueryAction)) {
      throw new InvalidOAuthRequestInputError();
    }
    action = rawQueryAction;
    targetName = safeOAuthTargetName(
      singleSearchValue(ctx.url.searchParams, "name"),
    ) ?? null;
    continuation = optionalEnum(
      singleSearchValue(ctx.url.searchParams, "continuation"),
      ["login_selection"] as const,
    );
    if (ctx.req.method === "POST" && ctx.req.body) {
      const form = await readFormDataRequestWithLimit(
        ctx.req,
        MAX_ADD_ACCOUNT_BODY_BYTES,
      );
      if (!form) throw new InvalidOAuthRequestInputError();
      rejectSearchFormOverlap(
        ctx.url.searchParams,
        form,
        ADD_ACCOUNT_CONTEXT_FIELDS,
      );
      intent = optionalEnum(
        singleFormString(form, "intent"),
        [
          "user",
          "project",
        ] as const,
      ) ?? intent;
      next = optionalSafeRelativePath(singleFormString(form, "next")) ?? next;
      const formCapabilities = repeatedFormStrings(form, "capability");
      if (formCapabilities.length > 0) {
        capabilities = normalizeOAuthCapabilities(formCapabilities);
      }
      const rawAction = singleFormString(form, "action");
      if (rawAction !== null && !isOAuthAction(rawAction)) {
        throw new InvalidOAuthRequestInputError();
      }
      action = rawAction ?? action;
      targetName = safeOAuthTargetName(singleFormString(form, "name")) ??
        targetName;
      continuation = optionalEnum(
        singleFormString(form, "continuation"),
        ["login_selection"] as const,
      ) ?? continuation;
    }
  } catch (error) {
    return new Response(
      error instanceof RequestBodyTooLargeError
        ? "request body too large"
        : "invalid authorization context",
      { status: error instanceof RequestBodyTooLargeError ? 413 : 400 },
    );
  }
  if (!capabilities) {
    return new Response("invalid capability", { status: 400 });
  }
  if (!isOAuthActionCapabilityRequest(action, capabilities)) {
    return new Response("invalid action capability combination", {
      status: 400,
    });
  }
  if (
    !hasValidLoginSelectionContinuationBinding(
      next,
      continuation,
      intent,
      action,
      capabilities,
    )
  ) {
    return new Response("invalid authorization continuation", {
      status: 400,
    });
  }
  const signin = addAccountSigninLocation(
    { intent, next, capabilities, action, targetName, continuation },
    { requireConfirmation: true, chooseAnother: true },
  );
  return new Response(null, {
    status: 303,
    headers: { location: signin, "cache-control": "no-store" },
  });
}

export const handler = define.handlers({
  GET: handleAddAccountRequest,
  POST: handleAddAccountRequest,
});
