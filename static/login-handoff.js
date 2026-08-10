const target = document.querySelector("[data-login-handoff-target]");

if (target instanceof HTMLAnchorElement) {
  const destination = safeNavigationDestination(target.href);
  if (destination) globalThis.location.replace(destination);
}

const HANDOFF_PATHS = new Set(["/login/select", "/oauth/switch"]);
const HANDOFF_TIMEOUT_MS = 12_000;

function isLoopbackNavigationHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(
    /\.$/,
    "",
  );
  if (host === "localhost" || host.endsWith(".localhost") || host === "::1") {
    return true;
  }
  const parts = host.split(".").map(Number);
  return parts.length === 4 &&
    parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) &&
    parts[0] === 127;
}

function isPrivateNavigationHost(hostname) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(
    /\.$/,
    "",
  );
  if (
    isLoopbackNavigationHost(host) || host.endsWith(".local") ||
    host.endsWith(".internal") || host.endsWith(".home.arpa") ||
    host.endsWith(".test") || host.endsWith(".invalid") ||
    host.endsWith(".example") || host.endsWith(".onion") ||
    host === "0.0.0.0" || host === "::" || host.startsWith("::")
  ) return true;
  const parts = host.split(".").map(Number);
  if (
    parts.length === 4 &&
    parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
  ) {
    const [a, b, c] = parts;
    return a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0 && (c === 0 || c === 2)) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113) || a >= 224;
  }
  if (!host.includes(":") && !host.includes(".")) return true;
  return host.startsWith("fc") || host.startsWith("fd") ||
    /^fe[89ab]/.test(host) || host.startsWith("ff");
}

function safeNavigationDestination(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const current = new URL(globalThis.location.href);
    const target = new URL(value, current);
    if (target.username || target.password) return null;
    if (target.origin === current.origin) {
      return target.protocol === "http:" || target.protocol === "https:"
        ? target.toString()
        : null;
    }
    if (
      target.protocol === "https:" && !isPrivateNavigationHost(target.hostname)
    ) {
      return target.toString();
    }
    if (
      target.protocol === "http:" &&
      isLoopbackNavigationHost(current.hostname) &&
      isLoopbackNavigationHost(target.hostname)
    ) return target.toString();
  } catch {
    // Invalid and active-scheme destinations are rejected below.
  }
  return null;
}

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

function formActionUrl(form) {
  const rawAction = form.getAttribute("action")?.trim();
  if (!rawAction) return null;
  try {
    return new URL(rawAction, `${globalThis.location.origin}/`);
  } catch {
    return null;
  }
}

document.addEventListener("submit", async (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;

  const action = formActionUrl(form);
  if (
    !action || action.origin !== globalThis.location.origin ||
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
        "x-atmosphere-login-bodyless": "1",
      },
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null);
    const destination = body
      ? safeNavigationDestination(body.redirectUrl)
      : null;
    if (!response.ok || !destination) {
      throw new Error(
        body && typeof body.error === "string"
          ? body.error
          : "Could not continue with this account.",
      );
    }
    globalThis.location.assign(destination);
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
