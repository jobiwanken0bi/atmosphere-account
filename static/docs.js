function copyCode(button) {
  const figure = button.closest("[data-docs-code]");
  const code = figure?.querySelector("code");
  const text = code?.textContent ?? "";
  if (!text.trim()) return;

  copyText(text).then(() => {
    setCopyState(button, "Copied", true);
  }).catch(() => {
    selectCode(code);
    setCopyState(button, "Selected", false);
  });
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through to the textarea fallback for local/dev browser contexts.
    }
  }
  fallbackCopyText(text);
}

function fallbackCopyText(text) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.append(textarea);
  textarea.select();
  const ok = document.execCommand("copy");
  textarea.remove();
  if (!ok) throw new Error("copy command failed");
}

function selectCode(code) {
  const selection = getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(code);
  selection.removeAllRanges();
  selection.addRange(range);
}

function setCopyState(button, label, copied) {
  const previous = button.textContent || "Copy";
  button.textContent = label;
  if (copied) button.setAttribute("data-copied", "true");
  setTimeout(() => {
    button.textContent = previous;
    button.removeAttribute("data-copied");
  }, 1400);
}

function initTocScrollSpy() {
  const toc = document.querySelector(".docs-toc");
  if (!toc) return;
  const links = Array.from(toc.querySelectorAll('a[href^="#"]'));
  const sections = links.map((link) => {
    const id = decodeURIComponent(link.hash.slice(1));
    const section = document.getElementById(id);
    return section ? { id, link, section } : null;
  }).filter(Boolean);
  if (sections.length === 0) return;

  function activate(id) {
    for (const item of sections) {
      const isActive = item.id === id;
      item.link.classList.toggle("is-active", isActive);
      if (isActive) {
        item.link.setAttribute("aria-current", "location");
      } else {
        item.link.removeAttribute("aria-current");
      }
    }
  }

  function activeSectionId() {
    const threshold = Math.min(globalThis.innerHeight * 0.36, 220);
    let active = sections[0].id;
    for (const item of sections) {
      if (item.section.getBoundingClientRect().top <= threshold) {
        active = item.id;
      } else {
        break;
      }
    }
    const pageBottom = globalThis.scrollY + globalThis.innerHeight;
    const documentBottom = document.documentElement.scrollHeight;
    if (pageBottom >= documentBottom - 4) {
      active = sections[sections.length - 1].id;
    }
    return active;
  }

  function updateActiveSection() {
    activate(activeSectionId());
  }

  let pending = false;
  function scheduleUpdate() {
    if (pending) return;
    pending = true;
    setTimeout(() => {
      pending = false;
      updateActiveSection();
    }, 16);
  }

  globalThis.addEventListener("scroll", scheduleUpdate, { passive: true });
  globalThis.addEventListener("resize", scheduleUpdate);
  globalThis.addEventListener("hashchange", scheduleUpdate);
  updateActiveSection();
}

function initDocsNavPosition() {
  const nav = document.querySelector(".docs-nav");
  const active = nav?.querySelector("a.is-active");
  if (!nav || !active) return;

  function scrollActiveIntoView() {
    active.scrollIntoView({
      block: "nearest",
      inline: "center",
      behavior: "auto",
    });
  }

  requestAnimationFrame(scrollActiveIntoView);
  globalThis.addEventListener("resize", () => {
    requestAnimationFrame(scrollActiveIntoView);
  });
}

document.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const button = target.closest("[data-docs-copy]");
  if (!(button instanceof HTMLButtonElement)) return;
  copyCode(button);
});

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    initTocScrollSpy();
    initDocsNavPosition();
  });
} else {
  initTocScrollSpy();
  initDocsNavPosition();
}
