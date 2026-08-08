const ENHANCED_ATTR = "data-signin-preview-enhanced";
const FLOW_ENHANCED_ATTR = "data-signin-flow-enhanced";

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

function cleanHandle(value) {
  return value.trim().replace(/^@/, "").toLowerCase();
}

function safeAvatarUrl(value) {
  if (typeof value !== "string") return "";
  if (
    value.startsWith("/") || value.startsWith("https://") ||
    value.startsWith("http://")
  ) {
    return value;
  }
  return "";
}

function statusNode(message, loading) {
  const row = document.createElement("div");
  row.className = "signin-form-preview-status";
  row.setAttribute("role", "status");
  row.setAttribute("aria-live", "polite");
  row.setAttribute("aria-atomic", "true");
  if (loading) {
    const spinner = document.createElement("span");
    spinner.className = "signin-form-preview-spinner";
    spinner.setAttribute("aria-hidden", "true");
    row.append(spinner);
  }
  const text = document.createElement("span");
  text.textContent = message;
  row.append(text);
  return row;
}

function matchButton(match, onSelect) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "signin-form-preview-row";
  button.setAttribute("role", "option");

  const avatarUrl = safeAvatarUrl(match.avatarUrl);
  if (avatarUrl) {
    const avatar = document.createElement("img");
    avatar.className = "signin-form-preview-avatar";
    avatar.src = avatarUrl;
    avatar.alt = "";
    avatar.loading = "lazy";
    avatar.decoding = "async";
    button.append(avatar);
  } else {
    const avatar = document.createElement("span");
    avatar.className = "signin-form-preview-avatar";
    avatar.setAttribute("aria-hidden", "true");
    button.append(avatar);
  }

  const meta = document.createElement("span");
  meta.className = "signin-form-preview-meta";
  const name = document.createElement("span");
  name.className = "signin-form-preview-name";
  name.textContent = match.displayName || `@${match.handle}`;
  meta.append(name);
  if (match.displayName) {
    const handle = document.createElement("span");
    handle.className = "signin-form-preview-handle";
    handle.textContent = `@${match.handle}`;
    meta.append(handle);
  }
  button.append(meta);

  button.addEventListener("click", () => onSelect(match));
  return button;
}

function renderSelected(target, match, onClear) {
  if (!target) return;
  const avatarUrl = safeAvatarUrl(match.avatarUrl);
  const avatar = avatarUrl
    ? document.createElement("img")
    : document.createElement("span");
  avatar.className = "signin-form-preview-avatar";
  if (avatarUrl) {
    avatar.src = avatarUrl;
    avatar.alt = "";
    avatar.loading = "lazy";
    avatar.decoding = "async";
  } else {
    avatar.setAttribute("aria-hidden", "true");
  }

  const meta = document.createElement("span");
  meta.className = "signin-form-preview-meta";
  const name = document.createElement("span");
  name.className = "signin-form-preview-name";
  name.textContent = match.displayName || `@${match.handle}`;
  meta.append(name);
  if (match.displayName) {
    const handle = document.createElement("span");
    handle.className = "signin-form-preview-handle";
    handle.textContent = `@${match.handle}`;
    meta.append(handle);
  }

  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "signin-selected-clear";
  clear.setAttribute("aria-label", "Clear selected account");
  clear.textContent = "×";
  clear.addEventListener("click", onClear);

  target.replaceChildren(avatar, meta, clear);
  target.hidden = false;
}

function hideSelected(target) {
  if (!target) return;
  target.hidden = true;
  target.replaceChildren();
}

function renderFormError(form, message) {
  let error = form.querySelector("[data-signin-form-error]");
  if (!error) {
    error = document.createElement("p");
    error.className = "signin-form-error";
    error.setAttribute("data-signin-form-error", "true");
    error.setAttribute("role", "alert");
    form.append(error);
  }
  error.textContent = message;
}

function clearFormError(form) {
  form.querySelector("[data-signin-form-error]")?.remove();
}

