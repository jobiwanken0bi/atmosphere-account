const HANDOFF_PATHS = new Set(["/login/select", "/oauth/switch"]);

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

  try {
    const response = await fetch(action, {
      method: "POST",
      body: new FormData(form),
      credentials: "same-origin",
      headers: {
        accept: "application/json",
        "x-atmosphere-login": "1",
      },
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
    handoffError(
      form,
      error instanceof Error ? error.message : "Could not continue.",
    );
    form.dataset.loginHandoffPending = "false";
    if (submitter instanceof HTMLButtonElement) {
      submitter.disabled = false;
      submitter.removeAttribute("aria-busy");
    }
    document.dispatchEvent(new CustomEvent("atmo:hide-page-skeleton"));
  }
});
