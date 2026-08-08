import { asset } from "fresh/runtime";

const SIGNIN_PREVIEW_SRC = asset("/signin-preview.js");
const LOGIN_HANDOFF_SRC = asset("/login-handoff.js");

function loadModuleOnce(id: string, src: string): void {
  if (document.getElementById(id)) return;
  const script = document.createElement("script");
  script.id = id;
  script.type = "module";
  script.src = src;
  // A transient asset failure should not permanently disable enhancement for
  // later dialog opens. Native form submission remains the immediate fallback.
  script.addEventListener("error", () => script.remove(), { once: true });
  document.head.append(script);
}

/** Load the two small progressive-enhancement modules only when a sign-in
 * form is actually shown in an island modal. */
export function ensureSigninFormRuntime(): void {
  loadModuleOnce("signin-preview-runtime", SIGNIN_PREVIEW_SRC);
  loadModuleOnce("login-handoff-runtime", LOGIN_HANDOFF_SRC);
}