function enhanceForm(form, index) {
  if (form.getAttribute(ENHANCED_ATTR) === "true") return;
  const input = form.querySelector("[data-signin-preview-input]");
  if (!(input instanceof HTMLInputElement)) return;
  const field = input.parentElement;
  if (!field) return;

  form.setAttribute(ENHANCED_ATTR, "true");
  const loadingLabel = form.dataset.previewLoading || "Searching…";
  const notFoundLabel = form.dataset.previewNotFound ||
    "No matching account found.";
  const submitLabel = form.dataset.submitLabel || "Continue";
  const submittingLabel = form.dataset.submittingLabel || "Opening sign-in…";
  const errorLabel = form.dataset.errorLabel ||
    "Couldn’t start sign-in. Check the handle and try again.";
  const submitButton = form.querySelector(".signin-form-submit");
  const selectedBox = form.querySelector("[data-signin-selected]");
  const previewId = input.dataset.signinPreviewId ||
    `signin-handle-preview-${index}`;
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", previewId);
  input.setAttribute("aria-expanded", "false");

  const preview = document.createElement("div");
  preview.id = previewId;
  preview.className = "signin-form-preview glass";
  preview.setAttribute("role", "listbox");
  preview.setAttribute("aria-label", "Matching Atmosphere accounts");
  preview.hidden = true;
  field.append(preview);

  let timer = 0;
  let seq = 0;
  let selectedMatch = null;
  let activeController = null;

  function abortPreviewFetch() {
    if (!activeController) return;
    activeController.abort();
    activeController = null;
  }

  function show() {
    preview.hidden = false;
    input.setAttribute("aria-expanded", "true");
  }

  function hide() {
    preview.hidden = true;
    input.setAttribute("aria-expanded", "false");
  }

  function clearSelected() {
    selectedMatch = null;
    hideSelected(selectedBox);
  }

  function renderLoading() {
    preview.replaceChildren(statusNode(loadingLabel, true));
    show();
  }

  function renderMiss() {
    preview.replaceChildren(statusNode(notFoundLabel, false));
    show();
  }

  function renderMatches(matches) {
    if (!Array.isArray(matches) || matches.length === 0) {
      renderMiss();
      return;
    }
    const list = document.createElement("div");
    list.className = "signin-form-preview-list";
    for (const match of matches) {
      if (!match || typeof match.handle !== "string") continue;
      list.append(matchButton(match, (selected) => {
        selectedMatch = selected;
        input.value = selected.handle;
        hide();
        renderSelected(selectedBox, selected, () => {
          input.value = "";
          clearSelected();
          input.focus();
        });
        const clearSelection = selectedBox?.querySelector(
          ".signin-selected-clear",
        );
        if (clearSelection instanceof HTMLButtonElement) {
          clearSelection.focus();
        } else {
          input.focus();
        }
      }));
    }
    if (list.children.length === 0) {
      renderMiss();
      return;
    }
    preview.replaceChildren(list);
    show();
  }

  function schedule(value) {
    const query = cleanHandle(value);
    clearTimeout(timer);
    abortPreviewFetch();
    if (!selectedMatch || selectedMatch.handle !== query) clearSelected();
    if (!query) {
      hide();
      preview.replaceChildren();
      return;
    }
    if (query.length < 2) {
      hide();
      preview.replaceChildren();
      return;
    }
    const mySeq = ++seq;
    renderLoading();
    timer = setTimeout(async () => {
      const controller = new AbortController();
      activeController = controller;
      try {
        const res = await fetch(
          `/api/identity/preview?handle=${encodeURIComponent(query)}`,
          {
            headers: { accept: "application/json" },
            signal: controller.signal,
          },
        );
        const data = await res.json();
        if (mySeq !== seq) return;
        if (data && data.found) {
          renderMatches(data.matches);
        } else {
          renderMiss();
        }
      } catch (err) {
        if (err && err.name === "AbortError") return;
        if (mySeq === seq) renderMiss();
      } finally {
        if (activeController === controller) activeController = null;
      }
    }, 150);
  }

  input.addEventListener("input", () => schedule(input.value));
  input.addEventListener("focus", () => {
    if (input.value.trim()) schedule(input.value);
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !preview.hidden) {
      event.preventDefault();
      event.stopPropagation();
      hide();
      return;
    }
    if (event.key !== "ArrowDown" || preview.hidden) return;
    const firstMatch = preview.querySelector(".signin-form-preview-row");
    if (firstMatch instanceof HTMLButtonElement) {
      event.preventDefault();
      firstMatch.focus();
    }
  });
  preview.addEventListener("keydown", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;
    const matches = Array.from(
      preview.querySelectorAll(".signin-form-preview-row"),
    );
    const index = matches.indexOf(target);
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      hide();
      input.focus();
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      target.click();
      return;
    }
    let next = null;
    if (event.key === "ArrowDown") next = matches[index + 1] ?? matches[0];
    if (event.key === "ArrowUp") next = matches[index - 1] ?? matches.at(-1);
    if (event.key === "Home") next = matches[0];
    if (event.key === "End") next = matches.at(-1);
    if (next instanceof HTMLButtonElement) {
      event.preventDefault();
      next.focus();
    }
  });
  form.addEventListener("submit", async (event) => {
    if (!input.value.trim()) {
      event.preventDefault();
      input.focus();
      return;
    }
    event.preventDefault();
    clearFormError(form);
    if (submitButton instanceof HTMLButtonElement) {
      submitButton.disabled = true;
      submitButton.textContent = submittingLabel;
    }
    try {
      const res = await fetch(form.action || "/oauth/login", {
        method: (form.method || "POST").toUpperCase(),
        body: new FormData(form),
        credentials: "same-origin",
        headers: {
          accept: "application/json",
          "x-atmosphere-login": "1",
        },
      });
      const body = await res.json().catch(() => null);
      const destination = body
        ? safeNavigationDestination(body.redirectUrl)
        : null;
      if (!res.ok || !destination) {
        throw new Error(errorLabel);
      }
      globalThis.location.assign(destination);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      renderFormError(form, message);
      if (submitButton instanceof HTMLButtonElement) {
        submitButton.disabled = false;
        submitButton.textContent = submitLabel;
      }
      document.dispatchEvent(new CustomEvent("atmo:hide-page-skeleton"));
    }
  });
  if (submitButton instanceof HTMLButtonElement) {
    submitButton.textContent = submitLabel;
  }
}

