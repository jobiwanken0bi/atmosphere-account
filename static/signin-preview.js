const ENHANCED_ATTR = "data-signin-preview-enhanced";
const FLOW_ENHANCED_ATTR = "data-signin-flow-enhanced";

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

  button.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    onSelect(match);
  });
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
  clear.textContent = "x";
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
  const loadingLabel = form.dataset.previewLoading || "Searching...";
  const notFoundLabel = form.dataset.previewNotFound ||
    "No matching account found.";
  const submitLabel = form.dataset.submitLabel || "Continue";
  const submittingLabel = form.dataset.submittingLabel || "Redirecting...";
  const submitButton = form.querySelector(".signin-form-submit");
  const selectedBox = form.querySelector("[data-signin-selected]");
  const previewId = input.getAttribute("aria-controls") ||
    `signin-handle-preview-${index}`;
  input.setAttribute("aria-controls", previewId);
  input.setAttribute("aria-expanded", "false");

  const preview = document.createElement("div");
  preview.id = previewId;
  preview.className = "signin-form-preview glass";
  preview.setAttribute("role", "listbox");
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
  document.addEventListener("pointerdown", (event) => {
    if (!form.contains(event.target)) hide();
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
      if (!res.ok || !body || typeof body.redirectUrl !== "string") {
        throw new Error(
          body && typeof body.error === "string"
            ? body.error
            : "Could not start sign in.",
        );
      }
      globalThis.location.assign(body.redirectUrl);
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
  const manualForm = flow.querySelector(
    'form.signin-form[data-signin-preview="true"]',
  );

  function setMode(mode) {
    for (const tab of tabs) {
      const active = tab.getAttribute("data-signin-tab") === mode;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", active ? "true" : "false");
    }
    for (const panel of panels) {
      panel.hidden = panel.getAttribute("data-signin-panel") !== mode;
    }
  }

  for (const tab of tabs) {
    tab.addEventListener("click", () => {
      setMode(tab.getAttribute("data-signin-tab") || "signin");
    });
  }

  if (manualForm) {
    for (const showManual of showManualButtons) {
      showManual.addEventListener("click", () => {
        manualForm.hidden = false;
        const input = manualForm.querySelector("[data-signin-preview-input]");
        if (input instanceof HTMLInputElement) input.focus();
      });
    }
  }

  if (showManualButtons.length === 0 && manualForm?.hidden) {
    manualForm.hidden = false;
  }

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

if (hasSigninPreviewTargets()) {
  bootSigninPreviews();
  setTimeout(bootSigninPreviews, 0);
  document.addEventListener("DOMContentLoaded", bootSigninPreviews);

  let observerTimer = 0;
  const observer = new MutationObserver(() => {
    clearTimeout(observerTimer);
    observerTimer = setTimeout(bootSigninPreviews, 25);
  });

  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
}
