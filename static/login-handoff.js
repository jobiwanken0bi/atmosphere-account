const target = document.querySelector("[data-login-handoff-target]");

if (target instanceof HTMLAnchorElement) {
  globalThis.location.replace(target.href);
}

const HANDOFF_PATHS = new Set(["/login/select", "/oauth/switch"]);
const HANDOFF_TIMEOUT_MS = 12_000;

function handoffError(form, message) {
  let error = form.querySelector("[data-login-handoff-error]");
  if (!error) {
    error = document.createElement("p");
    error.className = "signin-form-error";
    error.setAttribute("data-login-handoff-error", "true");
    form.append(error);
  }
  error.textContent = message;
}

function urlEncodedForm(form) {
  const params = new URLSearchParams();
  for (const [name, value] of new FormData(form)) {
    if (typeof value === "string") params.append(name, value);
  }
  return params;
}

document.addEventListener("submit", async (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;

  const action = new URL(form.action || globalThis.location.href);
  if (
    action.origin !== globalThis.location.origin ||
    !HANDOFF_PATHS.has(action.pathname)
  ) return;

  event.preventDefault();
  if (form.dataset.loginHandoffPending === "true") return;
  form.dataset.loginHandoffPending = "true";
  form.querySelector("[data-login-handoff-error]")?.remove();

  const submitter = event.submitter instanceof HTMLButtonElement
    ? event.submitter
    : form.querySelector('button[type="submit"]');
  if (submitter instanceof HTMLButtonElement) {
    submitter.disabled = true;
    submitter.setAttribute("aria-busy", "true");
  }

  const controller = new AbortController();
  const timeout = globalThis.setTimeout(
    () => controller.abort(),
    HANDOFF_TIMEOUT_MS,
  );
  try {
    const params = urlEncodedForm(form);
    for (const [name, value] of params) action.searchParams.append(name, value);
    const response = await fetch(action, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        accept: "application/json",
        "x-atmosphere-login": "1",
      },
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body || typeof body.redirectUrl !== "string") {
      throw new Error(
        body && typeof body.error === "string"
          ? body.error
          : "Could not continue with this account.",
      );
    }
    globalThis.location.assign(body.redirectUrl);
  } catch (error) {
    const message = error instanceof DOMException && error.name === "AbortError"
      ? "This is taking too long. Please try again."
      : error instanceof Error
      ? error.message
      : "Could not continue.";
    handoffError(form, message);
    form.dataset.loginHandoffPending = "false";
    if (submitter instanceof HTMLButtonElement) {
      submitter.disabled = false;
      submitter.removeAttribute("aria-busy");
    }
    document.dispatchEvent(new CustomEvent("atmo:hide-page-skeleton"));
  } finally {
    globalThis.clearTimeout(timeout);
  }
});