function enhanceFlow(flow) {
  if (flow.getAttribute(FLOW_ENHANCED_ATTR) === "true") return;
  flow.setAttribute(FLOW_ENHANCED_ATTR, "true");
  const tabs = Array.from(flow.querySelectorAll("[data-signin-tab]"));
  const panels = Array.from(flow.querySelectorAll("[data-signin-panel]"));
  const showManualButtons = Array.from(
    flow.querySelectorAll("[data-signin-show-manual]"),
  );
  const showSavedButtons = Array.from(
    flow.querySelectorAll("[data-signin-show-saved]"),
  );
  const savedView = flow.querySelector("[data-signin-saved-view]");
  const manualView = flow.querySelector("[data-signin-manual-view]");
  const pageCopyScope = flow.closest("[data-signin-page-copy]");
  const manualForm = flow.querySelector(
    'form.signin-form[data-signin-preview="true"]',
  );

  function setPageCopy(mode) {
    if (!(pageCopyScope instanceof HTMLElement)) return;
    for (
      const node of pageCopyScope.querySelectorAll(
        "[data-signin-mode-copy]",
      )
    ) {
      const value = node.getAttribute(`data-signin-copy-${mode}`);
      if (value !== null) node.textContent = value;
    }
  }

  function setMode(mode) {
    for (const tab of tabs) {
      const active = tab.getAttribute("data-signin-tab") === mode;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", active ? "true" : "false");
      tab.setAttribute("tabindex", active ? "0" : "-1");
    }
    for (const panel of panels) {
      panel.hidden = panel.getAttribute("data-signin-panel") !== mode;
    }
    setPageCopy(mode);
  }

  function setSigninView(view) {
    if (savedView) savedView.hidden = view !== "saved";
    if (manualView) manualView.hidden = view !== "manual";
  }

  for (const tab of tabs) {
    tab.addEventListener("click", (event) => {
      event.preventDefault();
      setMode(tab.getAttribute("data-signin-tab") || "signin");
    });
    tab.addEventListener("keydown", (event) => {
      const current = tabs.indexOf(tab);
      let next = null;
      if (event.key === "ArrowRight") next = tabs[current + 1] ?? tabs[0];
      if (event.key === "ArrowLeft") next = tabs[current - 1] ?? tabs.at(-1);
      if (event.key === "Home") next = tabs[0];
      if (event.key === "End") next = tabs.at(-1);
      if (!(next instanceof HTMLElement)) return;
      event.preventDefault();
      next.click();
      next.focus();
    });
  }

  if (manualForm) {
    for (const showManual of showManualButtons) {
      showManual.addEventListener("click", (event) => {
        event.preventDefault();
        setSigninView("manual");
        const input = manualForm.querySelector("[data-signin-preview-input]");
        if (input instanceof HTMLInputElement) input.focus();
      });
    }
    for (const showSaved of showSavedButtons) {
      showSaved.addEventListener("click", (event) => {
        event.preventDefault();
        setSigninView("saved");
        const firstSaved = savedView?.querySelector(
          ".signin-account-row",
        );
        if (firstSaved instanceof HTMLElement) firstSaved.focus();
      });
    }
  }

  setSigninView(flow.getAttribute("data-initial-signin-view") || "manual");
  setMode(flow.getAttribute("data-initial-mode") || "signin");
}

function hasSigninPreviewTargets() {
  return Boolean(
    document.querySelector('[data-signin-flow="true"]') ||
      document.querySelector('form.signin-form[data-signin-preview="true"]'),
  );
}

function bootSigninPreviews() {
  document
    .querySelectorAll('[data-signin-flow="true"]')
    .forEach((flow) => enhanceFlow(flow));
  document
    .querySelectorAll('form.signin-form[data-signin-preview="true"]')
    .forEach((form, index) => enhanceForm(form, index));
}

if (hasSigninPreviewTargets()) bootSigninPreviews();
setTimeout(bootSigninPreviews, 0);
document.addEventListener("DOMContentLoaded", bootSigninPreviews);

// One delegated outside-click listener serves both page forms and portal
// modals. Per-form listeners retained detached modal trees after every reopen.
document.addEventListener("pointerdown", (event) => {
  document
    .querySelectorAll(`form.signin-form[${ENHANCED_ATTR}="true"]`)
    .forEach((form) => {
      if (form.contains(event.target)) return;
      const input = form.querySelector("[data-signin-preview-input]");
      const previewId = input?.getAttribute("aria-controls");
      const preview = previewId ? document.getElementById(previewId) : null;
      if (preview) preview.hidden = true;
      input?.setAttribute("aria-expanded", "false");
    });
});

// Portal-based contextual modals are mounted after this module evaluates, so
// observe unconditionally rather than only when a form exists at page load.
let observerTimer = 0;
const observer = new MutationObserver(() => {
  clearTimeout(observerTimer);
  observerTimer = setTimeout(bootSigninPreviews, 25);
});

observer.observe(document.documentElement, {
  childList: true,
  subtree: true,
});
